import { describe, expect, it } from 'vitest';
import { schedule } from '../../src/core/schedule.js';
import type { ScheduleError } from '../../src/core/schedule.js';
import { canonicalPlan } from '../../src/core/schema.js';
import type { Kitchen, Plan, Schedule } from '../../src/core/schema.js';
import {
  BARE_KITCHEN,
  BIG_KITCHEN,
  BURNER_ONLY_KITCHEN,
  COLD_SAUCE,
  HANDS_FREE,
  HOME_KITCHEN,
  LONG_DAY,
  MEZZE,
  NO_BURNER_KITCHEN,
  ONE_BURNER_KITCHEN,
  PREP_AHEAD,
  SOLO_BURNER,
  SOLO_KEEPS,
  SUNDAY_ROAST,
  TIGHT_OVEN,
  TWO_CHOPS,
} from '../support/fixtures.js';

/** id, startMin, endMin, burner, oven, cook, slackMin, waitMin: the columns of the design tables. */
type Row = readonly [
  string,
  number,
  number,
  number | null,
  number | null,
  number | null,
  number,
  number | null,
];

const scheduled = (plan: Plan, kitchen: Kitchen): Schedule => {
  const result = schedule(plan, kitchen);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const rowsOf = (s: Schedule): Row[] =>
  s.steps.map((x) => [
    x.id,
    x.startMin,
    x.endMin,
    x.lanes.burner,
    x.lanes.oven,
    x.lanes.cook,
    x.slackMin,
    x.waitMin,
  ]);

const expectCritical = (s: Schedule): void => {
  for (const x of s.steps) expect(x.critical).toBe(x.slackMin === 0);
};

const failure = (input: unknown, kitchen: unknown): ScheduleError => {
  const result = schedule(input as Plan, kitchen as Kitchen);
  if (result.ok) throw new Error('expected err');
  return result.error;
};

describe('R10.6 hand-worked schedules (design H1 to H6)', () => {
  it('H1: SUNDAY_ROAST x HOME_KITCHEN, every column, no warnings, span and chain 110', () => {
    const s = scheduled(SUNDAY_ROAST, HOME_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['chicken.carve', -5, 0, null, null, 1, 0, 0],
      ['chicken.prep', -110, -100, null, null, 1, 0, null],
      ['chicken.rest', -25, -5, null, null, null, 0, 0],
      ['chicken.roast', -100, -25, null, 1, null, 0, 5],
      ['gravy.roux', -20, -18, 1, null, 1, 0, 0],
      ['gravy.simmer', -18, -8, 1, null, null, 0, 0],
      ['gravy.strain', -8, -6, null, null, 1, 0, 6],
      ['greens.boil', -10, -6, 2, null, null, 0, 0],
      ['greens.shred', -100, -95, null, null, 1, 75, null],
      ['greens.toss', -6, -5, null, null, 1, 0, 5],
    ]);
    expectCritical(s);
    expect(s.warnings).toEqual([]);
    expect([s.spanMin, s.chainMin]).toEqual([110, 110]);
    expect(s.kitchen).toEqual(HOME_KITCHEN);
    expect(s.plan).toEqual(canonicalPlan(SUNDAY_ROAST));
  });

  it('H2: SUNDAY_ROAST x ONE_BURNER_KITCHEN', () => {
    const s = scheduled(SUNDAY_ROAST, ONE_BURNER_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['chicken.carve', -5, 0, null, null, 1, 0, 0],
      ['chicken.prep', -110, -100, null, null, 1, 0, null],
      ['chicken.rest', -25, -5, null, null, null, 0, 0],
      ['chicken.roast', -100, -25, null, 1, null, 0, 3],
      ['gravy.roux', -22, -20, 1, null, 1, 0, 0],
      ['gravy.simmer', -20, -10, 1, null, null, 0, 2],
      ['gravy.strain', -8, -6, null, null, 1, 0, 6],
      ['greens.boil', -10, -6, 1, null, null, 0, 0],
      ['greens.shred', -100, -95, null, null, 1, 73, null],
      ['greens.toss', -6, -5, null, null, 1, 0, 5],
    ]);
    expectCritical(s);
    expect(s.warnings).toEqual([]);
    expect([s.spanMin, s.chainMin]).toEqual([110, 110]);
  });

  it('H3: TIGHT_OVEN x HOME_KITCHEN, one hold_exceeded with the exact message', () => {
    const s = scheduled(TIGHT_OVEN, HOME_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['pie.assemble', -85, -70, null, null, 1, 30, null],
      ['pie.bake', -40, 0, null, 1, null, 0, 0],
      ['potatoes.peel', -95, -85, null, null, 1, 0, null],
      ['potatoes.roast', -85, -40, null, 1, null, 0, 40],
    ]);
    expectCritical(s);
    expect(s.warnings).toEqual([
      {
        severity: 'warning',
        code: 'hold_exceeded',
        message:
          'Step potatoes.roast will be ready 40 minutes before serving and can wait only 10 minutes. More ovens, burners or cooks may help.',
        stepId: 'potatoes.roast',
        waitMin: 40,
        holdMin: 10,
      },
    ]);
    expect([s.spanMin, s.chainMin]).toEqual([95, 55]);
  });

  it('H4: MEZZE x HOME_KITCHEN, made-ahead steps move to the front', () => {
    const s = scheduled(MEZZE, HOME_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['flatbread.cook', -14, -2, 1, null, 1, 0, 2],
      ['flatbread.mix', -84, -74, null, null, 1, 0, null],
      ['flatbread.rise', -74, -14, null, null, null, 0, 0],
      ['hummus.blend', -74, -64, null, null, 1, 0, null],
      ['salad.chop', -64, -54, null, null, 1, 0, null],
      ['salad.dressing', -54, -49, null, null, 1, 35, null],
      ['salad.toss', -2, 0, null, null, 1, 0, 0],
    ]);
    expectCritical(s);
    expect(s.warnings).toEqual([]);
    expect([s.spanMin, s.chainMin]).toEqual([84, 82]);
  });

  it('H5: PREP_AHEAD x NO_BURNER_KITCHEN, right-justify shortens a wait; no burner lanes (R1.8)', () => {
    const s = scheduled(PREP_AHEAD, NO_BURNER_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['bread.bake', -8, 0, null, 1, null, 0, 0],
      ['bread.shape', -13, -8, null, null, 1, 0, 0],
      ['jelly.set', -60, 0, null, null, null, 0, null],
      ['salad.chop', -60, -50, null, null, 1, 37, null],
      ['salad.toss', -2, 0, null, null, 1, 0, 0],
    ]);
    expectCritical(s);
    expect(s.warnings).toEqual([]);
    expect([s.spanMin, s.chainMin]).toEqual([60, 60]);
  });

  it('R9.1 H6: SOLO_BURNER is one hot step ending at 0', () => {
    const s = scheduled(SOLO_BURNER, BURNER_ONLY_KITCHEN);
    expect(rowsOf(s)).toEqual([['solo.sear', -30, 0, 1, null, 1, 0, 0]]);
    expect(s.steps[0]?.critical).toBe(true);
    expect([s.spanMin, s.chainMin, s.warnings]).toEqual([30, 30, []]);
  });

  it('R9.1 H6: SOLO_KEEPS is one keeps step ending at 0 with no lanes and wait null', () => {
    const s = scheduled(SOLO_KEEPS, BURNER_ONLY_KITCHEN);
    expect(rowsOf(s)).toEqual([['solo.chill', -30, 0, null, null, null, 0, null]]);
    expect(s.steps[0]?.critical).toBe(true);
    expect([s.spanMin, s.chainMin, s.warnings]).toEqual([30, 30, []]);
  });

  it('R9.2 H6: HANDS_FREE gives no cook lane, and 1 or 6 cooks differ only in kitchen', () => {
    const one = scheduled(HANDS_FREE, BURNER_ONLY_KITCHEN);
    const six = scheduled(HANDS_FREE, { ...BURNER_ONLY_KITCHEN, cooks: 6 });
    expect(rowsOf(one)).toEqual([
      ['jelly.set', -120, 0, null, null, null, 0, null],
      ['stock.simmer', -60, 0, 1, null, null, 0, 0],
    ]);
    expect([one.spanMin, one.chainMin, one.warnings]).toEqual([120, 120, []]);
    expect(six).toEqual({ ...one, kitchen: { ...BURNER_ONLY_KITCHEN, cooks: 6 } });
  });

  it('R9.3 H6: TWO_CHOPS x BARE_KITCHEN, the second chop waits 10 and warns', () => {
    const s = scheduled(TWO_CHOPS, BARE_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['a.chop', -10, 0, null, null, 1, 0, 0],
      ['b.chop', -20, -10, null, null, 1, 0, 10],
    ]);
    expect(s.warnings.map((w) => [w.stepId, w.waitMin, w.holdMin])).toEqual([['b.chop', 10, 5]]);
    expect([s.spanMin, s.chainMin]).toEqual([20, 10]);
  });

  it('R9.3 H6: TWO_CHOPS x BIG_KITCHEN, cooks 1 and 2, no warnings', () => {
    const s = scheduled(TWO_CHOPS, BIG_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['a.chop', -10, 0, null, null, 1, 0, 0],
      ['b.chop', -10, 0, null, null, 2, 0, 0],
    ]);
    expect([s.spanMin, s.chainMin, s.warnings]).toEqual([10, 10, []]);
  });

  it('R9.5 H6: COLD_SAUCE, the keeps step starts at its hot prerequisite end', () => {
    const s = scheduled(COLD_SAUCE, BURNER_ONLY_KITCHEN);
    expect(rowsOf(s)).toEqual([
      ['fish.fry', -8, 0, 1, null, 1, 0, 0],
      ['sauce.reduce', -23, -13, 1, null, null, 0, 0],
      ['sauce.whisk', -13, -8, null, null, 1, 0, null],
    ]);
    expect([s.spanMin, s.chainMin, s.warnings]).toEqual([23, 15, []]);
  });

  it('R9.4 H6: LONG_DAY schedules 80 steps of 480 minutes within the default timeout', () => {
    const s = scheduled(LONG_DAY, BARE_KITCHEN);
    expect(s.steps).toHaveLength(80);
    s.steps.forEach((x, i) => {
      const n = i + 1;
      expect(x.id).toBe(`feast.s${String(n).padStart(2, '0')}`);
      expect([x.startMin, x.endMin, x.lanes.cook, x.slackMin, x.waitMin]).toEqual([
        -480 * n,
        480 - 480 * n,
        1,
        0,
        480 * (n - 1),
      ]);
    });
    expect([s.spanMin, s.chainMin, s.warnings.length]).toEqual([38400, 480, 79]);
    expect(s.warnings.map((w) => w.stepId)).toEqual(s.steps.slice(1).map((x) => x.id));
  });
});

describe('R1 entry point and input checks', () => {
  it('R1.2 a self-dependency gives invalid_plan with exactly the error issues', () => {
    const broken: Plan = {
      ...SUNDAY_ROAST,
      steps: SUNDAY_ROAST.steps.map((x) =>
        x.id === 'gravy.roux' ? { ...x, after: [...x.after, 'gravy.roux'] } : x,
      ),
    };
    const error = failure(broken, HOME_KITCHEN);
    expect(error.kind).toBe('invalid_plan');
    expect(error.issues.map((i) => [i.severity, i.code])).toEqual([['error', 'self_dependency']]);
  });

  it('R1.2 null, {} and 42 give invalid_plan and do not throw (R1.6)', () => {
    for (const input of [null, {}, 42]) {
      const error = failure(input, HOME_KITCHEN);
      expect(error.kind).toBe('invalid_plan');
      expect(error.issues.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('R1.3 a kitchen with zero cooks gives invalid_kitchen', () => {
    const error = failure(SUNDAY_ROAST, { ...HOME_KITCHEN, cooks: 0 });
    expect(error.kind).toBe('invalid_kitchen');
    expect(error.issues.map((i) => i.code)).toEqual(['invalid_field']);
  });

  it('R1.3 a plan error is reported before a kitchen error', () => {
    expect(failure(null, { burners: -1 }).kind).toBe('invalid_plan');
  });

  it('R1.4 no burners gives missing_appliance with one issue per burner step', () => {
    const error = failure(SUNDAY_ROAST, { ...HOME_KITCHEN, burners: 0 });
    expect(error.kind).toBe('missing_appliance');
    expect(error.issues.map((i) => [i.code, 'stepId' in i ? i.stepId : null])).toEqual([
      ['missing_appliance', 'gravy.roux'],
      ['missing_appliance', 'gravy.simmer'],
      ['missing_appliance', 'greens.boil'],
    ]);
  });

  it('R1.5 a plan with only warnings schedules, and its warnings stay out of the schedule', () => {
    const s = scheduled(LONG_DAY, BARE_KITCHEN);
    expect(s.warnings.every((w) => w.code === 'hold_exceeded')).toBe(true);
  });

  it('R1.7 the arguments are not changed', () => {
    const plan = structuredClone(MEZZE);
    const kitchen = structuredClone(HOME_KITCHEN);
    schedule(plan, kitchen);
    expect(plan).toEqual(MEZZE);
    expect(kitchen).toEqual(HOME_KITCHEN);
  });

  it('R2.3 plan is the canonical plan even when the input steps are shuffled', () => {
    const shuffled: Plan = { ...TIGHT_OVEN, steps: [...TIGHT_OVEN.steps].reverse() };
    expect(scheduled(shuffled, HOME_KITCHEN).plan).toEqual(canonicalPlan(TIGHT_OVEN));
  });
});
