import { expect, test } from '@playwright/test';

/**
 * Flow specs for the @crisp/ai chat client, driven end-to-end over the
 * zero-key Demo model. Remote-provider and BYO-Ollama paths need
 * keys/daemons a CI browser doesn't have — those contracts are locked
 * down at the unit level (ai-gateway.test.ts, byo.test.ts, libs/ai).
 */
test.describe('Chat flows over @crisp/ai (Demo model)', () => {
  test('completed answer carries the latency footer with the model name', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('what is oklch?');
    await page.keyboard.press('Enter');

    // useChat assembled the streamed answer into the transcript
    await expect(page.locator('.prose p').first()).toBeVisible({ timeout: 15_000 });
    // RUN_FINISHED landed: stats footer names the model
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible({ timeout: 20_000 });
  });

  test('stop mid-stream, then regenerate replaces the partial with a fresh answer', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('walk me through markdown');
    await page.keyboard.press('Enter');

    await expect(page.locator('.prose p').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /stop/i }).click();
    await expect(page.getByText('▪ stopped early')).toBeVisible({ timeout: 10_000 });

    // regenerate re-sends the history ending at the persisted user message;
    // the server drops the superseded partial (deleteMessagesAfter)
    await page.getByRole('button', { name: 'regenerate' }).click();
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('▪ stopped early')).not.toBeVisible();
    await expect(page.locator('.assistant')).toHaveCount(1);
    await expect(page.locator('.user-message')).toHaveCount(1);
  });

  test('reload restores the persisted conversation (setMessages path)', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('what is oklch?');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible({ timeout: 30_000 });

    await page.reload();

    // both turns come back from SQLite, with the footer meta rehydrated
    await expect(page.locator('.user-message')).toContainText('what is oklch?');
    await expect(page.locator('.prose').last()).toContainText(/OKLCH/i);
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible();
    // and the composer is idle — no run resumed by accident
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  });

  test('a failing model shows the typed error card; retry after switching topic recovers', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByPlaceholder('Write a message…').fill('please error:provider_unavailable now');
    await page.keyboard.press('Enter');

    // RUN_ERROR became the right error card, with no assistant message
    await expect(page.getByText('Provider unreachable')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('provider_unavailable', { exact: true })).toBeVisible();
    await expect(page.locator('.assistant')).toHaveCount(0);

    // the conversation stays usable: a follow-up send streams normally
    await page.getByPlaceholder('Write a message…').fill('what is oklch?');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/took .+ · Demo/)).toBeVisible({ timeout: 30_000 });
  });
});
