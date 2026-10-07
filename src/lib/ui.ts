// Состояние интерфейса, которое не нужно сохранять (окно подключения кошелька, уведомления).
import { useSyncExternalStore } from 'react';
import { haptic } from './telegram';

export function memory<T>(initial: T) {
  let value = initial;
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      ls.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

export const connectModal = memory(false);

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
  link?: { href: string; label: string };
}

export const toasts = memory<Toast[]>([]);

export function toast(kind: Toast['kind'], text: string, link?: Toast['link']) {
  const t: Toast = { id: Date.now() + Math.random(), kind, text, link };
  if (kind !== 'info') haptic(kind === 'ok' ? 'success' : 'error');
  toasts.set([...toasts.get(), t]);
  setTimeout(() => toasts.set(toasts.get().filter((x) => x.id !== t.id)), kind === 'error' ? 9000 : 6000);
}

export function useMemory<T>(s: { get: () => T; subscribe: (l: () => void) => () => void }): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
