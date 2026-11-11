import { expect, test } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
import { advanceClock, fixClockAt, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

// The plan is Sunday roast for 19:30 on Wed 2026-11-11 (London is on GMT): the first step
// starts at 17:40 (cooking-mode design, CM-a and CM-b).
test.describe('starting to cook (CM1.1 to CM1.4)', () => {
  test('CM1.2 at 17:30 "Start cooking" counts down 10:00 to 17:40 and offers "Start now"', async ({
    page,
  }) => {
    await fixClockAt(page, '2026-11-11T17:30:00Z');
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('link', { name: 'Start cooking' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Right now' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Cooking starts at 17:40' }),
    ).toBeVisible();
    await expect(page.getByRole('timer', { name: 'Time until cooking starts' })).toHaveText(
      '10:00',
    );
    await expect(page.getByText('Start now to serve at 19:20, 10 min earlier.')).toBeVisible();
    await expect(
      page.getByText('First: Season and truss the chicken (Roast chicken)'),
    ).toBeVisible();
    await expect(page.getByText('Serve at 19:30')).toBeVisible();
  });

  test('CM4.1 a minute later the countdown reads 09:00', async ({ page }) => {
    await fixClockAt(page, '2026-11-11T17:30:00Z');
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('link', { name: 'Start cooking' }).click();
    await expect(page.getByRole('timer')).toHaveText('10:00');
    await advanceClock(page, 60_000);
    await expect(page.getByRole('timer')).toHaveText('09:00');
  });

  test('CM1.3 "Start now" moves serving to 19:20 and ends the countdown', async ({ page }) => {
    await fixClockAt(page, '2026-11-11T17:30:00Z');
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('link', { name: 'Start cooking' }).click();
    await page.getByRole('button', { name: 'Start now' }).click();
    await expect(page.getByText('Serve at 19:20')).toBeVisible();
    // "Start now" moves the plan itself, so there is no separate planned time to show (CM-a).
    await expect(page.getByText('Planned for')).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(0);
  });

  test('CM1.4 a session begun at 17:52 rebuilds at once: serve at 19:42', async ({ page }) => {
    await fixClockAt(page, '2026-11-11T17:52:00Z');
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/');
    await page.getByRole('link', { name: 'Start cooking' }).click();
    await expect(page.getByText('Serve at 19:42')).toBeVisible();
    await expect(page.getByText('Planned for 19:30')).toBeVisible();
  });

  test('CM1.1 opening #/cook with no cook session shows the Plan screen and never begins one', async ({
    page,
  }) => {
    await fixClockAt(page, '2026-11-11T17:30:00Z');
    await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
    await page.goto('/#/cook');
    await expect(page.getByRole('link', { name: 'Start cooking' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Right now' })).toBeHidden();
    const stored = await page.evaluate(() => window.localStorage.getItem('make-dinner:state'));
    expect(JSON.parse(stored ?? '{}').cook).toBeNull();
  });
});
