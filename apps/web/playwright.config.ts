import { defineConfig } from '@playwright/test';

/**
 * Local e2e against the zero-key Demo model. Requires Redis
 * (docker compose up redis -d); both servers start here.
 *
 * Isolation guarantees:
 * - Dedicated ports (server 3100, vite 5174) so a dev server or the Docker
 *   app on 3000/5173 can never be what's under test.
 * - reuseExistingServer: false — if anything squats on these ports the run
 *   fails loudly instead of silently testing the wrong process.
 * - A unique throwaway SQLite per run, removed in global-teardown.
 *   (e2e/health.spec.ts additionally asserts the server process is fresh.)
 */
const dbPath = `/tmp/crisp-e2e-${process.env.CRISP_E2E_DB ?? `${Date.now()}-${process.pid}`}.sqlite`;
process.env.CRISP_E2E_DB_PATH = dbPath; // handed to global-teardown for cleanup

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5174',
    // Prefer a system Chrome when the Playwright build can't run (e.g. NixOS):
    // CRISP_E2E_BROWSER=/path/to/chrome bunx playwright test
    ...(process.env.CRISP_E2E_BROWSER
      ? { launchOptions: { executablePath: process.env.CRISP_E2E_BROWSER } }
      : {}),
  },
  webServer: [
    {
      command: 'bun run ../server/src/index.ts',
      port: 3100,
      reuseExistingServer: false,
      env: {
        DB_PATH: dbPath,
        PORT: '3100',
        CRISP_RATE_LIMIT: 'off', // the smoke flow sends faster than a human
      },
    },
    {
      command: 'bunx vite --port 5174 --strictPort',
      port: 5174,
      reuseExistingServer: false,
      env: {
        CRISP_API_ORIGIN: 'http://localhost:3100',
      },
    },
  ],
});
