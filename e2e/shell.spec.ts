import { expect, test } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
import { FIXED_NOW, openSettings, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

test.describe('shell: routing and navigation', () => {
  test('R9.3 #/plan with no dinner lands on the Menu and the hash is replaced, not pushed', async ({
    page,
  }) => {
    await page.goto('/#/plan');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(page).toHaveURL(/#\/menu$/);
    await page.goBack();
    expect(page.url()).toBe('about:blank');
  });

  test('R9.2 with no dinner the nav shows Menu current and the other three unreachable with reasons', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Dinner' });
    const items = nav.getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveText('1 Menu');
    await expect(items.nth(1)).toContainText('2 Steps');
    await expect(items.nth(1)).toContainText('Pick a dinner first');
    await expect(items.nth(2)).toContainText('3 Plan');
    await expect(items.nth(3)).toContainText('4 Cook');
    // The Cook screen is registered (cooking-mode); without a plan it says what is missing.
    await expect(items.nth(3)).toContainText('Make the plan first');
    await expect(nav.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'step');
    await expect(nav.getByRole('link')).toHaveCount(1);
  });

  test('R9.2 with a dinner, Steps, Plan and Cook become links', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'steps');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Dinner' });
    await expect(nav.getByRole('link')).toHaveText(['1 Menu', '2 Steps', '3 Plan', '4 Cook']);
    await expect(nav.getByRole('link', { name: 'Steps' })).toHaveAttribute('aria-current', 'step');
  });

  test('R9.4 each screen has one h1 and the document title "<screen> · Make Dinner"', async ({
    page,
  }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'menu');
    await page.goto('/');
    await expect(page).toHaveTitle('Menu · Make Dinner');
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Steps' })
      .click();
    await expect(page).toHaveTitle('Steps · Make Dinner');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the steps');
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Plan' })
      .click();
    await expect(page).toHaveTitle('Plan · Make Dinner');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('R9.4 focus moves to the h1 when the screen changes', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'menu');
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Steps' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check the steps' })).toBeFocused();
  });

  test('R9.3 Back and Forward move between screens', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'menu');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Dinner' });
    await nav.getByRole('link', { name: 'Steps' }).click();
    await nav.getByRole('link', { name: 'Plan' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the steps');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the steps');
  });

  test('R9.5 a reload keeps the route and the dinner', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'plan');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await expect(page).toHaveURL(/#\/plan$/);
  });

  test('R9.6 unreadable stored state starts fresh and says so in the live region', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('make-dinner:state', '{nope'));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(page.getByRole('status')).toHaveText(
      'Your saved dinner could not be read, so the app started fresh.',
    );
  });
});

test.describe('shell: compact flow navigation (review B)', () => {
  test('B1 the four steps share one row and the navigation is at most 72 px tall', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Dinner' });
    const navBox = await nav.boundingBox();
    expect(navBox?.height).toBeLessThanOrEqual(72);
    const tops = await nav
      .getByRole('listitem')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(1);
    for (const item of await nav.getByRole('listitem').all()) {
      const box = await item.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(48);
      expect(box?.width).toBeGreaterThanOrEqual(48);
    }
  });

  test('B1 the current step is marked by weight and an underline, not by colour alone', async ({
    page,
  }) => {
    await page.goto('/');
    const current = page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('link', { name: 'Menu' });
    await expect(current).toHaveCSS('font-weight', '700');
    await expect(current).toHaveCSS('text-decoration-line', 'underline');
  });

  test('B1 an unreachable step has its reason as text for screen readers and shows it only when tapped', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Dinner' });
    const steps = nav.getByRole('button', { name: 'Steps' });
    await expect(steps).toHaveAccessibleDescription('Pick a dinner first');
    await expect(steps).toHaveAttribute('aria-disabled', 'true');
    const helper = page.locator('.flow-nav__helper');
    await expect(helper).toHaveText('');
    // Playwright refuses to click aria-disabled controls; a finger does not.
    await steps.click({ force: true });
    await expect(helper).toHaveText('Pick a dinner first');
    await nav.getByRole('button', { name: 'Cook' }).click({ force: true });
    await expect(helper).toHaveText('Make the plan first');
    await page.getByRole('link', { name: 'Make Dinner' }).focus();
    await expect(helper).toHaveText('');
  });

  test('B1 an unreachable step shows its reason when focused with the keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Dinner' })
      .getByRole('button', { name: 'Plan' })
      .focus();
    await expect(page.locator('.flow-nav__helper')).toHaveText('Pick a dinner first');
  });
});

test.describe('shell: settings disclosure (review B)', () => {
  test('B2 on a phone Theme and Start over sit behind Settings; on a wide screen they are inline', async ({
    page,
  }) => {
    await page.goto('/');
    const width = page.viewportSize()?.width ?? 0;
    const toggle = page.getByRole('button', { name: 'Settings' });
    if (width < 640) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByLabel('Theme')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Start over' })).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByLabel('Theme')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
      await toggle.click();
      await expect(page.getByLabel('Theme')).toBeHidden();
    } else {
      await expect(toggle).toBeHidden();
      await expect(page.getByLabel('Theme')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
    }
  });

  test('B2 the header with Settings closed is at most 64 px tall on a phone', async ({ page }) => {
    await page.goto('/');
    const box = await page.locator('header').boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    if (width < 640) expect(box?.height).toBeLessThanOrEqual(64);
    else expect(box?.height).toBeLessThanOrEqual(72);
  });
});

test.describe('shell: header', () => {
  test.use({ colorScheme: 'light' });

  test('R9.1 theme Dark under a light system sets data-theme and the dark --color-bg, survives a reload, System removes it', async ({
    page,
  }) => {
    await page.goto('/');
    await openSettings(page);
    const root = page.locator('html');
    await expect(root).not.toHaveAttribute('data-theme', /.*/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 241, 231)');

    await page.getByLabel('Theme').selectOption({ label: 'Dark' });
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(26, 24, 22)');

    await page.reload();
    await openSettings(page);
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByLabel('Theme')).toHaveValue('dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(26, 24, 22)');

    await page.getByLabel('Theme').selectOption({ label: 'System' });
    await expect(root).not.toHaveAttribute('data-theme', /.*/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 241, 231)');
  });

  test('R9.7 Start over needs a second tap; Cancel returns focus to the button and keeps the dinner', async ({
    page,
  }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'plan');
    await page.goto('/');
    await openSettings(page);
    const start = page.getByRole('button', { name: 'Start over' });
    await start.click();
    await expect(
      page.getByText('Start over? This removes your dinner from this device.'),
    ).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Start over' })).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
  });

  test('R9.7 confirming Start over opens the Menu, clears the dinner and keeps the theme', async ({
    page,
  }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'plan');
    await page.goto('/');
    await openSettings(page);
    await page.getByLabel('Theme').selectOption({ label: 'Dark' });
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('navigation', { name: 'Dinner' }).getByRole('link')).toHaveCount(1);
    await page.reload();
    await openSettings(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(page.getByLabel('Theme')).toHaveValue('dark');
  });

  test('N1 the header targets are at least 48×48 px', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'plan');
    await page.goto('/');
    await openSettings(page);
    const settings = page.getByRole('button', { name: 'Settings' });
    if (await settings.isVisible()) {
      const box = await settings.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);
    }
    const targets = [
      page.getByRole('link', { name: 'Make Dinner' }),
      page.getByLabel('Theme'),
      page.getByRole('button', { name: 'Start over' }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);
    }
    await page.getByRole('button', { name: 'Start over' }).click();
    for (const name of ['Yes, start over', 'Cancel']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);
    }
  });
});
