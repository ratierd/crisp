/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  test: {
    exclude: ['e2e/**', 'node_modules/**'], // e2e belongs to Playwright
  },
  resolve: {
    alias: {
      '@crisp/contracts': fileURLToPath(
        new URL('../../libs/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // e2e (and any non-default setup) points this at its server via env
      '/api': process.env.CRISP_API_ORIGIN ?? 'http://localhost:3000',
    },
  },
});
