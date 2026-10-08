// Настройка Telegram-бота после деплоя сервера (запускается из GitHub Actions):
// вебхук на сервер, кнопка «Открыть радар», команды и описания. Ничего не нужно делать в @BotFather руками,
// кроме создания самого бота (/newbot).
//   TELEGRAM_BOT_TOKEN=… node worker/setup-bot.mjs <worker_url> <site_url>
import { createHash } from 'node:crypto';

const token = process.env.TELEGRAM_BOT_TOKEN;
const [workerUrl, siteUrl] = process.argv.slice(2);
if (!token || !workerUrl || !siteUrl) {
  console.error('usage: TELEGRAM_BOT_TOKEN=… node worker/setup-bot.mjs <worker_url> <site_url>');
  process.exit(1);
}

// Тот же секрет, что вычисляет сервер (worker/src/telegram.ts → webhookSecret)
const secret = createHash('sha256').update(`gem-radar:${token}`).digest('hex').slice(0, 48);

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  console.log(`✓ ${method}`);
  return data.result;
}

const me = await call('getMe', {});
await call('setWebhook', {
  url: `${workerUrl.replace(/\/$/, '')}/telegram`,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: true,
});
await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть радар', web_app: { url: siteUrl } } });
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Включить алерты и открыть радар' },
    { command: 'check', description: 'Проверить монету: /check <адрес>' },
    { command: 'stop', description: 'Выключить алерты' },
    { command: 'help', description: 'Как это работает' },
  ],
});
await call('setMyShortDescription', { short_description: 'Радар X-гемов: хайп в Twitter → проверка контракта → покупка в 1 клик.' });
await call('setMyDescription', {
  description:
    '📡 Gem Radar — поиск мемкоинов по методике «X-гемы через Twitter».\n\n' +
    '• Сам присылаю монеты, которые прошли все 5 проверок: хайп, кто качает, контракт, цена, нарратив\n' +
    '• Пришлите адрес или ссылку — разберу любую монету\n' +
    '• Покупка и продажа в 1 клик: Solana, Base, BNB, Ethereum, Arbitrum, Robinhood\n\n' +
    'Кошелёк создаётся прямо в Telegram, ключи — только на вашем телефоне.\n\n' +
    'Не финансовый совет. Мемкоины — высокий риск.',
});
console.log(`Бот @${me.username} настроен: ${workerUrl}/telegram`);
