// Работа с KV. На бесплатном тарифе Cloudflare — 1000 записей в сутки, поэтому пишем экономно:
// одна запись на Twitter-проверку (кэш), одна на счётчик лимита, по одной на алерт и подписчика.
import type { Env } from './env';
import { intVar } from './env';

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

export async function getJsonKV<T>(env: Env, key: string): Promise<T | undefined> {
  try {
    return ((await env.KV.get(key, 'json')) as T | null) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function putJsonKV(env: Env, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  // KV требует TTL не меньше 60 секунд
  await env.KV.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.round(ttlSeconds)) });
}

// ---------- Дневной лимит Twitter-проверок (защита от неожиданных расходов) ----------

export async function budgetLeft(env: Env, now: number): Promise<number> {
  const limit = intVar(env.DAILY_TWITTER_BUDGET, 150);
  const used = intVar((await env.KV.get(`budget:${day(now)}`)) ?? undefined, 0);
  return Math.max(0, limit - used);
}

export async function spendBudget(env: Env, now: number): Promise<void> {
  const key = `budget:${day(now)}`;
  const used = intVar((await env.KV.get(key)) ?? undefined, 0);
  await env.KV.put(key, String(used + 1), { expirationTtl: 2 * 86_400 });
}

// ---------- Подписчики бота ----------

export async function subscribe(env: Env, chatId: number | string): Promise<boolean> {
  const key = `sub:${chatId}`;
  if (await env.KV.get(key)) return false;
  await env.KV.put(key, '1');
  return true;
}

export async function unsubscribe(env: Env, chatId: number | string): Promise<void> {
  await env.KV.delete(`sub:${chatId}`);
}

export async function listSubscribers(env: Env, limit = 1000): Promise<string[]> {
  const res = await env.KV.list({ prefix: 'sub:', limit });
  return res.keys.map((k) => k.name.slice(4));
}

// ---------- Память сканера ----------

export const alertKey = (chain: string, address: string) => `alert:${chain}:${address.toLowerCase()}`;
export const seenKey = (chain: string, address: string) => `seen:${chain}:${address.toLowerCase()}`;
