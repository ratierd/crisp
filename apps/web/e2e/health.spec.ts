import { expect, test } from '@playwright/test';

/**
 * Honest health + isolation guard: proves the suite is talking to a healthy,
 * freshly-started working-tree server (not a stale dev server or container).
 */
test('api/health reports every backend up, from a server started for this run', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);

  const body = (await response.json()) as { ok: boolean; redis: boolean; db: boolean; startedAt: string };
  expect(body).toMatchObject({ ok: true, redis: true, db: true });

  const ageMs = Date.now() - new Date(body.startedAt).getTime();
  expect(ageMs).toBeGreaterThanOrEqual(0);
  expect(ageMs).toBeLessThan(10 * 60_000); // started for this run, not last week
});
