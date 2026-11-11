import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { TWO_COOK_KITCHEN } from '../test/support/fixtures.js';
import {
  advanceClock,
  cookAt,
  cookUntilServed,
  dock,
  expectNoAxeViolations,
  expectNoPageScroll,
  fakeWakeLock,
  tapToCmF,
} from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

const START = '2026-11-11T17:40:00Z';

/** CM-c: the roast got +15 min at 18:30, the log and its up-to-date list open. */
async function cmC(page: Page): Promise<void> {
  await cookAt(page, START);
  await tapToCmF(page);
  await advanceClock(page, 35 * 60_000);
  await page
    .getByRole('region', { name: 'Roast the chicken' })
    .getByRole('group', { name: 'Needs more time' })
    .getByRole('button', { name: '+15 min' })
    .click();
  await page.getByRole('button', { name: /steps that are up to date/ }).click();
}

const STATES: Record<string, (page: Page) => Promise<void>> = {
  countdown: (page) => cookAt(page, '2026-11-11T17:30:00Z'),
  'CM-c with the log open': cmC,
  'two cooks (CM-i)': (page) => cookAt(page, START, TWO_COOK_KITCHEN),
  'blocked start confirm': async (page) => {
    await cookAt(page, START);
    await tapToCmF(page);
    await advanceClock(page, 75 * 60_000);
    await expect(dock(page).getByText('Make a roux in the roasting tin')).toBeVisible();
    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    await expect(dock(page).getByRole('button', { name: 'Start anyway' })).toBeVisible();
  },
  finished: async (page) => {
    test.setTimeout(120_000);
    await cookAt(page, START);
    await cookUntilServed(page);
  },
  stale: async (page) => {
    await cmC(page);
    await advanceClock(page, 9 * 60 * 60_000);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Carry on with this dinner?' })).toBeVisible();
  },
  'too late': async (page) => {
    await cookAt(page, '2026-11-13T19:30:00Z').catch(() => undefined);
    await expect(page.getByText(/too long ago to cook against/)).toBeVisible();
  },
  'wake lock note': async (page) => {
    await fakeWakeLock(page, 'none');
    await cookAt(page, START);
    await expect(page.getByText(/The screen may turn off/)).toBeVisible();
  },
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Cook screen, ${scheme} (CM9.1 to CM9.3, CM10.3)`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, setup] of Object.entries(STATES)) {
      test(`CM10.3 axe finds nothing in: ${name}`, async ({ page }) => {
        await setup(page);
        await expectNoAxeViolations(page);
      });
    }
  });
}

test.describe('Targets and focus (CM3.5, CM3.6, CM9.3)', () => {
  test('CM3.5 CM3.6 every button is at least 48x48, the primaries 64 tall, the dock primary in the bottom third', async ({
    page,
  }) => {
    await cmC(page);
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('main button, main a.button')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const box = el.getBoundingClientRect();
          return {
            name: (el.textContent ?? '').trim().slice(0, 40),
            w: box.width,
            h: box.height,
            primary:
              el.classList.contains('button--primary') ||
              /^(\+\d+ min|I'm behind)/.test(el.textContent ?? ''),
          };
        }),
    );
    expect(sizes.length).toBeGreaterThan(3);
    for (const s of sizes) {
      expect(s.w, `${s.name} width`).toBeGreaterThanOrEqual(48);
      expect(s.h, `${s.name} height`).toBeGreaterThanOrEqual(48);
      if (s.primary) expect(s.h, `${s.name} height`).toBeGreaterThanOrEqual(64);
    }
  });

  test('CM3.6 at 17:40 the dock primary starts below two thirds of the 844 px viewport', async ({
    page,
  }) => {
    await cookAt(page, START);
    const box = await dock(page).getByRole('button', { name: 'Start', exact: true }).boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((844 * 2) / 3);
  });

  test('CM9.3 focus goes to Done after Start, to the next card heading after Done, and to the restored button after Undo', async ({
    page,
  }) => {
    await cookAt(page, START);
    await dock(page).getByRole('button', { name: 'Start', exact: true }).click();
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeFocused();
    await advanceClock(page, 10 * 60_000);
    await expect(page.getByRole('timer').first()).toHaveText('00:00');
    await dock(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator(':focus')).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await dock(page).getByRole('button', { name: /^Undo/ }).click();
    await expect(dock(page).getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  });
});

test.describe('Zoom, landscape and motion (CM9.1, CM9.5)', () => {
  const dockInView = async (page: Page, height: number): Promise<void> => {
    const box = await dock(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
  };

  test('CM9.5 CM-c at 195 px wide (200% zoom on a phone) never scrolls sideways and the dock is in view', async ({
    page,
  }) => {
    await cmC(page);
    await page.setViewportSize({ width: 195, height: 844 });
    await expectNoPageScroll(page);
    await dockInView(page, 844);
  });

  test('CM9.5 CM-c in landscape at 844x390 never scrolls sideways and the dock is in view', async ({
    page,
  }) => {
    await cmC(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expectNoPageScroll(page);
    await dockInView(page, 390);
  });

  test('CM9.1 the countdown is 56 px monospace with tabular numbers at 390 px', async ({
    page,
  }) => {
    await cookAt(page, '2026-11-11T17:30:00Z');
    const style = await page
      .getByRole('timer', { name: 'Time until cooking starts' })
      .evaluate((el) => {
        const css = getComputedStyle(el);
        return { size: css.fontSize, tabular: css.fontVariantNumeric, family: css.fontFamily };
      });
    expect(Number.parseFloat(style.size)).toBeCloseTo(56, 1);
    expect(style.tabular).toContain('tabular-nums');
    expect(style.family).toContain('monospace');
  });

  test.describe('reduced motion', () => {
    test('CM9.5 no element has a running transition or animation', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await cmC(page);
      const running = await page.evaluate(
        () =>
          [...document.querySelectorAll('*')].filter((el) => {
            const css = getComputedStyle(el);
            const seconds = (list: string): number =>
              Math.max(...list.split(',').map((t) => Number.parseFloat(t) || 0));
            return seconds(css.transitionDuration) > 0 || seconds(css.animationDuration) > 0;
          }).length,
      );
      expect(running).toBe(0);
    });
  });
});
