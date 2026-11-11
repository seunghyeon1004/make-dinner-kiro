import { expect, test } from '@playwright/test';
import { SUNDAY_ROAST_DINNERFILE } from '../test/support/fixtures.js';
import { FIXED_NOW } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

const WITH_LINES = `${SUNDAY_ROAST_DINNERFILE}# kitchen burners=4 ovens=1 cooks=1\n# serve 19:30\n`;
const WITH_DOLLAR = `${SUNDAY_ROAST_DINNERFILE}$(X)\n`;
/** The Shred step moved to a dish that the file does not declare. */
const WITH_GHOST_DISH = SUNDAY_ROAST_DINNERFILE.replace(
  '# step dish=greens minutes=5 appliance=none handsOn=true hold=keeps title="Shred',
  '# step dish=ghost minutes=5 appliance=none handsOn=true hold=keeps title="Shred',
);

test.describe('open a Dinnerfile', () => {
  test('R3.2 R3.5 pasting a Dinnerfile with kitchen and serve lines opens Plan', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Dinnerfile text').fill(WITH_LINES);
    await page.getByRole('button', { name: 'Open Dinnerfile' }).click();
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
    await expect(page.getByText('Start at 17:40')).toBeVisible();
    await expect(page.getByText('Serve at 19:30')).toBeVisible();
  });

  test('R3.3 a $(X) line lists its error; "Show line 57" selects exactly that line', async ({
    page,
  }) => {
    await page.goto('/');
    const area = page.getByLabel('Dinnerfile text');
    await area.fill(WITH_DOLLAR);
    await page.getByRole('button', { name: 'Open Dinnerfile' }).click();
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(
      page.getByText('This Dinnerfile could not be read. Fix these lines and open it again.'),
    ).toBeVisible();
    await expect(page.getByText(/^Line 57: Make Dinner reads only comments/)).toBeVisible();

    await page.getByRole('button', { name: 'Show line 57' }).click();
    const lines = WITH_DOLLAR.split('\n');
    const start = lines.slice(0, 56).reduce((sum, line) => sum + line.length + 1, 0);
    expect(lines[56]).toBe('$(X)');
    await expect(area).toBeFocused();
    const selection = await area.evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    expect(selection).toEqual([start, start + 4]);
  });

  test('R3.1 a chosen file is put into the text area and opened', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open a Dinnerfile from this device').setInputFiles({
      name: 'Dinnerfile',
      mimeType: 'text/plain',
      buffer: Buffer.from(WITH_LINES),
    });
    await expect(page).toHaveURL(/#\/plan$/);
    await expect(page.getByText('Start at 17:40')).toBeVisible();
  });

  test('R3.1 a file of 1 MB and one byte shows the too-large copy and opens nothing', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Open a Dinnerfile from this device').setInputFiles({
      name: 'Dinnerfile',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(1_048_577, 97),
    });
    await expect(
      page.getByText('This file is over 1 MB, so it is not a Dinnerfile from this app.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/menu$/);
    await expect(page.getByLabel('Dinnerfile text')).toHaveValue('');
  });

  test('R2.8 the pasted text survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Dinnerfile text').fill(WITH_DOLLAR);
    await page.reload();
    await expect(page.getByLabel('Dinnerfile text')).toHaveValue(WITH_DOLLAR);
  });

  test('R3.4 a plan with an error opens Steps; a step with no dish can be given one', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Dinnerfile text').fill(WITH_GHOST_DISH);
    await page.getByRole('button', { name: 'Open Dinnerfile' }).click();
    await expect(page).toHaveURL(/#\/steps$/);
    const orphans = page.getByRole('region', { name: 'Steps with no dish' });
    await expect(
      orphans.getByRole('heading', { level: 3, name: 'Shred the greens' }),
    ).toBeVisible();
    await expect(orphans).toContainText(
      "Step greens.shred belongs to dish ghost, which is not in this plan. Pick one of the plan's dishes.",
    );
    await expect(page.getByRole('button', { name: 'Make the plan' })).toBeDisabled();

    await orphans.getByRole('button', { name: 'Edit' }).click();
    await orphans.getByLabel('Dish').selectOption({ label: 'Spring greens' });
    await expect(page.getByRole('region', { name: 'Steps with no dish' })).toHaveCount(0);
    await expect(page.getByText('No issues.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make the plan' })).toBeEnabled();
  });
});
