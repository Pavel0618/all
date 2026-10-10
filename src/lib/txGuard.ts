// Проверка транзакций от агрегаторов ПЕРЕД подписью.
// Приложение подписывает то, что вернули Jupiter / KyberSwap / LI.FI. Если их API взломают или подменят ответ,
// транзакция могла бы вывести средства. Поэтому пропускаем только знакомые контракты и безопасные инструкции.
import { PublicKey, type VersionedTransaction } from '@solana/web3.js';

export class UnsafeTxError extends Error {
  constructor(detail: string) {
    super(`Сделка остановлена для вашей безопасности: ${detail}. Средства не тронуты.`);
  }
}

// ---------- EVM ----------

/** Официальные роутеры агрегаторов. Адреса одинаковые во всех поддерживаемых сетях. */
export const TRUSTED_ROUTERS: Record<'KyberSwap' | 'LI.FI', readonly string[]> = {
  // KyberSwap MetaAggregationRouterV2
  KyberSwap: ['0x6131b5fae19ea4f9d964eac0408e4408b66337b5'],
  // LI.FI Diamond
  'LI.FI': ['0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'],
};

export function assertTrustedRouter(provider: keyof typeof TRUSTED_ROUTERS, address: string | undefined, what: string): void {
  if (!address || !TRUSTED_ROUTERS[provider].includes(address.toLowerCase())) {
    throw new UnsafeTxError(`${provider} вернул незнакомый адрес ${what} (${address ?? 'пусто'})`);
  }
}

/** При покупке сеть списывает ровно сумму покупки, при продаже — ноль нативной монеты. */
export function assertEvmValue(buy: boolean, value: bigint, amountIn: bigint): void {
  if (buy ? value > amountIn : value !== 0n) throw new UnsafeTxError('сумма транзакции не совпадает с суммой сделки');
}

// ---------- Solana ----------

const SYSTEM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUJoi5QNyVTaV4';
const WSOL = 'So11111111111111111111111111111111111111112';

const ALLOWED_PROGRAMS = new Set([SYSTEM, COMPUTE_BUDGET, TOKEN, TOKEN_2022, ATA, JUPITER_V6]);

/** wSOL-счёт пользователя: сюда Jupiter переводит SOL перед обменом. */
export function wsolAccount(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(WSOL).toBuffer()], new PublicKey(ATA))[0];
}

const u32 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] * 0x1000000);
const u64 = (d: Uint8Array, o: number) => BigInt(u32(d, o)) + (BigInt(u32(d, o + 4)) << 32n);

/**
 * Обмен через Jupiter: платит комиссию сам пользователь, вызываются только Jupiter и служебные программы,
 * переводы SOL — только на свой wSOL-счёт, из токен-инструкций — только «обновить wSOL» и «закрыть счёт себе»,
 * приоритетная комиссия — не больше лимита.
 */
export function assertSafeJupiterTx(tx: VersionedTransaction, owner: PublicKey, maxPriorityLamports: number): void {
  const msg = tx.message;
  const keys = msg.staticAccountKeys;
  const key = (i: number) => (i < keys.length ? keys[i] : undefined);
  if (!keys[0]?.equals(owner)) throw new UnsafeTxError('комиссию сети платит не ваш кошелёк');
  const wsol = wsolAccount(owner);
  let cuLimit = 200_000;
  let cuPrice = 0n;
  let jupiter = 0;

  for (const ix of msg.compiledInstructions) {
    // Программы в Solana всегда в основном списке адресов, не в таблицах поиска
    const program = key(ix.programIdIndex)?.toBase58();
    if (!program || !ALLOWED_PROGRAMS.has(program)) throw new UnsafeTxError(`незнакомая программа ${program ?? '?'}`);
    const d = ix.data;
    const acc = (n: number) => key(ix.accountKeyIndexes[n]);

    if (program === JUPITER_V6) jupiter++;
    else if (program === COMPUTE_BUDGET) {
      if (d[0] === 2) cuLimit = u32(d, 1); // SetComputeUnitLimit
      else if (d[0] === 3) cuPrice = u64(d, 1); // SetComputeUnitPrice, микролампорты за единицу
    } else if (program === SYSTEM) {
      // Только перевод SOL со своего кошелька на свой wSOL-счёт
      const isTransfer = u32(d, 0) === 2;
      if (!isTransfer || !acc(0)?.equals(owner) || !acc(1)?.equals(wsol)) throw new UnsafeTxError('перевод SOL на чужой адрес');
    } else if (program === TOKEN || program === TOKEN_2022) {
      // SyncNative (17) или CloseAccount (9), при котором остаток возвращается вам
      if (d[0] === 17) continue;
      if (d[0] === 9 && acc(1)?.equals(owner) && acc(2)?.equals(owner)) continue;
      throw new UnsafeTxError('перевод или разрешение на ваши токены');
    }
    // ATA: создание своего токен-счёта — безопасно (платите только аренду счёта)
  }

  if (jupiter === 0) throw new UnsafeTxError('в транзакции нет обмена Jupiter');
  const priority = (cuPrice * BigInt(cuLimit)) / 1_000_000n;
  if (priority > BigInt(maxPriorityLamports)) throw new UnsafeTxError('приоритетная комиссия больше выбранной');
}
