// Автоматическая Twitter-аналитика для шагов 1, 2 и 5 методики.
// Сервер (Cloudflare Worker) забирает свежие твиты с упоминанием токена через twitterapi.io,
// а здесь из них считаются сигналы: всплеск упоминаний, кто пишет (KOL или боты), темы.
// Код общий для сервера и сайта, поэтому без зависимостей от браузера.

export interface TweetAuthor {
  userName: string;
  name?: string;
  followers: number;
  createdAt?: string;
  isBlueVerified?: boolean;
}

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  viewCount: number;
  author: TweetAuthor;
}

export interface TwitterSignals {
  /** Поисковый запрос, по которому считали */
  query: string;
  /** Сколько твитов проанализировано */
  sample: number;
  /** true — получены все твиты за сутки, false — только самые свежие */
  complete: boolean;
  /** Упоминаний за последний час */
  lastHour: number;
  /** Средняя скорость упоминаний до последнего часа (в час) */
  perHourBefore?: number;
  /** Во сколько раз последний час активнее среднего */
  acceleration?: number;
  uniqueAuthors: number;
  /** Заметные авторы (KOL): ≥10k подписчиков и аккаунт старше полугода */
  kols: { userName: string; followers: number }[];
  kolCount: number;
  /** Доля авторов, похожих на ботов (мало подписчиков или аккаунт моложе месяца) */
  botShare: number;
  likes: number;
  retweets: number;
  views: number;
  hashtags: string[];
  /** Аккаунт проекта */
  project?: { userName: string; followers: number; ageDays?: number; verified?: boolean };
  /** Кусок текста твитов — для поиска нарратива */
  textSample: string;
  fetchedAt: number;
}

export const KOL_MIN_FOLLOWERS = 10_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

export function parseDate(s?: string): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Приводим ответ API к нашему виду (названия полей у провайдеров немного отличаются). */
export function normalizeTweet(raw: Record<string, unknown>): Tweet | undefined {
  const a = (raw.author ?? raw.user ?? {}) as Record<string, unknown>;
  const userName = String(a.userName ?? a.username ?? a.screen_name ?? '');
  const createdAt = String(raw.createdAt ?? raw.created_at ?? '');
  if (!userName || !createdAt) return undefined;
  return {
    id: String(raw.id ?? raw.id_str ?? ''),
    text: String(raw.text ?? raw.full_text ?? ''),
    createdAt,
    likeCount: toNum(raw.likeCount ?? raw.favorite_count),
    retweetCount: toNum(raw.retweetCount ?? raw.retweet_count),
    viewCount: toNum(raw.viewCount ?? raw.views),
    author: {
      userName,
      name: a.name ? String(a.name) : undefined,
      followers: toNum(a.followers ?? a.followersCount ?? a.followers_count),
      createdAt: a.createdAt ? String(a.createdAt) : a.created_at ? String(a.created_at) : undefined,
      isBlueVerified: Boolean(a.isBlueVerified ?? a.verified),
    },
  };
}

export function computeSignals(
  tweets: Tweet[],
  opts: { now: number; complete: boolean; query: string; projectHandle?: string; project?: TwitterSignals['project'] },
): TwitterSignals {
  const { now } = opts;
  const own = opts.projectHandle?.toLowerCase();
  const times = tweets.map((t) => parseDate(t.createdAt)).filter((t): t is number => t !== undefined);
  const lastHour = times.filter((t) => now - t <= HOUR).length;
  const older = times.filter((t) => now - t > HOUR);

  // Окно, которое покрывают твиты: сутки, если получили всё, иначе — до самого старого твита
  const oldest = times.length ? Math.min(...times) : now;
  const windowHours = opts.complete ? 24 : Math.max(0, (now - oldest) / HOUR);
  const beforeHours = windowHours - 1;
  const perHourBefore = beforeHours >= 0.25 ? older.length / beforeHours : undefined;
  const acceleration =
    perHourBefore !== undefined && perHourBefore > 0 ? lastHour / perHourBefore : perHourBefore === 0 && lastHour > 0 ? lastHour : undefined;

  // Авторы
  const authors = new Map<string, TweetAuthor>();
  for (const t of tweets) {
    const key = t.author.userName.toLowerCase();
    if (key === own) continue;
    if (!authors.has(key)) authors.set(key, t.author);
  }
  const list = [...authors.values()];
  const ageDays = (a: TweetAuthor) => {
    const c = parseDate(a.createdAt);
    return c === undefined ? undefined : (now - c) / DAY;
  };
  const kols = list
    .filter((a) => a.followers >= KOL_MIN_FOLLOWERS && (ageDays(a) ?? 365) >= 180)
    .sort((x, y) => y.followers - x.followers)
    .map((a) => ({ userName: a.userName, followers: a.followers }));
  const bots = list.filter((a) => a.followers < 50 || (ageDays(a) ?? 365) < 30).length;

  // Темы
  const tags = new Map<string, number>();
  for (const t of tweets) {
    for (const m of t.text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
      const k = m[1].toLowerCase();
      tags.set(k, (tags.get(k) ?? 0) + 1);
    }
  }
  const hashtags = [...tags.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  return {
    query: opts.query,
    sample: tweets.length,
    complete: opts.complete,
    lastHour,
    perHourBefore,
    acceleration,
    uniqueAuthors: list.length,
    kols: kols.slice(0, 5),
    kolCount: kols.length,
    botShare: list.length ? bots / list.length : 0,
    likes: tweets.reduce((s, t) => s + t.likeCount, 0),
    retweets: tweets.reduce((s, t) => s + t.retweetCount, 0),
    views: tweets.reduce((s, t) => s + t.viewCount, 0),
    hashtags,
    project: opts.project,
    textSample: tweets
      .map((t) => t.text)
      .join(' \n')
      .slice(0, 4000),
    fetchedAt: now,
  };
}

/** Запрос для поиска упоминаний: адрес контракта (точно) или $ТИКЕР, без твитов самого проекта. */
export function buildQuery(address: string, symbol?: string, projectHandle?: string): string {
  const parts = [address];
  if (symbol && /^[A-Za-z][A-Za-z0-9]{1,11}$/.test(symbol)) parts.push(`$${symbol}`);
  let q = parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
  if (projectHandle) q += ` -from:${projectHandle}`;
  return `${q} within_time:24h`;
}

// ---------- Решение по критериям ----------

export interface SignalVerdict {
  status: 'good' | 'weak';
  reasons: { ok: boolean | null; text: string }[];
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n)));

/** Шаг 1: «Хайп в Twitter нарастает». */
export function hypeFromSignals(s: TwitterSignals): SignalVerdict {
  const reasons: SignalVerdict['reasons'] = [];
  const speed = `${s.lastHour} упоминаний за час${s.acceleration !== undefined ? ` (×${s.acceleration.toFixed(1)} к среднему)` : ''}`;
  if (s.sample === 0) {
    return { status: 'weak', reasons: [{ ok: false, text: 'За сутки в X почти нет упоминаний токена' }] };
  }
  const accelerating = s.acceleration !== undefined && s.acceleration >= 1.5;
  let status: SignalVerdict['status'];
  if (s.lastHour >= 20 || (s.lastHour >= 5 && (accelerating || s.acceleration === undefined))) {
    status = 'good';
    reasons.push({ ok: true, text: s.lastHour >= 20 && !accelerating ? `Twitter кипит: ${speed}` : `Всплеск интереса: ${speed}` });
  } else if (s.acceleration !== undefined && s.acceleration < 0.7) {
    status = 'weak';
    reasons.push({ ok: false, text: `Интерес падает: ${speed}` });
  } else {
    status = 'weak';
    reasons.push({ ok: false, text: s.lastHour < 5 ? `Мало упоминаний: ${speed}` : `Без ускорения: ${speed}` });
  }
  if (s.views > 0) reasons.push({ ok: null, text: `Охват твитов: ${k(s.views)} просмотров, ${k(s.likes)} лайков, ${k(s.retweets)} ретвитов` });
  return { status, reasons };
}

/** Шаг 2: «Его качают реальные инфлюенсеры». */
export function influencersFromSignals(s: TwitterSignals): SignalVerdict {
  const reasons: SignalVerdict['reasons'] = [];
  const kolText = s.kols
    .slice(0, 3)
    .map((x) => `@${x.userName} (${k(x.followers)})`)
    .join(', ');
  let status: SignalVerdict['status'];
  if (s.uniqueAuthors < 3) {
    status = 'weak';
    reasons.push({ ok: false, text: `Пишут всего ${s.uniqueAuthors} аккаунта — волны нет` });
  } else if (s.botShare >= 0.6) {
    status = 'weak';
    reasons.push({ ok: false, text: `${Math.round(s.botShare * 100)}% авторов похожи на ботов (мало подписчиков или свежий аккаунт)` });
  } else if (s.kolCount >= 2 || (s.kolCount === 1 && s.kols[0].followers >= 50_000)) {
    status = 'good';
    reasons.push({ ok: true, text: `Пишут заметные аккаунты: ${kolText}${s.kolCount > 3 ? ` и ещё ${s.kolCount - 3}` : ''}` });
  } else {
    status = 'weak';
    reasons.push({ ok: false, text: s.kolCount === 1 ? `Только один заметный аккаунт: ${kolText}` : 'Нет заметных авторов (≥10k подписчиков) — толпа без лидеров' });
  }
  reasons.push({ ok: null, text: `Авторов: ${s.uniqueAuthors}, похожих на ботов: ${Math.round(s.botShare * 100)}%` });
  if (s.project) {
    const age = s.project.ageDays !== undefined ? `, аккаунту ${Math.round(s.project.ageDays)} дн.` : '';
    reasons.push({ ok: s.project.followers >= 1000 ? null : false, text: `Аккаунт проекта @${s.project.userName}: ${k(s.project.followers)} подписчиков${age}` });
  }
  return { status, reasons };
}
