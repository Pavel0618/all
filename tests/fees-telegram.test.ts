import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { associatedTokenAddress, createAtaIdempotentIx, feePercentLabel } from '../src/lib/fees';
import { SOL_MINT, jupQuote, jupSwapTransaction, type JupQuote } from '../src/lib/jupiter';
import { kyberRoute } from '../src/lib/kyber';
import { routeToStartParam, startParamToRoute } from '../src/lib/telegram';
import { parseEvmKey, parseSolanaSecret } from '../src/wallet/builtin';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

describe('комиссия', () => {
  it('wSOL-счёт для комиссий совпадает с @solana/spl-token', () => {
    const owner = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
    // Эталон: getAssociatedTokenAddressSync(NATIVE_MINT, owner) из @solana/spl-token
    expect(associatedTokenAddress(owner, new PublicKey(SOL_MINT)).toBase58()).toBe('8LjUgMjzZuHj8VdyxzkmLLQVmW4C3gd56md1nLd76TNW');
  });

  it('инструкция создания счёта — CreateIdempotent', () => {
    const payer = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const ix = createAtaIdempotentIx(payer, owner, new PublicKey(SOL_MINT));
    expect(ix.programId.toBase58()).toBe('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    expect([...ix.data]).toEqual([1]);
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.keys[1].pubkey.toBase58()).toBe(associatedTokenAddress(owner, new PublicKey(SOL_MINT)).toBase58());
  });

  it('подпись процента', () => {
    expect(feePercentLabel(50)).toBe('0,5%');
    expect(feePercentLabel(100)).toBe('1%');
  });
});

describe('комиссия уходит в агрегаторы', () => {
  afterEach(() => vi.unstubAllGlobals());

  const okJson = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it('Jupiter: platformFeeBps в котировке и feeAccount в транзакции', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body as string | undefined });
        return okJson(url.includes('/quote') ? { outAmount: '1' } : { swapTransaction: 'x', lastValidBlockHeight: 1 });
      }),
    );
    await jupQuote({ inputMint: SOL_MINT, outputMint: 'M', amount: '100', slippageBps: 500, platformFeeBps: 50 });
    expect(new URL(calls[0].url).searchParams.get('platformFeeBps')).toBe('50');
    await jupSwapTransaction({} as JupQuote, 'U', 'high', 'FEEACC').catch(() => undefined);
    expect(JSON.parse(calls[1].body!).feeAccount).toBe('FEEACC');
  });

  it('Jupiter: без комиссии параметров нет', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => (calls.push(url), okJson({}))));
    await jupQuote({ inputMint: SOL_MINT, outputMint: 'M2', amount: '100', slippageBps: 500 });
    expect(new URL(calls[0]).searchParams.has('platformFeeBps')).toBe(false);
  });

  it('KyberSwap: feeAmount в bps, получатель и сторона', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => (calls.push(url), okJson({ code: 0, data: { routeSummary: {}, routerAddress: '0x' } }))));
    await kyberRoute('base', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', '0x1', '1000', {
      bps: 50,
      receiver: '0x2222222222222222222222222222222222222222',
      chargeFeeBy: 'currency_in',
    });
    const q = new URL(calls[0]).searchParams;
    expect(q.get('feeAmount')).toBe('50');
    expect(q.get('isInBps')).toBe('true');
    expect(q.get('chargeFeeBy')).toBe('currency_in');
    expect(q.get('feeReceiver')).toBe('0x2222222222222222222222222222222222222222');
  });
});

describe('Telegram диплинки', () => {
  it('туда и обратно', () => {
    const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const p = routeToStartParam('solana', mint)!;
    expect(p.length).toBeLessThanOrEqual(64);
    expect(startParamToRoute(p)).toBe(`#/token/solana/${mint}`);
    const evm = routeToStartParam('ethereum', '0x6982508145454ce325ddbe47a25d4ec3d2311933')!;
    expect(startParamToRoute(evm)).toBe('#/token/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933');
  });

  it('мусор не открывает страницу', () => {
    expect(startParamToRoute('hello')).toBeUndefined();
    expect(startParamToRoute('polygon_0x6982508145454ce325ddbe47a25d4ec3d2311933')).toBeUndefined();
    expect(startParamToRoute('solana_../../x')).toBeUndefined();
  });
});

describe('импорт ключей', () => {
  it('Solana: base58 (Phantom) и массив (Solflare)', () => {
    const kp = Keypair.generate();
    expect(parseSolanaSecret(bs58.encode(kp.secretKey))?.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(parseSolanaSecret(JSON.stringify(Array.from(kp.secretKey)))?.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(parseSolanaSecret('not a key')).toBeUndefined();
  });

  it('EVM: с 0x и без', () => {
    const k = 'ab'.repeat(32);
    expect(parseEvmKey(k)).toBe(`0x${k}`);
    expect(parseEvmKey(`0x${k}`)).toBe(`0x${k}`);
    expect(parseEvmKey('0x123')).toBeUndefined();
  });
});
