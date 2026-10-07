// Интеграция с Telegram Mini Apps. Вне Telegram всё здесь — безопасные заглушки.
import { TG_APP, TG_BOT } from '../config';
import { isChainId } from './chains';
import type { Route } from './router';

type Cb<T extends unknown[]> = (...args: T) => void;

interface TgStorage {
  setItem: (key: string, value: string, cb?: Cb<[string | null, boolean?]>) => void;
  /** У SecureStorage третий аргумент — можно ли восстановить значение после переустановки Telegram */
  getItem: (key: string, cb: Cb<[string | null, (string | null)?, boolean?]>) => void;
  removeItem: (key: string, cb?: Cb<[string | null, boolean?]>) => void;
  restoreItem?: (key: string, cb?: Cb<[string | null, (string | null)?]>) => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string; username?: string } };
  version: string;
  platform: string;
  colorScheme?: 'light' | 'dark';
  isVersionAtLeast: (v: string) => boolean;
  ready: () => void;
  expand: () => void;
  close?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  disableVerticalSwipes?: () => void;
  openLink: (url: string, opts?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  showConfirm?: (message: string, cb: (ok: boolean) => void) => void;
  BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  HapticFeedback?: {
    impactOccurred: (s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (t: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  SecureStorage?: TgStorage;
  DeviceStorage?: TgStorage;
  CloudStorage?: TgStorage;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function tg(): TelegramWebApp | undefined {
  const w = window.Telegram?.WebApp;
  // Скрипт Telegram, загруженный вне Telegram, сообщает platform = 'unknown'
  return w && w.platform && w.platform !== 'unknown' ? w : undefined;
}

export const isTelegram = (): boolean => Boolean(tg());

const BG = '#0b0e14';

/** Вызывается один раз до первого рендера. */
export function initTelegram(): void {
  const app = tg();
  if (!app) return;
  document.documentElement.classList.add('in-telegram');
  try {
    app.ready();
    app.expand();
    if (app.isVersionAtLeast('6.1')) {
      app.setHeaderColor?.(BG);
      app.setBackgroundColor?.(BG);
    }
    if (app.isVersionAtLeast('7.10')) app.setBottomBarColor?.(BG);
    // Чтобы прокрутка вниз не сворачивала приложение
    if (app.isVersionAtLeast('7.7')) app.disableVerticalSwipes?.();
  } catch {
    /* старый клиент */
  }

  // Telegram передаёт параметры запуска в hash — заменяем их нашим маршрутом
  const start = startParamToRoute(app.initDataUnsafe?.start_param);
  if (/tgWebApp/.test(window.location.hash) || !window.location.hash || window.location.hash === '#') {
    history.replaceState(null, '', start ?? '#/');
  }

  // Внешние ссылки во встроенном браузере Telegram, t.me — внутри Telegram
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a || !a.href || a.getAttribute('href')?.startsWith('#')) return;
      if (a.target !== '_blank' && !/^https?:/.test(a.getAttribute('href') ?? '')) return;
      e.preventDefault();
      openExternal(a.href);
    },
    true,
  );
}

export function openExternal(url: string): void {
  const app = tg();
  if (!app) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  if (/^https:\/\/t\.me\//.test(url)) app.openTelegramLink(url);
  else app.openLink(url);
}

export function haptic(kind: 'success' | 'error' | 'warning' | 'tap'): void {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'tap') h.impactOccurred('light');
    else h.notificationOccurred(kind);
  } catch {
    /* ignore */
  }
}

/** Подтверждение: нативное окно Telegram или обычный confirm. */
export function confirmDialog(message: string): Promise<boolean> {
  const app = tg();
  if (app?.showConfirm && app.isVersionAtLeast('6.2')) {
    return new Promise((resolve) => app.showConfirm!(message, (ok) => resolve(Boolean(ok))));
  }
  return Promise.resolve(window.confirm(message));
}

// ---------- Кнопка «Назад» ----------

let backHandler: (() => void) | undefined;

export function setBackButton(visible: boolean): void {
  const app = tg();
  if (!app || !app.isVersionAtLeast('6.1')) return;
  if (!backHandler) {
    backHandler = () => {
      if (history.length > 1) history.back();
      else window.location.hash = '#/';
    };
    app.BackButton.onClick(backHandler);
  }
  if (visible) app.BackButton.show();
  else app.BackButton.hide();
}

// ---------- Диплинки: t.me/<бот>/<app>?startapp=<сеть>_<адрес> ----------

/** start_param: только [A-Za-z0-9_-] и до 64 символов. */
export function routeToStartParam(chain: string, address: string): string | undefined {
  const p = `${chain}_${address}`;
  return /^[A-Za-z0-9_-]{1,64}$/.test(p) ? p : undefined;
}

export function startParamToRoute(param?: string): string | undefined {
  if (!param) return undefined;
  const i = param.indexOf('_');
  if (i <= 0) return undefined;
  const chain = param.slice(0, i);
  const address = param.slice(i + 1);
  if (!isChainId(chain) || !/^[A-Za-z0-9]{32,44}$|^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  return `#/token/${chain}/${address}`;
}

export function miniAppLink(route?: Extract<Route, { name: 'token' }>): string | undefined {
  if (!TG_BOT) return undefined;
  // С коротким именем — t.me/<бот>/<app>; без него — основной Mini App бота: t.me/<бот>?startapp
  const base = TG_APP ? `https://t.me/${TG_BOT}/${TG_APP}` : `https://t.me/${TG_BOT}`;
  const p = route ? routeToStartParam(route.chain, route.address) : undefined;
  return p ? `${base}?startapp=${p}` : TG_APP ? base : `${base}?startapp`;
}

/** Поделиться токеном: в Telegram — выбор чата, в браузере — системное меню или копирование. */
export async function shareToken(chain: string, address: string, symbol: string): Promise<'shared' | 'copied' | 'failed'> {
  const link = miniAppLink({ name: 'token', chain, address }) ?? `${window.location.origin}${window.location.pathname}#/token/${chain}/${address}`;
  const text = `$${symbol} — проверка по 5 шагам в Gem Radar`;
  const app = tg();
  if (app) {
    app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return 'shared';
  }
  if (navigator.share) {
    try {
      await navigator.share({ url: link, text });
      return 'shared';
    } catch {
      /* отменили — копируем */
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// ---------- Хранилища Telegram ----------

function call<T>(fn: (cb: Cb<[string | null, T?]>) => void, timeoutMs = 4000): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    try {
      fn((err, val) => {
        clearTimeout(t);
        if (err) reject(new Error(String(err)));
        else resolve(val);
      });
    } catch (e) {
      clearTimeout(t);
      reject(e as Error);
    }
  });
}

export interface KeyValueStore {
  kind: 'secure' | 'device' | 'local';
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

function tgStore(kind: 'secure' | 'device', s: TgStorage): KeyValueStore {
  return {
    kind,
    get: async (key) => {
      let restorable = false;
      const value = await call<string | null>((cb) =>
        s.getItem(key, (err, val, canBeRestored) => {
          restorable = Boolean(canBeRestored);
          cb(err, val);
        }),
      );
      if (value) return value;
      // После переустановки Telegram ключ из Keychain/Keystore можно вернуть
      if (restorable && s.restoreItem) return (await call<string | null>((cb) => s.restoreItem!(key, cb), 30_000)) ?? undefined;
      return undefined;
    },
    set: async (key, value) => {
      await call<boolean>((cb) => s.setItem(key, value, cb));
    },
    remove: async (key) => {
      await call<boolean>((cb) => s.removeItem(key, cb));
    },
  };
}

const localStore: KeyValueStore = {
  kind: 'local',
  get: async (key) => {
    try {
      return localStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: async (key, value) => localStorage.setItem(key, value),
  remove: async (key) => localStorage.removeItem(key),
};

/**
 * Хранилища по убыванию надёжности: SecureStorage (Keychain / Keystore телефона),
 * DeviceStorage (локально на устройстве), localStorage (браузер).
 */
export function keyStores(): KeyValueStore[] {
  const app = tg();
  const out: KeyValueStore[] = [];
  if (app?.isVersionAtLeast('9.0')) {
    if (app.SecureStorage?.getItem) out.push(tgStore('secure', app.SecureStorage));
    if (app.DeviceStorage?.getItem) out.push(tgStore('device', app.DeviceStorage));
  }
  out.push(localStore);
  return out;
}
