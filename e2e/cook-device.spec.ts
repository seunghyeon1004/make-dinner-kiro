import { expect, test } from '@playwright/test';
import {
  advanceClock,
  cookAt,
  cookFakes,
  cookUntilServed,
  dock,
  fakeAudio,
  fakeWakeLock,
  setVisibility,
  tapToCmF,
} from './support.js';

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

const NOTE = /The screen may turn off while you cook\./;

test.describe('Wake lock (CM6.1, CM6.2)', () => {
  test('CM6.1 grant: one request on entry, another after hidden then visible, a release on going to Plan', async ({
    page,
  }) => {
    await fakeWakeLock(page, 'grant');
    await cookAt(page, '2026-11-11T17:40:00Z');
    await expect.poll(async () => (await cookFakes(page)).wakeRequests).toBe(1);
    await expect(page.getByText(NOTE)).toBeHidden();

    await setVisibility(page, 'hidden');
    await expect.poll(async () => (await cookFakes(page)).wakeReleases).toBe(1);
    await setVisibility(page, 'visible');
    await expect.poll(async () => (await cookFakes(page)).wakeRequests).toBe(2);

    await page.evaluate(() => {
      window.location.hash = '#/plan';
    });
    await expect(page.getByRole('link', { name: 'Continue cooking' })).toBeVisible();
    await expect.poll(async () => (await cookFakes(page)).wakeReleases).toBe(2);
  });

  for (const mode of ['refuse', 'none'] as const) {
    test(`CM6.2 ${mode}: the note is shown and no error text`, async ({ page }) => {
      await fakeWakeLock(page, mode);
      await cookAt(page, '2026-11-11T17:40:00Z');
      await expect(page.getByText(NOTE)).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByText(/error|failed|denied/i)).toHaveCount(0);
    });
  }

  test('CM6.1 CM8.1 the wake lock is released when dinner is served', async ({ page }) => {
    test.setTimeout(120_000);
    await fakeWakeLock(page, 'grant');
    await cookAt(page, '2026-11-11T17:40:00Z');
    await cookUntilServed(page);
    await expect.poll(async () => (await cookFakes(page)).wakeReleases).toBeGreaterThanOrEqual(1);
    const fakes = await cookFakes(page);
    expect(fakes.wakeRequests).toBe(1);
  });
});

test.describe('Alerts (CM4.2 to CM4.4, CM9.4)', () => {
  const OFF = /Turn on to hear a chime and feel a buzz when a timer ends\./;

  test('CM4.4 CM4.3 off at first; a tap turns it on in the tap; at 19:05 one announcement, two beeps and the buzz', async ({
    page,
  }) => {
    await fakeAudio(page);
    await cookAt(page, '2026-11-11T17:40:00Z');
    await tapToCmF(page);
    const toggle = page.getByRole('button', { name: /Sound and vibration/ });
    await expect(page.getByText(OFF)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/A chime and a buzz play when a timer ends\./)).toBeVisible();
    const afterTap = await cookFakes(page);
    expect([afterTap.audioContexts, afterTap.resumed]).toEqual([1, 1]);
    expect(afterTap.oscillators).toEqual([]);

    const live = page.getByRole('status');
    await advanceClock(page, 70 * 60_000); // 17:55 -> 19:05
    await expect(live).toHaveText('Time is up: Roast the chicken.');
    const fakes = await cookFakes(page);
    expect(fakes.oscillators.map((o) => o.frequency)).toEqual([880, 880]);
    expect(fakes.oscillators[1]!.start - fakes.oscillators[0]!.start).toBeCloseTo(0.25, 5);
    expect(fakes.vibrations).toEqual([[200, 100, 200]]);

    // Seconds later with no new event: nothing more is played or announced.
    await page.waitForTimeout(2200);
    expect((await cookFakes(page)).oscillators).toHaveLength(2);
    await expect(live).toHaveText('Time is up: Roast the chicken.');
  });

  test('CM4.4 after a reload the toggle says one more tap is needed', async ({ page }) => {
    await fakeAudio(page);
    await cookAt(page, '2026-11-11T17:40:00Z');
    await page.getByRole('button', { name: /Sound and vibration/ }).click();
    await expect(page.getByText(/A chime and a buzz play/)).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Sound was on before the page reloaded. Tap once to turn it on again.'),
    ).toBeVisible();
    await expect(dock(page)).toBeVisible();
  });
});
