// ============================================================================
//  НАСТРОЙКИ ВЛАДЕЛЬЦА ПРИЛОЖЕНИЯ
//  Можно вписать значения прямо здесь или задать переменными окружения при сборке
//  (GitHub → Settings → Secrets and variables → Actions → Variables, см. README).
// ============================================================================

/** Комиссия сервиса с каждой сделки в базисных пунктах: 100 = 1%, 50 = 0.5%. */
const DEFAULT_FEE_BPS = 50;

/** Ваш Solana-адрес (как в Phantom). Комиссия со сделок на Solana приходит в SOL. */
const DEFAULT_FEE_SOLANA_WALLET = 'GppeiwUj7jewiRqNmcH3YBMow9a3jCTLFf1dcY6F1bZx';

/** Ваш EVM-адрес (0x…, как в MetaMask). Комиссия в Ethereum/Base/BNB/Arbitrum приходит в ETH/BNB. */
const DEFAULT_FEE_EVM_WALLET = '0xa82B263D0F2906aCf03A768F764Fe19cc7f9d534';

/**
 * Username Telegram-бота без @ и короткое имя Mini App (из @BotFather → /newapp) — для ссылок «Поделиться».
 * Если короткого имени нет (Mini App подключён как основной), ссылки будут вида t.me/<бот>?startapp=…
 */
const DEFAULT_TG_BOT = '';
const DEFAULT_TG_APP = '';

// ----------------------------------------------------------------------------

const env = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

/** Больше 3% — уже дороже любого торгового бота; защищаемся от опечатки. */
export const MAX_FEE_BPS = 300;

function parseBps(v: string | undefined): number {
  const n = Number(env(v, String(DEFAULT_FEE_BPS)));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_FEE_BPS, Math.round(n));
}

export const FEE_BPS = parseBps(import.meta.env.VITE_FEE_BPS);
export const FEE_SOLANA_WALLET = env(import.meta.env.VITE_FEE_SOLANA_WALLET, DEFAULT_FEE_SOLANA_WALLET);
export const FEE_EVM_WALLET = env(import.meta.env.VITE_FEE_EVM_WALLET, DEFAULT_FEE_EVM_WALLET);
export const TG_BOT = env(import.meta.env.VITE_TG_BOT, DEFAULT_TG_BOT).replace(/^@/, '');
export const TG_APP = env(import.meta.env.VITE_TG_APP, DEFAULT_TG_APP);
