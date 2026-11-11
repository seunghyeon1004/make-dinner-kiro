import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Plan } from '../src/core/index.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
import { FIXED_NOW, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

/** SUNDAY_ROAST with `gravy.roux` waiting for a step that does not exist. */
const BROKEN_ROAST: Plan = {
  ...SUNDAY_ROAST,
  steps: SUNDAY_ROAST.steps.map((step) =>
    step.id === 'gravy.roux' ? { ...step, after: ['chicken.rost'] } : step,
  ),
};

async function openSteps(page: Page, plan: Plan = SUNDAY_ROAST): Promise<void> {
  await seedDinner(page, plan, HOME_KITCHEN, '19:30', 'steps');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the steps');
}

const dish = (page: Page, name: string) =>
  page.locator('section.dish', { has: page.getByRole('heading', { level: 2, name, exact: true }) });

test.describe('steps screen', () => {
  test('R4.1 R4.9 seeded SUNDAY_ROAST shows a section per dish, steps in dependency order, No issues.', async ({
    page,
  }) => {
    await openSteps(page);
    await expect(page.getByText('Sunday roast. Fix any errors, then make the plan.')).toBeVisible();
    const sections = page.locator('section.dish').getByRole('heading', { level: 2 });
    await expect(sections).toHaveText(['Roast chicken', 'Gravy', 'Spring greens']);

    const titles = (name: string) => dish(page, name).getByRole('heading', { level: 3 });
    await expect(titles('Roast chicken')).toHaveText([
      'Season and truss the chicken',
      'Roast the chicken',
      'Rest the chicken under foil',
      'Carve the chicken',
    ]);
    await expect(titles('Gravy')).toHaveText([
      'Make a roux in the roasting tin',
      'Add stock and let the gravy thicken',
      'Strain the gravy into a jug',
    ]);
    await expect(titles('Spring greens')).toHaveText([
      'Shred the greens',
      'Cook the greens in salted water',
      'Toss the greens with butter',
    ]);
    await expect(page.getByText('No issues.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make the plan' })).toBeEnabled();
  });

  test('R4.2 a step summary gives id, duration, appliance, hands-on, hold and prerequisites by title', async ({
    page,
  }) => {
    await openSteps(page);
    const roast = page.locator('[data-step-id="chicken.roast"]');
    await expect(roast).toContainText('chicken.roast');
    await expect(roast).toContainText('1 h 15 min');
    await expect(roast).toContainText('Oven');
    await expect(roast).toContainText('Hands-free');
    await expect(roast).toContainText('Can wait 5 min');
    await expect(roast).toContainText('Waits for: Season and truss the chicken');
    const prep = page.locator('[data-step-id="chicken.prep"]');
    await expect(prep).toContainText('Keeps');
    await expect(prep).toContainText('Waits for nothing');
  });

  test('R4.9 R4.10 an error shows beside its step and in the summary, and blocks the plan', async ({
    page,
  }) => {
    await openSteps(page, BROKEN_ROAST);
    await expect(page.getByText('1 error and 0 warnings.', { exact: true })).toBeVisible();
    await expect(page.getByText('Fix the errors to make the plan.', { exact: true })).toBeVisible();

    const beside = page.locator('[data-step-id="gravy.roux"] .issue');
    await expect(beside).toHaveCount(1);
    await expect(beside).toContainText('!');
    await expect(beside).toContainText('Error');
    await expect(beside).toContainText('chicken.rost');
    await expect(page.locator('[data-step-id="gravy.simmer"] .issue')).toHaveCount(0);

    const button = page.getByRole('button', { name: 'Make the plan' });
    await expect(button).toBeDisabled();
    await expect(page.getByText('Fix 1 error to make the plan.', { exact: true })).toBeVisible();

    // The summary link moves focus to the issue beside the step.
    await page.locator('#issues-summary').getByRole('link').click();
    await expect(beside).toBeFocused();
  });

  test('R4.11 Make the plan on a valid plan opens the Plan screen', async ({ page }) => {
    await openSteps(page);
    await page.getByRole('button', { name: 'Make the plan' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await expect(page.getByText('Start at 17:40', { exact: true })).toBeVisible();
  });
});

const card = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);

test.describe('step editor', () => {
  test('R4.3 R4.11 minutes of Roast the chicken 75 to 85 move the start to 17:30', async ({
    page,
  }) => {
    await openSteps(page);
    await card(page, 'chicken.roast').getByRole('button', { name: 'Edit' }).click();
    const minutes = page.getByLabel('Minutes', { exact: true });
    await minutes.fill('85');
    await expect(card(page, 'chicken.roast')).toContainText('1 h 25 min');
    await page.getByRole('button', { name: 'Make the plan' }).click();
    await expect(page.getByText('Start at 17:30', { exact: true })).toBeVisible();
    await expect(page.getByText('Takes 2 h', { exact: true })).toBeVisible();
  });

  test('R4.4 minutes 0 shows the field error, keeps the typed value and leaves the plan unchanged', async ({
    page,
  }) => {
    await openSteps(page);
    await card(page, 'chicken.roast').getByRole('button', { name: 'Edit' }).click();
    const minutes = page.getByLabel('Minutes', { exact: true });
    await minutes.fill('0');
    await expect(
      page.getByText('Enter whole minutes from 1 to 480.', { exact: true }),
    ).toBeVisible();
    await expect(minutes).toHaveValue('0');
    await expect(card(page, 'chicken.roast')).toContainText('1 h 15 min');
    await page.getByRole('button', { name: 'Make the plan' }).click();
    await expect(page.getByText('Takes 1 h 50 min', { exact: true })).toBeVisible();
  });

  test('R4.3 unchecking Keeps shows Can wait up to (minutes) with 10', async ({ page }) => {
    await openSteps(page);
    await card(page, 'chicken.prep').getByRole('button', { name: 'Edit' }).click();
    const keeps = page.getByLabel('Keeps (can wait as long as needed)');
    await expect(keeps).toBeChecked();
    await expect(page.getByLabel('Can wait up to (minutes)')).toHaveCount(0);
    await keeps.uncheck();
    await expect(page.getByLabel('Can wait up to (minutes)')).toHaveValue('10');
    await expect(card(page, 'chicken.prep')).toContainText('Can wait 10 min');
  });

  test('R4.5 only one editor is open at a time', async ({ page }) => {
    await openSteps(page);
    await card(page, 'chicken.prep').getByRole('button', { name: 'Edit' }).click();
    await card(page, 'chicken.roast').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Minutes', { exact: true })).toHaveCount(1);
    await expect(card(page, 'chicken.roast').getByLabel('Minutes', { exact: true })).toHaveCount(1);
  });

  test('R4.5 in the gravy.roux editor a step that already waits for it is disabled', async ({
    page,
  }) => {
    await openSteps(page);
    await card(page, 'gravy.roux').getByRole('button', { name: 'Edit' }).click();
    const waits = page.getByRole('group', { name: 'Waits for' });
    await expect(waits.getByRole('checkbox', { name: 'Roast the chicken' })).toBeChecked();
    const strain = waits.getByRole('checkbox', {
      name: 'Strain the gravy into a jug (already waits for this step)',
    });
    await expect(strain).toBeDisabled();
    await expect(strain).not.toBeChecked();
    // The step itself is not an option.
    await expect(waits.getByRole('checkbox', { name: /Make a roux/ })).toHaveCount(0);
  });

  test('R4.5 R4.10 an unknown prerequisite shows checked; unchecking it enables Make the plan', async ({
    page,
  }) => {
    await openSteps(page, BROKEN_ROAST);
    await card(page, 'gravy.roux').getByRole('button', { name: 'Edit' }).click();
    const unknown = page.getByRole('checkbox', { name: 'chicken.rost (not a step in this plan)' });
    await expect(unknown).toBeChecked();
    await expect(page.getByRole('button', { name: 'Make the plan' })).toBeDisabled();
    // Its option goes away once it is cleared, so click rather than uncheck.
    await unknown.click();
    await expect(unknown).toHaveCount(0);
    await expect(page.getByText('No issues.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make the plan' })).toBeEnabled();
  });
});

test.describe('add and remove', () => {
  test('R4.7 removing Roast the chicken asks naming the two steps; Keep step changes nothing; Remove step announces the notice', async ({
    page,
  }) => {
    await openSteps(page);
    const roast = card(page, 'chicken.roast');
    await roast.getByRole('button', { name: 'Remove step' }).click();
    await expect(roast).toContainText(
      'Remove \u201cRoast the chicken\u201d? 2 steps wait for it: Rest the chicken under foil, Make a roux in the roasting tin. They will no longer wait for it.',
    );

    await roast.getByRole('button', { name: 'Keep step' }).click();
    await expect(roast.getByRole('button', { name: 'Keep step' })).toHaveCount(0);
    await expect(roast).toContainText('Waits for: Season and truss the chicken');
    await expect(roast.getByRole('button', { name: 'Remove step' })).toBeFocused();
    await expect(page.getByRole('status')).toHaveText('');

    await roast.getByRole('button', { name: 'Remove step' }).click();
    await roast.getByRole('button', { name: 'Remove step' }).click();
    await expect(card(page, 'chicken.roast')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(
      'Removed \u201cRoast the chicken\u201d. Rest the chicken under foil, Make a roux in the roasting tin no longer wait for it.',
    );
    await expect(card(page, 'chicken.rest')).toContainText('Waits for nothing');
  });

  test('R4.6 R4.8 adding a dish Crème brûlée creates its section with a New step creme-brulee.step-1', async ({
    page,
  }) => {
    await openSteps(page);
    await page.getByRole('button', { name: 'Add a dish' }).click();
    await page.getByLabel('Dish name', { exact: true }).fill('Crème brûlée');
    await page.getByRole('button', { name: 'Add dish' }).click();
    const section = dish(page, 'Crème brûlée');
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { level: 3 })).toHaveText('New step');
    await expect(card(page, 'creme-brulee.step-1')).toContainText('creme-brulee.step-1');
    // The new step opens for editing with focus in its title.
    await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  });

  test('R4.6 a blank dish name shows the field error', async ({ page }) => {
    await openSteps(page);
    await page.getByRole('button', { name: 'Add a dish' }).click();
    await page.getByRole('button', { name: 'Add dish' }).click();
    await expect(page.getByText('Give the dish a name.', { exact: true })).toBeVisible();
  });

  test('R4.6 renaming a dish keeps its ids', async ({ page }) => {
    await openSteps(page);
    await dish(page, 'Gravy').getByRole('button', { name: 'Rename dish' }).click();
    await page.getByLabel('Dish name', { exact: true }).fill('Pan gravy');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(dish(page, 'Pan gravy')).toBeVisible();
    await expect(card(page, 'gravy.roux')).toBeVisible();
  });

  test('R4.6 Add a step adds a New step to the dish and opens it', async ({ page }) => {
    await openSteps(page);
    await dish(page, 'Gravy').getByRole('button', { name: 'Add a step' }).click();
    await expect(card(page, 'gravy.step-1')).toContainText('New step');
    await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  });

  test('R4.6 removing a dish asks and then removes its steps', async ({ page }) => {
    await openSteps(page);
    const greens = dish(page, 'Spring greens');
    await greens.getByRole('button', { name: 'Remove dish' }).click();
    await expect(greens).toContainText('Remove the dish Spring greens and its 3 steps?');
    await greens.getByRole('button', { name: 'Remove dish' }).click();
    await expect(dish(page, 'Spring greens')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText('Removed the dish Spring greens.');
  });

  test('R4.8 the last step cannot be removed and says why', async ({ page }) => {
    const only: Plan = {
      title: 'One step',
      dishes: [{ id: 'toast', name: 'Toast' }],
      steps: [
        {
          id: 'toast.make',
          dish: 'toast',
          title: 'Make toast',
          minutes: 3,
          appliance: 'none',
          handsOn: true,
          after: [],
          holdMin: null,
        },
      ],
    };
    await openSteps(page, only);
    const remove = card(page, 'toast.make').getByRole('button', { name: 'Remove step' });
    await expect(remove).toBeDisabled();
    await expect(card(page, 'toast.make')).toContainText('A plan needs at least one step.');
    await expect(dish(page, 'Toast').getByRole('button', { name: 'Remove dish' })).toBeDisabled();
    await expect(dish(page, 'Toast')).toContainText('A plan needs at least one dish.');
  });
});
