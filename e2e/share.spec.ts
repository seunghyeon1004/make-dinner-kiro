import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Plan } from '../src/core/index.js';
import { encodeShare } from '../src/web/state/share-link.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
import { FIXED_NOW, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

const STORED = { ...SUNDAY_ROAST, title: 'My stored dinner' };

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

/** The payload of a link to SUNDAY_ROAST in the home kitchen, served at 19:30. */
async function sundayRoastPayload(): Promise<string> {
  const encoded = await encodeShare({ plan: SUNDAY_ROAST, kitchen: HOME_KITCHEN, serve: '19:30' });
  if (!encoded.ok) throw new Error('expected a link');
  return encoded.value;
}

async function listText(page: Page): Promise<string> {
  return page.locator('#plan-list').innerText();
}

test.describe('opening a share link', () => {
  test('R8.5 a link opens Plan in a new context with the same list as the source page', async ({
    page,
    browser,
  }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await expect(page.getByText('Start at 17:40')).toBeVisible();
    const source = await listText(page);

    const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' });
    const other = await context.newPage();
    await other.clock.install({ time: new Date(FIXED_NOW) });
    await other.goto(`/#/share/${await sundayRoastPayload()}`);
    await expect(other).toHaveURL(/#\/plan$/);
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await expect(other.getByText('Start at 17:40')).toBeVisible();
    await expect(other.getByText('Opened a shared dinner.')).toBeVisible();
    expect(await listText(other)).toBe(source);
    await context.close();
  });

  test('R8.6 a damaged link opens Menu with the damaged-link copy and keeps the stored dinner', async ({
    page,
  }) => {
    await seedDinner(page, STORED, HOME_KITCHEN, '19:30');
    const payload = await sundayRoastPayload();
    const damaged = `${payload.slice(0, 12)}${payload[12] === 'A' ? 'B' : 'A'}${payload.slice(13)}`;
    await page.goto(`/#/share/${damaged}`);
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(
      page.getByText(
        'This share link is damaged or incomplete, so it could not be opened. Ask for the link again, or open a Dinnerfile.',
      ),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Plan' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My stored dinner');
  });

  test('R8.6 a version 2 link shows the version copy', async ({ page }) => {
    await page.goto('/#/share/2.abc');
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(
      page.getByText(
        'This share link was made by a newer version of Make Dinner and cannot be opened here.',
      ),
    ).toBeVisible();
  });

  test('R8.6 a link while a dinner is stored asks before replacing', async ({ page }) => {
    await seedDinner(page, STORED, HOME_KITCHEN, '19:30');
    await page.goto(`/#/share/${await sundayRoastPayload()}`);
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(page.getByText('Replace your current dinner, My stored dinner?')).toBeVisible();
    await page.getByRole('button', { name: 'Keep my dinner' }).click();
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Plan' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My stored dinner');

    await page.goto(`/#/share/${await sundayRoastPayload()}`);
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await expect(page.getByText('Opened a shared dinner.')).toBeVisible();
  });
});

/** 80 steps in 12 dishes with 1,000 characters of detail each: too long for a link. */
function hugePlan(): Plan {
  let seed = 12345;
  const noise = (n: number): string => {
    let out = '';
    while (out.length < n) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      out += seed.toString(36);
    }
    return out.slice(0, n);
  };
  const dishes = Array.from({ length: 12 }, (_, i) => ({
    id: `dish-${i + 1}`,
    name: `Dish ${i + 1}`,
  }));
  const steps = Array.from({ length: 80 }, (_, i) => ({
    id: `dish-${(i % 12) + 1}.step-${i + 1}`,
    dish: `dish-${(i % 12) + 1}`,
    title: `Step ${i + 1}`,
    minutes: 1,
    appliance: 'none' as const,
    handsOn: false,
    after: [],
    holdMin: null,
    detail: noise(1000),
  }));
  return { title: 'Huge dinner', dishes, steps };
}

test.describe('making a share link', () => {
  test('R8.3 "Share link" fills the link field with a #/share/1. URL and says it was copied', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Share link' });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const field = page.getByLabel('Link to this dinner');
    await expect(field).toHaveAttribute('readonly', '');
    const link = await field.inputValue();
    expect(link.startsWith(`${baseURL}/#/share/1.`)).toBe(true);
    await expect(
      page.getByText(
        'Copied a link to this dinner. The plan is in the link itself; nothing is stored on the server.',
      ),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    expect(link).toBe(`${baseURL}/#/share/${await sundayRoastPayload()}`);
  });

  test('R8.7 when the clipboard refuses the link is selected and the cook is told', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
        configurable: true,
      });
    });
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('button', { name: 'Share link' }).click();
    await expect(
      page.getByText(
        "Could not copy. The text is selected; copy it with your device's copy command.",
      ),
    ).toBeVisible();
    const field = page.getByLabel('Link to this dinner');
    const selected = await field.evaluate((el: HTMLInputElement) =>
      el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
    );
    expect(selected).toBe(await field.inputValue());
  });

  test('R8.4 a plan too long for a link shows the too-long copy with its length and no link', async ({
    page,
  }) => {
    await seedDinner(page, hugePlan(), HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('button', { name: 'Share link' }).click();
    const message = page.getByText(
      /^This plan is too long for a link \([0-9,]+ characters; the limit is 8,000\)\. Share the Dinnerfile instead\.$/,
    );
    await expect(message).toBeVisible();
    await expect(page.getByLabel('Link to this dinner')).toHaveCount(0);
  });
});
