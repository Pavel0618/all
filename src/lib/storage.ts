// Всё, что приложение помнит, хранится только в вашем браузере (localStorage):
// настройки, избранное, ответы по чек-листу и история сделок. Сервера у приложения нет.
import { useSyncExternalStore } from 'react';
import type { ChainId } from './chains';
import { DEFAULT_THRESHOLDS, type ManualAnswers, type Thresholds, type VerdictLevel } from './analysis';
import { DEFAULT_NARRATIVES, type Narrative } from './narratives';
import type { PriorityLevel } from './jupiter';

type Updater<T> = T | ((prev: T) => T);

export interface Store<T> {
  get: () => T;
  set: (v: Updater<T>) => void;
  subscribe: (l: () => void) => () => void;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим или переполнено — работаем без сохранения */
  }
}

export function createStore<T>(key: string, fallback: T, migrate?: (stored: T) => T): Store<T> {
  const stored = read(key, fallback);
  let value = migrate ? migrate(stored) : stored;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      value = typeof v === 'function' ? (v as (p: T) => T)(value) : v;
      write(key, value);
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T>(store: Store<T>): [T, Store<T>['set']] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [value, store.set];
}

// ---------- Настройки ----------

export interface Settings {
  solanaRpc: string;
  slippageBps: number;
  priority: PriorityLevel;
  thresholds: Thresholds;
  narratives: Narrative[];
  /** Своя сумма покупки по умолчанию для каждой сети */
  defaultBuy: Partial<Record<ChainId, number>>;
}

export const DEFAULT_SETTINGS: Settings = {
  solanaRpc: 'https://solana-rpc.publicnode.com',
  slippageBps: 500,
  priority: 'high',
  thresholds: DEFAULT_THRESHOLDS,
  narratives: DEFAULT_NARRATIVES,
  defaultBuy: {},
};

export const settingsStore = createStore<Settings>('gr.settings', DEFAULT_SETTINGS, (s) => ({
  ...DEFAULT_SETTINGS,
  ...s,
  thresholds: { ...DEFAULT_THRESHOLDS, ...s.thresholds },
  narratives: s.narratives?.length ? s.narratives : DEFAULT_NARRATIVES,
}));

// ---------- Избранное ----------

export interface WatchItem {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image?: string;
  addedAt: number;
  verdict?: VerdictLevel;
  note?: string;
}

export const watchStore = createStore<WatchItem[]>('gr.watchlist', []);

// ---------- Ответы на чек-лист ----------

export const answersStore = createStore<Record<string, ManualAnswers>>('gr.answers', {});

export const tokenKey = (chain: ChainId, address: string) => `${chain}:${address}`;

// ---------- Сделки ----------

export interface Trade {
  id: string;
  side: 'buy' | 'sell';
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  image?: string;
  /** Сколько нативной монеты потрачено (buy) или получено (sell) — по котировке */
  nativeAmount: number;
  nativeSymbol: string;
  /** Сколько токенов получено (buy) или продано (sell) — по котировке */
  tokenAmount: number;
  priceUsd?: number;
  tx: string;
  at: number;
}

export const tradesStore = createStore<Trade[]>('gr.trades', []);

export function addTrade(t: Omit<Trade, 'id' | 'at'>) {
  tradesStore.set((list) => [{ ...t, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() }, ...list]);
}
