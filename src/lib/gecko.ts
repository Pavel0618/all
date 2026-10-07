// GeckoTerminal API — бесплатный список «трендовых» пулов по активности (не реклама).
import { getJson } from './http';
import { CHAINS, type ChainId } from './chains';

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

/** Адреса базовых токенов из трендовых пулов сети. */
export async function getTrendingTokenAddresses(chain: ChainId): Promise<string[]> {
  const slug = CHAINS[chain].geckoSlug;
  const data = await getJson<{ data?: GeckoPool[] }>(
    `https://api.geckoterminal.com/api/v2/networks/${slug}/trending_pools?page=1`,
    { ttlMs: 60_000, headers: { Accept: 'application/json' } },
  );
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
