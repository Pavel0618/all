// LI.FI — резервный агрегатор для EVM-сетей (работает без ключа, поддерживает Robinhood Chain).
// Используется, когда KyberSwap не нашёл маршрут или не знает сеть.
import { getJson } from './http';
import { CHAINS, type ChainId } from './chains';

const API = 'https://li.quest/v1';
export const LIFI_NATIVE = '0x0000000000000000000000000000000000000000';
/** Адрес-заглушка для предварительной котировки, пока кошелёк не подключён */
export const PREVIEW_ADDRESS = '0x0000000000000000000000000000000000000001';

export interface LifiQuote {
  tool?: string;
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin?: string;
    approvalAddress?: string;
    fromAmountUSD?: string;
    toAmountUSD?: string;
    gasCosts?: { amountUSD?: string }[];
  };
  transactionRequest?: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
  };
}

export async function lifiQuote(params: {
  chain: ChainId;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress?: string;
  slippageBps: number;
  /** Комиссия интегратора (доля, 0.005 = 0.5%) и его имя в LI.FI Portal */
  fee?: { fraction: number; integrator: string };
}): Promise<LifiQuote> {
  const chainId = CHAINS[params.chain].evmChainId;
  if (!chainId) throw new Error('Сеть не поддерживается');
  const q = new URLSearchParams({
    fromChain: String(chainId),
    toChain: String(chainId),
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress ?? PREVIEW_ADDRESS,
    slippage: String(params.slippageBps / 10_000),
    integrator: params.fee?.integrator ?? 'gem-radar',
    order: 'CHEAPEST',
  });
  if (params.fee && params.fee.fraction > 0) q.set('fee', String(params.fee.fraction));
  return getJson<LifiQuote>(`${API}/quote?${q}`, { ttlMs: 0, timeoutMs: 20_000 });
}
