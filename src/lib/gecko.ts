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
