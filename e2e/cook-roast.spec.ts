import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST, TWO_COOK_KITCHEN } from '../test/support/fixtures.js';
import type { Kitchen } from '../src/core/index.js';
import { advanceClock, fixClockAt, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

/** Sunday roast for 19:30 on Wed 2026-11-11, "Start cooking" tapped at `iso`. */
async function cookAt(
  page: Page,
  iso: string,
  kitchen: Kitchen = HOME_KITCHEN,
  serve: '19:30' = '19:30',
): Promise<void> {
  await fixClockAt(page, iso);
  await seedDinner(page, SUNDAY_ROAST, kitchen, serve);
  await page.goto('/');
  await page.getByRole('link', { name: 'Start cooking' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Right now' })).toBeVisible();
}

const dock = (page: Page) => page.getByRole('region', { name: 'Actions' });

test.describe('Do now and the dock (CM2.2 to CM2.4, CM3.1, CM3.5, CM3.6, CM9.3)', () => {
  test('CM3.1 at 17:40 the dock names the prep step with Start; Start moves focus to Done', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await expect(dock(page).getByText('Season and truss the chicken')).toBeVisible();
    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    const done = dock(page).getByRole('button', { name: 'Done', exact: true });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
  });

  test('CM2.4 at 17:50 Done on the prep step shows the roast as "Start, then leave it" and the shred in the dock', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    await advanceClock(page, 10 * 60_000);
    // The screen reads the time once a second; wait for the 17:50 card before tapping.
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await dock(page).getByRole('button', { name: 'Done', exact: true }).click();

    const roast = page.getByRole('region', { name: 'Roast the chicken' });
    await expect(roast.getByText('Start, then leave it')).toBeVisible();
    await expect(roast.getByRole('button', { name: /^Start/ })).toBeVisible();
    await expect(dock(page).getByText('Shred the greens')).toBeVisible();
    await expect(dock(page).getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });

  test('CM2.2 with two cooks at 17:40 there are a Cook 1 and a Cook 2 card', async ({ page }) => {
    await cookAt(page, '2026-11-11T17:40:00Z', TWO_COOK_KITCHEN);
    await expect(page.getByText('Cook 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Cook 2', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Season and truss the chicken' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Shred the greens' })).toBeVisible();
  });
});

/** CM-c up to the shred: prep done, the roast and the shred started 17:50, the shred done 17:55. */
async function tapToCmF(page: Page): Promise<void> {
  const click = (name: string) => dock(page).getByRole('button', { name, exact: true }).click();
  await click('Start');
  await advanceClock(page, 10 * 60_000);
  await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await click('Done'); // prep, 17:50
  const roast = page.getByRole('region', { name: 'Roast the chicken' });
  await roast.getByRole('button', { name: /^Start/ }).click(); // roast, 17:50
  await click('Start'); // shred, 17:50
  await advanceClock(page, 5 * 60_000);
  await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await click('Done'); // shred, 17:55
}

test.describe('Running and Needs more time (CM2.5, CM3.1, CM4.1, CM4.2)', () => {
  test('CM2.5 the roast started at 17:50 reads ready at 19:05 with 75:00 in the Running section', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    await advanceClock(page, 10 * 60_000);
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await dock(page).getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('region', { name: 'Roast the chicken' })
      .getByRole('button', { name: /^Start/ })
      .click();

    const running = page.getByRole('region', { name: 'Roast the chicken' });
    await expect(page.getByRole('heading', { level: 2, name: 'Running' })).toBeVisible();
    await expect(running.getByText('Roast chicken · ready at 19:05')).toBeVisible();
    await expect(running.getByRole('timer', { name: 'Time left' })).toHaveText('75:00');
  });

  test('CM4.2 CM3.1 with the shred done, at 19:05 the roast is "! Time is up", the dock offers Done, and +5 min sits under Needs more time', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    const running = page.getByRole('region', { name: 'Roast the chicken' });
    await expect(running.getByRole('timer', { name: 'Time left' })).toHaveText('70:00');
    const group = running.getByRole('group', { name: 'Needs more time' });
    await expect(group.getByRole('button', { name: '+5 min' })).toBeVisible();
    await expect(group.getByRole('button', { name: '+10 min' })).toBeVisible();
    await expect(group.getByRole('button', { name: '+15 min' })).toBeVisible();

    await advanceClock(page, 70 * 60_000); // 17:55 -> 19:05
    await expect(running.getByText('! Time is up')).toBeVisible();
    await expect(dock(page).getByText('Roast the chicken')).toBeVisible();
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  });
});

test.describe('Up next and the dish strip (CM2.6, CM2.7, CM9.5)', () => {
  test('CM2.6 CM-f at 17:56: up next is the rest at 19:05, then the roux and the simmer', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    await advanceClock(page, 60_000); // 17:56
    const upNext = page.getByRole('region', { name: 'Up next' });
    const items = upNext.getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Rest the chicken under foil');
    await expect(items.nth(0)).toContainText('Roast chicken');
    await expect(items.nth(0)).toContainText('in 1 h 9 min');
    await expect(items.nth(0)).toContainText('19:05');
    await expect(items.nth(1)).toContainText('Make a roux in the roasting tin');
    await expect(items.nth(1)).toContainText('19:10');
    await expect(items.nth(2)).toContainText('Add stock and let the gravy thicken');
    await expect(items.nth(2)).toContainText('19:12');
  });

  test('CM2.7 CM9.5 CM-f dish chips say how many steps are done and a state in words', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    await advanceClock(page, 60_000);
    const chips = page.getByRole('list', { name: 'Dishes' }).getByRole('listitem');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toContainText('Roast chicken: 1 of 4 done');
    await expect(chips.nth(0)).toContainText('Cooking');
    await expect(chips.nth(1)).toContainText('Gravy: 0 of 3 done');
    await expect(chips.nth(1)).toContainText('Next at 19:10');
    await expect(chips.nth(2)).toContainText('Spring greens: 1 of 3 done');
    await expect(chips.nth(2)).toContainText('Next at 19:20');
  });
});

test.describe('the build log (CM5.1, CM5.3 to CM5.6)', () => {
  test('CM5.3 CM-c: +15 min on the roast at 18:30 logs RB-a: lines, serving, warning, up-to-date list, announcement', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    const log = page.getByRole('region', { name: 'Build log' });
    await expect(log.getByText('No rebuilds yet.')).toBeVisible();

    await advanceClock(page, 35 * 60_000); // 18:30
    const roast = page.getByRole('region', { name: 'Roast the chicken' });
    await expect(roast.getByRole('timer')).toHaveText('35:00');
    await roast
      .getByRole('group', { name: 'Needs more time' })
      .getByRole('button', { name: '+15 min' })
      .click();

    await expect(log.locator('.log-line')).toHaveText([
      '18:30 rebuild: chicken.roast needs 15 more min',
      'chicken.rest 19:05 -> 19:20',
      'gravy.roux 19:10 -> 19:26',
      'gravy.simmer 19:12 -> 19:28',
      'greens.boil 19:20 -> 19:33',
      'greens.toss 19:24 -> 19:37',
      'gravy.strain 19:22 -> 19:38',
      'chicken.carve 19:25 -> 19:40',
      '3 steps up to date',
      'serve 19:30 -> 19:45',
    ]);
    await expect(page.getByText('Serve at 19:45')).toBeVisible();
    await expect(page.getByText('Planned for 19:30')).toBeVisible();
    await expect(log.getByText('Warning')).toHaveCount(1);
    await expect(
      log.getByText(
        'Spring greens: \u201cToss the greens with butter\u201d will be ready 7 min before serving and can wait only 5 min. More ovens, burners or cooks may help.',
      ),
    ).toBeVisible();
    await expect(page.locator('.live-notice')).toHaveText(
      'Plan rebuilt: 7 steps moved. Serving is now 19:45. 1 new warning.',
    );

    await expect(log.locator('.log-line', { hasText: 'is up to date' })).toHaveCount(0);
    const toggle = log.getByRole('button', { name: 'Show the 3 steps that are up to date' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(log.locator('.log-line', { hasText: 'is up to date' })).toHaveText([
      'chicken.prep is up to date',
      'chicken.roast is up to date',
      'greens.shred is up to date',
    ]);
    await expect(
      log.getByRole('button', { name: 'Hide the steps that are up to date' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe("I'm behind, Undo, blocked starts and late cards (CM2.9, CM3.2 to CM3.4, CM5.1, CM5.8)", () => {
  test("CM3.2 CM-d: at 17:53, with the shred not started, I'm behind moves only the shred to 17:53", async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    const click = (name: string) => dock(page).getByRole('button', { name, exact: true }).click();
    await click('Start');
    await advanceClock(page, 10 * 60_000);
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await click('Done');
    await page
      .getByRole('region', { name: 'Roast the chicken' })
      .getByRole('button', { name: /^Start/ })
      .click();
    await advanceClock(page, 3 * 60_000); // 17:53
    await expect(dock(page).getByText('Shred the greens')).toBeVisible();
    await dock(page).getByRole('button', { name: "I'm behind", exact: true }).click();

    const log = page.getByRole('region', { name: 'Build log' });
    await expect(log.locator('.log-line')).toHaveText([
      "17:53 rebuild: I'm behind",
      'greens.shred 17:50 -> 17:53',
      '9 steps up to date',
    ]);
    await expect(page.getByText('Serve at 19:30')).toBeVisible();
    await expect(page.locator('.live-notice')).toHaveText(
      'Plan rebuilt: 1 step moved. Serving stays at 19:30.',
    );
  });

  test('CM3.4 CM-c: Undo restores Serve at 19:30, and is gone ten seconds later without a tap', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    await advanceClock(page, 35 * 60_000); // 18:30
    const roast = page.getByRole('region', { name: 'Roast the chicken' });
    const plus15 = roast
      .getByRole('group', { name: 'Needs more time' })
      .getByRole('button', { name: '+15 min' });
    await plus15.click();
    await expect(page.getByText('Serve at 19:45')).toBeVisible();
    const undo = dock(page).getByRole('button', { name: 'Undo: +15 min on Roast the chicken' });
    await undo.click();
    await expect(page.getByText('Serve at 19:30')).toBeVisible();
    await expect(page.getByText('Planned for')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Build log' }).getByText('No rebuilds yet.'),
    ).toBeVisible();
    await expect(page.locator('.live-notice')).toHaveText('Undone: +15 min on Roast the chicken.');
    await expect(dock(page).getByRole('button', { name: /^Undo/ })).toHaveCount(0);

    await plus15.click();
    await expect(dock(page).getByRole('button', { name: /^Undo/ })).toBeVisible();
    await advanceClock(page, 10_000);
    await expect(dock(page).getByRole('button', { name: /^Undo/ })).toHaveCount(0);
    await expect(page.getByText('Serve at 19:45')).toBeVisible();
  });

  test("CM2.9 CM-g: at 19:10 the roast and the rest read Late by 5 min, nothing is rebuilt, and I'm behind gives the E3 log", async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    await advanceClock(page, 75 * 60_000); // 19:10
    const roast = page.getByRole('region', { name: 'Roast the chicken' });
    const rest = page.getByRole('region', { name: 'Rest the chicken under foil' });
    await expect(roast.getByText('! Late by 5 min')).toBeVisible();
    await expect(rest.getByText('! Late by 5 min')).toBeVisible();
    const log = page.getByRole('region', { name: 'Build log' });
    await expect(log.getByText('No rebuilds yet.')).toBeVisible();
    await expect(page.getByText('Serve at 19:30')).toBeVisible();

    const behind = dock(page).getByRole('button', { name: "I'm behind", exact: true });
    await expect(behind).toHaveClass(/button--emphasis/);
    await behind.click();
    await expect(log.locator('.log-line')).toHaveText([
      "19:10 rebuild: I'm behind",
      'chicken.rest 19:05 -> 19:10',
      'gravy.roux 19:10 -> 19:15',
      'gravy.simmer 19:12 -> 19:17',
      'greens.boil 19:20 -> 19:25',
      'gravy.strain 19:22 -> 19:27',
      'greens.toss 19:24 -> 19:29',
      'chicken.carve 19:25 -> 19:30',
      '3 steps up to date',
      'serve 19:30 -> 19:35',
    ]);
    await expect(page.getByText('Serve at 19:35')).toBeVisible();
    await expect(roast.getByText('! Late by')).toHaveCount(0);
  });

  test('CM3.3 starting the roux while the roast runs asks first; Not yet changes nothing, Start anyway starts it', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    await advanceClock(page, 75 * 60_000); // 19:10, the roux is due
    await expect(dock(page).getByText('Make a roux in the roasting tin')).toBeVisible();
    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    await expect(
      dock(page).getByText(
        'Make a roux in the roasting tin waits for \u201cRoast the chicken\u201d, not done yet. Start it anyway?',
      ),
    ).toBeVisible();
    await dock(page).getByRole('button', { name: 'Not yet' }).click();
    await expect(dock(page).getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    await expect(dock(page).getByRole('button', { name: 'Start', exact: true })).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Build log' }).getByText('No rebuilds yet.'),
    ).toBeVisible();

    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    await dock(page).getByRole('button', { name: 'Start anyway' }).click();
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  });
});
