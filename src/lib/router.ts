// Простой роутер на hash (#/...) — работает на любом статическом хостинге.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'radar' }
  | { name: 'token'; chain: string; address: string }
  | { name: 'search'; q: string }
  | { name: 'portfolio' }
  | { name: 'guide' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'token':
      if (parts[1] && parts[2]) return { name: 'token', chain: parts[1], address: parts[2] };
      break;
    case 'search':
      return { name: 'search', q: new URLSearchParams(query).get('q') ?? '' };
    case 'portfolio':
      return { name: 'portfolio' };
    case 'guide':
      return { name: 'guide' };
    case 'settings':
      return { name: 'settings' };
  }
  return { name: 'radar' };
}

export function href(r: Route): string {
  switch (r.name) {
    case 'token':
      return `#/token/${r.chain}/${r.address}`;
    case 'search':
      return `#/search?q=${encodeURIComponent(r.q)}`;
    case 'radar':
      return '#/';
    default:
      return `#/${r.name}`;
  }
}

export function navigate(r: Route, replace = false) {
  const target = href(r);
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
  window.scrollTo({ top: 0 });
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}
