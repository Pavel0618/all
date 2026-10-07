// Смоук-тест Gem Radar в Chromium: все внешние API подменены фикстурами,
// кошельки — тестовые (Wallet Standard для Solana и EIP-6963 для EVM).
// Запуск: npm run e2e   (скриншоты — в e2e/screenshots)
// Если Chromium для Playwright не установлен: npx playwright install chromium
// или укажите свой браузер: CHROMIUM_PATH=/path/to/chrome npm run e2e
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Keypair, TransactionMessage, VersionedTransaction, SystemProgram, PublicKey } = require('@solana/web3.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// Тестовый кошелёк и «транзакция», которую якобы вернул Jupiter
const FX = (() => {
  const kp = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey('11111111111111111111111111111112'), lamports: 1 })],
  }).compileToV0Message();
  return {
    address: kp.publicKey.toBase58(),
    pubkeyBytes: Array.from(kp.publicKey.toBytes()),
    swapTx: Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64'),
    tokenA: Keypair.generate().publicKey.toBase58(),
    tokenB: Keypair.generate().publicKey.toBase58(),
    tokenC: Keypair.generate().publicKey.toBase58(),
  };
})();
const EVM_TOKEN = '0x1111111111111111111111111111111111111111';
const EVM_ACCOUNT = '0x2222222222222222222222222222222222222222';
const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const now = Date.now();

function pair(chainId, addr, symbol, name, o = {}) {
  return {
    chainId,
    dexId: o.dexId ?? 'raydium',
    url: `https://dexscreener.com/${chainId}/pair${symbol}`,
    pairAddress: `pair${symbol}`,
    baseToken: { address: addr, name, symbol },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: '0.0000012',
    priceUsd: o.priceUsd ?? '0.00021',
    txns: { m5: { buys: 40, sells: 20 }, h1: { buys: 380, sells: 220 }, h6: { buys: 700, sells: 500 }, h24: { buys: 2000, sells: 1500 } },
    volume: { m5: 4000, h1: 52000, h6: 120000, h24: 300000 },
    priceChange: o.priceChange ?? { m5: 2.1, h1: 14.3, h6: 48, h24: 75 },
    liquidity: { usd: o.liq ?? 42000, base: 1, quote: 1 },
    fdv: o.mcap ?? 210000,
    marketCap: o.mcap ?? 210000,
    pairCreatedAt: now - (o.ageH ?? 9) * 3600_000,
    info: {
      imageUrl: undefined,
      websites: [{ label: 'Website', url: 'https://example.org' }],
      socials: o.noTwitter ? [] : [{ type: 'twitter', url: `https://x.com/${symbol.toLowerCase()}coin` }],
    },
    boosts: o.boosted ? { active: 10 } : undefined,
  };
}

const PAIRS = {
  [FX.tokenA]: pair('solana', FX.tokenA, 'FROGAI', 'Frog AI'),
  [FX.tokenB]: pair('solana', FX.tokenB, 'MOON', 'Moon Rocket', { mcap: 3_400_000, liq: 210000, boosted: true }),
  [FX.tokenC]: pair('solana', FX.tokenC, 'SCAM', 'Totally Safe', { mcap: 90000, liq: 15000, noTwitter: true }),
  [EVM_TOKEN.toLowerCase()]: pair('base', EVM_TOKEN, 'BASED', 'Based Pepe', { mcap: 260000, liq: 55000, priceUsd: '0.000025' }),
};

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify(body),
});

const unknownRpc = new Set();
const evmSent = [];

async function routeAll(page) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const host = url.hostname;

    if (host === 'localhost') {
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.join(DIST, p);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
      const type = p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
    }

    if (host === 'api.dexscreener.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname.startsWith('/token-boosts')) return route.fulfill(json([{ chainId: 'solana', tokenAddress: FX.tokenB, amount: 10 }]));
      if (url.pathname.startsWith('/token-profiles'))
        return route.fulfill(
          json([
            { chainId: 'solana', tokenAddress: FX.tokenA, description: 'First AI frog on Solana', links: [{ type: 'twitter', url: 'https://x.com/frogaicoin' }] },
            { chainId: 'solana', tokenAddress: FX.tokenC, description: 'safe' },
          ]),
        );
      if (parts[0] === 'tokens' && parts[1] === 'v1') {
        const addrs = parts[3].split(',');
        return route.fulfill(json(addrs.map((a) => PAIRS[a] ?? PAIRS[a.toLowerCase()]).filter(Boolean)));
      }
      if (url.pathname.startsWith('/latest/dex/search')) return route.fulfill(json({ pairs: Object.values(PAIRS) }));
      if (url.pathname.startsWith('/latest/dex/tokens/')) {
        const a = parts[3];
        const p = PAIRS[a] ?? PAIRS[a.toLowerCase()];
        return route.fulfill(json({ pairs: p ? [p] : [] }));
      }
      if (url.pathname.startsWith('/latest/dex/pairs/')) return route.fulfill(json({ pairs: null }));
      return route.fulfill(json({}, 404));
    }

    if (host === 'api.geckoterminal.com') {
      return route.fulfill(
        json({
          data: [FX.tokenA, FX.tokenB, FX.tokenC].map((a, i) => ({
            id: `solana_pool${i}`,
            type: 'pool',
            attributes: { name: 'x', address: `pool${i}` },
            relationships: { base_token: { data: { id: `solana_${a}`, type: 'token' } } },
          })),
        }),
      );
    }

    if (host === 'api.rugcheck.xyz') {
      const mint = url.pathname.split('/')[3];
      if (mint === FX.tokenC)
        return route.fulfill(json({ score: 9000, score_normalised: 72, risks: [{ name: 'Mint Authority still enabled', level: 'danger' }, { name: 'Low Liquidity', level: 'warn' }], lpLockedPct: 0 }));
      return route.fulfill(json({ score: 1, score_normalised: 1, risks: [], lpLockedPct: 100 }));
    }

    if (host === 'api.gopluslabs.io') {
      const addr = url.searchParams.get('contract_addresses');
      if (url.pathname.includes('/solana/')) {
        const bad = addr === FX.tokenC;
        return route.fulfill(json({ code: 1, message: 'OK', result: { [addr]: { mintable: { status: bad ? '1' : '0' }, freezable: { status: '0' }, transfer_hook: [] } } }));
      }
      return route.fulfill(
        json({
          code: 1,
          message: 'OK',
          result: {
            [addr.toLowerCase()]: {
              is_open_source: '1', is_proxy: '0', is_mintable: '0', owner_address: '', buy_tax: '0', sell_tax: '0.01', is_honeypot: '0',
              transfer_pausable: '0', is_blacklisted: '0', is_whitelisted: '0', hidden_owner: '0', can_take_back_ownership: '0',
              lp_holders: [{ address: '0x000000000000000000000000000000000000dead', percent: '0.99', is_locked: 0 }],
            },
          },
        }),
      );
    }

    if (host === 'lite-api.jup.ag') {
      if (url.pathname.endsWith('/quote')) {
        const sell = url.searchParams.get('outputMint') === 'So11111111111111111111111111111111111111112';
        return route.fulfill(
          json({
            inputMint: url.searchParams.get('inputMint'),
            inAmount: url.searchParams.get('amount'),
            outputMint: url.searchParams.get('outputMint'),
            outAmount: sell ? '480000000' : '476190000000',
            otherAmountThreshold: '1',
            swapMode: 'ExactIn',
            slippageBps: Number(url.searchParams.get('slippageBps')),
            priceImpactPct: '0.0123',
            routePlan: [{ swapInfo: { label: 'Raydium CPMM' } }],
          }),
        );
      }
      if (url.pathname.endsWith('/swap')) {
        const body = JSON.parse(req.postData());
        if (!body.quoteResponse || !body.userPublicKey || !body.prioritizationFeeLamports?.priorityLevelWithMaxLamports) {
          return route.fulfill(json({ error: 'bad request' }, 400));
        }
        return route.fulfill(json({ swapTransaction: FX.swapTx, lastValidBlockHeight: 1000 }));
      }
    }

    if (host === 'aggregator-api.kyberswap.com') {
      if (req.headers()['x-client-id'] !== 'gem-radar') return route.fulfill(json({ code: 4001, message: 'no client id' }, 400));
      if (url.pathname.endsWith('/routes')) {
        const tokenIn = url.searchParams.get('tokenIn');
        const sell = tokenIn.toLowerCase() === EVM_TOKEN.toLowerCase();
        return route.fulfill(
          json({
            code: 0,
            message: 'successfully',
            data: {
              routeSummary: {
                tokenIn, amountIn: url.searchParams.get('amountIn'), amountInUsd: '25.0', tokenOut: url.searchParams.get('tokenOut'),
                amountOut: sell ? '9000000000000000' : '1000000000000000000000000', amountOutUsd: '24.6', gas: '200000', gasPrice: '1', gasUsd: '0.04',
                extraFee: { feeAmount: '0', chargeFeeBy: '', isInBps: false, feeReceiver: '' }, route: [],
              },
              routerAddress: ROUTER,
            },
          }),
        );
      }
      if (url.pathname.endsWith('/route/build')) {
        const body = JSON.parse(req.postData());
        return route.fulfill(
          json({ code: 0, message: 'ok', data: { amountIn: body.routeSummary.amountIn, amountOut: body.routeSummary.amountOut, gas: '200000', gasPrice: '1', data: '0xdeadbeef', routerAddress: ROUTER, transactionValue: body.routeSummary.tokenIn.toLowerCase().startsWith('0xeeee') ? body.routeSummary.amountIn : '0' } }),
        );
      }
    }

    if (host === 'solana-rpc.publicnode.com') {
      const body = JSON.parse(req.postData() || '{}');
      const handle = (r) => {
        const ctx = { context: { slot: 1, apiVersion: '2.0.0' } };
        switch (r.method) {
          case 'getAccountInfo':
            return { ...ctx, value: { data: { program: 'spl-token', parsed: { type: 'mint', info: { decimals: 6, supply: '1000000000000000', isInitialized: true } }, space: 82 }, executable: false, lamports: 1461600, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch: 0, space: 82 } };
          case 'getBalance':
            return { ...ctx, value: 2_500_000_000 };
          case 'getTokenAccountsByOwner':
            return {
              ...ctx,
              value: [
                {
                  pubkey: '11111111111111111111111111111113',
                  account: { data: { program: 'spl-token', parsed: { type: 'account', info: { tokenAmount: { amount: '476190000000', decimals: 6, uiAmount: 476190, uiAmountString: '476190' } } }, space: 165 }, executable: false, lamports: 2039280, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch: 0, space: 165 },
                },
              ],
            };
          case 'getSignatureStatuses':
            return { ...ctx, value: [{ slot: 2, confirmations: null, err: null, confirmationStatus: 'confirmed', status: { Ok: null } }] };
          case 'getBlockHeight':
            return 100;
          case 'getLatestBlockhash':
            return { ...ctx, value: { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1000 } };
          default:
            unknownRpc.add(r.method);
            return null;
        }
      };
      const res = Array.isArray(body) ? body.map((r) => ({ jsonrpc: '2.0', id: r.id, result: handle(r) })) : { jsonrpc: '2.0', id: body.id, result: handle(body) };
      return route.fulfill(json(res));
    }

    if (host === 'dexscreener.com') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#111;color:#888;font:14px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">DexScreener chart (mock)</body></html>' });
    }

    return route.abort();
  });
}

const INIT = ({ fx, evmAccount }) => {
  // ---- Тестовый Solana-кошелёк (Wallet Standard) ----
  const listeners = {};
  const account = {
    address: fx.address,
    publicKey: new Uint8Array(fx.pubkeyBytes),
    chains: ['solana:mainnet'],
    features: ['solana:signAndSendTransaction', 'solana:signTransaction'],
  };
  window.__solSent = 0;
  const wallet = {
    version: '1.0.0',
    name: 'TestWallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMCAxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9IiNhYjlmZjIiLz48L3N2Zz4=',
    chains: ['solana:mainnet'],
    accounts: [],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          wallet.accounts = [account];
          (listeners.change || []).forEach((l) => l({ accounts: wallet.accounts }));
          return { accounts: wallet.accounts };
        },
      },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { wallet.accounts = []; } },
      'standard:events': {
        version: '1.0.0',
        on: (ev, l) => {
          (listeners[ev] = listeners[ev] || []).push(l);
          return () => {};
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          window.__solSent += inputs.length;
          return inputs.map(() => ({ signature: new Uint8Array(64).fill(7) }));
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) => inputs.map((i) => ({ signedTransaction: i.transaction })),
      },
    },
  };
  const cb = ({ register }) => register(wallet);
  window.addEventListener('wallet-standard:app-ready', (e) => cb(e.detail));
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: cb }));
  } catch {}

  // ---- Тестовый EVM-кошелёк (EIP-6963) ----
  let chainId = '0x1';
  const evmListeners = {};
  window.__evmSent = [];
  const pad = (hex) => '0x' + hex.replace(/^0x/, '').padStart(64, '0');
  const provider = {
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [evmAccount];
        case 'eth_chainId':
          return chainId;
        case 'wallet_switchEthereumChain':
          chainId = params[0].chainId;
          (evmListeners.chainChanged || []).forEach((l) => l(chainId));
          return null;
        case 'eth_sendTransaction':
          window.__evmSent.push(params[0]);
          return '0x' + String(window.__evmSent.length).padStart(64, 'a');
        case 'eth_getTransactionReceipt':
          return {
            blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x10', contractAddress: null, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1',
            from: evmAccount, gasUsed: '0x5208', logs: [], logsBloom: '0x' + '0'.repeat(512), status: '0x1', to: params ? '0x' + '6'.repeat(40) : null,
            transactionHash: params[0], transactionIndex: '0x0', type: '0x2',
          };
        case 'eth_blockNumber':
          return '0x20';
        case 'eth_getBalance':
          return '0xde0b6b3a7640000';
        case 'eth_call': {
          const data = params[0].data;
          if (data.startsWith('0x70a08231')) return pad((1000n * 10n ** 18n).toString(16));
          if (data.startsWith('0x313ce567')) return pad('12');
          if (data.startsWith('0xdd62ed3e')) return pad('0');
          return '0x';
        }
        case 'eth_getTransactionByHash':
          return null;
        default:
          window.__evmUnknown = [...(window.__evmUnknown || []), method];
          return null;
      }
    },
    on: (ev, l) => { (evmListeners[ev] = evmListeners[ev] || []).push(l); },
    removeListener: () => {},
  };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: { uuid: 'test-evm', name: 'TestEVM', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'test.evm' }, provider }),
      }),
    );
  window.addEventListener('eip6963:requestProvider', announce);
};

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addInitScript(INIT, { fx: FX, evmAccount: EVM_ACCOUNT });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await routeAll(page);
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  };

  // 1. Радар
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.token-card', { timeout: 15000 });
  const fitCards = await page.locator('.token-card').count();
  check('Радар: под методику показан только FROGAI', fitCards === 1, `карточек: ${fitCards}`);
  await page.getByLabel('Только под методику').uncheck();
  const allCards = await page.locator('.token-card').count();
  check('Радар: без фильтра 3 карточки', allCards === 3, `карточек: ${allCards}`);
  check('Радар: метка рекламы у MOON', (await page.locator('.token-card', { hasText: 'MOON' }).locator('.badge-ad').count()) === 1);
  await shot('01-radar');

  // 2. Новые с соцсетями
  await page.getByText('🆕 Новые с соцсетями').click();
  await page.waitForTimeout(500);
  check('Радар: вкладка «Новые» загрузилась', (await page.locator('.token-card').count()) === 2);

  // 3. Страница токена A
  await page.locator('.token-card', { hasText: 'FROGAI' }).first().click();
  await page.waitForSelector('.verdict');
  await page.waitForSelector('.sec-list');
  const v1 = await page.locator('.verdict-title').first().innerText();
  check('Токен A: до ответов — проверка не завершена', /не завершена/.test(v1), v1);
  await page.locator('#step-2').getByRole('button', { name: 'Да, реальные' }).click();
  const v2 = await page.locator('.verdict-title').first().innerText();
  check('Токен A: после ответа — можно входить', /Можно входить/.test(v2), v2);
  await shot('02-token-go');

  // 4. Подключаем Solana-кошелёк и покупаем
  await page.locator('.trade').getByRole('button', { name: 'Подключить кошелёк' }).click();
  await page.getByRole('button', { name: 'TestWallet' }).click();
  await page.waitForSelector('.wallet-btn .dot-ok', { timeout: 10000 });
  await page.waitForSelector('.quote >> text=Вы получите', { timeout: 10000 });
  const quoteText = await page.locator('.quote').innerText();
  check('Покупка: котировка Jupiter с decimals', /476[\s,.]?190|476\.2k|476,190/.test(quoteText), quoteText.replace(/\n/g, ' | '));
  await page.locator('.trade .btn-buy').click();
  await page.waitForSelector('.toast-ok >> text=Куплено', { timeout: 20000 });
  check('Покупка Solana: транзакция отправлена кошельком', (await page.evaluate(() => window.__solSent)) === 1);
  await shot('03-token-bought');

  // 5. Продажа
  await page.locator('.trade .seg-wide').getByRole('button', { name: 'Продать' }).click();
  await page.locator('.trade').getByRole('button', { name: '50%' }).click();
  await page.waitForSelector('.quote >> text=SOL', { timeout: 10000 });
  await page.locator('.trade .btn-sell').click();
  await page.waitForSelector('.toast-ok >> text=/Продано.*SOL/', { timeout: 20000 });
  check('Продажа Solana: прошла', (await page.evaluate(() => window.__solSent)) === 2);

  // 6. Опасный токен C
  await page.goto(`http://localhost:4173/#/token/solana/${FX.tokenC}`);
  await page.waitForSelector('.verdict-danger', { timeout: 15000 });
  const buyDisabled = await page.locator('.trade .btn-buy').isDisabled();
  check('Токен C: вердикт «опасно», покупка заблокирована', buyDisabled);
  await page.locator('.risk-gate input').check();
  await page.waitForSelector('.quote >> text=Вы получите');
  check('Токен C: после подтверждения риска кнопка активна', !(await page.locator('.trade .btn-buy').isDisabled()));
  await shot('04-token-danger');

  // 7. EVM-токен на Base: ввод адреса без сети
  await page.goto('http://localhost:4173/#/');
  await page.getByLabel('Поиск токена').fill(EVM_TOKEN);
  await page.getByRole('button', { name: 'Проверить' }).click();
  await page.waitForURL(/#\/token\/base\//, { timeout: 15000 });
  await page.waitForSelector('.sec-list');
  await page.locator('.wallet-btn').click();
  await page.getByRole('button', { name: 'TestEVM' }).click();
  await page.waitForSelector('.trade >> text=Переключить сеть на Base', { timeout: 10000 });
  await page.locator('.trade .btn-buy').click();
  await page.waitForSelector('.trade >> text=Купить BASED', { timeout: 10000 });
  await page.waitForSelector('.quote >> text=Вы получите');
  await page.locator('.trade .btn-buy').click();
  await page.waitForSelector('.toast-ok >> text=/Куплено.*BASED/', { timeout: 20000 });
  const sent = await page.evaluate(() => window.__evmSent);
  check('Покупка Base: tx в роутер KyberSwap с value', sent.length === 1 && sent[0].to.toLowerCase() === ROUTER.toLowerCase() && BigInt(sent[0].value) > 0n, JSON.stringify(sent[0]));
  // Продажа EVM: approve + swap
  await page.locator('.trade .seg-wide').getByRole('button', { name: 'Продать' }).click();
  await page.waitForSelector('.quote >> text=ETH', { timeout: 10000 });
  await page.locator('.trade .btn-sell').click();
  await page.waitForSelector('.toast-ok >> text=/Продано.*ETH/', { timeout: 20000 });
  const sent2 = await page.evaluate(() => window.__evmSent);
  check('Продажа Base: approve + swap', sent2.length === 3 && sent2[1].data.startsWith('0x095ea7b3') && sent2[2].data === '0xdeadbeef', JSON.stringify(sent2.map((t) => [t.to, t.data.slice(0, 10), t.value])));
  await shot('05-token-base');

  // 8. Портфель
  await page.goto('http://localhost:4173/#/portfolio');
  await page.waitForSelector('.pos');
  const posCount = await page.locator('section', { hasText: 'Мои позиции' }).locator('.pos').count();
  check('Портфель: 2 открытые позиции', posCount === 2, `позиций: ${posCount}`);
  await page.waitForTimeout(500);
  await shot('06-portfolio');

  // 9. Поиск, методика, настройки
  await page.goto('http://localhost:4173/#/search?q=FROG');
  await page.waitForSelector('.token-card');
  check('Поиск: результаты', (await page.locator('.token-card').count()) >= 3);
  await page.goto('http://localhost:4173/#/guide');
  await page.waitForSelector('.guide');
  await shot('07-guide');
  await page.goto('http://localhost:4173/#/settings');
  await page.waitForSelector('.narr');
  await shot('08-settings');

  // Десктоп
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`http://localhost:4173/#/token/solana/${FX.tokenA}`);
  await page.waitForSelector('.sec-list');
  await page.waitForTimeout(500);
  await shot('09-desktop-token');

  console.log(results.join('\n'));
  console.log('unknown solana rpc:', [...unknownRpc].join(', ') || '—');
  console.log('unknown evm rpc:', JSON.stringify(await page.evaluate(() => window.__evmUnknown || [])));
  console.log('console errors:', errors.length ? '\n  ' + errors.join('\n  ') : '—');
  await browser.close();
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.error('SMOKE CRASH', e);
  process.exit(2);
});
