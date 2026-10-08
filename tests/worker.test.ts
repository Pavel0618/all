import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQuery, computeSignals, hypeFromSignals, influencersFromSignals, normalizeTweet, type Tweet } from '../src/lib/twitterSignals';
import worker from '../worker/src/index';
import { scan, SCAN_INTERVAL_MS } from '../worker/src/scanner';
import { webhookSecret } from '../worker/src/telegram';
import type { Env } from '../worker/src/env';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const MIN = 60_000;

// ---------- Фикстуры ----------

function tweet(minutesAgo: number, user: string, followers: number, accountAgeDays = 400, text = 'gm $FROG'): Record<string, unknown> {
  return {
    id: `${user}-${minutesAgo}-${Math.random()}`,
    text,
    createdAt: new Date(NOW - minutesAgo * MIN).toUTCString(),
    likeCount: 10,
    retweetCount: 2,
    viewCount: 500,
    author: { userName: user, followers, createdAt: new Date(NOW - accountAgeDays * 86_400_000).toUTCString(), isBlueVerified: false },
  };
}

/** Горячая монета: 12 твитов за последний час, 6 — раньше; пишут два KOL */
function hotTweets(): Record<string, unknown>[] {
  const list: Record<string, unknown>[] = [];
  for (let i = 0; i < 12; i++) list.push(tweet(5 * i, `fan${i}`, 300 + i * 50, 200, i === 0 ? '#AI frog agent $FROG' : 'gm $FROG'));
  list.push(tweet(10, 'bigkol', 250_000), tweet(20, 'midkol', 40_000));
  for (let i = 0; i < 6; i++) list.push(tweet(120 + i * 180, `old${i}`, 800));
  return list;
}

class FakeKV {
  m = new Map<string, string>();
  async get(k: string, type?: string) {
    const v = this.m.get(k);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
  async delete(k: string) {
    this.m.delete(k);
  }
  async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number }) {
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true };
  }
}

function makeEnv(extra: Partial<Env> = {}): Env & { KV: FakeKV } {
  return {
    KV: new FakeKV() as unknown as KVNamespace,
    TWITTERAPI_KEY: 'tw-key',
    TELEGRAM_BOT_TOKEN: '123:abc',
    SITE_URL: 'https://example.github.io/all/',
    ...extra,
  } as Env & { KV: FakeKV };
}

function ctx() {
  const tasks: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException() {}, props: {}, tasks } as unknown as ExecutionContext & { tasks: Promise<unknown>[] };
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function pair(chainId: string, address: string, symbol: string, o: { mcap?: number; liq?: number; h1tx?: number; h6tx?: number; twitter?: boolean } = {}) {
  return {
    chainId,
    dexId: 'raydium',
    url: `https://dexscreener.com/${chainId}/p${symbol}`,
    pairAddress: `p${symbol}`,
    baseToken: { address, name: symbol, symbol },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'SOL', symbol: 'SOL' },
    priceUsd: '0.0002',
    txns: { h1: { buys: o.h1tx ?? 400, sells: 200 }, h6: { buys: o.h6tx ?? 700, sells: 500 } },
    priceChange: { m5: 2, h1: 12, h6: 40, h24: 70 },
    liquidity: { usd: o.liq ?? 45_000 },
    marketCap: o.mcap ?? 220_000,
    pairCreatedAt: NOW - 10 * 3_600_000,
    info: { socials: o.twitter === false ? [] : [{ type: 'twitter', url: `https://x.com/${symbol.toLowerCase()}` }] },
  };
}

interface Calls {
  twitter: string[];
  telegram: { method: string; body: Record<string, unknown> }[];
}

/** Мок всех внешних сервисов. */
function mockWorld(tokens: Record<string, ReturnType<typeof pair>>, tweets: () => Record<string, unknown>[] = hotTweets): Calls {
  const calls: Calls = { twitter: [], telegram: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname === 'api.dexscreener.com') {
        if (url.pathname.startsWith('/token-profiles')) return json([]);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'tokens') return json(parts[3].split(',').map((a) => tokens[a]).filter(Boolean));
        return json({ pairs: [] });
      }
      if (url.hostname === 'api.geckoterminal.com') {
        return json({ data: Object.keys(tokens).map((a) => ({ id: 'p', attributes: { name: 'x', address: 'p' }, relationships: { base_token: { data: { id: `solana_${a}` } } } })) });
      }
      if (url.hostname === 'api.rugcheck.xyz') return json({ score: 1, risks: [], lpLockedPct: 100 });
      if (url.hostname === 'api.gopluslabs.io') return json({ code: 1, result: {} });
      if (url.hostname === 'api.twitterapi.io') {
        calls.twitter.push(url.pathname + url.search);
        if (url.pathname.includes('/user/info')) return json({ data: { userName: 'frog', followers: 12_000, createdAt: new Date(NOW - 90 * 86_400_000).toUTCString() } });
        return json({ tweets: tweets(), has_next_page: false });
      }
      if (url.hostname === 'api.telegram.org') {
        const method = url.pathname.split('/').pop()!;
        calls.telegram.push({ method, body: JSON.parse(String(init?.body ?? '{}')) });
        return json({ ok: true, result: method === 'getMe' ? { username: 'gemradar_bot' } : {} });
      }
      return json({}, 404);
    }),
  );
  return calls;
}

// Время сервера = время фикстур (подменяем только Date, таймеры настоящие)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------- Twitter-сигналы ----------

describe('Twitter-сигналы', () => {
  const tweets = hotTweets().map((t) => normalizeTweet(t)!) as Tweet[];

  it('считает всплеск упоминаний', () => {
    const s = computeSignals(tweets, { now: NOW, complete: true, query: 'q', projectHandle: 'frog' });
    expect(s.lastHour).toBe(14);
    expect(s.perHourBefore).toBeCloseTo(6 / 23);
    expect(s.acceleration).toBeGreaterThan(10);
    expect(hypeFromSignals(s).status).toBe('good');
  });

  it('находит KOL и отличает от ботов', () => {
    const s = computeSignals(tweets, { now: NOW, complete: true, query: 'q' });
    expect(s.kols.map((k) => k.userName)).toEqual(['bigkol', 'midkol']);
    expect(influencersFromSignals(s).status).toBe('good');
    expect(s.hashtags).toContain('ai');
  });

  it('боты без KOL → слабый пункт', () => {
    const bots = Array.from({ length: 10 }, (_, i) => normalizeTweet(tweet(i * 3, `bot${i}`, 5, 3))!);
    const s = computeSignals(bots, { now: NOW, complete: true, query: 'q' });
    expect(s.botShare).toBe(1);
    expect(influencersFromSignals(s).status).toBe('weak');
  });

  it('тишина → хайпа нет', () => {
    const s = computeSignals([], { now: NOW, complete: true, query: 'q' });
    expect(hypeFromSignals(s).status).toBe('weak');
  });

  it('интерес падает → слабый', () => {
    const fading = [...Array.from({ length: 2 }, (_, i) => tweet(10 + i, `a${i}`, 900)), ...Array.from({ length: 40 }, (_, i) => tweet(70 + i * 10, `b${i}`, 900))];
    const s = computeSignals(fading.map((t) => normalizeTweet(t)!), { now: NOW, complete: true, query: 'q' });
    expect(hypeFromSignals(s).status).toBe('weak');
  });

  it('запрос: адрес, $тикер, без твитов проекта, за сутки', () => {
    expect(buildQuery('ADDR', 'FROG', 'frogcoin')).toBe('(ADDR OR $FROG) -from:frogcoin within_time:24h');
    expect(buildQuery('ADDR', 'бад тикер')).toBe('ADDR within_time:24h');
  });
});

// ---------- Сервер: /signals ----------

describe('сервер: /signals', () => {
  const A = 'FroG1111111111111111111111111111111111111aa';

  it('считает сигналы, кэширует и списывает лимит один раз', async () => {
    const env = makeEnv();
    const calls = mockWorld({ [A]: pair('solana', A, 'FROG') });
    const req = () => worker.fetch(new Request(`https://w.dev/signals?chain=solana&address=${A}`), env, ctx());
    const r1 = await req();
    const body = (await r1.json()) as { signals: { lastHour: number; kolCount: number }; symbol: string; handle: string };
    expect(r1.status).toBe(200);
    expect(r1.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(body.symbol).toBe('FROG');
    expect(body.handle).toBe('frog');
    expect(body.signals.kolCount).toBe(2);
    const twitterCalls = calls.twitter.length;
    const r2 = (await (await req()).json()) as { cached: boolean };
    expect(r2.cached).toBe(true);
    expect(calls.twitter.length).toBe(twitterCalls);
    expect(env.KV.m.get('budget:2026-10-08')).toBe('1');
  });

  it('уважает дневной лимит', async () => {
    const B = 'FroG2222222222222222222222222222222222222bb';
    const env = makeEnv({ DAILY_TWITTER_BUDGET: '0' });
    const calls = mockWorld({ [B]: pair('solana', B, 'FROGB') });
    const res = (await (await worker.fetch(new Request(`https://w.dev/signals?chain=solana&address=${B}`), env, ctx())).json()) as { error: string };
    expect(res.error).toBe('budget');
    expect(calls.twitter).toHaveLength(0);
  });

  it('без ключа — not_configured, мусорные адреса — 400, неизвестные — 404', async () => {
    const C = 'FroG3333333333333333333333333333333333333cc';
    mockWorld({ [C]: pair('solana', C, 'FROGC') });
    const env = makeEnv({ TWITTERAPI_KEY: undefined });
    expect(((await (await worker.fetch(new Request(`https://w.dev/signals?chain=solana&address=${C}`), env, ctx())).json()) as { error: string }).error).toBe('not_configured');
    expect((await worker.fetch(new Request('https://w.dev/signals?chain=solana&address=bad'), env, ctx())).status).toBe(400);
    expect((await worker.fetch(new Request('https://w.dev/signals?chain=polygon&address=0x1111111111111111111111111111111111111111'), env, ctx())).status).toBe(400);
    expect((await worker.fetch(new Request('https://w.dev/signals?chain=solana&address=FroG4444444444444444444444444444444444444dd'), env, ctx())).status).toBe(404);
  });
});

// ---------- Бот ----------

describe('Telegram-бот', () => {
  const D = 'FroG5555555555555555555555555555555555555ee';

  async function send(env: Env, text: string, secret?: string) {
    const c = ctx();
    const res = await worker.fetch(
      new Request('https://w.dev/telegram', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret ?? (await webhookSecret(env.TELEGRAM_BOT_TOKEN!)) },
        body: JSON.stringify({ message: { chat: { id: 42, type: 'private' }, text } }),
      }),
      env,
      c,
    );
    await Promise.all(c.tasks);
    return res;
  }

  it('секрет вебхука совпадает с тем, что ставит скрипт настройки бота', async () => {
    // @ts-expect-error — встроенный модуль Node есть в тестах, но не в типах Cloudflare
    const { createHash } = (await import('node:crypto')) as { createHash: (a: string) => { update(s: string): { digest(e: string): string } } };
    const expected = createHash('sha256').update('gem-radar:123:abc').digest('hex').slice(0, 48);
    expect(await webhookSecret('123:abc')).toBe(expected);
  });

  it('чужие запросы без секрета отклоняются', async () => {
    const env = makeEnv();
    mockWorld({});
    expect((await send(env, '/start', 'wrong')).status).toBe(403);
  });

  it('/start подписывает и даёт кнопку Mini App', async () => {
    const env = makeEnv();
    const calls = mockWorld({});
    await send(env, '/start');
    expect(env.KV.m.has('sub:42')).toBe(true);
    const msg = calls.telegram.find((c) => c.method === 'sendMessage')!;
    expect(JSON.stringify(msg.body.reply_markup)).toContain('web_app');
  });

  it('адрес в сообщении → разбор по 5 шагам с кнопкой «Открыть и купить»', async () => {
    const env = makeEnv();
    const calls = mockWorld({ [D]: pair('solana', D, 'FROGD') });
    await send(env, D);
    const msg = calls.telegram.find((c) => c.method === 'sendMessage')!;
    const text = String(msg.body.text);
    expect(text).toContain('$FROGD');
    expect(text).toContain('Можно входить');
    expect(text.match(/✅/g)?.length).toBe(5);
    expect(JSON.stringify(msg.body.reply_markup)).toContain(`#/token/solana/${D}`);
  });

  it('/stop отписывает', async () => {
    const env = makeEnv();
    mockWorld({});
    await send(env, '/start');
    await send(env, '/stop');
    expect(env.KV.m.has('sub:42')).toBe(false);
  });
});

// ---------- Сканер ----------

describe('сканер алертов', () => {
  const HOT = 'FroG6666666666666666666666666666666666666ff';
  const LATE = 'FroG7777777777777777777777777777777777777gg';
  // Время, при котором сканер берёт Solana (первая сеть в списке)
  const solanaTime = Math.ceil(NOW / (SCAN_INTERVAL_MS * 6)) * SCAN_INTERVAL_MS * 6;

  it('присылает алерт только по монете «Можно входить» и только один раз', async () => {
    const env = makeEnv({ ALERT_CHAT_ID: '-1001', SCAN_CHAINS: 'solana' });
    await env.KV.put('sub:42', '1');
    const calls = mockWorld({
      [HOT]: pair('solana', HOT, 'HOT'),
      [LATE]: pair('solana', LATE, 'LATE', { mcap: 5_000_000 }), // капа уже большая — не кандидат
    });
    const log = await scan(env, solanaTime);
    expect(log.chain).toBe('solana');
    expect(log.candidates).toBe(1);
    expect(log.alerts).toEqual(['HOT']);
    const sends = calls.telegram.filter((c) => c.method === 'sendMessage');
    expect(sends.map((s) => String(s.body.chat_id)).sort()).toEqual(['-1001', '42']);
    // В канале — ссылка на бота, в личке — Mini App
    expect(JSON.stringify(sends.find((s) => s.body.chat_id === '-1001')!.body.reply_markup)).toContain('t.me/gemradar_bot?start=solana_');
    const again = await scan(env, solanaTime + SCAN_INTERVAL_MS * 6);
    expect(again.alerts).toEqual([]);
  });

  it('без бота сканер не работает и не тратит лимит', async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: undefined });
    const calls = mockWorld({ [HOT]: pair('solana', HOT, 'HOT') });
    const log = await scan(env, solanaTime);
    expect(log.skipped).toBeTruthy();
    expect(calls.twitter).toHaveLength(0);
  });
});
