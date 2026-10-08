// Клиент twitterapi.io: поиск свежих твитов и данные аккаунта проекта.
import { buildQuery, computeSignals, normalizeTweet, parseDate, type Tweet, type TwitterSignals } from '../../src/lib/twitterSignals';
import type { Env } from './env';

const API = 'https://api.twitterapi.io';
/** Страниц поиска по 20 твитов. 2 страницы ≈ $0.006 за проверку */
const MAX_PAGES = 2;

async function call<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'x-api-key': env.TWITTERAPI_KEY ?? '' } });
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}`);
  return (await res.json()) as T;
}

interface SearchPage {
  tweets?: Record<string, unknown>[];
  has_next_page?: boolean;
  next_cursor?: string;
}

export async function searchTweets(env: Env, query: string): Promise<{ tweets: Tweet[]; complete: boolean }> {
  const tweets: Tweet[] = [];
  let cursor = '';
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ query, queryType: 'Latest', cursor });
    const data = await call<SearchPage>(env, `/twitter/tweet/advanced_search?${q}`);
    for (const raw of data.tweets ?? []) {
      const t = normalizeTweet(raw);
      if (t && !tweets.some((x) => x.id === t.id)) tweets.push(t);
    }
    if (!data.has_next_page || !data.next_cursor || data.next_cursor === cursor) {
      complete = true;
      break;
    }
    cursor = data.next_cursor;
  }
  return { tweets, complete };
}

export async function projectInfo(env: Env, userName: string, now: number): Promise<TwitterSignals['project'] | undefined> {
  try {
    const res = await call<{ data?: Record<string, unknown> } & Record<string, unknown>>(env, `/twitter/user/info?userName=${encodeURIComponent(userName)}`);
    const d = (res.data ?? res) as Record<string, unknown>;
    const followers = Number(d.followers ?? d.followersCount ?? d.followers_count);
    if (!Number.isFinite(followers)) return undefined;
    const created = parseDate(String(d.createdAt ?? d.created_at ?? ''));
    return {
      userName: String(d.userName ?? userName),
      followers,
      ageDays: created ? (now - created) / 86_400_000 : undefined,
      verified: Boolean(d.isBlueVerified ?? d.verified),
    };
  } catch {
    return undefined;
  }
}

export async function fetchTwitterSignals(
  env: Env,
  token: { address: string; symbol?: string; handle?: string },
  now: number,
): Promise<TwitterSignals> {
  const query = buildQuery(token.address, token.symbol, token.handle);
  const [{ tweets, complete }, project] = await Promise.all([
    searchTweets(env, query),
    token.handle ? projectInfo(env, token.handle, now) : Promise.resolve(undefined),
  ]);
  return computeSignals(tweets, { now, complete, query, projectHandle: token.handle, project });
}
