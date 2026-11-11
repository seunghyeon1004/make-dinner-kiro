import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schedule } from '../../../src/core/index.js';
import { planListGroups } from '../../../src/web/components/plan-list-items.js';
import { scheduleView } from '../../../src/web/state/schedule-view.js';
import { arbPlanAndKitchen } from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';

const original = process.env['TZ'];
const CHOSEN_MS = Date.parse('2026-11-11T19:30:00Z');

describe('plan list properties', () => {
  beforeAll(() => {
    process.env['TZ'] = 'Europe/London';
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
  });
  afterAll(() => {
    if (original === undefined) delete process.env['TZ'];
    else process.env['TZ'] = original;
  });

  it('P-UI4 every step once, ordered by start then id, group minutes strictly increasing', () => {
    fc.assert(
      fc.property(arbPlanAndKitchen(), ({ plan, kitchen }) => {
        const result = schedule(plan, kitchen);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const groups = planListGroups(scheduleView(result.value), CHOSEN_MS, 'en-GB');

        // Oracle: plain loops over the schedule's own start minutes.
        const startOf = new Map(result.value.steps.map((s) => [s.id, s.startMin]));
        const listed = groups.flatMap((g) =>
          g.items.map((i) => ({ id: i.stepId, minute: g.minute })),
        );

        expect(listed.map((x) => x.id).sort()).toEqual(plan.steps.map((s) => s.id).sort());
        for (const item of listed) expect(item.minute).toBe(startOf.get(item.id));
        for (let i = 1; i < listed.length; i += 1) {
          const a = listed[i - 1];
          const b = listed[i];
          if (a === undefined || b === undefined) throw new Error('index');
          expect(a.minute < b.minute || (a.minute === b.minute && a.id < b.id)).toBe(true);
        }
        for (let i = 1; i < groups.length; i += 1) {
          expect(groups[i - 1]?.minute).toBeLessThan(groups[i]?.minute ?? Number.NaN);
        }
      }),
      fcParams(),
    );
  });
});
