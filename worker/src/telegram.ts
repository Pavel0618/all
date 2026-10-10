// Telegram-бот: алерты «Можно входить», проверка монеты по адресу/ссылке, подписка.
import { CHAINS, isChainId, parseUserInput, type ChainId } from '../../src/lib/chains';
import { getTokenAnyChain, mainPair } from '../../src/lib/dexscreener';
import { fmtUsd, type CriterionStatus } from '../../src/lib/analysis';
import { allowed, type Env } from './env';
import { fullReport, loadToken, type FullReport } from './analyze';
import { subscribe, unsubscribe } from './store';

// ---------- Bot API ----------

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  return data.result as T;
}

/** Секрет вебхука выводится из токена бота — отдельный секрет хранить не нужно. */
export async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gem-radar:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

let usernameCache: string | undefined;
export async function botUsername(env: Env): Promise<string | undefined> {
  if (usernameCache) return usernameCache;
  try {
    usernameCache = (await tg<{ username?: string }>(env, 'getMe', {})).username;
  } catch {
    /* ignore */
  }
  return usernameCache;
}

// ---------- Ссылки и кнопки ----------

export function siteTokenUrl(env: Env, chain: string, address: string): string | undefined {
  if (!env.SITE_URL) return undefined;
  return `${env.SITE_URL.replace(/#.*$/, '').replace(/\/?$/, '/')}#/token/${chain}/${address}`;
}

/** Кнопка под сообщением: в личке открывает Mini App сразу на токене, в каналах — ссылкой на бота. */
export async function tokenButtons(env: Env, chain: string, address: string, privateChat: boolean) {
  const url = siteTokenUrl(env, chain, address);
  if (privateChat && url) return { inline_keyboard: [[{ text: '📲 Открыть и купить', web_app: { url } }]] };
  const username = await botUsername(env);
  if (!username) return url ? { inline_keyboard: [[{ text: 'Открыть в Gem Radar', url }]] } : undefined;
  return { inline_keyboard: [[{ text: '📲 Открыть и купить', url: `https://t.me/${username}?start=${chain}_${address}` }]] };
}

// ---------- Форматирование ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON: Record<CriterionStatus, string> = { good: '✅', weak: '❌', unknown: '❔' };
const VERDICT_ICON = { go: '🟢', caution: '🟡', skip: '⏭', danger: '⛔' } as const;
const SHORT: Record<string, string> = {
  hype: 'Хайп',
  influencers: 'Кто качает',
  price: 'Цена',
  contract: 'Контракт',
  narrative: 'Нарратив',
};

export function formatReport(r: FullReport): string {
  const { token, analysis } = r;
  const m = token.market;
  const h1 = m.change.h1;
  const lines = [
    `${VERDICT_ICON[analysis.verdict.level]} <b>$${esc(token.symbol)}</b> · ${CHAINS[token.chain].name} — <b>${esc(analysis.verdict.title)}</b>`,
    `Капа ${fmtUsd(m.mcap)} · Ликв. ${fmtUsd(m.liquidity)}${h1 !== undefined ? ` · 1ч ${h1 > 0 ? '+' : ''}${h1.toFixed(0)}%` : ''}`,
    '',
  ];
  for (const c of analysis.criteria) {
    const reason = c.reasons.find((x) => x.ok !== null) ?? c.reasons[0];
    lines.push(`${ICON[c.status]} <b>${SHORT[c.id]}:</b> ${esc(reason?.text ?? c.title)}`);
  }
  if (r.signalsError === 'budget') lines.push('', '<i>Twitter-анализ на сегодня исчерпан — шаги 1–2 по косвенным данным.</i>');
  if (r.signalsError === 'not_configured') lines.push('', '<i>Twitter-анализ не подключён — шаги 1–2 по косвенным данным.</i>');
  lines.push('', `<code>${esc(token.address)}</code>`, '<i>Не финансовый совет. Мемкоины — высокий риск.</i>');
  return lines.join('\n');
}

// ---------- Обработка сообщений ----------

interface Update {
  message?: { chat: { id: number; type: string }; text?: string };
}

const HELP =
  '📡 <b>Gem Radar</b> — радар X-гемов по методике «через Twitter».\n\n' +
  '• Присылаю монеты, которые прошли все 5 проверок: хайп, кто качает, контракт, цена, нарратив.\n' +
  '• Пришлите адрес контракта или ссылку (DexScreener, GMGN, pump.fun) — проверю монету.\n\n' +
  '/check &lt;адрес&gt; — проверить монету\n/stop — выключить алерты\n/start — включить снова';

async function resolveToken(text: string) {
  const parsed = parseUserInput(text);
  if (!parsed?.address) return undefined;
  let chain: ChainId | undefined = parsed.chain;
  let address = parsed.address;
  if (!chain) {
    const best = mainPair(await getTokenAnyChain(address), address);
    if (!best || !isChainId(best.chainId)) return undefined;
    chain = best.chainId;
    address = best.baseToken.address;
  }
  return loadToken(chain, address);
}

async function replyReport(env: Env, chatId: number, text: string, privateChat: boolean, now: number) {
  // Каждая проверка тратит платный Twitter-лимит — не больше нескольких в минуту из одного чата
  if (!(await allowed(env.BOT_LIMIT, `chat:${chatId}`))) {
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Слишком много проверок подряд — подождите минуту.' });
    return;
  }
  const token = await resolveToken(text).catch(() => undefined);
  if (!token) {
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Не нашёл такую монету на DexScreener. Пришлите адрес контракта или ссылку.' });
    return;
  }
  const report = await fullReport(env, token, now, { twitter: true });
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: formatReport(report),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: await tokenButtons(env, token.chain, token.address, privateChat),
  });
}

export async function handleUpdate(env: Env, update: Update, now: number): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const privateChat = msg.chat.type === 'private';
  const text = msg.text.trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const command = cmd.startsWith('/') ? cmd.slice(1).split('@')[0].toLowerCase() : '';

  if (command === 'start') {
    await subscribe(env, chatId);
    const payload = rest.join(' ');
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: `${HELP}\n\n✅ Алерты включены.`,
      parse_mode: 'HTML',
      reply_markup: env.SITE_URL ? { inline_keyboard: [[{ text: '📡 Открыть радар', web_app: { url: env.SITE_URL } }]] } : undefined,
    });
    // Пришли по кнопке из канала: /start <сеть>_<адрес> — сразу показываем монету
    const m = payload.match(/^([a-z]+)_([A-Za-z0-9]{32,44})$/);
    if (m && isChainId(m[1])) await replyReport(env, chatId, `https://dexscreener.com/${m[1]}/${m[2]}`, privateChat, now);
    return;
  }
  if (command === 'stop') {
    await unsubscribe(env, chatId);
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Алерты выключены. /start — включить снова.' });
    return;
  }
  if (command === 'help') {
    await tg(env, 'sendMessage', { chat_id: chatId, text: HELP, parse_mode: 'HTML' });
    return;
  }
  const query = command === 'check' ? rest.join(' ') : command ? '' : text;
  if (!query) {
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Пришлите адрес контракта или ссылку на монету.' });
    return;
  }
  await tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
  await replyReport(env, chatId, query, privateChat, now);
}
