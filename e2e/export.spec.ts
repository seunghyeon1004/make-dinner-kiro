import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST, SUNDAY_ROAST_DINNERFILE } from '../test/support/fixtures.js';
import { FIXED_NOW, seedDinner } from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

/** SUNDAY_ROAST_DINNERFILE with the two lines the export adds after "# plan" (core: toDinnerfile). */
const EXPORTED = SUNDAY_ROAST_DINNERFILE.replace(
  '# plan "Sunday roast"\n',
  '# plan "Sunday roast"\n# kitchen burners=4 ovens=1 cooks=1\n# serve 19:30\n',
);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30');
});

test.describe('export: Dinnerfile', () => {
  test('R8.1 the Plan screen offers Dinnerfile, Share link and Print', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Dinnerfile', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  });

  test('R8.2 "Dinnerfile" opens a panel with the exported text and the make line', async ({
    page,
  }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Dinnerfile', exact: true });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('region', { name: 'Dinnerfile' });
    expect(await panel.locator('pre').textContent()).toBe(EXPORTED);
    await expect(
      panel.getByText(
        'Run make -n -f Dinnerfile dinner to see GNU Make print the steps in an order that works.',
      ),
    ).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveCount(0);
  });

  test('R8.2 "Download" gives a plain-text file named Dinnerfile with the same text', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dinnerfile', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Dinnerfile');
    const path = await file.path();
    expect(await readFile(path, 'utf8')).toBe(EXPORTED);
  });

  test('R8.2 "Copy" with clipboard permission puts the text on the clipboard and says so', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.getByRole('button', { name: 'Dinnerfile', exact: true }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByText('Copied the Dinnerfile.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(EXPORTED);
  });

  test('R8.7 "Copy" when the clipboard refuses says so and selects the text', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
        configurable: true,
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Dinnerfile', exact: true }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(
      page.getByText(
        "Could not copy. The text is selected; copy it with your device's copy command.",
      ),
    ).toBeVisible();
    // Selection.toString() leaves out the pre's closing line break.
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(EXPORTED.trimEnd());
  });
});

test.describe('print layout (R8.8)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`R8.8 print shows only the title, summary, plan list and Dinnerfile, black on white (${scheme})`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Dinnerfile', exact: true }).click();
      await expect(page.locator('main pre')).toHaveCount(2);
      // On screen the print-only Dinnerfile is not shown.
      await expect(page.locator('pre.print-only')).toBeHidden();

      await page.emulateMedia({ media: 'print', colorScheme: scheme });

      // Exactly these four blocks of the screen are visible, and nothing outside the screen.
      const shown = await page.evaluate(() => {
        const visible = (parent: Element | null): string[] =>
          [...(parent?.children ?? [])]
            .filter((el) => getComputedStyle(el).display !== 'none')
            .map((el) => el.tagName + (el.id === '' ? '' : `#${el.id}`));
        return {
          app: visible(document.querySelector('.app')),
          main: visible(document.querySelector('main')),
        };
      });
      expect(shown).toEqual({ app: ['MAIN'], main: ['H1', 'DIV', 'SECTION#plan-list', 'PRE'] });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sunday roast');
      await expect(page.locator('.summary')).toContainText('Start at 17:40');
      await expect(page.locator('.summary')).toContainText('Serve at 19:30');
      expect(await page.locator('pre.print-only').textContent()).toBe(EXPORTED);
      await expect(page.locator('header')).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Dinner' })).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Kitchen' })).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Timeline' })).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Take the plan with you' })).toBeHidden();
      await expect(page.getByRole('region', { name: 'Dinnerfile' })).toBeHidden();

      // Black on white for every visible element, in both colour schemes.
      const colours = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll(
          'main h1, main .summary, main .summary *, #plan-list, #plan-list *, pre.print-only',
        )) {
          const style = getComputedStyle(el);
          if (style.color !== 'rgb(0, 0, 0)') bad.push(`${el.tagName} color ${style.color}`);
          if (style.backgroundColor !== 'rgb(255, 255, 255)') {
            bad.push(`${el.tagName} background ${style.backgroundColor}`);
          }
        }
        return bad;
      });
      expect(colours).toEqual([]);
    });
  }
});
