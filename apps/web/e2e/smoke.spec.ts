import { expect, test } from '@playwright/test';

test.describe('Crisp smoke (Demo model)', () => {
  test('first run: empty state → streamed markdown answer → conversation listed', async ({
    page,
  }) => {
    await page.goto('/');

    // empty state
    await expect(page.getByRole('heading', { name: 'Start a conversation.' })).toBeVisible();

    // send via the composer
    await page.getByPlaceholder('Write a message…').fill('walk me through markdown');
    await page.keyboard.press('Enter');

    // streaming state: stop affordance + live indicator
    await expect(page.getByRole('button', { name: /stop/i })).toBeVisible();
    await expect(page.getByText('run live')).toBeVisible();

    // streamed markdown renders: the Demo showcase has an h2 and a code block
    await expect(page.locator('.prose h2').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.code-block')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.code-block-copy').first()).toHaveText('copy');

    // completion: latency badge appears, composer back to send
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

    // conversation shows up in the sidebar with a title
    await expect(page.locator('.item .title').first()).toContainText(/markdown/i);
  });

  test('typed error card with retry', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('please error:rate_limited now');
    await page.keyboard.press('Enter');

    await expect(page.getByText('Rate limited')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('rate_limited', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('mid-stream refresh reattaches to the live run', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('walk me through markdown');
    await page.keyboard.press('Enter');

    // let the stream get going, then simulate the refresh
    await expect(page.locator('.prose p').first()).toBeVisible({ timeout: 15_000 });
    await page.reload();

    // history is back and the live stream keeps writing to completion
    await expect(page.locator('.user-message')).toContainText('walk me through markdown');
    await expect(page.locator('.code-block')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible({ timeout: 20_000 });
  });

  test('stop mid-stream keeps the partial with a regenerate affordance', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('walk me through markdown');
    await page.keyboard.press('Enter');

    // wait for some prose, then stop via Esc
    await expect(page.locator('.prose p').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');

    await expect(page.getByText('▪ stopped early')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'regenerate' })).toBeVisible();
  });
});
