import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../test/support/fixtures.js';
import { seedDinner } from './support.js';

// N2: on a phone the largest sample's timeline shows within 1 s of the tap, and a stepper tap
// updates the list within 200 ms. Times are taken in the page with performance.now(), from
// the click to the first frame in which the condition holds. These run on the real clock, on
// both projects (the task names the phone project; the desktop is faster).
test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

interface SampleSummary {
  title: string;
  plan: { steps: unknown[] };
}

/** Clicks the element in the page and waits for `condition`; resolves with the elapsed ms. */
async function timedClick(
  page: Page,
  selector: string,
  index: number,
  condition: 'timeline' | 'list-changed',
): Promise<number> {
  return page.evaluate(
    ({ selector, index, condition }) =>
      new Promise<number>((resolve, reject) => {
        const target = document.querySelectorAll<HTMLElement>(selector)[index];
        if (target === undefined) {
          reject(new Error(`no element ${selector}[${index}]`));
          return;
        }
        const before = document.getElementById('plan-list')?.innerText ?? '';
        const started = performance.now();
        target.click();
        const poll = (): void => {
          const done =
            condition === 'timeline'
              ? (() => {
                  const box = document.querySelector('.timeline .bar')?.getBoundingClientRect();
                  return box !== undefined && box.width > 0 && box.height > 0;
                })()
              : (document.getElementById('plan-list')?.innerText ?? '') !== before;
          if (done) resolve(performance.now() - started);
          else if (performance.now() - started > 5000)
            reject(new Error('condition not met in 5 s'));
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }),
    { selector, index, condition },
  );
}

test.describe('speed (N2)', () => {
  test('N2 the largest sample shows its timeline within 1 s of the tap', async ({ page }) => {
    const response = await page.request.get('/api/samples');
    const body = (await response.json()) as { samples: SampleSummary[] };
    const sizes = body.samples.map((s) => s.plan.steps.length);
    const largest = sizes.indexOf(Math.max(...sizes));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Plan this dinner' })).toHaveCount(
      body.samples.length,
    );
    const elapsed = await timedClick(page, 'button.button--primary', largest, 'timeline');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      body.samples[largest]?.title ?? '',
    );
    test.info().annotations.push({ type: 'elapsed ms', description: elapsed.toFixed(1) });
    expect(elapsed).toBeLessThan(1000);
  });

  test('N2 a stepper tap updates the plan list within 200 ms', async ({ page }) => {
    await seedDinner(page, SUNDAY_ROAST, { ...HOME_KITCHEN, burners: 2 }, '19:30');
    await page.goto('/');
    await expect(page.locator('#plan-list')).toContainText('Make a roux in the roasting tin');
    const elapsed = await timedClick(page, 'button[aria-label="Fewer burners"]', 0, 'list-changed');
    test.info().annotations.push({ type: 'elapsed ms', description: elapsed.toFixed(1) });
    expect(elapsed).toBeLessThan(200);
  });
});
