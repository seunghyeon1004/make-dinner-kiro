import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServeTime } from '../../../src/core/index.js';
import { clockAt, minuteAt, resolveServing, toServeTime } from '../../../src/web/state/clock.js';
import { arbServeTime } from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';

const HOUR = 3_600_000;
const original = process.env['TZ'];

describe('clock properties under Europe/London', () => {
  beforeAll(() => {
    process.env['TZ'] = 'Europe/London';
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
  });
  afterAll(() => {
    if (original === undefined) delete process.env['TZ'];
    else process.env['TZ'] = original;
  });

  const arbNowMs = fc.integer({
    min: Date.UTC(2026, 0, 1),
    max: Date.UTC(2027, 11, 31),
  });

  it('P-UI5 minuteAt inverts clockAt for every integer minute', () => {
    fc.assert(
      fc.property(
        arbNowMs,
        fc.integer({ min: -2000, max: 2000 }),
        (chosenMs, minute) => minuteAt(chosenMs, clockAt(chosenMs, minute)) === minute,
      ),
      fcParams(),
    );
  });

  it('P-UI5 resolveServing lies in [now - 4 h, now + 21 h] and keeps the clock time outside DST gaps', () => {
    fc.assert(
      fc.property(arbNowMs, arbServeTime(), (nowMs, time) => {
        const result = resolveServing(time as ServeTime, nowMs);
        expect(result).toBeGreaterThanOrEqual(nowMs - 4 * HOUR);
        expect(result).toBeLessThanOrEqual(nowMs + 21 * HOUR);
        const nearChange =
          new Date(result - 3 * HOUR).getTimezoneOffset() !==
          new Date(result + 3 * HOUR).getTimezoneOffset();
        if (!nearChange) expect(toServeTime(result)).toBe(time);
      }),
      fcParams(),
    );
  });
});
