import { afterEach, describe, expect, it, vi } from 'vitest';
import { abiFlags, holdersConcentration } from '../src/lib/blockscout';
import { checkSecurity, groupStatus } from '../src/lib/security';
import { evmBuild, evmQuote } from '../src/lib/evmSwap';
import { getTrendingTokenAddresses } from '../src/lib/gecko';
import { CHAINS, isChainId, parseUserInput } from '../src/lib/chains';

const TOKEN = '0x1234567890abcdef1234567890abcdef12345678';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const notFound = () => Promise.resolve(new Response('{"error":"not found"}', { status: 404 }));

afterEach(() => vi.unstubAllGlobals());

describe('Robinhood Chain в конфигурации', () => {
  it('сеть есть и разбирается из ссылок', () => {
    expect(CHAINS.robinhood).toMatchObject({ evmChainId: 4663, native: 'ETH', kind: 'evm' });
    expect(parseUserInput(`https://dexscreener.com/robinhood/${TOKEN}`)).toMatchObject({ chain: 'robinhood', address: TOKEN });
  });
  it('isChainId не путает служебные имена объекта с сетями', () => {
    expect(isChainId('robinhood')).toBe(true);
    expect(isChainId('constructor')).toBe(false);
    expect(isChainId('toString')).toBe(false);
  });
});

describe('проверка контракта по Blockscout', () => {
  const fn = (name: string, stateMutability = 'nonpayable') => ({ type: 'function', name, stateMutability });

  it('находит mint / pause / blacklist / смену налога', () => {
    const flags = abiFlags([fn('transfer'), fn('approve'), fn('mint'), fn('pause'), fn('addToBlacklist'), fn('setBuyTax'), fn('balanceOf', 'view')], false);
    const texts = flags.map((f) => `${f.group}:${f.severity}`);
    expect(texts).toEqual(['permissions:danger', 'permissions:danger', 'permissions:danger', 'tax:danger']);
  });

  it('без владельца те же функции — только предупреждение', () => {
    const flags = abiFlags([fn('mint')], true);
    expect(flags[0].severity).toBe('warn');
  });

  it('не считает сменой налога setFeeReceiver', () => {
    expect(abiFlags([fn('setFeeReceiver'), fn('setFeeWallet')], false)).toHaveLength(0);
  });

  it('концентрация держателей без контрактов и сожжённых адресов', () => {
    const share = holdersConcentration(
      [
        { address: { hash: '0xpool', is_contract: true }, value: '500' },
        { address: { hash: '0x000000000000000000000000000000000000dead' }, value: '200' },
        { address: { hash: '0xa' }, value: '100' },
        { address: { hash: '0xb' }, value: '50' },
      ],
      1000n,
    );
    expect(share).toBe(15);
  });

  it('если GoPlus молчит — проверяем сами и не выдаём «всё чисто» без оснований', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('gopluslabs')) return ok({ code: 1, result: {} });
        if (url.includes('/smart-contracts/')) return ok({ is_verified: true, abi: [fn('transfer'), fn('setTax')], proxy_type: null });
        if (url.endsWith('/holders')) return ok({ items: [{ address: { hash: '0xa' }, value: '100' }] });
        if (url.includes('/tokens/')) return ok({ total_supply: '1000' });
        if (init?.method === 'POST') return ok({ result: '0x' + '0'.repeat(64) }); // owner() = 0x0 → отказался от прав
        return notFound();
      }),
    );
    const r = await checkSecurity('robinhood', TOKEN);
    expect(r.sources).toEqual(['Blockscout']);
    expect(groupStatus(r, 'tax')).toBe('warn'); // setTax есть, но владельца нет
    expect(groupStatus(r, 'honeypot')).toBe('warn'); // честно: не проверено
    expect(groupStatus(r, 'liquidity')).toBe('warn');
    expect(groupStatus(r, 'owner')).toBe('ok');
  });

  it('закрытый код — опасно', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('gopluslabs')) return ok({ code: 1, result: {} });
        if (url.includes('/smart-contracts/')) return ok({ is_verified: false });
        if (url.includes('/tokens/')) return ok({ total_supply: '1000' });
        return ok({ result: '0x' });
      }),
    );
    const r = await checkSecurity('robinhood', '0x2234567890abcdef1234567890abcdef12345678');
    expect(groupStatus(r, 'owner')).toBe('danger');
  });
});

describe('обмен: KyberSwap → LI.FI', () => {
  const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
  let diamond = LIFI_DIAMOND;

  it('если KyberSwap не знает сеть, котировка и транзакция идут через LI.FI', async () => {
    diamond = LIFI_DIAMOND;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        if (url.includes('kyberswap')) return ok({ code: 4008, message: 'chain not supported' });
        if (url.includes('li.quest')) {
          return ok({
            estimate: { fromAmount: '1000', toAmount: '5000', approvalAddress: LIFI_DIAMOND, fromAmountUSD: '3', toAmountUSD: '2.9' },
            transactionRequest: { to: diamond, data: '0xabcdef', value: '0x3e8' },
          });
        }
        return notFound();
      }),
    );
    const side = { chain: 'robinhood' as const, buy: true, token: TOKEN, amountIn: 1000n };
    const q = await evmQuote(side, '0xme');
    expect(q.provider).toBe('LI.FI');
    expect(q.amountOut).toBe('5000');
    const tx = await evmBuild(side, q, '0xme', 500);
    expect(tx).toMatchObject({ to: LIFI_DIAMOND, data: '0xabcdef', value: 1000n });
    const lifiUrl = new URL(calls.filter((c) => c.includes('li.quest')).at(-1)!);
    expect(lifiUrl.searchParams.get('fromChain')).toBe('4663');
    expect(lifiUrl.searchParams.get('slippage')).toBe('0.05');
  });

  it('LI.FI вернул транзакцию на чужой контракт — сделка останавливается', async () => {
    diamond = '0x000000000000000000000000000000000000dEaD';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('kyberswap')) return ok({ code: 4008, message: 'chain not supported' });
        return ok({
          estimate: { fromAmount: '1000', toAmount: '5000', approvalAddress: LIFI_DIAMOND },
          transactionRequest: { to: diamond, data: '0xabcdef', value: '0x3e8' },
        });
      }),
    );
    const side = { chain: 'robinhood' as const, buy: true, token: TOKEN, amountIn: 1000n };
    const q = await evmQuote(side, '0xme');
    await expect(evmBuild(side, q, '0xme', 500)).rejects.toThrow(/Сделка остановлена/);
  });
});

describe('GeckoTerminal: поиск id новой сети', () => {
  it('при 404 ищет сеть по названию и запоминает', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/networks/robinhood/')) return notFound();
        if (url.includes('/networks?page=1')) return ok({ data: [{ id: 'eth', attributes: { name: 'Ethereum' } }, { id: 'rh-chain', attributes: { name: 'Robinhood Chain' } }] });
        if (url.includes('/networks/rh-chain/trending_pools')) {
          return ok({ data: [{ id: 'p', attributes: { name: 'x', address: 'p' }, relationships: { base_token: { data: { id: `rh-chain_${TOKEN}` } } } }] });
        }
        return notFound();
      }),
    );
    expect(await getTrendingTokenAddresses('robinhood')).toEqual([TOKEN]);
  });
});
