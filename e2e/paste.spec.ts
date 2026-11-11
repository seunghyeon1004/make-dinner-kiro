import { expect, test } from '@playwright/test';
import { SUNDAY_ROAST } from '../test/support/fixtures.js';
import { FIXED_NOW, fakeParse, parseError } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

const OK_BODY = { plan: SUNDAY_ROAST, issues: [], source: 'model' };

const TOO_LONG =
  'The recipe text is over 12,000 characters. Shorten it or split it into two dinners.';
const MEANWHILE = 'Meanwhile, sample dinners and Dinnerfiles still work.';

test.describe('paste recipes', () => {
  test('R2.1 the counter starts at 0 of 12,000 and follows the text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('0 of 12,000 characters')).toBeVisible();
    await page.getByLabel('Recipe text').fill('Roast it.');
    await expect(page.getByText('9 of 12,000 characters')).toBeVisible();
  });

  test('R2.2 empty text disables "Read recipes" and says why', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Read recipes' })).toBeDisabled();
    await expect(page.getByText('Paste at least one recipe.')).toBeVisible();
  });

  test('R2.2 12,001 characters disable "Read recipes" with the too-long copy', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Recipe text').fill('a'.repeat(12_001));
    await expect(page.getByText('12,001 of 12,000 characters')).toBeVisible();
    await expect(page.getByText(TOO_LONG)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read recipes' })).toBeDisabled();
    await page.getByLabel('Recipe text').fill('a'.repeat(12_000));
    await expect(page.getByRole('button', { name: 'Read recipes' })).toBeEnabled();
  });

  test('R2.3 R2.5 success posts the text as typed and opens Steps with the plan', async ({
    page,
  }) => {
    const parse = await fakeParse(page, 200, OK_BODY);
    await page.goto('/');
    await page.getByLabel('Recipe text').fill('Roast the chicken.\n');
    await page.getByRole('button', { name: 'Read recipes' }).click();
    await expect(page).toHaveURL(/#\/steps$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the steps');
    await expect(page.getByRole('heading', { level: 2, name: 'Roast chicken' })).toBeVisible();
    await expect(page.getByText('No issues.')).toBeVisible();
    expect(parse.lastBody()).toEqual({ text: 'Roast the chicken.\n' });
  });

  const MESSAGES: {
    code: string;
    status: number;
    text: string;
    headers?: Record<string, string>;
  }[] = [
    {
      code: 'bad_request',
      status: 400,
      text: 'The recipe reader could not read this request. Reload the page and try again.',
    },
    { code: 'input_too_long', status: 413, text: TOO_LONG },
    {
      code: 'rate_limited',
      status: 429,
      headers: { 'Retry-After': '120' },
      text: `You have read several recipes in a short time. Try again after 17:02. ${MEANWHILE}`,
    },
    {
      code: 'rate_limited',
      status: 429,
      text: `You have read several recipes in a short time. Try again in a few minutes. ${MEANWHILE}`,
    },
    {
      code: 'daily_cap_reached',
      status: 429,
      headers: { 'Retry-After': '3600' },
      text: 'The recipe reader has reached its limit for today. It starts again at 18:00. Use a sample dinner or open a Dinnerfile instead.',
    },
    {
      code: 'daily_cap_reached',
      status: 429,
      text: 'The recipe reader has reached its limit for today. It starts again tomorrow. Use a sample dinner or open a Dinnerfile instead.',
    },
    {
      code: 'model_unavailable',
      status: 503,
      text: 'The recipe reader is not available on this server right now. Use a sample dinner or open a Dinnerfile instead.',
    },
    {
      code: 'model_refused',
      status: 502,
      text: 'The recipe reader declined to read this text. Check that it is a recipe, or use a sample dinner.',
    },
    {
      code: 'model_output_invalid',
      status: 502,
      text: 'The recipe reader returned steps this app cannot use. Try again, or paste fewer dishes at a time.',
    },
    {
      code: 'internal',
      status: 500,
      text: 'Something went wrong on the server. Try again, or use a sample dinner or a Dinnerfile.',
    },
    {
      code: 'invalid_plan',
      status: 422,
      text: 'Something went wrong on the server. Try again, or use a sample dinner or a Dinnerfile.',
    },
  ];

  for (const message of MESSAGES) {
    const variant = message.headers === undefined ? 'without Retry-After' : 'with Retry-After';
    test(`R2.6 ${message.code} (${variant}) shows its copy and keeps the text`, async ({
      page,
    }) => {
      await fakeParse(page, message.status, parseError(message.code), message.headers);
      await page.goto('/');
      await page.getByLabel('Recipe text').fill('Roast it.');
      await page.getByRole('button', { name: 'Read recipes' }).click();
      await expect(page.getByRole('alert')).toHaveText(message.text);
      await expect(page).toHaveURL(/#\/menu$/);
      await expect(page.getByLabel('Recipe text')).toHaveValue('Roast it.');
      await expect(page.getByRole('button', { name: 'Read recipes' })).toBeEnabled();
    });
  }

  test('R2.7 a request that fails without a response shows the network copy', async ({ page }) => {
    await page.route('**/api/parse', (route) => route.abort());
    await page.goto('/');
    await page.getByLabel('Recipe text').fill('Roast it.');
    await page.getByRole('button', { name: 'Read recipes' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The server could not be reached. Check your connection and try again. Sample dinners you have opened and Dinnerfiles work offline.',
    );
  });

  test('R2.4 a slow request shows the busy copy with seconds; Cancel stops it', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/parse', async (route) => {
      await held;
      await route.abort().catch(() => undefined);
    });
    await page.goto('/');
    await page.getByLabel('Recipe text').fill('Roast it.');
    await page.clock.pauseAt(new Date('2026-11-11T17:00:10Z'));
    await page.getByRole('button', { name: 'Read recipes' }).click();
    const busy = page.getByRole('status').filter({ hasText: 'Reading your recipes.' });
    await expect(busy).toContainText('Reading your recipes. This can take up to a minute. 0 s');
    await expect(page.getByLabel('Recipe text')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Read recipes' })).toBeDisabled();
    // Let the effect that starts the one-second interval run first (effects wait for a frame).
    await page.clock.runFor(200);
    await page.clock.runFor(5000);
    await expect(busy).toContainText('Reading your recipes. This can take up to a minute. 5 s');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Stopped reading the recipes.')).toBeVisible();
    await expect(busy).toHaveCount(0);
    await expect(page.getByLabel('Recipe text')).toHaveValue('Roast it.');
    await expect(page.getByRole('button', { name: 'Read recipes' })).toBeEnabled();
    release();
  });

  test('R2.8 the typed text survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Recipe text').fill('Roast the chicken.');
    await page.reload();
    await expect(page.getByLabel('Recipe text')).toHaveValue('Roast the chicken.');
  });
});
