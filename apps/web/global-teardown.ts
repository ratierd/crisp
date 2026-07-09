import { unlink } from 'node:fs/promises';

/** Removes this run's throwaway SQLite (path minted in playwright.config.ts). */
export default async function globalTeardown(): Promise<void> {
  const dbPath = process.env.CRISP_E2E_DB_PATH;
  if (!dbPath?.startsWith('/tmp/crisp-e2e-')) return;
  for (const suffix of ['', '-wal', '-shm']) {
    await unlink(`${dbPath}${suffix}`).catch(() => undefined);
  }
}
