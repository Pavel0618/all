// GeckoTerminal API — бесплатный список «трендовых» пулов по активности (не реклама).
import { getJson, HttpError } from './http';
import { CHAINS, type ChainId } from './chains';

const API = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json' };

interface GeckoPool {
  id: string;
  attributes: {
    name: string;
    address: string;
    pool_created_at?: string;
    fdv_usd?: string | null;
    market_cap_usd?: string | null;
    reserve_in_usd?: string | null;
  };
  relationships?: {
    base_token?: { data?: { id: string } };
  };
}

async function trendingFor(network: string): Promise<string[]> {
  const data = await getJson<{ data?: GeckoPool[] }>(`${API}/networks/${network}/trending_pools?page=1`, { ttlMs: 60_000, headers: HEADERS });
  const out: string[] = [];
  for (const pool of data.data ?? []) {
    const id = pool.relationships?.base_token?.data?.id;
    if (!id) continue;
    // id выглядит как "<сеть>_<адрес>"
    const addr = id.slice(id.indexOf('_') + 1);
    if (addr && !out.includes(addr)) out.push(addr);
  }
  return out;
}

const resolved = new Map<ChainId, string>();

/** Ищем id сети в GeckoTerminal по названию — для новых сетей, у которых id заранее неизвестен. */
export async function findGeckoNetwork(name: string): Promise<string | undefined> {
  const re = new RegExp(name, 'i');
  for (let page = 1; page <= 10; page++) {
    const data = await getJson<{ data?: { id: string; attributes?: { name?: string } }[] }>(`${API}/networks?page=${page}`, {
      ttlMs: 3_600_000,
      headers: HEADERS,
    });
    const list = data.data ?? [];
    const hit = list.find((n) => re.test(n.attributes?.name ?? '') || re.test(n.id));
    if (hit) return hit.id;
    if (list.length === 0) break;
  }
  return undefined;
}

/** Адреса базовых токенов из трендовых пулов сети. */
export async function getTrendingTokenAddresses(chain: ChainId): Promise<string[]> {
  const known = resolved.get(chain) ?? CHAINS[chain].geckoSlug;
  try {
    return await trendingFor(known);
  } catch (e) {
    // Неизвестный id сети → 404. Пробуем найти сеть по названию
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    const id = await findGeckoNetwork(CHAINS[chain].name);
    if (!id || id === known) throw e;
    resolved.set(chain, id);
    return trendingFor(id);
  }
}

// ---------- Свечи для графика ----------

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

const TIMEFRAMES: Record<Timeframe, [string, number]> = {
  '1m': ['minute', 1],
  '5m': ['minute', 5],
  '15m': ['minute', 15],
  '1h': ['hour', 1],
  '4h': ['hour', 4],
  '1d': ['day', 1],
};

export interface Candle {
  /** unix-время в секундах */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const isStatus = (e: unknown, ...codes: number[]) => e instanceof HttpError && codes.includes(e.status ?? 0);

async function fetchOhlcv(network: string, pool: string, token: string | undefined, tf: Timeframe): Promise<Candle[]> {
  const [period, aggregate] = TIMEFRAMES[tf];
  const q = new URLSearchParams({ aggregate: String(aggregate), limit: '300', currency: 'usd' });
  // Цена именно нашего токена, даже если в пуле он стоит вторым
  if (token) q.set('token', token);
  let data: { data?: { attributes?: { ohlcv_list?: (number | string | null)[][] } } };
  try {
    data = await getJson(`${API}/networks/${network}/pools/${pool}/ohlcv/${period}?${q}`, { ttlMs: 30_000, headers: HEADERS });
  } catch (e) {
    // Если параметр token не понравился — пробуем без него
    if (token && isStatus(e, 400, 422)) return fetchOhlcv(network, pool, undefined, tf);
    throw e;
  }
  const byTime = new Map<number, Candle>();
  for (const row of data.data?.attributes?.ohlcv_list ?? []) {
    // null из API не должен превращаться в цену 0 — такая свеча сломала бы масштаб графика
    const [time, open, high, low, close, volume] = row.map((v) => (v === null || v === undefined ? NaN : Number(v)));
    if ([time, open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) byTime.set(time, { time, open, high, low, close, volume: volume || 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Самый ликвидный пул токена по версии GeckoTerminal. */
async function topPool(network: string, token: string): Promise<string | undefined> {
  const data = await getJson<{ data?: { attributes?: { address?: string } }[] }>(`${API}/networks/${network}/tokens/${token}/pools?page=1`, {
    ttlMs: 300_000,
    headers: HEADERS,
  });
  return data.data?.[0]?.attributes?.address;
}

/**
 * Свечи пула. Если GeckoTerminal не знает пул из DexScreener — берём главный пул токена;
 * если не знает id сети — ищем сеть по названию.
 */
export async function getCandles(chain: ChainId, pool: string, token: string, tf: Timeframe): Promise<Candle[]> {
  const attempt = async (network: string): Promise<Candle[]> => {
    try {
      return await fetchOhlcv(network, pool, token, tf);
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
      const other = await topPool(network, token).catch(() => undefined);
      if (!other || other.toLowerCase() === pool.toLowerCase()) throw e;
      return fetchOhlcv(network, other, token, tf);
    }
  };
  const known = resolved.get(chain) ?? CHAINS[chain].geckoSlug;
  try {
    return await attempt(known);
  } catch (e) {
    if (!isStatus(e, 404)) throw e;
    const id = await findGeckoNetwork(CHAINS[chain].name).catch(() => undefined);
    if (!id || id === known) throw e;
    resolved.set(chain, id);
    return attempt(id);
  }
}
