// Настройки сервера. Секреты (ключи) задаются через `wrangler secret put`, остальное — переменными в wrangler.toml
// или флагом `--var` при деплое (это делает GitHub Actions, см. .github/workflows/deploy.yml).

export interface Env {
  /** Хранилище: кэш Twitter-анализа, подписчики бота, уже отправленные алерты, дневной лимит */
  KV: KVNamespace;

  /** Ключ twitterapi.io — без него Twitter-анализ выключен */
  TWITTERAPI_KEY?: string;
  /** Токен бота от @BotFather — без него бот и алерты выключены */
  TELEGRAM_BOT_TOKEN?: string;

  /** Адрес сайта / Mini App (https://<ник>.github.io/<репо>/) */
  SITE_URL?: string;
  /** Куда ещё слать алерты: id канала или чата (например, -100123…) — по желанию */
  ALERT_CHAT_ID?: string;
  /** Сколько Twitter-проверок в сутки можно потратить (≈$0.006 за проверку). По умолчанию 150 */
  DAILY_TWITTER_BUDGET?: string;
  /** Сколько монет за один проход сканера проверять в Twitter. По умолчанию 2 */
  SCAN_TWITTER_PER_RUN?: string;
  /** Сети для сканера через запятую. По умолчанию все */
  SCAN_CHAINS?: string;
  /** Разрешённый сайт для запросов из браузера (CORS). По умолчанию — адрес из SITE_URL */
  ALLOWED_ORIGIN?: string;

  /** Ограничители запросов (wrangler.toml → [[ratelimits]]): с одного IP на /signals и из одного чата в бот */
  SIGNALS_LIMIT?: RateLimit;
  BOT_LIMIT?: RateLimit;
}

/** Часть дневного лимита Twitter, которую сайт и бот не могут потратить: она остаётся сканеру алертов. */
export const SCANNER_RESERVE = 0.25;

/** Пропускает ли ограничитель; без привязки (локальные тесты) — пропускает. */
export async function allowed(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true; // сбой ограничителя не должен ломать сервис
  }
}

export const intVar = (v: string | undefined, fallback: number) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
