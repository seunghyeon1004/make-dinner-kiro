import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schedule } from '../../../src/core/index.js';
import { layoutTimeline } from '../../../src/web/components/timeline-layout.js';
import { scheduleView } from '../../../src/web/state/schedule-view.js';
import { arbPlanAndKitchen } from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';

const original = process.env['TZ'];
const CHOSEN_MS = Date.parse('2026-11-11T19:30:00Z');

describe('timeline layout properties', () => {
  beforeAll(() => {
    process.env['TZ'] = 'Europe/London';
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
  });
  afterAll(() => {
    if (original === undefined) delete process.env['TZ'];
    else process.env['TZ'] = original;
  });

  it('P-UI3 bars never overlap in a row, sit on exactly their lanes, hands-free rows equal peak overlap, pixels follow the formula', () => {
    fc.assert(
      fc.property(arbPlanAndKitchen(), ({ plan, kitchen }) => {
        const result = schedule(plan, kitchen);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const s = result.value;
        const layout = layoutTimeline(scheduleView(s), CHOSEN_MS, 'en-GB');
        const first = Math.min(...s.steps.map((t) => t.startMin));

        // Axis: origin at most 14 minutes before the first start, end at most 14 after serving.
        expect(layout.originMin <= first && first - layout.originMin < 15).toBe(true);
        expect(layout.endMin >= 0 && layout.endMin < 15).toBe(true);
        expect(layout.widthPx).toBe((layout.endMin - layout.originMin) * 6);

        const byId = new Map(s.steps.map((t) => [t.id, t]));
        const stepOf = new Map(plan.steps.map((t) => [t.id, t]));
        const seen = new Map<string, string[]>();
        for (const row of layout.rows) {
          // No two bars of a row overlap (plain loop over pairs).
          for (let i = 0; i < row.bars.length; i += 1) {
            for (let j = i + 1; j < row.bars.length; j += 1) {
              const a = row.bars[i];
              const b = row.bars[j];
              if (a === undefined || b === undefined) throw new Error('index');
              expect(a.leftPx + a.widthPx <= b.leftPx || b.leftPx + b.widthPx <= a.leftPx).toBe(
                true,
              );
            }
          }
          for (const b of row.bars) {
            const t = byId.get(b.stepId);
            if (t === undefined) throw new Error('unknown step in a bar');
            expect(b.leftPx).toBe((t.startMin - layout.originMin) * 6);
            expect(b.widthPx).toBe((t.endMin - t.startMin) * 6);
            expect(b.showLabel).toBe(b.widthPx >= 56);
            seen.set(b.stepId, [...(seen.get(b.stepId) ?? []), row.label]);
          }
        }

        // Each step is on exactly the lanes it holds, or on one hands-free row.
        for (const t of s.steps) {
          const step = stepOf.get(t.id);
          if (step === undefined) throw new Error('unknown step');
          const expected: string[] = [];
          if (t.lanes.cook !== null) expected.push(`Cook ${t.lanes.cook}`);
          if (t.lanes.burner !== null) expected.push(`Burner ${t.lanes.burner}`);
          if (t.lanes.oven !== null) expected.push(`Oven ${t.lanes.oven}`);
          const got = seen.get(t.id) ?? [];
          if (expected.length > 0) expect(got.sort()).toEqual(expected.sort());
          else {
            expect(got).toHaveLength(1);
            expect(got[0]?.startsWith('Hands-free')).toBe(true);
          }
        }

        // Oracle: the number of hands-free rows is the peak number of hands-free steps active.
        const free = s.steps.filter((t) => {
          const step = stepOf.get(t.id);
          return step !== undefined && step.appliance === 'none' && !step.handsOn;
        });
        let peak = 0;
        for (let minute = first; minute < 0; minute += 1) {
          peak = Math.max(
            peak,
            free.filter((t) => t.startMin <= minute && minute < t.endMin).length,
          );
        }
        expect(layout.rows.filter((r) => r.kind === 'hands-free')).toHaveLength(peak);
      }),
      fcParams(),
    );
  });
});
