import { expect, test } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
import { FIXED_NOW, seedDinner } from './support.js';

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
    await expect(nav.getByRole('listitem')).toHaveText([
      'Menu',
      'Steps Pick a dinner first',
      'Plan Pick a dinner first',
      'Cook Cooking mode is not available yet',
    ]);
    await expect(nav.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'step');
    await expect(nav.getByRole('link')).toHaveCount(1);
  });

  test('R9.2 with a dinner, Steps and Plan become links and Cook stays text', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'steps');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Dinner' });
    await expect(nav.getByRole('link')).toHaveText(['Menu', 'Steps', 'Plan']);
    await expect(nav.getByRole('link', { name: 'Steps' })).toHaveAttribute('aria-current', 'step');
    await expect(nav.getByRole('listitem').last()).toHaveText(
      'Cook Cooking mode is not available yet',
    );
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

test.describe('shell: header', () => {
  test.use({ colorScheme: 'light' });

  test('R9.1 theme Dark under a light system sets data-theme and the dark --color-bg, survives a reload, System removes it', async ({
    page,
  }) => {
    await page.goto('/');
    const root = page.locator('html');
    await expect(root).not.toHaveAttribute('data-theme', /.*/);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 241, 231)');

    await page.getByLabel('Theme').selectOption({ label: 'Dark' });
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(26, 24, 22)');

    await page.reload();
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
    await page.getByLabel('Theme').selectOption({ label: 'Dark' });
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('navigation', { name: 'Dinner' }).getByRole('link')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a dinner');
    await expect(page.getByLabel('Theme')).toHaveValue('dark');
  });

  test('N1 the header targets are at least 48×48 px', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30', 'plan');
    await page.goto('/');
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
