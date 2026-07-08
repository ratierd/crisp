import { defineConfig } from '@playwright/test';

/**
 * One local smoke spec against the zero-key Demo model.
 * Requires Redis (docker compose up redis -d); the servers start here.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    // Prefer a system Chrome when the Playwright build can't run (e.g. NixOS):
    // CRISP_E2E_BROWSER=/path/to/chrome bunx playwright test
    ...(process.env.CRISP_E2E_BROWSER
      ? { launchOptions: { executablePath: process.env.CRISP_E2E_BROWSER } }
      : {}),
  },
  webServer: [
    {
      command: 'bun run ../server/src/index.ts',
      port: 3000,
      reuseExistingServer: true,
      env: {
        DB_PATH: `/tmp/crisp-e2e-${process.env.CRISP_E2E_DB ?? 'default'}.sqlite`,
        PORT: '3000',
      },
    },
    {
      command: 'bunx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
