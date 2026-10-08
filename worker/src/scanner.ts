// Сканер для бота: раз в 15 минут берёт одну сеть по кругу, находит монеты с ранним ростом активности,
// прогоняет все 5 проверок и присылает алерт, только если вердикт «Можно входить».
// Экономия: в Twitter проверяем лишь лучших кандидатов, уже прошедших рынок и контракт.
import { activityAcceleration, DEFAULT_THRESHOLDS, marketFromPair, priceCriterion } from '../../src/lib/analysis';
import { CHAIN_LIST, isChainId, type ChainId } from '../../src/lib/chains';
import { extractSocials, getLatestProfiles, getTokensBatch, mainPair, type DexPair } from '../../src/lib/dexscreener';
import { getTrendingTokenAddresses } from '../../src/lib/gecko';
import { DEFAULT_NARRATIVES } from '../../src/lib/narratives';
import { checkSecurity, CORE_GROUPS, groupStatus } from '../../src/lib/security';
import type { Env } from './env';
import { intVar } from './env';
import { fullReport, loadToken, type FullReport } from './analyze';
import { alertKey, listSubscribers, putJsonKV } from './store';
import { formatReport, tg, tokenButtons } from './telegram';

/** Интервал cron — для выбора сети по кругу */
export const SCAN_INTERVAL_MS = 15 * 60_000;
/** Сколько монет за проход проверять на безопасность (бесплатно, но есть лимит запросов) */
const SECURITY_PER_RUN = 4;
/** Сколько подписчиков оповещать за один проход (лимит запросов Cloudflare); для большой аудитории — канал */
const MAX_PRIVATE_ALERTS = 20;

export interface ScanLog {
  chain?: ChainId;
  scanned: number;
  candidates: number;
  checked: string[];
  alerts: string[];
  skipped?: string;
}

export function scanChain(env: Env, now: number): ChainId {
  const list = (env.SCAN_CHAINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(isChainId);
  const chains = list.length ? list : CHAIN_LIST.map((c) => c.id);
  return chains[Math.floor(now / SCAN_INTERVAL_MS) % chains.length];
}

/** Предварительный отбор по рынку: ранний этап, ликвидность, есть Twitter, активность растёт. */
export function isCandidate(pair: DexPair): boolean {
  const socials = extractSocials(pair);
  if (!socials.twitter && !socials.twitterUrl) return false;
  const tokenInput = {
    market: marketOf(pair),
    securityLoaded: false,
    hasTwitterLink: true,
    token: {},
    narratives: DEFAULT_NARRATIVES,
    answers: {},
    thresholds: DEFAULT_THRESHOLDS,
  };
  if (priceCriterion(tokenInput).status !== 'good') return false;
  return (activityAcceleration(tokenInput.market) ?? 0) >= 1.3;
}

const marketOf = (pair: DexPair) => marketFromPair(pair);

async function broadcast(env: Env, report: FullReport): Promise<number> {
  const text = formatReport(report);
  const base = { text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  let sent = 0;
  if (env.ALERT_CHAT_ID) {
    await tg(env, 'sendMessage', {
      ...base,
      chat_id: env.ALERT_CHAT_ID,
      reply_markup: await tokenButtons(env, report.token.chain, report.token.address, false),
    }).then(
      () => sent++,
      () => undefined,
    );
  }
  const subs = await listSubscribers(env, MAX_PRIVATE_ALERTS);
  const markup = await tokenButtons(env, report.token.chain, report.token.address, true);
  for (const chatId of subs) {
    await tg(env, 'sendMessage', { ...base, chat_id: chatId, reply_markup: markup }).then(
      () => sent++,
      () => undefined,
    );
  }
  return sent;
}

export async function scan(env: Env, now: number): Promise<ScanLog> {
  const log: ScanLog = { scanned: 0, candidates: 0, checked: [], alerts: [] };
  if (!env.TELEGRAM_BOT_TOKEN) return { ...log, skipped: 'TELEGRAM_BOT_TOKEN не задан' };
  const chain = scanChain(env, now);
  log.chain = chain;

  // 1. Кто сейчас набирает активность
  const [trending, profiles] = await Promise.all([
    getTrendingTokenAddresses(chain).catch(() => [] as string[]),
    getLatestProfiles()
      .then((list) => list.filter((p) => p.chainId === chain).map((p) => p.tokenAddress))
      .catch(() => [] as string[]),
  ]);
  const addresses = [...new Set([...trending, ...profiles])].slice(0, 30);
  if (!addresses.length) return { ...log, skipped: 'нет данных о трендах' };
  const pairs = await getTokensBatch(chain, addresses).catch(() => [] as DexPair[]);

  const byToken = new Map<string, DexPair[]>();
  for (const p of pairs) {
    const k = p.baseToken.address.toLowerCase();
    byToken.set(k, [...(byToken.get(k) ?? []), p]);
  }
  const candidates = [...byToken.entries()]
    .map(([addr, list]) => mainPair(list, addr))
    .filter((p): p is DexPair => Boolean(p))
    .filter((p) => {
      log.scanned++;
      return isCandidate(p);
    })
    .sort((a, b) => (activityAcceleration(marketOf(b)) ?? 0) - (activityAcceleration(marketOf(a)) ?? 0));
  log.candidates = candidates.length;

  // 2. Контракт (бесплатно) → Twitter (платно, лимит) → вердикт
  let securityChecks = 0;
  let twitterChecks = 0;
  const twitterPerRun = intVar(env.SCAN_TWITTER_PER_RUN, 1);
  for (const pair of candidates) {
    if (securityChecks >= SECURITY_PER_RUN || twitterChecks >= twitterPerRun) break;
    const addr = pair.baseToken.address;
    if (await env.KV.get(alertKey(chain, addr))) continue; // уже присылали
    // Свежий Twitter-анализ в кэше значит «уже проверяли недавно»
    if (await env.KV.get(`sig:${chain}:${addr.toLowerCase()}`)) continue;

    securityChecks++;
    const security = await checkSecurity(chain, addr, pair.dexId).catch(() => undefined);
    if (!security || CORE_GROUPS.some((g) => groupStatus(security, g) === 'danger')) continue;

    const token = await loadToken(chain, addr).catch(() => undefined);
    if (!token) continue;
    twitterChecks++;
    log.checked.push(token.symbol);
    const report = await fullReport(env, token, now, { twitter: true, security });
    if (report.analysis.verdict.level !== 'go') continue;

    await putJsonKV(env, alertKey(chain, addr), { at: now }, 24 * 3600);
    await broadcast(env, report);
    log.alerts.push(token.symbol);
  }
  return log;
}
