// DexScreener API — бесплатный, без ключа. Даёт цену, капу, ликвидность, сделки,
// возраст пула и ссылки на соцсети токена (в т.ч. Twitter).
import { getJson } from './http';
import { isChainId, type ChainId } from './chains';

const API = 'https://api.dexscreener.com';

export interface TxCount {
  buys: number;
  sells: number;
}

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', TxCount>>;
  volume?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', number>>;
  priceChange?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', number>>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    header?: string;
    websites?: { label?: string; url: string }[];
    socials?: { type?: string; platform?: string; url?: string; handle?: string }[];
  };
  boosts?: { active?: number };
}

export interface TokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { type?: string; label?: string; url: string }[];
  amount?: number;
  totalAmount?: number;
}

/** Все пулы токена в сети (может прийти пустой массив). */
/** Только https-ссылки: адреса из ответа API не должны стать javascript:/data:-ссылкой или картинкой с чужого http. */
export function httpsUrl(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  try {
    return new URL(u).protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

function clean(p: DexPair): DexPair {
  const url = p.url?.startsWith('https://dexscreener.com/') ? p.url : `https://dexscreener.com/${p.chainId}/${p.pairAddress}`;
  if (!p.info) return { ...p, url };
  return {
    ...p,
    url,
    info: {
      ...p.info,
      imageUrl: httpsUrl(p.info.imageUrl),
      websites: (p.info.websites ?? []).filter((w) => httpsUrl(w.url)),
      socials: (p.info.socials ?? []).map((x) => ({ ...x, url: httpsUrl(x.url) })),
    },
  };
}

const cleanAll = (list: DexPair[] | null | undefined) => (list ?? []).map(clean);

export async function getTokenPairs(chain: ChainId, address: string): Promise<DexPair[]> {
  const data = await getJson<DexPair[] | { pairs?: DexPair[] }>(`${API}/tokens/v1/${chain}/${address}`);
  return cleanAll(Array.isArray(data) ? data : data.pairs);
}

/** Пулы сразу для нескольких токенов (до 30 адресов за раз). */
export async function getTokensBatch(chain: ChainId, addresses: string[]): Promise<DexPair[]> {
  const out: DexPair[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const data = await getJson<DexPair[]>(`${API}/tokens/v1/${chain}/${chunk.join(',')}`, { ttlMs: 30_000 });
    if (Array.isArray(data)) out.push(...cleanAll(data));
  }
  return out;
}

/** Поиск пула по адресу пула (ссылки DexScreener содержат адрес пула, а не токена). */
export async function getPair(chain: ChainId, pairAddress: string): Promise<DexPair | undefined> {
  const data = await getJson<{ pairs?: DexPair[] | null; pair?: DexPair | null }>(
    `${API}/latest/dex/pairs/${chain}/${pairAddress}`,
  );
  const p = data.pairs?.[0] ?? data.pair ?? undefined;
  return p ? clean(p) : undefined;
}

/** Поиск по адресу без сети (EVM-адрес может быть в любой сети). */
export async function getTokenAnyChain(address: string): Promise<DexPair[]> {
  const data = await getJson<{ pairs?: DexPair[] | null }>(`${API}/latest/dex/tokens/${address}`);
  return cleanAll(data.pairs);
}

/** Поиск по названию / тикеру. */
export async function searchPairs(query: string): Promise<DexPair[]> {
  const data = await getJson<{ pairs?: DexPair[] | null }>(`${API}/latest/dex/search?q=${encodeURIComponent(query)}`);
  return cleanAll(data.pairs).filter((p) => isChainId(p.chainId));
}

/** Свежие профили токенов (проекты, которые только что заполнили соцсети на DexScreener). */
export async function getLatestProfiles(): Promise<TokenProfile[]> {
  const list = await getJson<TokenProfile[]>(`${API}/token-profiles/latest/v1`, { ttlMs: 60_000 });
  return (Array.isArray(list) ? list : []).map((p) => ({ ...p, icon: httpsUrl(p.icon), links: (p.links ?? []).filter((l) => httpsUrl(l.url)) }));
}

/** Токены с активным платным «бустом» (= реклама на DexScreener). */
export async function getBoosted(): Promise<TokenProfile[]> {
  return getJson<TokenProfile[]>(`${API}/token-boosts/latest/v1`, { ttlMs: 60_000 });
}

/** Главный (самый ликвидный) пул токена. */
export function mainPair(pairs: DexPair[], tokenAddress?: string): DexPair | undefined {
  const relevant = tokenAddress
    ? pairs.filter((p) => p.baseToken.address.toLowerCase() === tokenAddress.toLowerCase())
    : pairs;
  const list = relevant.length ? relevant : pairs;
  return [...list].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
}

export interface Socials {
  /** Хэндл аккаунта проекта в X/Twitter (без @) */
  twitter?: string;
  /** Исходная ссылка на X (может быть сообществом X Communities) */
  twitterUrl?: string;
  telegram?: string;
  websites: string[];
}

/** Достаёт Twitter-хэндл и прочие ссылки из данных пула. */
export function extractSocials(pair?: DexPair, profile?: TokenProfile): Socials {
  const res: Socials = { websites: [] };
  const socials = pair?.info?.socials ?? [];
  for (const s of socials) {
    const type = (s.type ?? s.platform ?? '').toLowerCase();
    const url = s.url ?? s.handle ?? '';
    if (type === 'twitter' || type === 'x') {
      res.twitter ??= twitterHandle(url);
      res.twitterUrl ??= url;
    }
    if (type === 'telegram') res.telegram ??= url;
  }
  for (const w of pair?.info?.websites ?? []) res.websites.push(w.url);
  for (const l of profile?.links ?? []) {
    const type = (l.type ?? l.label ?? '').toLowerCase();
    if (type === 'twitter' || type === 'x') {
      res.twitter ??= twitterHandle(l.url);
      res.twitterUrl ??= l.url;
    } else if (type === 'telegram') res.telegram ??= l.url;
    else if (!res.websites.includes(l.url)) res.websites.push(l.url);
  }
  return res;
}

export function twitterHandle(urlOrHandle: string): string | undefined {
  const s = urlOrHandle.trim();
  if (!s) return undefined;
  const m = s.match(/(?:twitter\.com|x\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,30})/i);
  if (m) {
    const h = m[1];
    // Ссылка на поиск/сообщество/твит — не профиль
    if (['i', 'search', 'home', 'intent', 'hashtag'].includes(h.toLowerCase())) return undefined;
    return h;
  }
  if (/^@?[A-Za-z0-9_]{1,30}$/.test(s)) return s.replace(/^@/, '');
  return undefined;
}
