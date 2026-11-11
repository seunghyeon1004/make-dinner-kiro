import { expect, test } from '@playwright/test';
import { SamplesResponseSchema } from '../src/core/index.js';
import { FIXED_NOW } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

/** The samples as the server sends them: the order and the words the Menu must show. */
async function serverSamples(page: import('@playwright/test').Page) {
  const response = await page.request.get('/api/samples');
  expect(response.status()).toBe(200);
  return SamplesResponseSchema.parse(await response.json()).samples;
}

test.describe('menu: samples', () => {
  test('R1.1 lists the five samples in response order with blurb and dish names', async ({
    page,
  }) => {
    const samples = await serverSamples(page);
    expect(samples).toHaveLength(5);
    await page.goto('/');
    const cards = page.getByRole('list', { name: 'Sample dinners' }).getByRole('listitem');
    await expect(cards).toHaveCount(5);
    await expect(cards.getByRole('heading', { level: 3 })).toHaveText(samples.map((s) => s.title));
    for (const [index, sample] of samples.entries()) {
      const card = cards.nth(index);
      await expect(card).toContainText(sample.blurb);
      await expect(card).toContainText(`Dishes: ${sample.dishes.join(', ')}`);
      await expect(card.getByRole('button', { name: 'Plan this dinner' })).toBeVisible();
    }
  });

  test('R1.3 "Plan this dinner" on the first sample opens Plan in one tap with the sample title', async ({
    page,
  }) => {
    const [first] = await serverSamples(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Plan this dinner' }).first().click();
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first?.title ?? '');
  });

  test('R9.8 after the samples have loaded, choosing one and opening Plan makes no request', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Plan this dinner' })).toHaveCount(5);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.getByRole('button', { name: 'Plan this dinner' }).nth(1).click();
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Pick a dinner');
    expect(requests).toEqual([]);
  });

  test('R1.2 a failed samples request shows the failure copy and "Try again" lists them', async ({
    page,
  }) => {
    await page.route('**/api/samples', (route) => route.abort());
    await page.goto('/');
    await expect(
      page.getByText(
        'The sample dinners could not be loaded. Check your connection and try again.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plan this dinner' })).toHaveCount(0);
    await page.unroute('**/api/samples');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Plan this dinner' })).toHaveCount(5);
  });

  test('R1.5 a second sample asks before replacing; Keep my dinner changes nothing', async ({
    page,
  }) => {
    const samples = await serverSamples(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Plan this dinner' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(samples[0]?.title ?? '');
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Menu' })
      .click();

    await page.getByRole('button', { name: 'Plan this dinner' }).nth(1).click();
    const ask = page.getByText(`Replace your current dinner, ${samples[0]?.title}?`);
    await expect(ask).toBeVisible();
    await expect(ask).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');

    await page.getByRole('button', { name: 'Keep my dinner' }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Plan this dinner' }).nth(1)).toBeFocused();
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Plan' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(samples[0]?.title ?? '');
  });

  test('R1.5 Replace it loads the second sample', async ({ page }) => {
    const samples = await serverSamples(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Plan this dinner' }).first().click();
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Menu' })
      .click();
    await page.getByRole('button', { name: 'Plan this dinner' }).nth(1).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(samples[1]?.title ?? '');
  });
});
