/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' — чтобы сайт работал из любой папки (GitHub Pages, Netlify, IPFS, просто файл на хостинге).
export default defineConfig({
  base: './',
  plugins: [react()],
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
