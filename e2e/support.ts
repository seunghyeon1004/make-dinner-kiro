import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
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

/**
 * Fixes `Date.now()` at `iso` (a UTC instant on the fixed day; London is on GMT then) for the
 * cooking-mode flows. Timers keep running: a paused clock (`install` + `pauseAt`) also freezes
 * `requestAnimationFrame`, which Preact uses to run `useEffect`, so the screen would never
 * update after a tap. The app re-reads the time at most a second after it moves.
 */
export async function fixClockAt(page: Page, iso: string): Promise<void> {
  await page.clock.setFixedTime(new Date(iso));
}

/** Moves the fixed time forward by `ms`; the screen catches up at its next one-second read. */
export async function advanceClock(page: Page, ms: number): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + ms));
}

/** Sunday roast for 19:30 on Wed 2026-11-11, "Start cooking" tapped at `iso`. */
export async function cookAt(
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

export const dock = (page: Page) => page.getByRole('region', { name: 'Actions' });

/** CM-c up to the shred: prep done, the roast and the shred started 17:50, the shred done 17:55. */
export async function tapToCmF(page: Page): Promise<void> {
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

/**
 * Cooks a whole dinner on time: taps every Start and every Done whose time has come, else moves
 * the fixed clock to the earliest of the next Up next time and the running timers. Stops at
 * "Dinner is served".
 */
export async function cookUntilServed(page: Page, afterEach?: () => Promise<void>): Promise<void> {
  const served = page.getByRole('heading', { name: 'Dinner is served' });
  for (let guard = 0; guard < 400; guard += 1) {
    if (await served.isVisible()) return;
    const step = await page.evaluate(() => {
      const parse = (text: string): number => {
        const [m, s] = text.replace('+', '').split(':').map(Number);
        return ((m ?? 0) * 60 + (s ?? 0)) * (text.startsWith('+') ? -1000 : 1000);
      };
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[id^="act-"]')];
      const usable = (button: HTMLButtonElement, want: string): boolean => {
        const match = /^act-(.+)-(start|done)$/.exec(button.id);
        if (match === null || match[2] !== want) return false;
        const card = document.getElementById(`card-${match[1]}`)?.parentElement;
        if (want === 'start') return card?.querySelector('.cook-card__warn') == null;
        const text = card?.querySelector('[role="timer"]')?.textContent ?? '';
        return text === '' || text.startsWith('+') || text === '00:00';
      };
      // Finish what is finished before starting what waits for it.
      const next =
        buttons.find((b) => usable(b, 'done')) ?? buttons.find((b) => usable(b, 'start'));
      if (next !== undefined) {
        next.click();
        return { clicked: true, waitMs: 0 };
      }
      const waits: number[] = [];
      for (const time of document.querySelectorAll<HTMLTimeElement>('time[datetime]')) {
        waits.push(Date.parse(time.dateTime) - Date.now());
      }
      for (const timer of document.querySelectorAll('[role="timer"]')) {
        waits.push(parse(timer.textContent ?? ''));
      }
      const positive = waits.filter((ms) => ms > 0);
      return { clicked: false, waitMs: positive.length === 0 ? 0 : Math.min(...positive) };
    });
    if (step.clicked) {
      await page.waitForTimeout(60);
      await afterEach?.();
      continue;
    }
    expect(step.waitMs, 'something to wait for').toBeGreaterThan(0);
    await advanceClock(page, step.waitMs);
    await page.waitForTimeout(1100);
  }
  throw new Error(
    `cookUntilServed did not finish the dinner:\n${await page.locator('main').innerText()}`,
  );
}

/** What the fakes of `fakeWakeLock` and `fakeAudio` recorded in the page. */
export interface CookFakes {
  wakeRequests: number;
  wakeReleases: number;
  audioContexts: number;
  oscillators: { frequency: number; start: number }[];
  resumed: number;
  vibrations: number[][];
}

/** Replaces `navigator.wakeLock` before the app boots; calls are counted in `window.__cookFakes`. */
export async function fakeWakeLock(page: Page, mode: 'grant' | 'refuse' | 'none'): Promise<void> {
  await page.addInitScript((how) => {
    const w = window as unknown as { __cookFakes: Record<string, unknown> };
    const fakes = (w.__cookFakes ??= {}) as Record<string, number>;
    fakes['wakeRequests'] = 0;
    fakes['wakeReleases'] = 0;
    if (how === 'none') {
      Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
      return;
    }
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          fakes['wakeRequests'] = (fakes['wakeRequests'] ?? 0) + 1;
          if (how === 'refuse') throw new DOMException('refused', 'NotAllowedError');
          const listeners: (() => void)[] = [];
          const release = async (): Promise<void> => {
            fakes['wakeReleases'] = (fakes['wakeReleases'] ?? 0) + 1;
            for (const listener of listeners) listener();
          };
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void release();
          });
          return { release, addEventListener: (_t: string, l: () => void) => listeners.push(l) };
        },
      },
    });
  }, mode);
}

/** Pretends the page is hidden or visible again and fires `visibilitychange`. */
export async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

export async function cookFakes(page: Page): Promise<CookFakes> {
  return page.evaluate(() => (window as unknown as { __cookFakes: CookFakes }).__cookFakes);
}

/** Replaces `AudioContext` and `navigator.vibrate` before the app boots; calls land in `window.__cookFakes`. */
export async function fakeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cookFakes: Record<string, unknown> };
    const fakes = (w.__cookFakes ??= {}) as Record<string, unknown>;
    fakes['audioContexts'] = 0;
    fakes['resumed'] = 0;
    fakes['oscillators'] = [];
    fakes['vibrations'] = [];
    class FakeContext {
      currentTime = 0;
      destination = {};
      constructor() {
        fakes['audioContexts'] = (fakes['audioContexts'] as number) + 1;
      }
      async resume(): Promise<void> {
        fakes['resumed'] = (fakes['resumed'] as number) + 1;
      }
      createGain() {
        return {
          gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
          connect() {},
        };
      }
      createOscillator() {
        const osc = {
          type: '',
          frequency: { value: 0 },
          connect() {},
          start(when: number) {
            (fakes['oscillators'] as unknown[]).push({
              frequency: osc.frequency.value,
              start: when,
            });
          },
          stop() {},
        };
        return osc;
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeContext, configurable: true });
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number[]) => {
        (fakes['vibrations'] as unknown[]).push(pattern);
        return true;
      },
    });
  });
}
