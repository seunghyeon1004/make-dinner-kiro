import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Plan } from '../src/core/index.js';
import { HOME_KITCHEN, SUNDAY_ROAST, SUNDAY_ROAST_DINNERFILE } from '../test/support/fixtures.js';
import {
  expectNoAxeViolations,
  expectNoPageScroll,
  FIXED_NOW,
  fakeParse,
  parseError,
  seedDinner,
} from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

/** SUNDAY_ROAST with `gravy.roux` waiting for a step that does not exist (an error). */
const BROKEN_ROAST: Plan = {
  ...SUNDAY_ROAST,
  steps: SUNDAY_ROAST.steps.map((step) =>
    step.id === 'gravy.roux' ? { ...step, after: ['chicken.rost'] } : step,
  ),
};

/** Every visible button, input, select and text area is at least 48×48 px (ui.md, N1). */
async function expectTargets48(page: Page): Promise<void> {
  const small = await page
    .locator('button, input:not([type="hidden"]), select, textarea')
    .evaluateAll((elements) =>
      elements.flatMap((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') return [];
        // The file picker and the visually hidden helpers are not targets.
        if (el.closest('.visually-hidden') !== null) return [];
        if (box.width >= 48 && box.height >= 48) return [];
        const name = el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('id') ?? '';
        return [
          `${el.tagName.toLowerCase()} "${name.trim().slice(0, 40)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
        ];
      }),
    );
  expect(small).toEqual([]);
}

async function check(page: Page): Promise<void> {
  await expectNoAxeViolations(page);
  await expectTargets48(page);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`a11y, ${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test('R11.3 Menu', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();
      await check(page);
    });

    test('R11.3 Menu with a parse error', async ({ page }) => {
      await fakeParse(page, 429, parseError('rate_limited'), { 'Retry-After': '120' });
      await page.goto('/');
      await page.getByLabel('Recipe text').fill('Roast the chicken for 75 minutes.');
      await page.getByRole('button', { name: 'Read recipes' }).click();
      await expect(page.getByText(/^You have read several recipes/)).toBeVisible();
      await check(page);
    });

    test('R11.3 Menu with Dinnerfile errors', async ({ page }) => {
      await page.goto('/');
      await page.getByLabel('Dinnerfile text').fill(`${SUNDAY_ROAST_DINNERFILE}$(X)\n`);
      await page.getByRole('button', { name: 'Open Dinnerfile' }).click();
      await expect(page.getByRole('button', { name: 'Show line 57' })).toBeVisible();
      await check(page);
    });

    test('R11.3 Steps with an editor open and an error', async ({ page }) => {
      await seedDinner(page, BROKEN_ROAST, HOME_KITCHEN, '19:30', 'steps');
      await page.goto('/');
      await page
        .locator('[data-step-id="gravy.roux"]')
        .getByRole('button', { name: 'Edit' })
        .click();
      await expect(page.getByRole('group', { name: 'Waits for' })).toBeVisible();
      await check(page);
    });

    test('R11.3 Plan', async ({ page }) => {
      await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
      await page.goto('/');
      await expect(page.getByText('Start at 17:40')).toBeVisible();
      await check(page);
    });

    test('R11.3 Plan with the Dinnerfile panel open', async ({ page }) => {
      await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
      await page.goto('/');
      await page.getByRole('button', { name: 'Dinnerfile', exact: true }).click();
      await expect(page.locator('main pre:not(.print-only)')).toBeVisible();
      await check(page);
    });

    test('R11.3 Plan with the share panel open', async ({ page }) => {
      await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
      await page.goto('/');
      await page.getByRole('button', { name: 'Share link' }).click();
      await expect(page.getByLabel('Link to this dinner')).toBeVisible();
      await check(page);
    });

    test('R11.3 Plan with the settings open (phone) and a missing appliance', async ({ page }) => {
      await seedDinner(page, SUNDAY_ROAST, { ...HOME_KITCHEN, ovens: 0 }, '19:30');
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Add an oven' })).toBeVisible();
      await check(page);
    });
  });
}

test.describe('zoom and motion', () => {
  const SCREENS: ReadonlyArray<readonly [string, (page: Page) => Promise<void>]> = [
    ['Menu', async (page) => void (await page.goto('/'))],
    [
      'Steps',
      async (page) => {
        await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'steps');
        await page.goto('/');
      },
    ],
    [
      'Plan',
      async (page) => {
        await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
        await page.goto('/');
      },
    ],
  ];

  for (const [name, open] of SCREENS) {
    test(`R6.9 N1 ${name} at 195 px wide (390 px at 200%) does not scroll the page sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 195, height: 844 });
      await open(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoPageScroll(page);
    });
  }

  test('N1 under reduced motion no element has a running transition or animation', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('button', { name: 'Dinnerfile', exact: true }).click();
    await page.getByRole('button', { name: 'Fewer burners' }).click();
    const running = await page.evaluate(() => document.getAnimations().length);
    expect(running).toBe(0);
    const durations = await page.locator('body *').evaluateAll(
      (els) =>
        els.filter((el) => {
          const s = getComputedStyle(el);
          return s.transitionDuration.split(',').some((d) => parseFloat(d) > 0);
        }).length,
    );
    expect(durations).toBe(0);
    await context.close();
  });
});
