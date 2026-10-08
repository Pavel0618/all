# Создание бота Gem Radar

Создать бота может только владелец аккаунта Telegram: это делается в переписке с [@BotFather](https://t.me/BotFather),
API для этого нет. Всё остальное — кнопку «Открыть радар», команды, описание, вебхук для алертов — настраивает
публикация (GitHub Actions) по токену бота. Полная инструкция с ключами — [`../SERVER_SETUP.md`](../SERVER_SETUP.md).

## 1. Создать бота (обязательно)

Отправьте в @BotFather по очереди:

```
/newbot
```
```
Gem Radar
```
Username — должен оканчиваться на `bot` и быть свободным. Попробуйте по порядку:
```
GemRadarApp_bot
```
```
XGemRadar_bot
```
```
GemRadarTrade_bot
```
BotFather пришлёт **токен**. Добавьте его в GitHub как секрет `TELEGRAM_BOT_TOKEN`
(Settings → Secrets and variables → Actions → New repository secret) и запустите Actions → Deploy → Run workflow.

## 2. Аватар (по желанию)

```
/setuserpic
```
Выберите бота и отправьте файл **`bot-avatar-512.png`** из этой папки.

## 3. Отдельная ссылка на Mini App (по желанию)

Без этого шага всё работает: «Поделиться» ведёт в чат бота, и бот сразу присылает разбор монеты с кнопкой
«Открыть и купить». Если хотите, чтобы ссылки открывали приложение сразу:

```
/newapp
```
Выберите бота, затем название `Gem Radar`, описание, фото **`miniapp-640x360.png`**, GIF — `/empty`,
URL — `https://pavel0618.github.io/all/`, короткое имя — `radar`. После этого добавьте переменную
`TG_APP` = `radar` (Settings → Secrets and variables → Actions → Variables) и снова запустите публикацию.

## Комиссия в SOL (один раз)

Откройте приложение → **Настройки → Комиссия сервиса → Создать счёт для комиссий** (≈0.002 SOL с
подключённого кошелька). Счёт для комиссий в SOL: `4R57Fw1hgcTVRrN4sVfXgzxsKzYRsHMWyHzvb51shzg8`
(wSOL-счёт адреса `GppeiwUj7jewiRqNmcH3YBMow9a3jCTLFf1dcY6F1bZx`). Комиссия в EVM-сетях приходит сразу.
