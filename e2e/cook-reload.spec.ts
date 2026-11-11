import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { advanceClock, cookAt, dock, tapToCmF } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

/** CM-c: the roast got +15 min at 18:30. */
async function cmCAt1830(page: Page): Promise<void> {
  await cookAt(page, '2026-11-11T17:40:00Z');
  await tapToCmF(page);
  await advanceClock(page, 35 * 60_000);
  const roast = page.getByRole('region', { name: 'Roast the chicken' });
  await expect(roast.getByRole('timer')).toHaveText('35:00');
  await roast
    .getByRole('group', { name: 'Needs more time' })
    .getByRole('button', { name: '+15 min' })
    .click();
  await expect(roast.getByRole('timer')).toHaveText('50:00');
}

const logLines = (page: Page) =>
  page.getByRole('region', { name: 'Build log' }).locator('.log-line');

test.describe('Persistence and the stale prompt (CM7.1 to CM7.3)', () => {
  test('CM7.2 CM-c at 18:30, after a reload the log and 50:00 are the same', async ({ page }) => {
    await cmCAt1830(page);
    const before = await logLines(page).allTextContents();
    await page.reload();
    const roast = page.getByRole('region', { name: 'Roast the chicken' });
    await expect(roast.getByRole('timer')).toHaveText('50:00');
    expect(await logLines(page).allTextContents()).toEqual(before);
    expect(before[0]).toBe('18:30 rebuild: chicken.roast needs 15 more min');
  });

  test('CM7.2 CM4.1 a new page in the same context at 18:50 reads 30:00 and announces no time up', async ({
    page,
    context,
  }) => {
    await cmCAt1830(page);
    await advanceClock(page, 20 * 60_000);
    const second = await context.newPage();
    await second.goto('/');
    await expect(second.getByRole('heading', { level: 1, name: 'Right now' })).toBeVisible();
    await expect(
      second.getByRole('region', { name: 'Roast the chicken' }).getByRole('timer'),
    ).toHaveText('30:00');
    await expect(second.getByRole('status')).toHaveText('');
  });

  test('CM7.3 a session last used 9 h ago asks first; Resume shows the view, Discard needs a second tap', async ({
    page,
  }) => {
    await cmCAt1830(page);
    await advanceClock(page, 9 * 60 * 60_000);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Carry on with this dinner?' })).toBeVisible();
    await expect(page.getByText(/more than 8 hours ago/)).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Carry on with this dinner?' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 2, name: 'Do now' })).toBeVisible();

    await advanceClock(page, 9 * 60 * 60_000);
    await page.reload();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByText('Discard the recorded times?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, discard' }).click();
    await expect(page.getByRole('link', { name: 'Start cooking' })).toBeVisible();
    expect(await dock(page).count()).toBe(0);
  });
});
