import { describe, expect, it } from 'vitest';
import { forwardRepair } from '../../src/core/passes/forward-repair.js';
import { assignRebuildLanes } from '../../src/core/passes/lanes.js';
import { rebuildReadout } from '../../src/core/passes/readout.js';
import { reAlign } from '../../src/core/passes/re-align.js';
import { canonicalPlan } from '../../src/core/schema.js';
import type { StepLanes } from '../../src/core/schema.js';
import { capacityOf, timelineFrom } from '../../src/core/timeline.js';
import type { Interval } from '../../src/core/timeline.js';
import {
  E1_PROGRESS,
  E2_PROGRESS,
  E5_EARLY_PROGRESS,
  E5_PROGRESS,
  E6_PROGRESS,
  H1_SCHEDULE,
  H3_SCHEDULE,
  HOME_KITCHEN,
  RB_A_PROGRESS,
  RB_B2_PROGRESS,
  RB_B_PROGRESS,
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
  'chicken.roast': 5,
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
  it('RB-a: slack 0 everywhere, the waits of the table, and the two warnings with their exact messages', () => {
    expect(readoutOf(RB_A_FINAL, RB_A_PROGRESS, -60, 15)).toEqual({
      slack: ALL_SLACK_ZERO,
      wait: { ...H1_WAITS, 'chicken.roast': 6, 'gravy.strain': 5, 'greens.toss': 7 },
      warnings: [
        warning(
          'chicken.roast',
          6,
          5,
          'Step chicken.roast will be ready 6 minutes before the step that uses it and can wait only 5 minutes. More ovens, burners or cooks may help.',
        ),
        warning(
          'greens.toss',
          7,
          5,
          'Step greens.toss will be ready 7 minutes before serving and can wait only 5 minutes. More ovens, burners or cooks may help.',
        ),
      ],
    });
  });
  it('RB-b: the tin juices wait 13 minutes for the late roux, toss waits 7; carve waits 2 for serving at 2', () => {
    expect(readoutOf(RB_B_FINAL, RB_B_PROGRESS, -12, 2)).toEqual({
      slack: ALL_SLACK_ZERO,
      wait: {
        ...H1_WAITS,
        'chicken.carve': 2,
        'chicken.roast': 13,
        'gravy.strain': 0,
        'greens.toss': 7,
      },
      warnings: [
        warning('chicken.roast', 13, 5, ROAST_MSG(13)),
        warning('greens.toss', 7, 5, TOSS_MSG(7)),
      ],
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
  it('E1: the roast, done at -35, waits 15 > 5; nothing else moves', () => {
    const r = readoutOf(h1With({ 'chicken.roast': iv(-100, -35) }), E1_PROGRESS, -35, 0);
    expect(r.wait).toEqual({ ...H1_WAITS, 'chicken.roast': 15 });
    expect(r.slack).toEqual(ALL_SLACK_ZERO);
    expect(r.warnings).toEqual([warning('chicken.roast', 15, 5, ROAST_MSG(15))]);
  });
  it('E2: the roast, started early, ends at -27 and waits 7 > 5; shred keeps its slack 75', () => {
    const r = readoutOf(
      h1With({ 'chicken.prep': iv(-110, -102), 'chicken.roast': iv(-102, -27) }),
      E2_PROGRESS,
      -100,
      0,
    );
    expect(r.wait).toEqual({ ...H1_WAITS, 'chicken.roast': 7 });
    expect(r.slack).toEqual({ ...ALL_SLACK_ZERO, 'greens.shred': 75 });
    expect(r.warnings).toEqual([warning('chicken.roast', 7, 5, ROAST_MSG(7))]);
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
