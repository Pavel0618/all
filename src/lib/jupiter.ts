// Покупка/продажа на Solana через агрегатор Jupiter (бесплатный lite-api, без ключа).
// Транзакцию собирает Jupiter, подписывает только ваш кошелёк — ключи никуда не уходят.
import { Buffer } from 'buffer';
import { VersionedTransaction, type Connection } from '@solana/web3.js';
import { getJson, postJson } from './http';

const JUP = 'https://lite-api.jup.ag/swap/v1';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export type PriorityLevel = 'medium' | 'high' | 'veryHigh';

export interface JupQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: { swapInfo?: { label?: string } }[];
}

export async function jupQuote(params: { inputMint: string; outputMint: string; amount: string; slippageBps: number }): Promise<JupQuote> {
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps),
    restrictIntermediateTokens: 'true',
  });
  // Котировка живёт недолго — не кэшируем
  return getJson<JupQuote>(`${JUP}/quote?${q}`, { ttlMs: 0 });
}

/** Максимальная приоритетная комиссия (в лампортах) для каждого уровня. */
const MAX_PRIORITY_LAMPORTS: Record<PriorityLevel, number> = {
  medium: 300_000, // 0.0003 SOL
  high: 1_000_000, // 0.001 SOL
  veryHigh: 4_000_000, // 0.004 SOL
};

export async function jupSwapTransaction(
  quote: JupQuote,
  userPublicKey: string,
  priority: PriorityLevel,
): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number }> {
  const res = await postJson<{ swapTransaction: string; lastValidBlockHeight: number }>(`${JUP}/swap`, {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: { maxLamports: MAX_PRIORITY_LAMPORTS[priority], priorityLevel: priority },
    },
  });
  return {
    tx: VersionedTransaction.deserialize(Buffer.from(res.swapTransaction, 'base64')),
    lastValidBlockHeight: res.lastValidBlockHeight,
  };
}

/** Влияние на цену в процентах (Jupiter отдаёт долю, напр. "0.012" = 1.2%). */
export function priceImpactPercent(q: JupQuote): number {
  const n = parseFloat(q.priceImpactPct);
  return Number.isFinite(n) ? n * 100 : 0;
}

export function routeLabel(q: JupQuote): string {
  const labels = q.routePlan.map((r) => r.swapInfo?.label).filter(Boolean);
  return [...new Set(labels)].join(' → ');
}

/**
 * Ждём подтверждения транзакции опросом статуса (без websocket — надёжнее на публичных RPC).
 */
export async function waitForSignature(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const st = value[0];
    if (st?.err) throw new Error('Транзакция не прошла в сети (чаще всего — цена ушла дальше slippage)');
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return;
    const height = await connection.getBlockHeight('confirmed').catch(() => 0);
    if (height > lastValidBlockHeight) {
      // Последняя проверка: транзакция могла успеть попасть в блок
      const again = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (again && !again.err && again.confirmationStatus) return;
      throw new Error('Транзакция устарела и не попала в блок — попробуйте ещё раз');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Сеть долго не подтверждает транзакцию — проверьте её в Solscan');
}
