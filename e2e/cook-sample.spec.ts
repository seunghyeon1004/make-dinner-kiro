import { expect, test } from '@playwright/test';
import { cookUntilServed, fixClockAt } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test('CM10.2 CM8.1 the Sunday roast sample cooked on time ends "on time" and the build log stays empty', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await fixClockAt(page, '2026-11-11T09:00:00Z');
  await page.goto('/');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Sunday roast' })
    .getByRole('button', { name: 'Plan this dinner' })
    .click();
  await page.getByRole('link', { name: 'Start cooking' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Right now' })).toBeVisible();

  const log = page.getByRole('region', { name: 'Build log' });
  await cookUntilServed(page, async () => {
    await expect(log.getByText('No rebuilds yet.')).toBeVisible();
  });
  await expect(page.getByText('Planned for 13:30: on time.')).toBeVisible();
  await expect(log.getByText('No rebuilds yet.')).toBeVisible();
});
