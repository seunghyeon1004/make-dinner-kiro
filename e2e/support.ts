import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Kitchen, Plan, ServeTime } from '../src/core/index.js';

/** The key `src/web/state/persist.ts` stores the dinner under. */
const STATE_KEY = 'make-dinner:state';

/** The fixed clock of the flows: Wednesday 2026-11-11, 17:00 in London (GMT, so UTC). */
export const FIXED_NOW = '2026-11-11T17:00:00Z';

/**
 * Writes a persisted state before the app boots, once per browser context: a reload keeps
 * what the app stored. `serve` is a clock time on the fixed day; London is on GMT then.
 */
export async function seedDinner(
  page: Page,
  plan: Plan,
  kitchen: Kitchen,
  serve: ServeTime | null,
  route: 'menu' | 'steps' | 'plan' = 'plan',
): Promise<void> {
  const state = {
    version: 1,
    route,
    theme: 'system',
    dinner: {
      plan,
      source: { kind: 'sample', sampleId: 'sunday-roast' },
      kitchen,
      serving: serve === null ? null : { time: serve, atMs: Date.parse(`2026-11-11T${serve}:00Z`) },
    },
    recipeText: '',
    dinnerfileText: '',
    cook: null,
  };
  await page.addInitScript(
    ({ key, value }) => {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
    },
    { key: STATE_KEY, value: JSON.stringify(state) },
  );
}

/** Axe with the three WCAG tag sets of testing.md; zero violations is the pass condition. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** The page never scrolls sideways (R6.9): the root's scroll width fits its client width. */
export async function expectNoPageScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

/** Answers `POST /api/parse` with a fixed status, JSON body and headers; the request body is returned. */
export async function fakeParse(
  page: Page,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ lastBody: () => unknown }> {
  let last: unknown = null;
  await page.route('**/api/parse', async (route) => {
    last = route.request().postDataJSON();
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });
  });
  return { lastBody: () => last };
}

/** A parse error body as the server sends it (tech.md). */
export function parseError(code: string): { error: { code: string; message: string } } {
  return { error: { code, message: 'Plain English from the server.' } };
}

/**
 * On a phone the theme switch and "Start over" sit behind the "Settings" button; on a wide
 * screen they are inline and the button is not shown. Opens the panel when it is closed.
 */
export async function openSettings(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Settings' });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}
