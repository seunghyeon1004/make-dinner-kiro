import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Plan } from '../src/core/index.js';
import { HOME_KITCHEN, SUNDAY_ROAST, TIGHT_OVEN } from '../test/support/fixtures.js';
import { expectNoPageScroll, FIXED_NOW, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

/**
 * The design's H1 table at Wed 19:30: heading, range, title, dish, lanes, duration, status.
 * Only prep, roast, rest and carve are on the critical path; an empty status says nothing.
 */
const H1_ROWS: readonly (readonly string[])[] = [
  [
    '17:40',
    '17:40–17:50',
    'Season and truss the chicken',
    'Roast chicken',
    'Cook 1',
    '10 min',
    '▲ On the critical path',
  ],
  [
    '17:50',
    '17:50–19:05',
    'Roast the chicken',
    'Roast chicken',
    'Oven 1',
    '1 h 15 min',
    '▲ On the critical path',
  ],
  [
    '17:50',
    '17:50–17:55',
    'Shred the greens',
    'Spring greens',
    'Cook 1',
    '5 min',
    'Can slip 1 h 15 min',
  ],
  [
    '19:05',
    '19:05–19:25',
    'Rest the chicken under foil',
    'Roast chicken',
    'Hands-free',
    '20 min',
    '▲ On the critical path',
  ],
  [
    '19:10',
    '19:10–19:12',
    'Make a roux in the roasting tin',
    'Gravy',
    'Burner 1, Cook 1',
    '2 min',
    '',
  ],
  [
    '19:12',
    '19:12–19:22',
    'Add stock and let the gravy thicken',
    'Gravy',
    'Burner 1',
    '10 min',
    '',
  ],
  [
    '19:20',
    '19:20–19:24',
    'Cook the greens in salted water',
    'Spring greens',
    'Burner 2',
    '4 min',
    '',
  ],
  ['19:22', '19:22–19:24', 'Strain the gravy into a jug', 'Gravy', 'Cook 1', '2 min', ''],
  ['19:24', '19:24–19:25', 'Toss the greens with butter', 'Spring greens', 'Cook 1', '1 min', ''],
  [
    '19:25',
    '19:25–19:30',
    'Carve the chicken',
    'Roast chicken',
    'Cook 1',
    '5 min',
    '▲ On the critical path',
  ],
];

async function openPlan(
  page: Page,
  plan: Plan = SUNDAY_ROAST,
  kitchen = HOME_KITCHEN,
): Promise<void> {
  await seedDinner(page, plan, kitchen, '19:30');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(plan.title);
}

test.describe('plan screen', () => {
  test('R5.4 R7.1 R7.2 seeded H1 at 19:30 shows start, serve, span and the list of the design table', async ({
    page,
  }) => {
    await openPlan(page);
    await expect(page.getByText('Start at 17:40', { exact: true })).toBeVisible();
    await expect(page.getByText('Serve at 19:30', { exact: true })).toBeVisible();
    await expect(page.getByText('Takes 1 h 50 min', { exact: true })).toBeVisible();

    const list = page.locator('#plan-list');
    const headings = list.getByRole('heading', { level: 3 });
    await expect(headings).toHaveText(
      [...H1_ROWS.map((r) => r[0] ?? ''), '19:30'].filter(
        (h, i, all) => all.indexOf(h) === i || i === all.length - 1,
      ),
    );
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(H1_ROWS.length + 1);
    for (const [index, row] of H1_ROWS.entries()) {
      const item = items.nth(index);
      for (const part of row.slice(1)) await expect(item).toContainText(part);
      if (row[6] === '') {
        await expect(item).not.toContainText('critical path');
        await expect(item).not.toContainText('Can slip');
      }
    }
    await expect(items.nth(H1_ROWS.length)).toHaveText('Serve');
  });

  test('R5.2 R7.1 burners 4 to 1 moves the roux to 19:08–19:10', async ({ page }) => {
    await openPlan(page);
    const fewer = page.getByRole('button', { name: 'Fewer burners' });
    for (let i = 0; i < 3; i += 1) await fewer.click();
    await expect(page.getByRole('group', { name: 'Burners' }).locator('output')).toHaveText('1');
    await expect(
      page.locator('#plan-list li', { hasText: 'Make a roux in the roasting tin' }),
    ).toContainText('19:08–19:10');
  });

  test('R5.1 the steppers stop at their bounds', async ({ page }) => {
    await openPlan(page);
    const cooks = page.getByRole('group', { name: 'Cooks' });
    await expect(cooks.getByRole('button', { name: 'Fewer cooks' })).toBeDisabled();
    const ovens = page.getByRole('group', { name: 'Ovens' });
    for (let i = 0; i < 3; i += 1) await ovens.getByRole('button', { name: 'More ovens' }).click();
    await expect(ovens.locator('output')).toHaveText('4');
    await expect(ovens.getByRole('button', { name: 'More ovens' })).toBeDisabled();
  });

  test('R5.7 ovens 1 to 0 names the step that needs one and shows no list; Add an oven restores it', async ({
    page,
  }) => {
    await openPlan(page);
    await page.getByRole('button', { name: 'Fewer ovens' }).click();
    await expect(
      page.getByText(
        'This plan needs an oven and the kitchen has none. These steps use it: Roast the chicken.',
      ),
    ).toBeVisible();
    await expect(page.locator('#plan-list')).toHaveCount(0);
    await expect(page.getByText(/^Start at/)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Burners' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change the steps' })).toBeVisible();

    await page.getByRole('button', { name: 'Add an oven' }).click();
    await expect(page.locator('#plan-list li')).toHaveCount(H1_ROWS.length + 1);
    await expect(page.getByText('Start at 17:40', { exact: true })).toBeVisible();
  });

  test('R5.3 R5.4 serving time 00:30 reads Serve at 00:30 tomorrow', async ({ page }) => {
    await openPlan(page);
    await page.getByLabel('Serving time').fill('00:30');
    await expect(page.getByText('Serve at 00:30 tomorrow', { exact: true })).toBeVisible();
    await expect(page.getByText('Start at 22:40 yesterday')).toHaveCount(0);
    // Headings now carry the weekday (R7.4): Wed 22:40 ... Thu 00:30.
    await expect(page.locator('#plan-list h3').first()).toHaveText('Wed 22:40');
  });

  test('R5.2 a serving time change does not move any step relative to serving', async ({
    page,
  }) => {
    await openPlan(page);
    await page.getByLabel('Serving time').fill('21:00');
    await expect(page.getByText('Start at 19:10', { exact: true })).toBeVisible();
    await expect(page.getByText('Takes 1 h 50 min', { exact: true })).toBeVisible();
  });

  test('R5.6 R7.3 TIGHT_OVEN shows its hold warning sentence and marks the list item', async ({
    page,
  }) => {
    await openPlan(page, TIGHT_OVEN);
    await expect(
      page.getByText(
        'Roast potatoes: “Roast the potatoes” will be ready 40 min before serving and can wait only 10 min. More ovens, burners or cooks may help.',
      ),
    ).toBeVisible();
    await expect(page.locator('#plan-list li', { hasText: 'Roast the potatoes' })).toContainText(
      '! Warning: waits 40 min and can wait 10 min',
    );
  });

  test('R5.6 a plan with no warnings says so', async ({ page }) => {
    await openPlan(page);
    await expect(
      page.getByText('No warnings. Every result is used within the time it can wait.'),
    ).toBeVisible();
  });

  test('R5.8 R9.3 a plan with an error never reaches the Plan screen: it opens Steps', async ({
    page,
  }) => {
    const broken: Plan = {
      ...SUNDAY_ROAST,
      steps: SUNDAY_ROAST.steps.map((step) =>
        step.id === 'gravy.roux' ? { ...step, after: ['chicken.rost'] } : step,
      ),
    };
    await seedDinner(page, broken, HOME_KITCHEN, '19:30', 'plan');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the steps');
    await expect(page).toHaveURL(/#\/steps$/);
  });
});

test.describe('plan screen: a start in the past', () => {
  const NOTE = 'This dinner needs 1 h 50 min. Earliest serving time 19:35.';

  test('R5.5 at 17:41 the note appears and "Serve at 19:35" sets the serving time and clears it', async ({
    page,
  }) => {
    await page.clock.setSystemTime(new Date('2026-11-11T17:41:00Z'));
    await openPlan(page);
    await expect(page.getByText(NOTE)).toBeVisible();
    await page.getByRole('button', { name: 'Serve at 19:35' }).click();
    await expect(page.getByText(NOTE)).toHaveCount(0);
    await expect(page.getByText('Serve at 19:35', { exact: true })).toBeVisible();
    await expect(page.getByText('Start at 17:45', { exact: true })).toBeVisible();
  });

  test('R5.5 at 17:39:30 there is no note; a minute later there is', async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-11-11T17:39:30Z'));
    await openPlan(page);
    await expect(page.getByText('Start at 17:40', { exact: true })).toBeVisible();
    await expect(page.getByText(/^This dinner needs/)).toHaveCount(0);
    await page.clock.runFor(60_000);
    await expect(page.getByText(/^This dinner needs/)).toBeVisible();
  });
});

test.describe('timeline', () => {
  test('R6.1 rows run Cook 1, Burner 1, Burner 2, Oven 1, Hands-free', async ({ page }) => {
    await openPlan(page);
    const labels = page.locator('.timeline__label');
    await expect(labels).toHaveText(['Cook 1', 'Burner 1', 'Burner 2', 'Oven 1', 'Hands-free']);
    await expect(page.getByText('Serve 19:30', { exact: true })).toBeAttached();
  });

  test('R6.7 the timeline is aria-hidden with nothing focusable in it, and a skip link precedes it', async ({
    page,
  }) => {
    await openPlan(page);
    const timeline = page.locator('.timeline');
    await expect(timeline).toHaveAttribute('aria-hidden', 'true');
    const focusable = await timeline.evaluate(
      (el) => el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length,
    );
    expect(focusable).toBe(0);
    const skip = page.getByRole('link', { name: 'Skip to the plan list' });
    await expect(skip).toBeVisible();
    const skipBeforeTimeline = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find(
        (a) => a.textContent === 'Skip to the plan list',
      );
      const graphic = document.querySelector('.timeline');
      return (
        link !== undefined &&
        graphic !== null &&
        (link.compareDocumentPosition(graphic) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });
    expect(skipBeforeTimeline).toBe(true);
    await skip.click();
    await expect(page.locator('#plan-list')).toBeFocused();
    await expect(page).toHaveURL(/#\/plan$/);
  });

  test('R6.8 tapping the Oven 1 bar focuses the Roast the chicken item', async ({ page }) => {
    await openPlan(page);
    await page.locator('.timeline [data-step-id="chicken.roast"]').click();
    const item = page.locator('[id="step-chicken.roast"]');
    await expect(item).toBeFocused();
    await expect(item).toContainText('Roast the chicken');
    await expect(item).toBeInViewport();
  });

  test('R6.5 the oven bar carries the label, the 12-minute roux bar none', async ({ page }) => {
    await openPlan(page);
    await expect(page.locator('.timeline [data-step-id="chicken.roast"]').first()).toContainText(
      'Roast the chicken',
    );
    await expect(page.locator('.timeline [data-step-id="gravy.roux"]').first()).toHaveText('');
  });

  test('R6.9 the timeline scrolls inside itself on a phone, the page never does, lane labels stay in view', async ({
    page,
  }, testInfo) => {
    await openPlan(page);
    const scroller = page.locator('.timeline');
    const sizes = await scroller.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    if (testInfo.project.name === 'phone') {
      expect(sizes.scroll).toBeGreaterThan(sizes.client);
    }
    await expectNoPageScroll(page);
    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expectNoPageScroll(page);
    const label = page.locator('.timeline__label').first();
    const box = await label.boundingBox();
    const frame = await scroller.boundingBox();
    expect(box).not.toBeNull();
    expect(frame).not.toBeNull();
    expect(Math.abs((box?.x ?? -1000) - (frame?.x ?? 1000))).toBeLessThan(2);
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeInViewport();
  });
});
