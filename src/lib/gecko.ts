// GeckoTerminal API — бесплатный список «трендовых» пулов по активности (не реклама).
import { getJson, HttpError, isFresh } from './http';
import { CHAINS, type ChainId } from './chains';

const API = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { Accept: 'application/json' };

// Бесплатный GeckoTerminal даёт ~30 запросов в минуту с одного IP (у мобильных операторов один IP на многих).
// Поэтому запросы идут через «ведро»: небольшой запас на всплеск, дальше не чаще раза в ~2 секунды,
// а временные отказы (429, 5xx, обрыв) повторяются с паузой.
export const geckoTuning = { burst: 8, refillMs: 2_200, retryDelays: [1_500, 4_000] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let tokens = geckoTuning.burst;
let refilledAt = Date.now();
let queue: Promise<void> = Promise.resolve();

function slot(): Promise<void> {
  const run = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      if (now < refilledAt) refilledAt = now; // часы перевели назад — не зависаем
      const add = Math.floor((now - refilledAt) / geckoTuning.refillMs);
      if (add > 0) {
        tokens = Math.min(geckoTuning.burst, tokens + add);
        refilledAt = tokens >= geckoTuning.burst ? now : refilledAt + add * geckoTuning.refillMs;
      }
      tokens = Math.min(tokens, geckoTuning.burst);
      if (tokens > 0) {
        tokens--;
        return;
      }
      await sleep(Math.max(50, geckoTuning.refillMs - (now - refilledAt)));
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Временный отказ: лимит, сбой сервера или обрыв (ответ 429 часто приходит без CORS — тогда статуса нет). */
export const isTransient = (e: unknown) => e instanceof HttpError && (e.status === undefined || e.status === 429 || e.status >= 500);

async function geckoGet<T>(url: string, ttlMs: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (!isFresh(url, ttlMs)) await slot();
    try {
      return await getJson<T>(url, { ttlMs, headers: HEADERS });
    } catch (e) {
      const delay = geckoTuning.retryDelays[attempt];
      if (!isTransient(e) || delay === undefined) throw e;
      await sleep(delay * (0.8 + Math.random() * 0.4));
    }
  }
}

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
  const data = await geckoGet<{ data?: GeckoPool[] }>(`${API}/networks/${network}/trending_pools?page=1`, 60_000);
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
    const data = await geckoGet<{ data?: { id: string; attributes?: { name?: string } }[] }>(`${API}/networks?page=${page}`, 3_600_000);
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
    data = await geckoGet(`${API}/networks/${network}/pools/${pool}/ohlcv/${period}?${q}`, 55_000);
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
  const data = await geckoGet<{ data?: { attributes?: { address?: string } }[] }>(`${API}/networks/${network}/tokens/${token}/pools?page=1`, 300_000);
  return data.data?.[0]?.attributes?.address;
}

const TF_SEC: Record<Timeframe, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 };
export const tfSeconds = (tf: Timeframe) => TF_SEC[tf];

/** Склеивает свечи в более крупный период (границы по UTC — как у GeckoTerminal). */
export function aggregateCandles(list: Candle[], sec: number): Candle[] {
  const out: Candle[] = [];
  for (const c of list) {
    const time = Math.floor(c.time / sec) * sec;
    const cur = out[out.length - 1];
    if (cur && cur.time === time) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    } else {
      out.push({ ...c, time });
    }
  }
  return out;
}

/** Последние удачные свечи по каждому периоду — запас на случай, если сервис занят. */
const lastGood = new Map<string, Candle[]>();

/**
 * Свечи пула. Если GeckoTerminal не знает пул из DexScreener — берём главный пул токена;
 * если не знает id сети — ищем сеть по названию. Если сервис временно отказал — показываем последние
 * загруженные свечи этого периода или собираем их из уже загруженного более мелкого периода.
 */
export async function getCandles(chain: ChainId, pool: string, token: string, tf: Timeframe): Promise<Candle[]> {
  const key = `${chain}|${pool}|${token}`.toLowerCase();
  try {
    const list = await loadCandles(chain, pool, token, tf);
    if (list.length) lastGood.set(`${key}|${tf}`, list);
    return list;
  } catch (e) {
    if (!isTransient(e)) throw e;
    const same = lastGood.get(`${key}|${tf}`);
    if (same) return same;
    // Сначала самый крупный из подходящих мелких периодов — у него длиннее история
    const finer = (Object.keys(TF_SEC) as Timeframe[])
      .filter((f) => TF_SEC[f] < TF_SEC[tf] && TF_SEC[tf] % TF_SEC[f] === 0)
      .sort((a, b) => TF_SEC[b] - TF_SEC[a]);
    for (const f of finer) {
      const src = lastGood.get(`${key}|${f}`);
      if (src?.length) return aggregateCandles(src, TF_SEC[tf]);
    }
    throw e;
  }
}

async function loadCandles(chain: ChainId, pool: string, token: string, tf: Timeframe): Promise<Candle[]> {
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
