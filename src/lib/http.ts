// Маленькая обёртка над fetch: таймаут, понятные ошибки и кэш на несколько секунд,
// чтобы не упираться в лимиты бесплатных API.

export class HttpError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; data: unknown }>();

export async function getJson<T>(url: string, opts: { ttlMs?: number; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const { ttlMs = 15_000, timeoutMs = 15_000, headers } = opts;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;

  const data = await request<T>(url, { method: 'GET', headers }, timeoutMs);
  cache.set(url, { at: Date.now(), data });
  return data;
}

export async function postJson<T>(url: string, body: unknown, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  return request<T>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? 20_000,
  );
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      let detail = '';
      try {
        const txt = await res.text();
        detail = txt.slice(0, 200);
      } catch {
        /* ignore */
      }
      if (res.status === 429) throw new HttpError('Слишком много запросов — подождите минуту', 429);
      throw new HttpError(`Ошибка ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error).name === 'AbortError') throw new HttpError('Сервис не ответил вовремя');
    throw new HttpError('Нет связи с сервисом (сеть или блокировка)');
  } finally {
    clearTimeout(timer);
  }
}
