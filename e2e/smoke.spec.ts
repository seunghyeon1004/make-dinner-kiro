import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Expected page background per colour scheme: --color-bg from ui.md, as computed rgb().
const EXPECTED_BACKGROUND = {
  light: 'rgb(246, 241, 231)', // #F6F1E7
  dark: 'rgb(26, 24, 22)', // #1A1816
} as const;

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`smoke, ${colorScheme} colour scheme`, () => {
    test.use({ colorScheme });

    test('the page loads and shows the Make Dinner heading', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle('Make Dinner');
      await expect(page.getByRole('heading', { level: 1, name: 'Make Dinner' })).toBeVisible();
    });

    test('the page uses the --color-bg token of this colour scheme', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        EXPECTED_BACKGROUND[colorScheme],
      );
    });

    test('axe finds zero violations (wcag2a, wcag2aa, wcag21aa)', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Make Dinner' })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
