// Покупка/продажа в EVM-сетях (Ethereum, Base, BNB, Arbitrum) через агрегатор KyberSwap.
// Бесплатно, без ключа. Транзакцию подписывает ваш кошелёк (MetaMask, Rabby, Phantom…).
import { getJson, postJson } from './http';
import { CHAINS, type ChainId } from './chains';

export const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const API = 'https://aggregator-api.kyberswap.com';
const CLIENT_ID = 'gem-radar';

export interface KyberRouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gasUsd: string;
  [k: string]: unknown;
}

export interface KyberRoute {
  routeSummary: KyberRouteSummary;
  routerAddress: string;
}

export interface KyberBuilt {
  amountIn: string;
  amountOut: string;
  data: string;
  routerAddress: string;
  transactionValue?: string;
}

interface KyberResp<T> {
  code: number;
  message: string;
  data?: T;
}

function slug(chain: ChainId): string {
  const s = CHAINS[chain].kyberSlug;
  if (!s) throw new Error('Сеть не поддерживается для обмена');
  return s;
}

export async function kyberRoute(chain: ChainId, tokenIn: string, tokenOut: string, amountIn: string): Promise<KyberRoute> {
  const q = new URLSearchParams({ tokenIn, tokenOut, amountIn, gasInclude: 'true', source: CLIENT_ID });
  const res = await getJson<KyberResp<KyberRoute>>(`${API}/${slug(chain)}/api/v1/routes?${q}`, {
    ttlMs: 0,
    headers: { 'x-client-id': CLIENT_ID },
  });
  if (res.code !== 0 || !res.data?.routeSummary) throw new Error(res.message || 'Маршрут не найден');
  return res.data;
}

export async function kyberBuild(chain: ChainId, route: KyberRoute, account: string, slippageBps: number): Promise<KyberBuilt> {
  const res = await postJson<KyberResp<KyberBuilt>>(
    `${API}/${slug(chain)}/api/v1/route/build`,
    {
      routeSummary: route.routeSummary,
      sender: account,
      recipient: account,
      // KyberSwap принимает от 0 до 2000 bps (20%)
      slippageTolerance: Math.min(2000, Math.max(1, slippageBps)),
      source: CLIENT_ID,
    },
    { headers: { 'x-client-id': CLIENT_ID } },
  );
  if (res.code !== 0 || !res.data?.data) throw new Error(res.message || 'Не удалось собрать транзакцию');
  return res.data;
}
