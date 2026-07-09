/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/** Resolve a feature slice's published entry straight to its source. */
const slice = (name: string, entry: string) =>
  fileURLToPath(new URL(`../../libs/features/${name}/src/${entry}.ts`, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  test: {
    exclude: ['e2e/**', 'node_modules/**'], // e2e belongs to Playwright
  },
  resolve: {
    alias: {
      '@crisp/models/contracts': slice('models', 'contracts'),
      '@crisp/conversations/contracts': slice('conversations', 'contracts'),
      '@crisp/feedback/contracts': slice('feedback', 'contracts'),
      '@crisp/runs/contracts': slice('runs', 'contracts'),
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
