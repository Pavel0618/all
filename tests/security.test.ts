// Атаки, от которых защищается приложение: подмена транзакций агрегатором, кража ключей
// через общий localStorage, подмена настроек, опасные ссылки, внедрение скриптов.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { assertEvmValue, assertSafeJupiterTx, assertTrustedRouter, JUPITER_V6, UnsafeTxError, wsolAccount } from '../src/lib/txGuard';
import { MAX_SLIPPAGE_BPS, sanitizeSettings } from '../src/lib/storage';
import { httpsUrl } from '../src/lib/dexscreener';
import { cspFor } from '../vite.config';

// ---------- EVM ----------

describe('EVM: только официальные роутеры', () => {
  it('KyberSwap и LI.FI — пропускаем (регистр не важен)', () => {
    expect(() => assertTrustedRouter('KyberSwap', '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', 'роутера')).not.toThrow();
    expect(() => assertTrustedRouter('LI.FI', '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', 'роутера')).not.toThrow();
  });

  it('чужой адрес или пусто — сделка останавливается', () => {
    expect(() => assertTrustedRouter('KyberSwap', '0x000000000000000000000000000000000000dEaD', 'роутера')).toThrow(UnsafeTxError);
    expect(() => assertTrustedRouter('LI.FI', undefined, 'для разрешения')).toThrow(/Сделка остановлена/);
    // адрес LI.FI не подходит как роутер KyberSwap
    expect(() => assertTrustedRouter('KyberSwap', '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', 'роутера')).toThrow(UnsafeTxError);
  });

  it('сумма транзакции: при покупке не больше суммы сделки, при продаже — ноль', () => {
    expect(() => assertEvmValue(true, 100n, 100n)).not.toThrow();
    expect(() => assertEvmValue(true, 101n, 100n)).toThrow(UnsafeTxError);
    expect(() => assertEvmValue(false, 0n, 100n)).not.toThrow();
    expect(() => assertEvmValue(false, 1n, 100n)).toThrow(UnsafeTxError);
  });
});

// ---------- Solana ----------

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const JUP = new PublicKey(JUPITER_V6);

function jupiterTx(owner: PublicKey, extra: TransactionInstruction[] = [], o: { payer?: PublicKey; cuPrice?: number; noJup?: boolean } = {}) {
  const wsol = wsolAccount(owner);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.cuPrice ?? 1_000 }),
    new TransactionInstruction({
      programId: ATA,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: wsol, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: WSOL, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    }),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsol, lamports: 100_000_000 }),
    new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: wsol, isSigner: false, isWritable: true }], data: Buffer.from([17]) }),
    ...(o.noJup ? [] : [new TransactionInstruction({ programId: JUP, keys: [{ pubkey: owner, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3]) })]),
    new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: wsol, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    }),
    ...extra,
  ];
  const msg = new TransactionMessage({ payerKey: o.payer ?? owner, recentBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg);
}

describe('Solana: транзакция Jupiter проверяется перед подписью', () => {
  const owner = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const CAP = 1_510_000;

  it('обычный обмен проходит', () => {
    expect(() => assertSafeJupiterTx(jupiterTx(owner), owner, CAP)).not.toThrow();
  });

  it('перевод SOL злоумышленнику — стоп', () => {
    const tx = jupiterTx(owner, [SystemProgram.transfer({ fromPubkey: owner, toPubkey: attacker, lamports: 1 })]);
    expect(() => assertSafeJupiterTx(tx, owner, CAP)).toThrow(/перевод SOL на чужой адрес/);
  });

  it('перевод токенов или разрешение на них — стоп', () => {
    const src = Keypair.generate().publicKey;
    const transfer = new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: attacker, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]),
    });
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [transfer]), owner, CAP)).toThrow(/ваши токены/);
    const approve = new TransactionInstruction({ programId: TOKEN, keys: transfer.keys, data: Buffer.from([4, 1, 0, 0, 0, 0, 0, 0, 0]) });
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [approve]), owner, CAP)).toThrow(UnsafeTxError);
  });

  it('закрытие счёта с выводом остатка не себе — стоп', () => {
    const close = new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: wsolAccount(owner), isSigner: false, isWritable: true },
        { pubkey: attacker, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [close]), owner, CAP)).toThrow(UnsafeTxError);
  });

  it('незнакомая программа — стоп', () => {
    const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: owner, isSigner: true, isWritable: true }], data: Buffer.from([0]) });
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [evil]), owner, CAP)).toThrow(/незнакомая программа/);
  });

  it('комиссию платит чужой кошелёк или нет обмена — стоп', () => {
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [], { payer: attacker }), owner, CAP)).toThrow(/не ваш кошелёк/);
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [], { noJup: true }), owner, CAP)).toThrow(/нет обмена/);
  });

  it('раздутая приоритетная комиссия (сжечь SOL) — стоп', () => {
    // 300 000 единиц × 1 000 000 000 микролампортов = 300 SOL
    expect(() => assertSafeJupiterTx(jupiterTx(owner, [], { cuPrice: 1_000_000_000 }), owner, CAP)).toThrow(/приоритетная комиссия/);
  });
});

// ---------- Настройки и ссылки ----------

describe('настройки из localStorage — недоверенные данные', () => {
  it('огромный slippage режется, http-RPC и мусор заменяются', () => {
    const s = sanitizeSettings({ slippageBps: 9_900, solanaRpc: 'http://evil.example', priority: 'insane' as never });
    expect(s.slippageBps).toBe(MAX_SLIPPAGE_BPS);
    expect(s.solanaRpc).toBe('https://solana-rpc.publicnode.com');
    expect(s.priority).toBe('high');
    expect(sanitizeSettings({ solanaRpc: 'javascript:alert(1)' }).solanaRpc).toBe('https://solana-rpc.publicnode.com');
    expect(sanitizeSettings({ slippageBps: Number.NaN }).slippageBps).toBe(500);
  });

  it('нормальные значения остаются', () => {
    const s = sanitizeSettings({ slippageBps: 1000, solanaRpc: 'https://mainnet.helius-rpc.com/?api-key=x', priority: 'veryHigh' });
    expect(s).toMatchObject({ slippageBps: 1000, solanaRpc: 'https://mainnet.helius-rpc.com/?api-key=x', priority: 'veryHigh' });
  });
});

describe('ссылки из чужих данных — только https', () => {
  it('javascript:, data:, http: отбрасываются', () => {
    expect(httpsUrl('https://dd.dexscreener.com/a.png')).toBe('https://dd.dexscreener.com/a.png');
    expect(httpsUrl('javascript:alert(1)')).toBeUndefined();
    expect(httpsUrl('data:text/html,<script>1</script>')).toBeUndefined();
    expect(httpsUrl('http://tracker.example/p.png')).toBeUndefined();
    expect(httpsUrl(42)).toBeUndefined();
  });
});

describe('CSP собранного сайта', () => {
  it('скрипты — только свои, Telegram и встроенный по хэшу; без unsafe-inline/eval', () => {
    const csp = cspFor('<head><script>var a = 1;</script><script type="module" src="./x.js"></script></head>');
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toMatch(/^script-src 'self' 'sha256-[A-Za-z0-9+/=]+' https:\/\/telegram\.org/);
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

// ---------- Ключи встроенного кошелька ----------

type Kind = 'secure' | 'device' | 'local';
function fakeStore(kind: Kind, data = new Map<string, string>()) {
  return {
    kind,
    data,
    get: async (k: string) => data.get(k),
    set: async (k: string, v: string) => void data.set(k, v),
    remove: async (k: string) => void data.delete(k),
  };
}

let stores: ReturnType<typeof fakeStore>[] = [];
vi.mock('../src/lib/telegram', async (orig) => ({ ...(await orig<typeof import('../src/lib/telegram')>()), keyStores: () => stores }));

describe('ключи встроенного кошелька', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => (stores = []));

  it('никогда не пишутся в localStorage — только в хранилище Telegram', async () => {
    const secure = fakeStore('secure');
    const local = fakeStore('local');
    stores = [secure, local];
    const w = await import('../src/wallet/builtin');
    await w.createBuiltin();
    expect(secure.data.has('gr_wallet_v1')).toBe(true);
    expect(local.data.size).toBe(0);
  });

  it('без хранилища Telegram кошелёк не создаётся', async () => {
    const local = fakeStore('local');
    stores = [local];
    const w = await import('../src/wallet/builtin');
    expect(w.canStoreKeysSafely()).toBe(false);
    await expect(w.createBuiltin()).rejects.toThrow(/Telegram версии 9.0/);
    await expect(w.importBuiltin('0x' + '1'.repeat(64))).rejects.toThrow(/Telegram версии 9.0/);
    expect(local.data.size).toBe(0);
  });

  it('старая копия из localStorage переносится в Telegram и стирается', async () => {
    const kp = Keypair.generate();
    const bs58 = (await import('bs58')).default;
    const raw = JSON.stringify({ v: 1, sol: bs58.encode(kp.secretKey), evm: '0x' + '2'.repeat(64), backedUp: true, createdAt: 1 });
    const device = fakeStore('device');
    const local = fakeStore('local', new Map([['gr_wallet_v1', raw]]));
    stores = [device, local];
    const w = await import('../src/wallet/builtin');
    await w.loadBuiltin();
    expect(w.builtinStore.get().status).toBe('ready');
    expect(w.builtinStore.get().storage).toBe('device');
    expect(device.data.get('gr_wallet_v1')).toBe(raw);
    expect(local.data.has('gr_wallet_v1')).toBe(false);
  });
});
