import { describe, expect, it } from 'vitest';
import { rebuild } from '../../src/core/rebuild.js';
import type { RebuildError } from '../../src/core/rebuild.js';
import { forwardRepair } from '../../src/core/passes/forward-repair.js';
import { assignRebuildLanes } from '../../src/core/passes/lanes.js';
import { rebuildReadout } from '../../src/core/passes/readout.js';
import { reAlign } from '../../src/core/passes/re-align.js';
import { canonicalPlan } from '../../src/core/schema.js';
import type {
  Progress,
  Rebuilt,
  RebuiltSchedule,
  Schedule,
  StepLanes,
} from '../../src/core/schema.js';
import { capacityOf, timelineFrom } from '../../src/core/timeline.js';
import type { Interval } from '../../src/core/timeline.js';
import {
  E1_NOW,
  E1_PROGRESS,
  E2_NOW,
  E2_PROGRESS,
  E3_NOW,
  E3_PROGRESS,
  E4_NOW,
  E4_PROGRESS,
  E5_EARLY_NOW,
  E5_EARLY_PROGRESS,
  E5_NOW,
  E5_PROGRESS,
  E6_NOW,
  E6_PROGRESS,
  E7_NOW,
  E7_PROGRESS,
  E8_NOW,
  E8_PROGRESS,
  H1_SCHEDULE,
  H3_SCHEDULE,
  HOME_KITCHEN,
  RB_A_NOW,
  RB_A_PROGRESS,
  RB_B2_NOW,
  RB_B2_PROGRESS,
  RB_B_NOW,
  RB_B_PROGRESS,
  RB_C_NOW,
  RB_C_PROGRESS,
  TIGHT_OVEN,
} from '../support/fixtures.js';

// Rebuild spec, T3: forward repair and re-align, against the hand-worked rebuilds of the
// rebuild design (RB-a, RB-b, RB-b2, RB-c, E3, E8). Plans are canonical, as the passes need.

const PLAN = H1_SCHEDULE.plan;
const CAP = capacityOf(HOME_KITCHEN);

type Ivs = Record<string, Interval>;
const iv = (startMin: number, endMin: number): Interval => ({ startMin, endMin });
const mapOf = (record: Ivs): Map<string, Interval> => new Map(Object.entries(record));
const plain = (m: ReadonlyMap<string, Interval>): Ivs =>
  Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The start of every step in the H1 table: the previous schedule of every rebuild below. */
const H1_STARTS: ReadonlyMap<string, number> = new Map(
  H1_SCHEDULE.steps.map((x) => [x.id, x.startMin]),
);

/** The H1 intervals, with some replaced. */
const h1With = (over: Ivs = {}): Ivs => ({
  'chicken.carve': iv(-5, 0),
  'chicken.prep': iv(-110, -100),
  'chicken.rest': iv(-25, -5),
  'chicken.roast': iv(-100, -25),
  'gravy.roux': iv(-20, -18),
  'gravy.simmer': iv(-18, -8),
  'gravy.strain': iv(-8, -6),
  'greens.boil': iv(-10, -6),
  'greens.shred': iv(-100, -95),
  'greens.toss': iv(-6, -5),
  ...over,
});

describe('RQ4.2 timelineFrom clips at fromMin', () => {
  const intervals = mapOf({
    'chicken.prep': iv(-110, -100), // cook, ends before from
    'chicken.roast': iv(-100, -25), // oven
    'gravy.roux': iv(-20, -18), // burner and cook
    'greens.boil': iv(-10, -6), // burner
  });
  const tl = timelineFrom(PLAN, CAP, intervals, -50);
  it('counts nothing before fromMin: the oven is idle at -51 and in use from -50 to -26', () => {
    expect(tl.usage('oven', -51)).toBe(0);
    expect(tl.usage('oven', -50)).toBe(1);
    expect(tl.usage('oven', -26)).toBe(1);
    expect(tl.usage('oven', -25)).toBe(0);
  });
  it('counts steps that end before fromMin as nothing at all', () => {
    for (let minute = -111; minute < -50; minute++) expect(tl.usage('cook', minute)).toBe(0);
  });
  it('counts the resources of each step: roux holds a burner and the cook, boil a burner', () => {
    expect([tl.usage('burner', -20), tl.usage('cook', -20)]).toEqual([1, 1]);
    expect([tl.usage('burner', -19), tl.usage('cook', -19)]).toEqual([1, 1]);
    expect([tl.usage('burner', -18), tl.usage('cook', -18)]).toEqual([0, 0]);
    expect([tl.usage('burner', -10), tl.usage('cook', -10)]).toEqual([1, 0]);
    expect([tl.usage('burner', -7), tl.usage('burner', -6)]).toEqual([1, 0]);
  });
  it('a step whose interval is missing holds nothing; an empty interval holds nothing', () => {
    const partial = timelineFrom(PLAN, CAP, mapOf({ 'chicken.roast': iv(-30, -30) }), -50);
    for (let minute = -60; minute < 0; minute++) expect(partial.usage('oven', minute)).toBe(0);
  });
  it('fromMin after every end leaves an empty timeline; before every start clips nothing', () => {
    const late = timelineFrom(PLAN, CAP, intervals, 100);
    for (let minute = -120; minute < 5; minute++) expect(late.usage('oven', minute)).toBe(0);
    const early = timelineFrom(PLAN, CAP, intervals, -500);
    expect(early.usage('oven', -100)).toBe(1);
    expect(early.usage('cook', -105)).toBe(1);
  });
});

describe('RQ4 forwardRepair on the hand-worked rebuilds (forward-repair starts)', () => {
  it('RB-a (roast needs 15 more, now -60): rest and roux -10, simmer -8, boil stays, strain 2, toss stays, carve 10', () => {
    const pinned = mapOf({
      'chicken.prep': iv(-110, -100),
      'greens.shred': iv(-100, -95),
      'chicken.roast': iv(-100, -10),
    });
    expect(plain(forwardRepair(PLAN, CAP, H1_STARTS, pinned, -60))).toEqual(
      h1With({
        'chicken.roast': iv(-100, -10),
        'chicken.rest': iv(-10, 10),
        'gravy.roux': iv(-10, -8),
        'gravy.simmer': iv(-8, 2),
        'gravy.strain': iv(2, 4),
        'chicken.carve': iv(10, 15),
      }),
    );
  });
  it('RB-b (8 minutes behind on the roux, now -12): roux -12, simmer -10, strain 0; the rest stay', () => {
    const pinned = mapOf({
      'chicken.prep': iv(-110, -100),
      'greens.shred': iv(-100, -95),
      'chicken.roast': iv(-100, -25),
      'chicken.rest': iv(-25, -5),
    });
    expect(plain(forwardRepair(PLAN, CAP, H1_STARTS, pinned, -12))).toEqual(
      h1With({
        'gravy.roux': iv(-12, -10),
        'gravy.simmer': iv(-10, 0),
        'gravy.strain': iv(0, 2),
      }),
    );
  });
  it('RB-b2 (behind on a step with slack, now -92): only greens.shred moves, to [-92,-87)', () => {
    const pinned = mapOf({
      'chicken.prep': iv(-110, -100),
      'chicken.roast': iv(-100, -25),
    });
    expect(plain(forwardRepair(PLAN, CAP, H1_STARTS, pinned, -92))).toEqual(
      h1With({ 'greens.shred': iv(-92, -87) }),
    );
  });
  it('RB-c (no slip, now -60): nothing moves', () => {
    const pinned = mapOf({
      'chicken.prep': iv(-110, -100),
      'greens.shred': iv(-100, -95),
      'chicken.roast': iv(-100, -25),
    });
    expect(plain(forwardRepair(PLAN, CAP, H1_STARTS, pinned, -60))).toEqual(h1With());
  });
  it('E3 (overrun, no taps, now -20): the roast ends now; rest and roux -20, simmer -18, boil -10, strain -8, toss -6, carve 0', () => {
    const pinned = mapOf({
      'chicken.prep': iv(-110, -100),
      'greens.shred': iv(-100, -95),
      'chicken.roast': iv(-100, -20),
    });
    expect(plain(forwardRepair(PLAN, CAP, H1_STARTS, pinned, -20))).toEqual(
      h1With({
        'chicken.roast': iv(-100, -20),
        'chicken.rest': iv(-20, 0),
        'gravy.roux': iv(-20, -18),
        'chicken.carve': iv(0, 5),
      }),
    );
  });
  it('E8 (untap, now 0): boil [0,4) before toss [4,5), though toss had the smaller previous start', () => {
    // The input is E6's output: H1 with greens.boil at -2 and toss done out of order at -6.
    const prev = new Map(H1_STARTS);
    prev.set('greens.boil', -2);
    const pinned = mapOf({
      'chicken.prep': iv(-110, -100),
      'greens.shred': iv(-100, -95),
      'chicken.roast': iv(-100, -25),
      'chicken.rest': iv(-25, -5),
      'gravy.roux': iv(-20, -18),
      'gravy.simmer': iv(-18, -8),
      'gravy.strain': iv(-8, -6),
      'chicken.carve': iv(-5, 0),
    });
    expect(plain(forwardRepair(PLAN, CAP, prev, pinned, 0))).toEqual(
      h1With({ 'greens.boil': iv(0, 4), 'greens.toss': iv(4, 5) }),
    );
  });
  it('the arguments are not changed', () => {
    const pinned = mapOf({ 'chicken.prep': iv(-110, -100) });
    const prev = new Map(H1_STARTS);
    forwardRepair(PLAN, CAP, prev, pinned, -60);
    expect(plain(pinned)).toEqual({ 'chicken.prep': iv(-110, -100) });
    expect(prev).toEqual(H1_STARTS);
  });
});

describe('RQ6 reAlign on the hand-worked rebuilds', () => {
  it('RB-a (serving 15): strain 8, simmer -2, toss 7, boil 3, roux -4; carve, rest and every pinned step stay', () => {
    const afterRepair = mapOf(
      h1With({
        'chicken.roast': iv(-100, -10),
        'chicken.rest': iv(-10, 10),
        'gravy.roux': iv(-10, -8),
        'gravy.simmer': iv(-8, 2),
        'gravy.strain': iv(2, 4),
        'chicken.carve': iv(10, 15),
      }),
    );
    const pinned = new Set(['chicken.prep', 'greens.shred', 'chicken.roast']);
    expect(plain(reAlign(PLAN, CAP, afterRepair, pinned, -60, 15))).toEqual(
      h1With({
        'chicken.roast': iv(-100, -10),
        'chicken.rest': iv(-10, 10),
        'gravy.roux': iv(-4, -2),
        'gravy.simmer': iv(-2, 8),
        'gravy.strain': iv(8, 10),
        'greens.boil': iv(3, 7),
        'greens.toss': iv(7, 8),
        'chicken.carve': iv(10, 15),
      }),
    );
  });
  it('E3 (serving 5): toss -1, strain -3, boil -5, simmer -13, roux -15', () => {
    const afterRepair = mapOf(
      h1With({
        'chicken.roast': iv(-100, -20),
        'chicken.rest': iv(-20, 0),
        'gravy.roux': iv(-20, -18),
        'chicken.carve': iv(0, 5),
      }),
    );
    const pinned = new Set(['chicken.prep', 'greens.shred', 'chicken.roast']);
    expect(plain(reAlign(PLAN, CAP, afterRepair, pinned, -20, 5))).toEqual(
      h1With({
        'chicken.roast': iv(-100, -20),
        'chicken.rest': iv(-20, 0),
        'gravy.roux': iv(-15, -13),
        'gravy.simmer': iv(-13, -3),
        'gravy.strain': iv(-3, -1),
        'greens.boil': iv(-5, -1),
        'greens.toss': iv(-1, 0),
        'chicken.carve': iv(0, 5),
      }),
    );
  });
  it('RB-b (serving 2): moves nothing, each step is held by a successor or by the cook', () => {
    const afterRepair = mapOf(
      h1With({
        'gravy.roux': iv(-12, -10),
        'gravy.simmer': iv(-10, 0),
        'gravy.strain': iv(0, 2),
      }),
    );
    const pinned = new Set(['chicken.prep', 'greens.shred', 'chicken.roast', 'chicken.rest']);
    expect(plain(reAlign(PLAN, CAP, afterRepair, pinned, -12, 2))).toEqual(plain(afterRepair));
  });
  it('the arguments are not changed', () => {
    const afterRepair = mapOf(h1With({ 'chicken.carve': iv(0, 5) }));
    const copy = plain(afterRepair);
    reAlign(PLAN, CAP, afterRepair, new Set(), -60, 5);
    expect(plain(afterRepair)).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------------------
// Rebuild spec, T4: lanes and readout.

type LaneTriple = readonly [burner: number | null, oven: number | null, cook: number | null];
const lanesOf = (m: ReadonlyMap<string, StepLanes>): Record<string, LaneTriple> =>
  Object.fromEntries(
    [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, l]): [string, LaneTriple] => [id, [l.burner, l.oven, l.cook]]),
  );
const lanesMap = (steps: readonly { id: string; lanes: StepLanes }[]): Map<string, StepLanes> =>
  new Map(steps.map((x) => [x.id, x.lanes]));

/** The lanes of the H1 table: burner, oven, cook per step. */
const H1_LANES: Record<string, LaneTriple> = {
  'chicken.carve': [null, null, 1],
  'chicken.prep': [null, null, 1],
  'chicken.rest': [null, null, null],
  'chicken.roast': [null, 1, null],
  'gravy.roux': [1, null, 1],
  'gravy.simmer': [1, null, null],
  'gravy.strain': [null, null, 1],
  'greens.boil': [2, null, null],
  'greens.shred': [null, null, 1],
  'greens.toss': [null, null, 1],
};

/** Final intervals of RB-a (the table of the design) and RB-b. */
const RB_A_FINAL = h1With({
  'chicken.carve': iv(10, 15),
  'chicken.rest': iv(-10, 10),
  'chicken.roast': iv(-100, -10),
  'gravy.roux': iv(-4, -2),
  'gravy.simmer': iv(-2, 8),
  'gravy.strain': iv(8, 10),
  'greens.boil': iv(3, 7),
  'greens.toss': iv(7, 8),
});
const RB_B_FINAL = h1With({
  'gravy.roux': iv(-12, -10),
  'gravy.simmer': iv(-10, 0),
  'gravy.strain': iv(0, 2),
});

describe('RQ7 assignRebuildLanes', () => {
  const prev = lanesMap(H1_SCHEDULE.steps);
  it('RB-a: every step keeps its H1 lane (boil burner 2, roast oven 1, the cook lane 1)', () => {
    expect(lanesOf(assignRebuildLanes(PLAN, CAP, mapOf(RB_A_FINAL), prev))).toEqual(H1_LANES);
  });
  it('RB-b: simmer, assigned first at -10, keeps burner 1; boil keeps burner 2', () => {
    expect(lanesOf(assignRebuildLanes(PLAN, CAP, mapOf(RB_B_FINAL), prev))).toEqual(H1_LANES);
  });
  it('E6: boil [-2,2) keeps its H1 burner 2', () => {
    const e6 = h1With({ 'greens.boil': iv(-2, 2) });
    expect(lanesOf(assignRebuildLanes(PLAN, CAP, mapOf(e6), prev))).toEqual(H1_LANES);
  });
  it('E7: both pinned oven steps are given oven lane 1 although the oven has one lane (RQ7.2)', () => {
    const plan = canonicalPlan(TIGHT_OVEN);
    const intervals = mapOf({
      'pie.assemble': iv(-85, -70),
      'pie.bake': iv(-60, -20),
      'potatoes.peel': iv(-95, -85),
      'potatoes.roast': iv(-85, -40),
    });
    expect(lanesOf(assignRebuildLanes(plan, CAP, intervals, lanesMap(H3_SCHEDULE.steps)))).toEqual({
      'pie.assemble': [null, null, 1],
      'pie.bake': [null, 1, null],
      'potatoes.peel': [null, null, 1],
      'potatoes.roast': [null, 1, null],
    });
  });
  it('RQ7.2 without an input lane the fallback is lane 1: both ovens steps share it', () => {
    const plan = canonicalPlan(TIGHT_OVEN);
    const intervals = mapOf({
      'pie.assemble': iv(-85, -70),
      'pie.bake': iv(-60, -20),
      'potatoes.peel': iv(-95, -85),
      'potatoes.roast': iv(-85, -40),
    });
    const lanes = lanesOf(assignRebuildLanes(plan, CAP, intervals, new Map()));
    expect([lanes['pie.bake']?.[1], lanes['potatoes.roast']?.[1]]).toEqual([1, 1]);
  });
  it('RQ7.1 a busy input lane is passed over: boil asking for burner 1 beside simmer gets burner 2', () => {
    const asked = new Map(prev);
    asked.set('greens.boil', { burner: 1, oven: null, cook: null });
    const lanes = lanesOf(assignRebuildLanes(PLAN, CAP, mapOf(RB_A_FINAL), asked));
    expect(lanes['greens.boil']).toEqual([2, null, null]);
    expect(lanes['gravy.simmer']).toEqual([1, null, null]);
  });
  it('RQ7.1 without an input lane a step takes its prerequisite lane (roux 3, so simmer 3) before the smallest free', () => {
    const asked = new Map(prev);
    asked.set('gravy.roux', { burner: 3, oven: null, cook: 1 });
    asked.delete('gravy.simmer');
    const lanes = lanesOf(assignRebuildLanes(PLAN, CAP, mapOf(RB_A_FINAL), asked));
    expect(lanes['gravy.roux']).toEqual([3, null, 1]);
    expect(lanes['gravy.simmer']).toEqual([3, null, null]);
  });
  it('RQ7.1 an input lane out of range is ignored: burner 9 gives the smallest free lane', () => {
    const asked = new Map(prev);
    asked.set('gravy.roux', { burner: 9, oven: null, cook: 1 });
    const lanes = lanesOf(assignRebuildLanes(PLAN, CAP, mapOf(RB_A_FINAL), asked));
    expect(lanes['gravy.roux']).toEqual([1, null, 1]);
  });
  it('RQ7.2 an empty pinned interval occupies no minute: boil done in zero time inside simmer keeps its burner lane 1', () => {
    const asked = new Map(prev);
    asked.set('greens.boil', { burner: 1, oven: null, cook: null });
    const lanes = lanesOf(
      assignRebuildLanes(PLAN, CAP, mapOf({ ...RB_A_FINAL, 'greens.boil': iv(0, 0) }), asked),
    );
    expect(lanes['greens.boil']).toEqual([1, null, null]);
    expect(lanes['gravy.simmer']).toEqual([1, null, null]);
  });
  it('a step with no resource gets no lane; the arguments are not changed', () => {
    const intervals = mapOf(RB_A_FINAL);
    const copy = plain(intervals);
    const lanes = assignRebuildLanes(PLAN, CAP, intervals, prev);
    expect(lanes.get('chicken.rest')).toEqual({ burner: null, oven: null, cook: null });
    expect(plain(intervals)).toEqual(copy);
    expect(lanesOf(prev)).toEqual(H1_LANES);
  });
});

const MORE = 'More ovens, burners or cooks may help.';
const ROAST_MSG = (wait: number): string =>
  `Step chicken.roast will be ready ${wait} minutes before the step that uses it and can wait only 5 minutes. ${MORE}`;
const TOSS_MSG = (wait: number): string =>
  `Step greens.toss will be ready ${wait} minutes before serving and can wait only 5 minutes. ${MORE}`;

type Waits = Record<string, number | null>;
const H1_WAITS: Waits = {
  'chicken.carve': 0,
  'chicken.prep': null,
  'chicken.rest': 0,
  'chicken.roast': 0,
  'gravy.roux': 0,
  'gravy.simmer': 0,
  'gravy.strain': 6,
  'greens.boil': 0,
  'greens.shred': null,
  'greens.toss': 5,
};
const ALL_SLACK_ZERO: Record<string, number> = Object.fromEntries(
  Object.keys(H1_WAITS).map((id) => [id, 0]),
);

const readoutOf = (
  intervals: Ivs,
  progress: object,
  now: number,
  serving: number,
): { slack: Record<string, number>; wait: Waits; warnings: unknown[] } => {
  const r = rebuildReadout(
    PLAN,
    CAP,
    mapOf(intervals),
    new Set(Object.keys(progress)),
    now,
    serving,
  );
  const sorted = <T>(m: ReadonlyMap<string, T>): Record<string, T> =>
    Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { slack: sorted(r.slackMin), wait: sorted(r.waitMin), warnings: r.warnings };
};
const warning = (stepId: string, waitMin: number, holdMin: number, message: string) => ({
  severity: 'warning',
  code: 'hold_exceeded',
  message,
  stepId,
  waitMin,
  holdMin,
});

describe('RQ8 rebuildReadout on the hand-worked rebuilds', () => {
  it('RB-a: slack 0 everywhere, the waits of the table (the roast waits 0: rest starts when it ends), and the one warning with its exact message', () => {
    expect(readoutOf(RB_A_FINAL, RB_A_PROGRESS, -60, 15)).toEqual({
      slack: ALL_SLACK_ZERO,
      wait: { ...H1_WAITS, 'gravy.strain': 5, 'greens.toss': 7 },
      warnings: [
        warning(
          'greens.toss',
          7,
          5,
          'Step greens.toss will be ready 7 minutes before serving and can wait only 5 minutes. More ovens, burners or cooks may help.',
        ),
      ],
    });
  });
  it('RB-b: the roast waits 0 for rest, which starts as it ends, however late the roux; toss waits 7; carve waits 2 for serving at 2', () => {
    expect(readoutOf(RB_B_FINAL, RB_B_PROGRESS, -12, 2)).toEqual({
      slack: ALL_SLACK_ZERO,
      wait: {
        ...H1_WAITS,
        'chicken.carve': 2,
        'gravy.strain': 0,
        'greens.toss': 7,
      },
      warnings: [warning('greens.toss', 7, 5, TOSS_MSG(7))],
    });
  });
  it('RB-b2: shred, moved to [-92,-87), has slack 67 (68 reaches the roux on the cook at -20); pinned rows 0', () => {
    const r = readoutOf(h1With({ 'greens.shred': iv(-92, -87) }), RB_B2_PROGRESS, -92, 0);
    expect(r.slack).toEqual({ ...ALL_SLACK_ZERO, 'greens.shred': 67 });
    expect(r.wait).toEqual(H1_WAITS);
    expect(r.warnings).toEqual([]);
  });
  it('RB-c: no slip, slack 0 on every row (shred is pinned), waits of H1, no warnings', () => {
    expect(readoutOf(h1With(), RB_C_PROGRESS, -60, 0)).toEqual({
      slack: ALL_SLACK_ZERO,
      wait: H1_WAITS,
      warnings: [],
    });
  });
  it('E1: the roast, done at -35, waits 10 > 5 until rest starts at -25 (not 15, to the roux at -20); nothing else moves', () => {
    const r = readoutOf(h1With({ 'chicken.roast': iv(-100, -35) }), E1_PROGRESS, -35, 0);
    expect(r.wait).toEqual({ ...H1_WAITS, 'chicken.roast': 10 });
    expect(r.slack).toEqual(ALL_SLACK_ZERO);
    expect(r.warnings).toEqual([warning('chicken.roast', 10, 5, ROAST_MSG(10))]);
  });
  it('E2: the roast, started early, ends at -27 and waits 2 until rest starts at -25, within its hold; shred keeps its slack 75', () => {
    const r = readoutOf(
      h1With({ 'chicken.prep': iv(-110, -102), 'chicken.roast': iv(-102, -27) }),
      E2_PROGRESS,
      -100,
      0,
    );
    expect(r.wait).toEqual({ ...H1_WAITS, 'chicken.roast': 2 });
    expect(r.slack).toEqual({ ...ALL_SLACK_ZERO, 'greens.shred': 75 });
    expect(r.warnings).toEqual([]);
  });
  it('E5: all done, carve late; serving at 3: strain waits 9 (hold 15), toss waits 8 > 5', () => {
    const r = readoutOf(h1With({ 'chicken.carve': iv(-5, 3) }), E5_PROGRESS, 3, 3);
    expect(r.slack).toEqual(ALL_SLACK_ZERO);
    expect(r.wait).toEqual({ ...H1_WAITS, 'gravy.strain': 9, 'greens.toss': 8 });
    expect(r.warnings).toEqual([warning('greens.toss', 8, 5, TOSS_MSG(8))]);
  });
  it("E5': all done, carve early; serving stays 0: carve waits 2, strain 6, toss 5; no warning", () => {
    const r = readoutOf(h1With({ 'chicken.carve': iv(-5, -2) }), E5_EARLY_PROGRESS, -2, 0);
    expect(r.slack).toEqual(ALL_SLACK_ZERO);
    expect(r.wait).toEqual({ ...H1_WAITS, 'chicken.carve': 2 });
    expect(r.warnings).toEqual([]);
  });
  it('E6: boil [-2,2) waits 0 (clamped: toss started earlier), has slack 0; toss waits 7 > 5', () => {
    const r = readoutOf(h1With({ 'greens.boil': iv(-2, 2) }), E6_PROGRESS, -2, 2);
    expect(r.slack).toEqual(ALL_SLACK_ZERO);
    expect(r.wait).toEqual({
      ...H1_WAITS,
      'chicken.carve': 2,
      'gravy.strain': 8,
      'greens.toss': 7,
    });
    expect(r.warnings).toEqual([warning('greens.toss', 7, 5, TOSS_MSG(7))]);
  });
  it('RQ2.4 E6 with carve running 5 minutes over (serving 5): boil, pending, is not held by toss, which started at -6; slack 3', () => {
    // Boil [-2,2) has only a pinned successor, so its deadline is serving 5: it can wait 3.
    const r = readoutOf(
      h1With({ 'greens.boil': iv(-2, 2), 'chicken.carve': iv(-5, 5) }),
      E6_PROGRESS,
      -2,
      5,
    );
    expect(r.slack).toEqual({ ...ALL_SLACK_ZERO, 'greens.boil': 3 });
  });
  it('the arguments are not changed', () => {
    const intervals = mapOf(RB_A_FINAL);
    const pinned = new Set(Object.keys(RB_A_PROGRESS));
    const copy = plain(intervals);
    rebuildReadout(PLAN, CAP, intervals, pinned, -60, 15);
    expect(plain(intervals)).toEqual(copy);
    expect([...pinned].sort()).toEqual(['chicken.prep', 'chicken.roast', 'greens.shred']);
  });
});

// ---------------------------------------------------------------------------------------
// Rebuild spec, T5: `rebuild` end to end, against the hand-worked tables of the design.

const rebuilt = (
  schedule: Schedule | RebuiltSchedule,
  progress: Progress,
  now: number,
): Rebuilt => {
  const r = rebuild(schedule, progress, now);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const failure = (schedule: unknown, progress: unknown, now: unknown): RebuildError => {
  const r = rebuild(schedule as Schedule, progress as Progress, now as number);
  if (r.ok) throw new Error('expected an error, got ok');
  return r.error;
};

/** One table row: start, end, slack, critical, wait. */
type Row = readonly [number, number, number, boolean, number | null];
const rowsOf = (r: Rebuilt): Record<string, Row> =>
  Object.fromEntries(
    r.schedule.steps.map((x): [string, Row] => [
      x.id,
      [x.startMin, x.endMin, x.slackMin, x.critical, x.waitMin],
    ]),
  );
const laneRowsOf = (r: Rebuilt): Record<string, LaneTriple> => lanesOf(lanesMap(r.schedule.steps));
const movesOf = (r: Rebuilt): [string, number, number][] =>
  r.diff.moved.map((m) => [m.stepId, m.fromStartMin, m.toStartMin]);
const warningsOf = (r: Rebuilt): [string, number, number][] =>
  r.schedule.warnings.map((w) => [w.stepId, w.waitMin, w.holdMin]);

/** The H1 table rows (start, end, slack, critical, wait); every slack is 0 except shred's 75. */
const H1_ROWS: Record<string, Row> = {
  'chicken.carve': [-5, 0, 0, true, 0],
  'chicken.prep': [-110, -100, 0, true, null],
  'chicken.rest': [-25, -5, 0, true, 0],
  'chicken.roast': [-100, -25, 0, true, 0],
  'gravy.roux': [-20, -18, 0, true, 0],
  'gravy.simmer': [-18, -8, 0, true, 0],
  'gravy.strain': [-8, -6, 0, true, 6],
  'greens.boil': [-10, -6, 0, true, 0],
  'greens.shred': [-100, -95, 75, false, null],
  'greens.toss': [-6, -5, 0, true, 5],
};
/** H1 rows with some replaced. */
const h1Rows = (over: Record<string, Row> = {}): Record<string, Row> => ({ ...H1_ROWS, ...over });
const ALL_IDS = Object.keys(H1_ROWS);
const idsExcept = (...skip: string[]): string[] => ALL_IDS.filter((id) => !skip.includes(id));

describe('RQ1 to RQ9 rebuild: the hand-worked rebuilds of the design, every column', () => {
  it('RB-a: roast needs 15 more minutes at -60; serving 15, span 125, chain 110, one warning, seven moves', () => {
    const r = rebuilt(H1_SCHEDULE, RB_A_PROGRESS, RB_A_NOW);
    expect(rowsOf(r)).toEqual({
      'chicken.carve': [10, 15, 0, true, 0],
      'chicken.prep': [-110, -100, 0, false, null],
      'chicken.rest': [-10, 10, 0, true, 0],
      'chicken.roast': [-100, -10, 0, false, 0],
      'gravy.roux': [-4, -2, 0, true, 0],
      'gravy.simmer': [-2, 8, 0, true, 0],
      'gravy.strain': [8, 10, 0, true, 5],
      'greens.boil': [3, 7, 0, true, 0],
      'greens.shred': [-100, -95, 0, false, null],
      'greens.toss': [7, 8, 0, true, 7],
    });
    expect(laneRowsOf(r)).toEqual(H1_LANES);
    expect(r.schedule.servingMin).toBe(15);
    expect(r.schedule.spanMin).toBe(125);
    expect(r.schedule.chainMin).toBe(110);
    expect(r.schedule.kitchen).toEqual(HOME_KITCHEN);
    expect(r.schedule.plan).toEqual(H1_SCHEDULE.plan);
    expect(r.schedule.warnings).toEqual([
      warning(
        'greens.toss',
        7,
        5,
        'Step greens.toss will be ready 7 minutes before serving and can wait only 5 minutes. More ovens, burners or cooks may help.',
      ),
    ]);
    expect(movesOf(r)).toEqual([
      ['chicken.carve', -5, 10],
      ['chicken.rest', -25, -10],
      ['gravy.roux', -20, -4],
      ['gravy.simmer', -18, -2],
      ['gravy.strain', -8, 8],
      ['greens.boil', -10, 3],
      ['greens.toss', -6, 7],
    ]);
    expect(r.diff.unchanged).toEqual(['chicken.prep', 'chicken.roast', 'greens.shred']);
    expect(r.diff.servingShiftMin).toBe(15);
  });

  it('RB-b: 8 minutes behind on the roux at -12; serving 2, span 112, one warning, toss 7', () => {
    const r = rebuilt(H1_SCHEDULE, RB_B_PROGRESS, RB_B_NOW);
    expect(rowsOf(r)).toEqual({
      'chicken.carve': [-5, 0, 0, true, 2],
      'chicken.prep': [-110, -100, 0, false, null],
      'chicken.rest': [-25, -5, 0, false, 0],
      'chicken.roast': [-100, -25, 0, false, 0],
      'gravy.roux': [-12, -10, 0, true, 0],
      'gravy.simmer': [-10, 0, 0, true, 0],
      'gravy.strain': [0, 2, 0, true, 0],
      'greens.boil': [-10, -6, 0, true, 0],
      'greens.shred': [-100, -95, 0, false, null],
      'greens.toss': [-6, -5, 0, true, 7],
    });
    expect(laneRowsOf(r)).toEqual(H1_LANES);
    expect([r.schedule.servingMin, r.schedule.spanMin, r.schedule.chainMin]).toEqual([2, 112, 110]);
    expect(warningsOf(r)).toEqual([['greens.toss', 7, 5]]);
    expect(movesOf(r)).toEqual([
      ['gravy.roux', -20, -12],
      ['gravy.simmer', -18, -10],
      ['gravy.strain', -8, 0],
    ]);
    expect(r.diff.unchanged).toHaveLength(7);
    expect(r.diff.servingShiftMin).toBe(2);
  });

  it('RB-b2: behind on a step with slack at -92; only shred moves, to [-92,-87), slack 67; serving 0', () => {
    const r = rebuilt(H1_SCHEDULE, RB_B2_PROGRESS, RB_B2_NOW);
    expect(rowsOf(r)).toEqual(
      h1Rows({
        'chicken.prep': [-110, -100, 0, false, null],
        'chicken.roast': [-100, -25, 0, false, 0],
        'greens.shred': [-92, -87, 67, false, null],
      }),
    );
    expect(laneRowsOf(r)).toEqual(H1_LANES);
    expect([r.schedule.servingMin, r.schedule.spanMin, r.schedule.chainMin]).toEqual([0, 110, 110]);
    expect(r.schedule.warnings).toEqual([]);
    expect(movesOf(r)).toEqual([['greens.shred', -100, -92]]);
    expect(r.diff.unchanged).toEqual(idsExcept('greens.shred'));
    expect(r.diff.servingShiftMin).toBe(0);
  });

  it('RB-c: no slip (R4) at -60; every start, end, lane and wait as H1; nothing moves', () => {
    const r = rebuilt(H1_SCHEDULE, RB_C_PROGRESS, RB_C_NOW);
    expect(rowsOf(r)).toEqual(
      h1Rows({
        'chicken.prep': [-110, -100, 0, false, null],
        'chicken.roast': [-100, -25, 0, false, 0],
        'greens.shred': [-100, -95, 0, false, null],
      }),
    );
    expect(laneRowsOf(r)).toEqual(H1_LANES);
    expect([r.schedule.servingMin, r.schedule.spanMin, r.schedule.chainMin]).toEqual([0, 110, 110]);
    expect(r.schedule.warnings).toEqual([]);
    expect(r.diff.moved).toEqual([]);
    expect(r.diff.unchanged).toEqual(ALL_IDS);
    expect(r.diff.servingShiftMin).toBe(0);
  });
});

describe('RQ1 to RQ9 rebuild: the situations E1 to E8 of the design', () => {
  it('E1 finished early: nothing moves (R3), serving 0, the roast waits 10 > 5', () => {
    const r = rebuilt(H1_SCHEDULE, E1_PROGRESS, E1_NOW);
    expect(r.diff.moved).toEqual([]);
    expect(r.schedule.servingMin).toBe(0);
    expect(rowsOf(r)['chicken.roast']).toEqual([-100, -35, 0, false, 10]);
    expect(rowsOf(r)['chicken.rest']).toEqual([-25, -5, 0, true, 0]);
    expect(warningsOf(r)).toEqual([['chicken.roast', 10, 5]]);
  });

  it('E2 started early: roast [-102,-27); only chicken.roast moves, -100 to -102; its wait is 2, within its hold, no warning', () => {
    const r = rebuilt(H1_SCHEDULE, E2_PROGRESS, E2_NOW);
    expect(rowsOf(r)['chicken.roast']).toEqual([-102, -27, 0, false, 2]);
    expect(movesOf(r)).toEqual([['chicken.roast', -100, -102]]);
    expect(r.schedule.servingMin).toBe(0);
    expect(warningsOf(r)).toEqual([]);
  });

  it('E3 overrun without taps: roast ends now [-100,-20); rest [-20,0), carve [0,5), serving 5, the hot steps re-aligned, no warnings', () => {
    const r = rebuilt(H1_SCHEDULE, E3_PROGRESS, E3_NOW);
    const rows = rowsOf(r);
    expect(rows['chicken.roast']?.slice(0, 2)).toEqual([-100, -20]);
    expect(rows['chicken.rest']?.slice(0, 2)).toEqual([-20, 0]);
    expect(rows['chicken.carve']?.slice(0, 2)).toEqual([0, 5]);
    expect(rows['greens.toss']?.[0]).toBe(-1);
    expect(rows['gravy.strain']?.[0]).toBe(-3);
    expect(rows['greens.boil']?.[0]).toBe(-5);
    expect(rows['gravy.simmer']?.[0]).toBe(-13);
    expect(rows['gravy.roux']?.[0]).toBe(-15);
    expect(r.schedule.servingMin).toBe(5);
    expect(r.schedule.warnings).toEqual([]);
    expect(r.diff.servingShiftMin).toBe(5);
  });

  it('E4 done long: nothing moves, serving 0, no warnings', () => {
    const r = rebuilt(H1_SCHEDULE, E4_PROGRESS, E4_NOW);
    expect(r.diff.moved).toEqual([]);
    expect(r.schedule.servingMin).toBe(0);
    expect(r.schedule.warnings).toEqual([]);
    expect(rowsOf(r)['greens.shred']).toEqual([-100, -88, 0, false, null]);
  });

  it('E5 all done late: nothing planned; serving 3, shift 3; strain waits 9, toss waits 8 and is warned', () => {
    const r = rebuilt(H1_SCHEDULE, E5_PROGRESS, E5_NOW);
    expect(r.schedule.servingMin).toBe(3);
    expect(r.diff.servingShiftMin).toBe(3);
    expect(r.diff.moved).toEqual([]);
    const rows = rowsOf(r);
    expect(Object.values(rows).map((x) => [x[2], x[3]])).toEqual(ALL_IDS.map(() => [0, false]));
    expect(rows['gravy.strain']?.[4]).toBe(9);
    expect(rows['greens.toss']?.[4]).toBe(8);
    expect(warningsOf(r)).toEqual([['greens.toss', 8, 5]]);
  });

  it("E5' all done early: serving stays 0 (R5, C5); carve waits 2; no warnings", () => {
    const r = rebuilt(H1_SCHEDULE, E5_EARLY_PROGRESS, E5_EARLY_NOW);
    expect(r.schedule.servingMin).toBe(0);
    expect(r.diff.servingShiftMin).toBe(0);
    expect(rowsOf(r)['chicken.carve']).toEqual([-5, -2, 0, false, 2]);
    expect(r.schedule.warnings).toEqual([]);
  });

  it('E6 out of order: boil [-2,2) on burner 2 waits 0; serving 2 (C3); toss waits 7 and is warned; only boil moves', () => {
    const r = rebuilt(H1_SCHEDULE, E6_PROGRESS, E6_NOW);
    expect(rowsOf(r)['greens.boil']).toEqual([-2, 2, 0, true, 0]);
    expect(laneRowsOf(r)['greens.boil']).toEqual([2, null, null]);
    expect(r.schedule.servingMin).toBe(2);
    expect(warningsOf(r)).toEqual([['greens.toss', 7, 5]]);
    expect(movesOf(r)).toEqual([['greens.boil', -10, -2]]);
  });

  it('E7 one oven, two pans (C2): ok; both pans on oven lane 1; serving 0; only pie.bake moves, -40 to -60; both warned', () => {
    const r = rebuilt(H3_SCHEDULE, E7_PROGRESS, E7_NOW);
    const lanes = laneRowsOf(r);
    expect([lanes['pie.bake']?.[1], lanes['potatoes.roast']?.[1]]).toEqual([1, 1]);
    expect(r.schedule.servingMin).toBe(0);
    expect(movesOf(r)).toEqual([['pie.bake', -40, -60]]);
    expect(warningsOf(r)).toEqual([
      ['pie.bake', 20, 10],
      ['potatoes.roast', 40, 10],
    ]);
  });

  it('E8 untap (C4): from E6 output, toss untapped at 0: boil [0,4) then toss [4,5); serving 5, shift 3', () => {
    const e6 = rebuilt(H1_SCHEDULE, E6_PROGRESS, E6_NOW).schedule;
    const r = rebuilt(e6, E8_PROGRESS, E8_NOW);
    const rows = rowsOf(r);
    expect(rows['greens.boil']?.slice(0, 2)).toEqual([0, 4]);
    expect(rows['greens.toss']?.slice(0, 2)).toEqual([4, 5]);
    expect(r.schedule.servingMin).toBe(5);
    expect(r.diff.servingShiftMin).toBe(3);
    expect(movesOf(r)).toEqual([
      ['greens.boil', -2, 0],
      ['greens.toss', -6, 4],
    ]);
  });
});

describe('RQ1.2 rebuild errors, each with its exact error', () => {
  const at60 = (progress: unknown, now: unknown = -60): RebuildError =>
    failure(H1_SCHEDULE, progress, now);
  it('unknown_step: an id not in the plan', () => {
    expect(at60({ 'chicken.fry': { state: 'done', startMin: -100, endMin: -90 } })).toEqual({
      kind: 'unknown_step',
      stepId: 'chicken.fry',
    });
  });
  it('unknown_step names the smallest unknown id', () => {
    const entry = { state: 'done', startMin: -100, endMin: -90 };
    expect(at60({ 'zz.last': entry, 'aa.first': entry })).toEqual({
      kind: 'unknown_step',
      stepId: 'aa.first',
    });
  });
  it('done_ends_before_start: shred done [-95,-100)', () => {
    expect(at60({ 'greens.shred': { state: 'done', startMin: -95, endMin: -100 } })).toEqual({
      kind: 'done_ends_before_start',
      stepId: 'greens.shred',
    });
  });
  it('done_after_now: shred done [-100,-50) at now -60', () => {
    expect(at60({ 'greens.shred': { state: 'done', startMin: -100, endMin: -50 } })).toEqual({
      kind: 'done_after_now',
      stepId: 'greens.shred',
    });
  });
  it('running_starts_after_now: roast running from -50 at now -60', () => {
    expect(at60({ 'chicken.roast': { state: 'running', startMin: -50, extraMin: 0 } })).toEqual({
      kind: 'running_starts_after_now',
      stepId: 'chicken.roast',
    });
  });
  it('invalid_now: -60.5, NaN, 1441 and a string', () => {
    for (const now of [-60.5, Number.NaN, 1441, 'x', null, Number.POSITIVE_INFINITY]) {
      expect(at60({}, now)).toEqual({ kind: 'invalid_now' });
    }
  });
  it('invalid_now: below the axis minimum -38400', () => {
    expect(at60({}, -38401)).toEqual({ kind: 'invalid_now' });
  });
  it('invalid_progress: a done entry without endMin, and a progress that is not an object', () => {
    expect(at60({ 'greens.shred': { state: 'done', startMin: -100 } })).toEqual({
      kind: 'invalid_progress',
    });
    expect(at60(42)).toEqual({ kind: 'invalid_progress' });
  });
  it('the checks run in order: invalid_now before invalid_progress before unknown_step', () => {
    expect(at60(42, 1441)).toEqual({ kind: 'invalid_now' });
    expect(at60({ 'chicken.fry': { state: 'nope' } })).toEqual({ kind: 'invalid_progress' });
  });
  it('invalid_schedule shape: a step ending at 1 without servingMin, and rebuild(null, 42, "x")', () => {
    const bad = {
      ...H1_SCHEDULE,
      steps: H1_SCHEDULE.steps.map((x) => (x.id === 'greens.toss' ? { ...x, endMin: 1 } : x)),
    };
    expect(failure(bad, {}, -60)).toEqual({
      kind: 'invalid_schedule',
      reason: 'shape',
      issues: [],
    });
    expect(failure(null, 42, 'x')).toEqual({
      kind: 'invalid_schedule',
      reason: 'shape',
      issues: [],
    });
  });
  it('invalid_schedule plan: a step that depends on itself, with the sanity issue', () => {
    const plan = {
      ...H1_SCHEDULE.plan,
      steps: H1_SCHEDULE.plan.steps.map((x) =>
        x.id === 'greens.toss' ? { ...x, after: [...x.after, 'greens.toss'] } : x,
      ),
    };
    const e = failure({ ...H1_SCHEDULE, plan }, {}, -60);
    expect(e).toMatchObject({ kind: 'invalid_schedule', reason: 'plan' });
    const issues = (e as { issues: { code: string; stepId?: string }[] }).issues;
    expect(issues.map((i) => [i.code, i.stepId])).toContainEqual([
      'self_dependency',
      'greens.toss',
    ]);
  });
  it('invalid_schedule kitchen: burners 0 gives the 3 missing_appliance issues', () => {
    const e = failure({ ...H1_SCHEDULE, kitchen: { burners: 0, ovens: 1, cooks: 1 } }, {}, -60);
    expect(e).toMatchObject({ kind: 'invalid_schedule', reason: 'kitchen' });
    const issues = (e as { issues: { code: string; stepId: string }[] }).issues;
    expect(issues.map((i) => [i.code, i.stepId])).toEqual([
      ['missing_appliance', 'gravy.roux'],
      ['missing_appliance', 'gravy.simmer'],
      ['missing_appliance', 'greens.boil'],
    ]);
  });
  it('invalid_schedule step_ids: one step removed from the schedule rows', () => {
    const e = failure({ ...H1_SCHEDULE, steps: H1_SCHEDULE.steps.slice(1) }, {}, -60);
    expect(e).toEqual({ kind: 'invalid_schedule', reason: 'step_ids', issues: [] });
  });
  it('serving_out_of_range: now 1440 with nothing done puts the last end at 1550', () => {
    expect(failure(H1_SCHEDULE, {}, 1440)).toEqual({
      kind: 'serving_out_of_range',
      servingMin: 1550,
    });
  });
  it('serving_out_of_range is checked last: a bad progress at now 1440 is reported first', () => {
    expect(
      failure(H1_SCHEDULE, { 'chicken.fry': { state: 'done', startMin: 0, endMin: 1 } }, 1440),
    ).toEqual({
      kind: 'unknown_step',
      stepId: 'chicken.fry',
    });
  });
  it('RQ1.3 values of every wrong kind give an error and no throw', () => {
    for (const bad of [undefined, null, 0, 'x', [], {}, () => 1]) {
      expect(rebuild(bad as never, bad as never, bad as never).ok).toBe(false);
    }
  });
});

describe('RQ9.3 and RQ1.3 rebuild repeats and leaves its arguments alone', () => {
  it("RB-a's output, rebuilt with RB-a's progress and now, equals RB-a's schedule with an empty diff", () => {
    const first = rebuilt(H1_SCHEDULE, RB_A_PROGRESS, RB_A_NOW);
    const second = rebuilt(first.schedule, RB_A_PROGRESS, RB_A_NOW);
    expect(second.schedule).toEqual(first.schedule);
    expect(second.diff).toEqual({
      moved: [],
      unchanged: ALL_IDS,
      servingShiftMin: 0,
    });
  });
  it('the schedule, the progress and now are unchanged after the call', () => {
    const schedule = structuredClone(H1_SCHEDULE);
    const progress = structuredClone(RB_A_PROGRESS);
    rebuild(schedule, progress, RB_A_NOW);
    expect(schedule).toEqual(H1_SCHEDULE);
    expect(progress).toEqual(RB_A_PROGRESS);
  });
  it('a step done in zero time (end == start) is accepted and occupies nothing: all done at H1, shred in zero time', () => {
    const progress: Progress = Object.fromEntries(
      Object.entries(H1_ROWS).map(([id, row]): [string, Progress[string]] => [
        id,
        id === 'greens.shred'
          ? { state: 'done', startMin: -100, endMin: -100 }
          : { state: 'done', startMin: row[0], endMin: row[1] },
      ]),
    );
    const r = rebuilt(H1_SCHEDULE, progress, 0);
    expect(rowsOf(r)['greens.shred']).toEqual([-100, -100, 0, false, null]);
    expect(r.schedule.servingMin).toBe(0);
    expect(r.diff.moved).toEqual([]);
  });
});
