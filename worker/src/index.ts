// Gem Radar server (Cloudflare Worker).
//  GET  /health    — что подключено (без секретов)
//  GET  /signals   — Twitter-анализ токена для сайта: ?chain=solana&address=…
//  POST /telegram  — вебхук бота
//  cron            — сканер алертов (см. wrangler.toml)
import type { Env } from './env';
import { getSignals, loadToken, validToken } from './analyze';
import { scan } from './scanner';
import { budgetLeft } from './store';
import { handleUpdate, webhookSecret } from './telegram';

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(env: Env, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env), ...extra },
  });
}

async function handleSignals(env: Env, url: URL, now: number): Promise<Response> {
  const chain = url.searchParams.get('chain') ?? '';
  const address = url.searchParams.get('address') ?? '';
  if (!validToken(chain, address)) return json(env, { error: 'bad_request' }, 400);
  // Берём токен с DexScreener на сервере: так нельзя потратить лимит на случайные адреса
  const token = await loadToken(chain, address).catch(() => undefined);
  if (!token) return json(env, { error: 'not_found' }, 404);
  const r = await getSignals(env, token, now);
  const base = { chain, address: token.address, symbol: token.symbol, handle: token.socials.twitter };
  if ('signals' in r) return json(env, { ...base, signals: r.signals, cached: r.cached }, 200, { 'Cache-Control': 'public, max-age=300' });
  return json(env, { ...base, error: r.error }, r.error === 'failed' ? 502 : 200);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    if (url.pathname === '/health') {
      return json(env, {
        ok: true,
        twitter: Boolean(env.TWITTERAPI_KEY),
        bot: Boolean(env.TELEGRAM_BOT_TOKEN),
        site: env.SITE_URL ?? null,
        twitterChecksLeftToday: await budgetLeft(env, now),
      });
    }

    if (url.pathname === '/signals' && req.method === 'GET') return handleSignals(env, url, now);

    if (url.pathname === '/telegram' && req.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) return new Response('bot disabled', { status: 404 });
      const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== (await webhookSecret(env.TELEGRAM_BOT_TOKEN))) return new Response('forbidden', { status: 403 });
      const update = await req.json().catch(() => ({}));
      // Отвечаем Telegram сразу, а проверку монеты делаем в фоне
      ctx.waitUntil(handleUpdate(env, update as Parameters<typeof handleUpdate>[1], now).catch((e) => console.error('update', e)));
      return new Response('ok');
    }

    return json(env, { error: 'not_found' }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      scan(env, event.scheduledTime)
        .then((log) => console.log('scan', JSON.stringify(log)))
        .catch((e) => console.error('scan failed', e)),
    );
  },
} satisfies ExportedHandler<Env>;
