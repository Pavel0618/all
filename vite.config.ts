/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Политика безопасности контента (CSP) для собранного сайта. GitHub Pages не даёт ставить заголовки,
 * поэтому — тегом <meta> первым в <head>. Скрипты — только свои, из Telegram (SDK Mini App) и встроенный
 * загрузчик SDK (по хэшу): внедрённый чужой скрипт браузер не выполнит. Только для сборки — в dev Vite
 * сам вставляет свои скрипты.
 */
export const CSP_BASE = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // API бирж, проверок и RPC (адрес Solana RPC можно поменять в настройках — поэтому любой https)
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

export function cspFor(html: string): string {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
  );
  // chrome-extension:/moz-extension: — чтобы кошельки-расширения могли подключить свой скрипт
  const script = ["script-src 'self'", ...inline, 'https://telegram.org', 'chrome-extension:', 'moz-extension:'].join(' ');
  return [CSP_BASE[0], script, ...CSP_BASE.slice(1)].join('; ');
}

function csp(): Plugin {
  return {
    name: 'gem-radar-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/(<meta charset[^>]*>)/i, `$1\n    <meta http-equiv="Content-Security-Policy" content="${cspFor(html)}" />`),
    },
  };
}

// base: './' — чтобы сайт работал из любой папки (GitHub Pages, Netlify, IPFS, просто файл на хостинге).
export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  define: {
    'process.env': {},
  },
  build: {
    // web3.js + viem дают ~1 МБ (≈310 КБ gzip) — для dApp это нормально
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
