import { describe, expect, it } from 'vitest';
import type {
  Appliance,
  Kitchen,
  Plan,
  RebuiltStep,
  Schedule,
  ScheduledStep,
  Step,
} from '../../src/core/schema.js';
import {
  AXIS_MS,
  BARE_KITCHEN,
  CM_F_FACTS,
  cmAt,
  E7_NOW,
  E7_PROGRESS,
  H1_SCHEDULE,
  H3_SCHEDULE,
  HOME_KITCHEN,
  MEZZE,
  NO_BURNER_KITCHEN,
  ONE_BURNER_KITCHEN,
  PREP_AHEAD,
  RB_A_NOW,
  RB_A_PROGRESS,
  RB_B_NOW,
  RB_B_PROGRESS,
  RB_C_NOW,
  RB_C_PROGRESS,
  SUNDAY_ROAST,
  SUNDAY_ROAST_DINNERFILE,
  SUNDAY_ROAST_MAKE_DINNER,
  SUNDAY_ROAST_MAKE_GRAVY,
  TIGHT_OVEN,
  TWO_CHOPS,
  WORST_CASE,
  WORST_CASE_DINNERFILE,
  WORST_CASE_MAKE_DINNER,
} from '../support/fixtures.js';
import {
  CANONICAL_STYLE,
  decodeEchoLine,
  isCycleIn,
  type Iv,
  oracleCapacityViolations,
  oracleDinnerfile,
  oracleDishLastSteps,
  oracleEchoText,
  oracleEncodeText,
  oracleMakeLines,
  oracleNeededSteps,
  oracleCompletenessViolations,
  oracleCookSections,
  oracleOverdue,
  oracleHoldExceeded,
  oracleLaneViolations,
  oracleLatestPosition,
  oracleLongestChain,
  oracleForwardRepair,
  oracleNormalise,
  oraclePendingOverfull,
  oraclePinnedIntervals,
  oraclePrecedenceViolations,
  oracleRebuildHoldExceeded,
  oracleRebuildLaneViolations,
  oracleRebuildSlack,
  oracleRebuildViolations,
  oracleRebuildWaits,
  oracleSlack,
  oracleValid,
  oracleWaits,
  startsOf,
  oracleShortestCycleLength,
  oracleStronglyConnected,
  oracleSuccessors,
  oracleTopologicalOrder,
  oracleWarnings,
  respectsPrecedence,
  oracleMaxInWindow,
  oracleUtcDay,
} from '../support/oracles.js';

interface Spec {
  id: string;
  after?: string[];
  minutes?: number;
  appliance?: Appliance;
  handsOn?: boolean;
  title?: string;
  detail?: string;
}

/** A plan from short step specs; the dish is the part of the id before the dot. */
function planOf(specs: Spec[]): Plan {
  const dishIds = [...new Set(specs.map((s) => s.id.split('.')[0] ?? ''))];
  const steps: Step[] = specs.map((s) => ({
    id: s.id,
    dish: s.id.split('.')[0] ?? '',
    title: s.title ?? 'Do the thing',
    ...(s.detail === undefined ? {} : { detail: s.detail }),
    minutes: s.minutes ?? 5,
    appliance: s.appliance ?? 'none',
    handsOn: s.handsOn ?? true,
    after: s.after ?? [],
    holdMin: null,
  }));
  return { title: 'Test plan', dishes: dishIds.map((id) => ({ id, name: id })), steps };
}

const terminalOf = (successors: Record<string, string[]>): string[] =>
  Object.keys(successors)
    .filter((id) => successors[id]?.length === 0)
    .sort();

describe('R10.5 oracleSuccessors and terminal steps, hand-worked on the fixtures', () => {
  it('SUNDAY_ROAST: successors of chicken.roast are chicken.rest and gravy.roux', () => {
    const successors = oracleSuccessors(SUNDAY_ROAST);
    expect(successors['chicken.roast']).toEqual(['chicken.rest', 'gravy.roux']);
    expect(successors).toEqual({
      'chicken.prep': ['chicken.roast'],
      'chicken.roast': ['chicken.rest', 'gravy.roux'],
      'chicken.rest': ['chicken.carve'],
      'chicken.carve': [],
      'gravy.roux': ['gravy.simmer'],
      'gravy.simmer': ['gravy.strain'],
      'gravy.strain': [],
      'greens.shred': ['greens.boil'],
      'greens.boil': ['greens.toss'],
      'greens.toss': [],
    });
    expect(terminalOf(successors)).toEqual(['chicken.carve', 'gravy.strain', 'greens.toss']);
  });
  it('MEZZE', () => {
    const successors = oracleSuccessors(MEZZE);
    expect(successors).toEqual({
      'flatbread.mix': ['flatbread.rise'],
      'flatbread.rise': ['flatbread.cook'],
      'flatbread.cook': [],
      'hummus.blend': [],
      'salad.chop': ['salad.toss'],
      'salad.dressing': ['salad.toss'],
      'salad.toss': [],
    });
    expect(terminalOf(successors)).toEqual(['flatbread.cook', 'hummus.blend', 'salad.toss']);
  });
  it('TIGHT_OVEN', () => {
    const successors = oracleSuccessors(TIGHT_OVEN);
    expect(successors).toEqual({
      'pie.assemble': ['pie.bake'],
      'pie.bake': [],
      'potatoes.peel': ['potatoes.roast'],
      'potatoes.roast': [],
    });
    expect(terminalOf(successors)).toEqual(['pie.bake', 'potatoes.roast']);
  });
  it('R3.1 ignores unknown after entries and sorts and merges duplicate ids', () => {
    const plan = planOf([
      { id: 'a.one' },
      { id: 'a.two', after: ['a.one', 'a.missing'] },
      { id: 'a.two', after: ['a.zero'] },
      { id: 'a.zero' },
    ]);
    expect(oracleSuccessors(plan)).toEqual({
      'a.one': ['a.two'],
      'a.two': [],
      'a.zero': ['a.two'],
    });
  });
  it('lists a repeated after entry once', () => {
    const plan = planOf([{ id: 'a.one' }, { id: 'a.two', after: ['a.one', 'a.one'] }]);
    expect(oracleSuccessors(plan)['a.one']).toEqual(['a.two']);
  });
});

describe('R10.5 oracleTopologicalOrder and respectsPrecedence', () => {
  it('SUNDAY_ROAST: smallest ready id first', () => {
    expect(oracleTopologicalOrder(SUNDAY_ROAST)).toEqual([
      'chicken.prep',
      'chicken.roast',
      'chicken.rest',
      'chicken.carve',
      'gravy.roux',
      'gravy.simmer',
      'gravy.strain',
      'greens.shred',
      'greens.boil',
      'greens.toss',
    ]);
  });
  it('MEZZE', () => {
    expect(oracleTopologicalOrder(MEZZE)).toEqual([
      'flatbread.mix',
      'flatbread.rise',
      'flatbread.cook',
      'hummus.blend',
      'salad.chop',
      'salad.dressing',
      'salad.toss',
    ]);
  });
  it('TIGHT_OVEN', () => {
    expect(oracleTopologicalOrder(TIGHT_OVEN)).toEqual([
      'pie.assemble',
      'pie.bake',
      'potatoes.peel',
      'potatoes.roast',
    ]);
  });
  it('returns null when the plan has a cycle or a self-dependency', () => {
    const cycle = planOf([
      { id: 'a.x', after: ['a.z'] },
      { id: 'a.y', after: ['a.x'] },
      { id: 'a.z', after: ['a.y'] },
    ]);
    expect(oracleTopologicalOrder(cycle)).toBeNull();
    expect(oracleTopologicalOrder(planOf([{ id: 'a.x', after: ['a.x'] }]))).toBeNull();
  });
  it('respectsPrecedence accepts a valid order', () => {
    expect(
      respectsPrecedence(TIGHT_OVEN, [
        'pie.assemble',
        'pie.bake',
        'potatoes.peel',
        'potatoes.roast',
      ]),
    ).toBe(true);
    expect(
      respectsPrecedence(TIGHT_OVEN, [
        'potatoes.peel',
        'pie.assemble',
        'potatoes.roast',
        'pie.bake',
      ]),
    ).toBe(true);
  });
  it('respectsPrecedence rejects a step before its prerequisite', () => {
    expect(
      respectsPrecedence(TIGHT_OVEN, [
        'pie.bake',
        'pie.assemble',
        'potatoes.peel',
        'potatoes.roast',
      ]),
    ).toBe(false);
  });
  it('respectsPrecedence rejects an order with a missing, repeated or foreign id', () => {
    expect(respectsPrecedence(TIGHT_OVEN, ['pie.assemble', 'pie.bake', 'potatoes.peel'])).toBe(
      false,
    );
    expect(
      respectsPrecedence(TIGHT_OVEN, [
        'pie.assemble',
        'pie.assemble',
        'pie.bake',
        'potatoes.peel',
        'potatoes.roast',
      ]),
    ).toBe(false);
    expect(
      respectsPrecedence(TIGHT_OVEN, ['pie.assemble', 'pie.bake', 'potatoes.peel', 'x.y']),
    ).toBe(false);
  });
});

describe('R10.5 oracleLongestChain: hand-worked 110, 82 and 55', () => {
  it('SUNDAY_ROAST is 110 (10 + 75 + 20 + 5), not the gravy chain 99', () => {
    expect(oracleLongestChain(SUNDAY_ROAST)).toBe(110);
  });
  it('MEZZE is 82 (10 + 60 + 12)', () => {
    expect(oracleLongestChain(MEZZE)).toBe(82);
  });
  it('TIGHT_OVEN is 55', () => {
    expect(oracleLongestChain(TIGHT_OVEN)).toBe(55);
  });
  it('R3.1 takes the largest minutes of a duplicated id', () => {
    const plan = planOf([
      { id: 'a.one', minutes: 5 },
      { id: 'a.one', minutes: 9 },
      { id: 'a.two', minutes: 1, after: ['a.one'] },
    ]);
    expect(oracleLongestChain(plan)).toBe(10);
  });
  it('a lone step is its own chain', () => {
    expect(oracleLongestChain(planOf([{ id: 'a.one', minutes: 7 }]))).toBe(7);
  });
});

// a.x waits on a.z, a.y waits on a.x, a.z waits on a.y: x → y → z → x.
const THREE_CYCLE = planOf([
  { id: 'a.x', after: ['a.z'] },
  { id: 'a.y', after: ['a.x'] },
  { id: 'a.z', after: ['a.y'] },
]);

describe('R10.5 isCycleIn', () => {
  it('accepts the 3-cycle in order and in any rotation', () => {
    expect(isCycleIn(THREE_CYCLE, ['a.x', 'a.y', 'a.z'])).toBe(true);
    expect(isCycleIn(THREE_CYCLE, ['a.y', 'a.z', 'a.x'])).toBe(true);
  });
  it('rejects the reverse direction', () => {
    expect(isCycleIn(THREE_CYCLE, ['a.x', 'a.z', 'a.y'])).toBe(false);
  });
  it('rejects a path of one step, a repeated id and an unknown id', () => {
    expect(isCycleIn(THREE_CYCLE, ['a.x'])).toBe(false);
    expect(isCycleIn(THREE_CYCLE, ['a.x', 'a.y', 'a.x'])).toBe(false);
    expect(isCycleIn(THREE_CYCLE, ['a.x', 'a.y', 'a.q'])).toBe(false);
  });
  it('rejects a path whose closing edge is missing', () => {
    const chain = planOf([
      { id: 'a.x' },
      { id: 'a.y', after: ['a.x'] },
      { id: 'a.z', after: ['a.y'] },
    ]);
    expect(isCycleIn(chain, ['a.x', 'a.y', 'a.z'])).toBe(false);
  });
  it('rejects a self-dependency as a cycle of one', () => {
    expect(isCycleIn(planOf([{ id: 'a.x', after: ['a.x'] }]), ['a.x'])).toBe(false);
  });
});

// Two 2-and-3 step cycles, a step that merely waits on one of them, and a self-loop.
const TWO_CYCLES = planOf([
  { id: 'a.x', after: ['a.y'] },
  { id: 'a.y', after: ['a.x'] },
  { id: 'b.p', after: ['b.r'] },
  { id: 'b.q', after: ['b.p'] },
  { id: 'b.r', after: ['b.q'] },
  { id: 'c.s', after: ['a.x'] },
  { id: 'd.t', after: ['d.t'] },
]);

describe('R10.5 oracleStronglyConnected', () => {
  it('gives the 3-cycle as one group', () => {
    expect(oracleStronglyConnected(THREE_CYCLE)).toEqual([['a.x', 'a.y', 'a.z']]);
  });
  it('gives two disjoint cycles as two groups in first-id order, leaving out c.s and the self-loop', () => {
    expect(oracleStronglyConnected(TWO_CYCLES)).toEqual([
      ['a.x', 'a.y'],
      ['b.p', 'b.q', 'b.r'],
    ]);
  });
  it('gives nothing for the acyclic fixtures', () => {
    expect(oracleStronglyConnected(SUNDAY_ROAST)).toEqual([]);
    expect(oracleStronglyConnected(MEZZE)).toEqual([]);
    expect(oracleStronglyConnected(TIGHT_OVEN)).toEqual([]);
  });
});

describe('R10.5 oracleShortestCycleLength', () => {
  it('is 3 for each step of the 3-cycle', () => {
    for (const id of ['a.x', 'a.y', 'a.z']) {
      expect(oracleShortestCycleLength(THREE_CYCLE, id)).toBe(3);
    }
  });
  it('is 2 through a step that also sits in a 2-cycle, and still 3 through the others', () => {
    // x → y → z → x, plus x → w → x.
    const plan = planOf([
      { id: 'a.x', after: ['a.z', 'a.w'] },
      { id: 'a.y', after: ['a.x'] },
      { id: 'a.z', after: ['a.y'] },
      { id: 'a.w', after: ['a.x'] },
    ]);
    expect(oracleShortestCycleLength(plan, 'a.x')).toBe(2);
    expect(oracleShortestCycleLength(plan, 'a.w')).toBe(2);
    expect(oracleShortestCycleLength(plan, 'a.y')).toBe(3);
  });
  it('is null for a step on no cycle, for a self-loop only, and for an unknown id', () => {
    expect(oracleShortestCycleLength(TWO_CYCLES, 'c.s')).toBeNull();
    expect(oracleShortestCycleLength(TWO_CYCLES, 'd.t')).toBeNull();
    expect(oracleShortestCycleLength(TWO_CYCLES, 'z.z')).toBeNull();
  });
});

describe('R10.5 oracleWarnings', () => {
  const none = (title: string, extra: Partial<Spec> = {}): Plan =>
    planOf([{ id: 'a.one', title, appliance: 'none', ...extra }]);
  const mismatch = [{ code: 'appliance_mismatch', stepId: 'a.one' }];

  it('R5.1 fires on "Roasting tin" for an appliance-free step', () => {
    expect(oracleWarnings(none('Roasting tin'))).toEqual(mismatch);
  });
  it('R5.1 fires on "stir-fry", on "saute\\u0301" and on a detail-only match', () => {
    expect(oracleWarnings(none('Stir-fry the onions'))).toEqual(mismatch);
    expect(oracleWarnings(none('Saute\u0301 the onions'))).toEqual(mismatch);
    expect(oracleWarnings(none('Prepare the onions', { detail: 'Then sear them.' }))).toEqual(
      mismatch,
    );
  });
  it('R5.1 fires once for a step with two words', () => {
    expect(oracleWarnings(none('Boil, then fry', { detail: 'Bake after.' }))).toEqual(mismatch);
  });
  it('R5.1 does not fire on "ovenproof", "boiler" or "roaster"', () => {
    expect(oracleWarnings(none('Find an ovenproof dish'))).toEqual([]);
    expect(oracleWarnings(none('Check the boiler'))).toEqual([]);
    expect(oracleWarnings(none('Wash the roaster'))).toEqual([]);
  });
  it('R5.1 does not fire for a burner step that says boil', () => {
    expect(
      oracleWarnings(planOf([{ id: 'a.one', title: 'Boil the water', appliance: 'burner' }])),
    ).toEqual([]);
  });
  it('R5.2 long_hands_on: 45 does not fire, 46 does', () => {
    expect(oracleWarnings(planOf([{ id: 'a.one', minutes: 45, handsOn: true }]))).toEqual([]);
    expect(oracleWarnings(planOf([{ id: 'a.one', minutes: 46, handsOn: true }]))).toEqual([
      { code: 'long_hands_on', stepId: 'a.one' },
    ]);
    expect(oracleWarnings(planOf([{ id: 'a.one', minutes: 46, handsOn: false }]))).toEqual([]);
  });
  it('R5.3 short_hands_free: 1 fires, 2 does not, 1 with handsOn or an appliance does not', () => {
    const short = [{ code: 'short_hands_free', stepId: 'a.one' }];
    expect(oracleWarnings(planOf([{ id: 'a.one', minutes: 1, handsOn: false }]))).toEqual(short);
    expect(oracleWarnings(planOf([{ id: 'a.one', minutes: 2, handsOn: false }]))).toEqual([]);
    expect(oracleWarnings(planOf([{ id: 'a.one', minutes: 1, handsOn: true }]))).toEqual([]);
    expect(
      oracleWarnings(planOf([{ id: 'a.one', minutes: 1, handsOn: false, appliance: 'oven' }])),
    ).toEqual([]);
  });
  it('the fixtures give no warnings', () => {
    expect(oracleWarnings(SUNDAY_ROAST)).toEqual([]);
    expect(oracleWarnings(MEZZE)).toEqual([]);
    expect(oracleWarnings(TIGHT_OVEN)).toEqual([]);
  });
  it('lists warnings sorted by code then step id', () => {
    const plan = planOf([
      { id: 'b.two', title: 'Roast it', appliance: 'none' },
      { id: 'a.one', title: 'Bake it', appliance: 'none' },
      { id: 'a.long', minutes: 50, handsOn: true },
    ]);
    expect(oracleWarnings(plan)).toEqual([
      { code: 'appliance_mismatch', stepId: 'a.one' },
      { code: 'appliance_mismatch', stepId: 'b.two' },
      { code: 'long_hands_on', stepId: 'a.long' },
    ]);
  });
});

describe('R9.1 oracleNormalise, one example per rule', () => {
  it('NFC', () => {
    expect(oracleNormalise('caf\u0065\u0301')).toBe('caf\u00e9');
  });
  it('CRLF to LF', () => {
    expect(oracleNormalise('a\r\nb')).toBe('a\nb');
  });
  it('lone CR to LF', () => {
    expect(oracleNormalise('a\rb')).toBe('a\nb');
  });
  it('CRLF, lone CR and LF together', () => {
    expect(oracleNormalise('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
  it('trailing spaces and tabs are removed from every line', () => {
    expect(oracleNormalise('a \t \nb\t\nc')).toBe('a\nb\nc');
  });
  it('trailing no-break space is white space', () => {
    expect(oracleNormalise('a\u00a0\nb')).toBe('a\nb');
  });
  it('two blank lines become one', () => {
    expect(oracleNormalise('a\n\n\nb')).toBe('a\n\nb');
  });
  it('three blank lines become one', () => {
    expect(oracleNormalise('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('one blank line stays', () => {
    expect(oracleNormalise('a\n\nb')).toBe('a\n\nb');
  });
  it('a line of only spaces counts as blank', () => {
    expect(oracleNormalise('a\n   \n\t\nb')).toBe('a\n\nb');
  });
  it('trims the whole text', () => {
    expect(oracleNormalise('\n\n  a\nb  \n\n')).toBe('a\nb');
  });
  it('keeps indentation after the first line', () => {
    expect(oracleNormalise('Steps:\n  1. Peel\n    2. Chop')).toBe(
      'Steps:\n  1. Peel\n    2. Chop',
    );
  });
  it('an empty or white-space-only text gives an empty string', () => {
    expect(oracleNormalise('')).toBe('');
    expect(oracleNormalise(' \r\n \t ')).toBe('');
  });
});

// ---------------------------------------------------------------------------------------
// Scheduler spec, T2.2: the scheduler oracles against the hand-worked tables H1 to H5.

/** [id, startMin, endMin, burner, oven, cook, slackMin, waitMin], as in the design tables. */
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

const H1: readonly Row[] = [
  ['chicken.carve', -5, 0, null, null, 1, 0, 0],
  ['chicken.prep', -110, -100, null, null, 1, 0, null],
  ['chicken.rest', -25, -5, null, null, null, 0, 0],
  ['chicken.roast', -100, -25, null, 1, null, 0, 0],
  ['gravy.roux', -20, -18, 1, null, 1, 0, 0],
  ['gravy.simmer', -18, -8, 1, null, null, 0, 0],
  ['gravy.strain', -8, -6, null, null, 1, 0, 6],
  ['greens.boil', -10, -6, 2, null, null, 0, 0],
  ['greens.shred', -100, -95, null, null, 1, 75, null],
  ['greens.toss', -6, -5, null, null, 1, 0, 5],
];
const H2: readonly Row[] = [
  ['chicken.carve', -5, 0, null, null, 1, 0, 0],
  ['chicken.prep', -110, -100, null, null, 1, 0, null],
  ['chicken.rest', -25, -5, null, null, null, 0, 0],
  ['chicken.roast', -100, -25, null, 1, null, 0, 0],
  ['gravy.roux', -22, -20, 1, null, 1, 0, 0],
  ['gravy.simmer', -20, -10, 1, null, null, 0, 2],
  ['gravy.strain', -8, -6, null, null, 1, 0, 6],
  ['greens.boil', -10, -6, 1, null, null, 0, 0],
  ['greens.shred', -100, -95, null, null, 1, 73, null],
  ['greens.toss', -6, -5, null, null, 1, 0, 5],
];
const H3: readonly Row[] = [
  ['pie.assemble', -85, -70, null, null, 1, 30, null],
  ['pie.bake', -40, 0, null, 1, null, 0, 0],
  ['potatoes.peel', -95, -85, null, null, 1, 0, null],
  ['potatoes.roast', -85, -40, null, 1, null, 0, 40],
];
const H4: readonly Row[] = [
  ['flatbread.cook', -14, -2, 1, null, 1, 0, 2],
  ['flatbread.mix', -84, -74, null, null, 1, 0, null],
  ['flatbread.rise', -74, -14, null, null, null, 0, 0],
  ['hummus.blend', -74, -64, null, null, 1, 0, null],
  ['salad.chop', -64, -54, null, null, 1, 0, null],
  ['salad.dressing', -54, -49, null, null, 1, 35, null],
  ['salad.toss', -2, 0, null, null, 1, 0, 0],
];
const H5: readonly Row[] = [
  ['bread.bake', -8, 0, null, 1, null, 0, 0],
  ['bread.shape', -13, -8, null, null, 1, 0, 0],
  ['jelly.set', -60, 0, null, null, null, 0, null],
  ['salad.chop', -60, -50, null, null, 1, 37, null],
  ['salad.toss', -2, 0, null, null, 1, 0, 0],
];

const TABLES: readonly (readonly [string, Plan, Kitchen, readonly Row[]])[] = [
  ['H1 SUNDAY_ROAST x HOME_KITCHEN', SUNDAY_ROAST, HOME_KITCHEN, H1],
  ['H2 SUNDAY_ROAST x ONE_BURNER_KITCHEN', SUNDAY_ROAST, ONE_BURNER_KITCHEN, H2],
  ['H3 TIGHT_OVEN x HOME_KITCHEN', TIGHT_OVEN, HOME_KITCHEN, H3],
  ['H4 MEZZE x HOME_KITCHEN', MEZZE, HOME_KITCHEN, H4],
  ['H5 PREP_AHEAD x NO_BURNER_KITCHEN', PREP_AHEAD, NO_BURNER_KITCHEN, H5],
];

const stepsOf = (rows: readonly Row[]): ScheduledStep[] =>
  rows.map(([id, startMin, endMin, burner, oven, cook, slackMin, waitMin]) => ({
    id,
    startMin,
    endMin,
    lanes: { burner, oven, cook },
    slackMin,
    critical: slackMin === 0,
    waitMin,
  }));

describe.each(TABLES)('R10.1 oracles on the hand-worked table %s', (_name, plan, kitchen, rows) => {
  const steps = stepsOf(rows);
  const starts = startsOf(steps);

  it('startsOf reads the start of each step', () => {
    expect(Object.keys(starts).sort()).toEqual(rows.map((r) => r[0]));
    for (const row of rows) expect(starts[row[0]]).toBe(row[1]);
  });
  it('no capacity, precedence, completeness or lane violation, and the schedule is valid', () => {
    expect(oracleCapacityViolations(plan, kitchen, starts)).toEqual([]);
    expect(oraclePrecedenceViolations(plan, starts)).toEqual([]);
    expect(oracleCompletenessViolations(plan, steps)).toEqual([]);
    expect(oracleLaneViolations(plan, kitchen, steps)).toEqual([]);
    expect(oracleValid(plan, kitchen, starts)).toBe(true);
  });
  it('oracleSlack gives the slack column for every step', () => {
    for (const row of rows)
      expect([row[0], oracleSlack(plan, kitchen, starts, row[0])]).toEqual([row[0], row[6]]);
  });
  it('oracleWaits gives the wait column (null where the result keeps)', () => {
    expect(oracleWaits(plan, starts)).toEqual(Object.fromEntries(rows.map((r) => [r[0], r[7]])));
  });
});

describe('G9 oracleLatestPosition on the hand-worked table H5', () => {
  const final = startsOf(stepsOf(H5));
  // Pass 2 output of the design: bread.shape is still at its pass 1 start -17.
  const afterPass2 = { ...final, 'bread.shape': -17 };
  it('bread.shape at -17 can move to -13 (bake starts at -8, shape lasts 5, the cook is free)', () => {
    expect(oracleLatestPosition(PREP_AHEAD, NO_BURNER_KITCHEN, afterPass2, 'bread.shape')).toBe(
      -13,
    );
  });
  it('the final H5 hot steps have no later position', () => {
    for (const id of ['bread.bake', 'bread.shape', 'jelly.set', 'salad.toss']) {
      expect([id, oracleLatestPosition(PREP_AHEAD, NO_BURNER_KITCHEN, final, id)]).toEqual([
        id,
        final[id],
      ]);
    }
  });
  it('salad.chop (keeps) could sit as late as -23 (cook busy with bread.shape from -13); the oracle does not filter by hold', () => {
    expect(oracleLatestPosition(PREP_AHEAD, NO_BURNER_KITCHEN, final, 'salad.chop')).toBe(-23);
  });
  it('a later position past a blocked minute still counts (one cook, gap after a clash)', () => {
    // a.one [-10,-8), a.two [-7,-6), one cook. Delays 2 and 3 clash with a.two, but delay 8
    // gives [-2,0), which is free: the search must not stop at the first clash.
    const plan: Plan = {
      title: 'Gap',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [
        {
          id: 'a.one',
          dish: 'a',
          title: 'One',
          minutes: 2,
          appliance: 'none',
          handsOn: true,
          after: [],
          holdMin: 5,
        },
        {
          id: 'a.two',
          dish: 'a',
          title: 'Two',
          minutes: 1,
          appliance: 'none',
          handsOn: true,
          after: [],
          holdMin: 5,
        },
      ],
    };
    const kitchen: Kitchen = { burners: 0, ovens: 0, cooks: 1 };
    expect(oracleLatestPosition(plan, kitchen, { 'a.one': -10, 'a.two': -7 }, 'a.one')).toBe(-2);
  });
});

describe('R10.1 oracleHoldExceeded on the hand-worked tables', () => {
  it('H3: only potatoes.roast waits past its hold (40 > 10)', () => {
    expect(oracleHoldExceeded(TIGHT_OVEN, startsOf(stepsOf(H3)))).toEqual([
      { stepId: 'potatoes.roast', waitMin: 40, holdMin: 10 },
    ]);
  });
  it('H1, H2, H4 and H5: no step waits past its hold (a wait equal to the hold is fine)', () => {
    expect(oracleHoldExceeded(SUNDAY_ROAST, startsOf(stepsOf(H1)))).toEqual([]);
    expect(oracleHoldExceeded(SUNDAY_ROAST, startsOf(stepsOf(H2)))).toEqual([]);
    expect(oracleHoldExceeded(MEZZE, startsOf(stepsOf(H4)))).toEqual([]);
    expect(oracleHoldExceeded(PREP_AHEAD, startsOf(stepsOf(H5)))).toEqual([]);
  });
  it('H5 pass 1 starts: bread.shape at -17 waits 4 > hold 2', () => {
    const pass1 = { ...startsOf(stepsOf(H5)), 'bread.shape': -17, 'salad.chop': -12 };
    expect(oracleHoldExceeded(PREP_AHEAD, pass1)).toEqual([
      { stepId: 'bread.shape', waitMin: 4, holdMin: 2 },
    ]);
  });
  it('H6 TWO_CHOPS x BARE_KITCHEN: b.chop waits 10 > 5', () => {
    const starts = { 'a.chop': -10, 'b.chop': -20 };
    expect(oracleHoldExceeded(TWO_CHOPS, starts)).toEqual([
      { stepId: 'b.chop', waitMin: 10, holdMin: 5 },
    ]);
    expect(oracleWaits(TWO_CHOPS, starts)).toEqual({ 'a.chop': 0, 'b.chop': 10 });
  });
});

describe('G4.3 a result with several users waits only until the first user starts (steering definition, 2026-11-11)', () => {
  it('H1 with the roast started at -107 (ends -32): rest starts at -25, roux at -20; wait 7, not 12', () => {
    const starts = { ...startsOf(stepsOf(H1)), 'chicken.roast': -107 };
    expect(oracleWaits(SUNDAY_ROAST, starts)['chicken.roast']).toBe(7);
    expect(oracleHoldExceeded(SUNDAY_ROAST, starts)).toEqual([
      { stepId: 'chicken.roast', waitMin: 7, holdMin: 5 },
    ]);
  });
  it('H1 with the roux moved to -2 (the later user): the roast still waits 0 for rest', () => {
    const starts = { ...startsOf(stepsOf(H1)), 'gravy.roux': -2 };
    expect(oracleWaits(SUNDAY_ROAST, starts)['chicken.roast']).toBe(0);
  });
});

describe('R10.1 each hand-made broken schedule gives exactly its one violation', () => {
  const ovens = planOf([
    { id: 'x.a', minutes: 3, appliance: 'oven', handsOn: false },
    { id: 'y.b', minutes: 3, appliance: 'oven', handsOn: false },
  ]);
  it('two oven steps overlapping in one minute with one oven: capacity', () => {
    // x.a is active at -3, -2, -1; y.b at -5, -4, -3: they share minute -3 only.
    expect(oracleCapacityViolations(ovens, HOME_KITCHEN, { 'x.a': -3, 'y.b': -5 })).toEqual([
      { minute: -3, resource: 'oven', count: 2, limit: 1 },
    ]);
  });
  it('the same two steps one minute apart: no capacity violation', () => {
    expect(oracleCapacityViolations(ovens, HOME_KITCHEN, { 'x.a': -3, 'y.b': -6 })).toEqual([]);
  });
  it('two hands-on steps overlapping with one cook: capacity on the cook', () => {
    const chops = planOf([
      { id: 'x.a', minutes: 2 },
      { id: 'y.b', minutes: 2 },
    ]);
    expect(oracleCapacityViolations(chops, HOME_KITCHEN, { 'x.a': -2, 'y.b': -3 })).toEqual([
      { minute: -2, resource: 'cook', count: 2, limit: 1 },
    ]);
  });
  it('a hands-free step is not counted against the cook', () => {
    const mixed = planOf([
      { id: 'x.a', minutes: 2, handsOn: false },
      { id: 'y.b', minutes: 2 },
    ]);
    expect(oracleCapacityViolations(mixed, BARE_KITCHEN, { 'x.a': -2, 'y.b': -2 })).toEqual([]);
  });

  const chain = planOf([
    { id: 'p.a', minutes: 3, handsOn: false },
    { id: 'p.b', minutes: 2, handsOn: false, after: ['p.a'] },
  ]);
  it('a step starting before its prerequisite ends: precedence', () => {
    // p.a ends at -2, p.b starts at -3.
    expect(oraclePrecedenceViolations(chain, { 'p.a': -5, 'p.b': -3 })).toEqual([
      { stepId: 'p.b', prereq: 'p.a' },
    ]);
  });
  it('a step starting exactly when its prerequisite ends: no violation', () => {
    expect(oraclePrecedenceViolations(chain, { 'p.a': -5, 'p.b': -2 })).toEqual([]);
  });

  const steps = (rows: readonly Row[]): ScheduledStep[] => stepsOf(rows);
  it('a missing step: completeness', () => {
    expect(
      oracleCompletenessViolations(chain, steps([['p.a', -5, -2, null, null, null, 0, 0]])),
    ).toEqual(['missing:p.b']);
  });
  it('an extra step, a duplicated step, a wrong length and an end after 0', () => {
    const base: Row[] = [
      ['p.a', -5, -2, null, null, null, 0, 0],
      ['p.b', -2, 0, null, null, null, 0, 0],
    ];
    expect(
      oracleCompletenessViolations(chain, steps([...base, ['q.z', -2, 0, null, null, null, 0, 0]])),
    ).toEqual(['extra:q.z']);
    expect(oracleCompletenessViolations(chain, steps([...base, base[0] as Row]))).toEqual([
      'duplicate:p.a',
    ]);
    expect(
      oracleCompletenessViolations(
        chain,
        steps([['p.a', -5, -1, null, null, null, 0, 0], base[1] as Row]),
      ),
    ).toEqual(['length:p.a']);
    expect(
      oracleCompletenessViolations(
        chain,
        steps([
          ['p.a', -4, -1, null, null, null, 0, 0],
          ['p.b', -1, 1, null, null, null, 0, 0],
        ]),
      ),
    ).toEqual(['after_serving:p.b']);
  });

  it('two overlapping steps on cook 1: lane clash; the same steps on cooks 1 and 2: none', () => {
    const chops = planOf([
      { id: 'x.a', minutes: 2 },
      { id: 'y.b', minutes: 2 },
    ]);
    const kitchen = { burners: 0, ovens: 0, cooks: 2 };
    expect(
      oracleLaneViolations(
        chops,
        kitchen,
        steps([
          ['x.a', -2, 0, null, null, 1, 0, 0],
          ['y.b', -3, -1, null, null, 1, 0, 0],
        ]),
      ),
    ).toEqual(['lane_clash:cook:1:x.a:y.b']);
    expect(
      oracleLaneViolations(
        chops,
        kitchen,
        steps([
          ['x.a', -2, 0, null, null, 1, 0, 0],
          ['y.b', -3, -1, null, null, 2, 0, 0],
        ]),
      ),
    ).toEqual([]);
  });
  it('a missing, an unexpected and an out-of-range lane', () => {
    const one = planOf([{ id: 'x.a', minutes: 2, appliance: 'oven', handsOn: false }]);
    expect(
      oracleLaneViolations(one, HOME_KITCHEN, steps([['x.a', -2, 0, null, null, null, 0, 0]])),
    ).toEqual(['lane_missing:x.a:oven']);
    expect(
      oracleLaneViolations(one, HOME_KITCHEN, steps([['x.a', -2, 0, null, 1, 1, 0, 0]])),
    ).toEqual(['lane_extra:x.a:cook']);
    expect(
      oracleLaneViolations(one, HOME_KITCHEN, steps([['x.a', -2, 0, null, 2, null, 0, 0]])),
    ).toEqual(['lane_range:x.a:oven']);
  });
});

describe('R10.1 oracleValid', () => {
  it('is false when a step ends after minute 0', () => {
    const chain = planOf([{ id: 'p.a', minutes: 3, handsOn: false }]);
    expect(oracleValid(chain, HOME_KITCHEN, { 'p.a': -3 })).toBe(true);
    expect(oracleValid(chain, HOME_KITCHEN, { 'p.a': -2 })).toBe(false);
  });
  it('is false for a capacity violation and for a precedence violation', () => {
    const ovens = planOf([
      { id: 'x.a', minutes: 3, appliance: 'oven', handsOn: false },
      { id: 'y.b', minutes: 3, appliance: 'oven', handsOn: false },
    ]);
    expect(oracleValid(ovens, HOME_KITCHEN, { 'x.a': -3, 'y.b': -5 })).toBe(false);
    const chain = planOf([
      { id: 'p.a', minutes: 3, handsOn: false },
      { id: 'p.b', minutes: 2, handsOn: false, after: ['p.a'] },
    ]);
    expect(oracleValid(chain, HOME_KITCHEN, { 'p.a': -5, 'p.b': -3 })).toBe(false);
  });
});

describe('R10.1 oracleSlack takes the definition, not the end points (design C2)', () => {
  it('one cook, s.go at -20 and o.go at -17, 1 minute each: delays 1 and 2 fit, 3 collides, so slack 2', () => {
    // Delays 4 to 19 fit again and 20 ends after 0; an end-point check would say 19.
    const plan = planOf([
      { id: 's.go', minutes: 1 },
      { id: 'o.go', minutes: 1 },
    ]);
    const starts = { 's.go': -20, 'o.go': -17 };
    expect(oracleValid(plan, HOME_KITCHEN, starts)).toBe(true);
    expect(oracleSlack(plan, HOME_KITCHEN, starts, 's.go')).toBe(2);
  });
  it('a step whose result is used at its end has slack 0', () => {
    const plan = planOf([
      { id: 'p.a', minutes: 3, handsOn: false },
      { id: 'p.b', minutes: 2, handsOn: false, after: ['p.a'] },
    ]);
    expect(oracleSlack(plan, HOME_KITCHEN, { 'p.a': -5, 'p.b': -2 }, 'p.a')).toBe(0);
    expect(oracleSlack(plan, HOME_KITCHEN, { 'p.a': -6, 'p.b': -2 }, 'p.a')).toBe(1);
  });
});

describe('R10.1 the oracles import nothing from the scheduler', () => {
  it('oracles.ts has no import of schedule, passes or timeline, and only type or schema imports from core', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../support/oracles.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../../src/core/schema.js']);
    // no dynamic import or require that could reach them
    expect(source).not.toMatch(/import\(|require\(/);
  });
});

// ---------------------------------------------------------------------------------------
// Rebuild spec, T2.2: the rebuild oracles against the hand-worked rebuilds RB-a, RB-b, RB-c
// and E7 of the rebuild design, written out here (not read from src/).

/** [id, startMin, endMin, slackMin, waitMin] of a rebuilt row; lanes are those of H1. */
type RebuiltRow = readonly [string, number, number, number, number | null];

const RB_A_ROWS: readonly RebuiltRow[] = [
  ['chicken.carve', 10, 15, 0, 0],
  ['chicken.prep', -110, -100, 0, null],
  ['chicken.rest', -10, 10, 0, 0],
  ['chicken.roast', -100, -10, 0, 0],
  ['gravy.roux', -4, -2, 0, 0],
  ['gravy.simmer', -2, 8, 0, 0],
  ['gravy.strain', 8, 10, 0, 5],
  ['greens.boil', 3, 7, 0, 0],
  ['greens.shred', -100, -95, 0, null],
  ['greens.toss', 7, 8, 0, 7],
];
const RB_B_ROWS: readonly RebuiltRow[] = [
  ['chicken.carve', -5, 0, 0, 2],
  ['chicken.prep', -110, -100, 0, null],
  ['chicken.rest', -25, -5, 0, 0],
  ['chicken.roast', -100, -25, 0, 0],
  ['gravy.roux', -12, -10, 0, 0],
  ['gravy.simmer', -10, 0, 0, 0],
  ['gravy.strain', 0, 2, 0, 0],
  ['greens.boil', -10, -6, 0, 0],
  ['greens.shred', -100, -95, 0, null],
  ['greens.toss', -6, -5, 0, 7],
];
const RB_C_ROWS: readonly RebuiltRow[] = [
  ['chicken.carve', -5, 0, 0, 0],
  ['chicken.prep', -110, -100, 0, null],
  ['chicken.rest', -25, -5, 0, 0],
  ['chicken.roast', -100, -25, 0, 0],
  ['gravy.roux', -20, -18, 0, 0],
  ['gravy.simmer', -18, -8, 0, 0],
  ['gravy.strain', -8, -6, 0, 6],
  ['greens.boil', -10, -6, 0, 0],
  ['greens.shred', -100, -95, 0, null],
  ['greens.toss', -6, -5, 0, 5],
];

const rebuiltStepsOf = (rows: readonly RebuiltRow[], lanesFrom: Schedule): RebuiltStep[] =>
  rows.map(([id, startMin, endMin, slackMin, waitMin]) => ({
    id,
    startMin,
    endMin,
    lanes: lanesFrom.steps.find((x) => x.id === id)?.lanes ?? {
      burner: null,
      oven: null,
      cook: null,
    },
    slackMin,
    critical: false,
    waitMin,
  }));
const ivOf = (rows: readonly { id: string; startMin: number; endMin: number }[]): Iv =>
  Object.fromEntries(rows.map((r) => [r.id, { startMin: r.startMin, endMin: r.endMin }]));

describe('RQ11.1 oraclePinnedIntervals', () => {
  it('RB-a: done keep their interval; the roast runs to -100 + 75 + 15 = -10', () => {
    expect(oraclePinnedIntervals(SUNDAY_ROAST, RB_A_PROGRESS, RB_A_NOW)).toEqual({
      'chicken.prep': { startMin: -110, endMin: -100 },
      'chicken.roast': { startMin: -100, endMin: -10 },
      'greens.shred': { startMin: -100, endMin: -95 },
    });
  });
  it('RB-b: a running rest ends at its expected end -5; a done roast keeps -25', () => {
    expect(oraclePinnedIntervals(SUNDAY_ROAST, RB_B_PROGRESS, RB_B_NOW)).toEqual({
      'chicken.prep': { startMin: -110, endMin: -100 },
      'chicken.rest': { startMin: -25, endMin: -5 },
      'chicken.roast': { startMin: -100, endMin: -25 },
      'greens.shred': { startMin: -100, endMin: -95 },
    });
  });
  it('an overrun without taps ends at now (E3: roast -100 + 75 = -25 < now -20)', () => {
    const progress = {
      'chicken.roast': { state: 'running', startMin: -100, extraMin: 0 },
    } as const;
    expect(oraclePinnedIntervals(SUNDAY_ROAST, progress, -20)).toEqual({
      'chicken.roast': { startMin: -100, endMin: -20 },
    });
  });
  it('E7: both oven steps run on past now -50, to -40 and -20', () => {
    expect(oraclePinnedIntervals(TIGHT_OVEN, E7_PROGRESS, E7_NOW)).toEqual({
      'pie.assemble': { startMin: -85, endMin: -70 },
      'pie.bake': { startMin: -60, endMin: -20 },
      'potatoes.peel': { startMin: -95, endMin: -85 },
      'potatoes.roast': { startMin: -85, endMin: -40 },
    });
  });
});

describe.each([
  ['RB-a', RB_A_ROWS, RB_A_PROGRESS, RB_A_NOW, 15],
  ['RB-b', RB_B_ROWS, RB_B_PROGRESS, RB_B_NOW, 2],
  ['RB-c', RB_C_ROWS, RB_C_PROGRESS, RB_C_NOW, 0],
] as const)(
  'RQ11.1 rebuild oracles on the hand-worked rebuild %s',
  (_n, rows, progress, now, serving) => {
    const steps = rebuiltStepsOf(rows, H1_SCHEDULE);
    const iv = ivOf(steps);
    it('oracleRebuildWaits gives the wait column', () => {
      expect(oracleRebuildWaits(SUNDAY_ROAST, iv, serving)).toEqual(
        Object.fromEntries(rows.map((r) => [r[0], r[4]])),
      );
    });
    it('oracleRebuildSlack gives the slack column (0 for every row)', () => {
      for (const row of rows) {
        expect([
          row[0],
          oracleRebuildSlack(SUNDAY_ROAST, HOME_KITCHEN, progress, now, iv, serving, row[0]),
        ]).toEqual([row[0], row[3]]);
      }
    });
    it('no violation of any kind', () => {
      expect(
        oracleRebuildViolations(SUNDAY_ROAST, HOME_KITCHEN, progress, now, steps, serving),
      ).toEqual([]);
      expect(oraclePendingOverfull(SUNDAY_ROAST, HOME_KITCHEN, progress, now, steps)).toEqual([]);
      expect(
        oracleRebuildLaneViolations(SUNDAY_ROAST, HOME_KITCHEN, iv, Object.keys(progress), steps),
      ).toEqual([]);
    });
  },
);

describe('RQ11.1 oracleRebuildHoldExceeded on the hand-worked rebuilds', () => {
  it('RB-a: only toss waits past its hold (7 > 5); the roast ends at -10, when rest starts', () => {
    expect(
      oracleRebuildHoldExceeded(SUNDAY_ROAST, ivOf(rebuiltStepsOf(RB_A_ROWS, H1_SCHEDULE)), 15),
    ).toEqual([{ stepId: 'greens.toss', waitMin: 7, holdMin: 5 }]);
  });
  it('RB-b: only toss waits past its hold (7 > 5); the roast ends at -25, when rest starts', () => {
    expect(
      oracleRebuildHoldExceeded(SUNDAY_ROAST, ivOf(rebuiltStepsOf(RB_B_ROWS, H1_SCHEDULE)), 2),
    ).toEqual([{ stepId: 'greens.toss', waitMin: 7, holdMin: 5 }]);
  });
  it('RB-c: no step waits past its hold', () => {
    expect(
      oracleRebuildHoldExceeded(SUNDAY_ROAST, ivOf(rebuiltStepsOf(RB_C_ROWS, H1_SCHEDULE)), 0),
    ).toEqual([]);
  });
});

describe('RQ11.1 oracleForwardRepair', () => {
  const h1Starts = Object.fromEntries(H1_SCHEDULE.steps.map((x) => [x.id, x.startMin]));
  it('RB-a: rest and roux at -10, simmer -8, boil stays -10, strain 2, toss stays -6, carve 10', () => {
    const fr = oracleForwardRepair(SUNDAY_ROAST, HOME_KITCHEN, RB_A_PROGRESS, RB_A_NOW, h1Starts);
    expect(fr).toEqual({
      'chicken.carve': { startMin: 10, endMin: 15 },
      'chicken.prep': { startMin: -110, endMin: -100 },
      'chicken.rest': { startMin: -10, endMin: 10 },
      'chicken.roast': { startMin: -100, endMin: -10 },
      'gravy.roux': { startMin: -10, endMin: -8 },
      'gravy.simmer': { startMin: -8, endMin: 2 },
      'gravy.strain': { startMin: 2, endMin: 4 },
      'greens.boil': { startMin: -10, endMin: -6 },
      'greens.shred': { startMin: -100, endMin: -95 },
      'greens.toss': { startMin: -6, endMin: -5 },
    });
  });
  it('RB-b: roux -12, simmer -10, strain 0; boil, toss and carve stay', () => {
    const fr = oracleForwardRepair(SUNDAY_ROAST, HOME_KITCHEN, RB_B_PROGRESS, RB_B_NOW, h1Starts);
    expect(fr).toEqual({
      'chicken.carve': { startMin: -5, endMin: 0 },
      'chicken.prep': { startMin: -110, endMin: -100 },
      'chicken.rest': { startMin: -25, endMin: -5 },
      'chicken.roast': { startMin: -100, endMin: -25 },
      'gravy.roux': { startMin: -12, endMin: -10 },
      'gravy.simmer': { startMin: -10, endMin: 0 },
      'gravy.strain': { startMin: 0, endMin: 2 },
      'greens.boil': { startMin: -10, endMin: -6 },
      'greens.shred': { startMin: -100, endMin: -95 },
      'greens.toss': { startMin: -6, endMin: -5 },
    });
  });
  it('RB-c: nothing moves', () => {
    const fr = oracleForwardRepair(SUNDAY_ROAST, HOME_KITCHEN, RB_C_PROGRESS, RB_C_NOW, h1Starts);
    expect(fr).toEqual(ivOf(rebuiltStepsOf(RB_C_ROWS, H1_SCHEDULE)));
  });
  it('E7: everything is pinned, so the forward repair is the pinned intervals', () => {
    const h3Starts = Object.fromEntries(H3_SCHEDULE.steps.map((x) => [x.id, x.startMin]));
    expect(oracleForwardRepair(TIGHT_OVEN, HOME_KITCHEN, E7_PROGRESS, E7_NOW, h3Starts)).toEqual(
      oraclePinnedIntervals(TIGHT_OVEN, E7_PROGRESS, E7_NOW),
    );
  });
});

describe('RQ11.1 the rebuild oracles on E7 (one oven, two pinned pans)', () => {
  const iv = oraclePinnedIntervals(TIGHT_OVEN, E7_PROGRESS, E7_NOW);
  const steps: RebuiltStep[] = Object.entries(iv).map(([id, i]) => ({
    id,
    startMin: i.startMin,
    endMin: i.endMin,
    lanes: {
      burner: null,
      oven: id === 'pie.bake' || id === 'potatoes.roast' ? 1 : null,
      cook: id === 'pie.assemble' || id === 'potatoes.peel' ? 1 : null,
    },
    slackMin: 0,
    critical: false,
    waitMin: null,
  }));
  it('oven capacity is exceeded at exactly minutes -50 to -41, and nothing else is wrong', () => {
    const expected = Array.from({ length: 10 }, (_v, i) => `capacity:oven:${-50 + i}`);
    expect(
      oracleRebuildViolations(TIGHT_OVEN, HOME_KITCHEN, E7_PROGRESS, E7_NOW, steps, 0),
    ).toEqual(expected);
  });
  it('no pending step is overfull (none is pending)', () => {
    expect(oraclePendingOverfull(TIGHT_OVEN, HOME_KITCHEN, E7_PROGRESS, E7_NOW, steps)).toEqual([]);
  });
  it('waits 20 and 40 are past the hold 10 of both pans', () => {
    expect(oracleRebuildHoldExceeded(TIGHT_OVEN, iv, 0)).toEqual([
      { stepId: 'pie.bake', waitMin: 20, holdMin: 10 },
      { stepId: 'potatoes.roast', waitMin: 40, holdMin: 10 },
    ]);
  });
  it('both pans on oven lane 1 is allowed (pinned, over capacity); with pie.bake pending it is a clash', () => {
    expect(
      oracleRebuildLaneViolations(TIGHT_OVEN, HOME_KITCHEN, iv, Object.keys(E7_PROGRESS), steps),
    ).toEqual([]);
    expect(
      oracleRebuildLaneViolations(TIGHT_OVEN, HOME_KITCHEN, iv, ['potatoes.roast'], steps),
    ).toEqual(['lane_clash:oven:1:pie.bake:potatoes.roast']);
  });
  it('a pending step on a pinned lane that is busy is a clash, and a lane out of range is reported', () => {
    const bad = steps.map((x) =>
      x.id === 'pie.bake' ? { ...x, lanes: { ...x.lanes, oven: 2 } } : x,
    );
    expect(
      oracleRebuildLaneViolations(TIGHT_OVEN, HOME_KITCHEN, iv, Object.keys(E7_PROGRESS), bad),
    ).toEqual(['lane_range:pie.bake:oven']);
  });
});

describe('RQ11.1 the rebuild oracles on three hand-made broken rebuilds of RB-a', () => {
  const good = rebuiltStepsOf(RB_A_ROWS, H1_SCHEDULE);
  const change = (id: string, startMin: number, endMin: number): RebuiltStep[] =>
    good.map((x) => (x.id === id ? { ...x, startMin, endMin } : x));
  const violations = (steps: RebuiltStep[], serving: number): string[] =>
    oracleRebuildViolations(SUNDAY_ROAST, HOME_KITCHEN, RB_A_PROGRESS, RB_A_NOW, steps, serving);
  it('a pending step before now: boil at [-61,-57) gives exactly before_now', () => {
    expect(violations(change('greens.boil', -61, -57), 15)).toEqual(['before_now:greens.boil']);
  });
  it('a step before its running prerequisite ends: rest at [-11,9) gives exactly one precedence', () => {
    expect(violations(change('chicken.rest', -11, 9), 15)).toEqual([
      'precedence:chicken.rest:chicken.roast',
    ]);
  });
  it('an end after servingMin: carve ends at 15, servingMin 14 gives exactly after_serving', () => {
    expect(violations(good, 14)).toEqual(['after_serving:chicken.carve']);
  });
  it('a pinned step that differs from its interval and a missing step are reported', () => {
    expect(violations(change('chicken.prep', -110, -99), 15)).toEqual(['length:chicken.prep']);
    expect(
      violations(
        good.filter((x) => x.id !== 'gravy.roux'),
        15,
      ),
    ).toEqual(['missing:gravy.roux']);
  });
});

describe('RQ11.1 oracleForwardRepair searches upward, oracleRebuildWaits clamps', () => {
  it('TWO_CHOPS x BARE_KITCHEN, nothing started, now -15: b.chop [-15,-5), a.chop waits for the cook to [-5,5)', () => {
    // prev starts a.chop -10, b.chop -20. b.chop first (smaller prev start), lower bound
    // max(-20, now -15) = -15. a.chop: lower bound -10, but the one cook is busy until -5.
    const fr = oracleForwardRepair(TWO_CHOPS, BARE_KITCHEN, {}, -15, {
      'a.chop': -10,
      'b.chop': -20,
    });
    expect(fr).toEqual({
      'a.chop': { startMin: -5, endMin: 5 },
      'b.chop': { startMin: -15, endMin: -5 },
    });
  });
  it('E6: boil [-2,2) ends after toss started at -6, so its wait is clamped to 0; toss waits 7', () => {
    const iv: Iv = {
      ...ivOf(rebuiltStepsOf(RB_C_ROWS, H1_SCHEDULE)),
      'greens.boil': { startMin: -2, endMin: 2 },
    };
    const waits = oracleRebuildWaits(SUNDAY_ROAST, iv, 2);
    expect(waits['greens.boil']).toBe(0);
    expect(waits['greens.toss']).toBe(7);
  });
});

describe('RQ8.3 oracleRebuildWaits measures to the first user, then clamps', () => {
  it('E2: the roast ends at -27, rest starts at -25 and roux at -20: wait 2, not 7', () => {
    const iv: Iv = {
      ...ivOf(rebuiltStepsOf(RB_C_ROWS, H1_SCHEDULE)),
      'chicken.roast': { startMin: -102, endMin: -27 },
    };
    expect(oracleRebuildWaits(SUNDAY_ROAST, iv, 0)['chicken.roast']).toBe(2);
    expect(oracleRebuildHoldExceeded(SUNDAY_ROAST, iv, 0)).toEqual([]);
  });
  it('a first user that started before the result ended clamps the wait to 0', () => {
    const iv: Iv = {
      ...ivOf(rebuiltStepsOf(RB_C_ROWS, H1_SCHEDULE)),
      'chicken.roast': { startMin: -100, endMin: -10 },
    };
    // rest starts at -25, before the roast ended at -10; roux at -20.
    expect(oracleRebuildWaits(SUNDAY_ROAST, iv, 0)['chicken.roast']).toBe(0);
  });
});

describe('RQ7.2 an empty pinned interval occupies no minute, so it clashes with nothing', () => {
  // RB-a with greens.boil recorded as done in zero time at minute 0 (start == end), on burner
  // lane 1, inside gravy.simmer's [-2,8) on burner lane 1. Boil holds no burner minute.
  const good = rebuiltStepsOf(RB_A_ROWS, H1_SCHEDULE);
  const steps = good.map((x) =>
    x.id === 'greens.boil'
      ? { ...x, startMin: 0, endMin: 0, lanes: { burner: 1, oven: null, cook: null } }
      : x,
  );
  it('the lane oracle reports no lane_clash for it', () => {
    expect(
      oracleRebuildLaneViolations(SUNDAY_ROAST, HOME_KITCHEN, ivOf(steps), ['greens.boil'], steps),
    ).toEqual([]);
  });
  it('a non-empty step on the same lane is still a clash', () => {
    const clash = steps.map((x) => (x.id === 'greens.boil' ? { ...x, startMin: 0, endMin: 1 } : x));
    expect(oracleRebuildLaneViolations(SUNDAY_ROAST, HOME_KITCHEN, ivOf(clash), [], clash)).toEqual(
      ['lane_clash:burner:1:gravy.simmer:greens.boil'],
    );
  });
});

describe('R7 oracleLatestPosition with the serving minute and the pinned intervals, on RB-a', () => {
  // RB-a: servingMin 15, roast running [-100,-10), prep and shred done; the seven pending steps
  // are all hot (they have a hold). The oracle is told where serving is and which intervals are
  // pinned; a step's deadline is the serving minute or the earliest start of a pending user.
  const finalIv = ivOf(rebuiltStepsOf(RB_A_ROWS, H1_SCHEDULE));
  const pinned = oraclePinnedIntervals(SUNDAY_ROAST, RB_A_PROGRESS, RB_A_NOW);
  const startsFrom = (iv: Iv): Record<string, number> =>
    Object.fromEntries(Object.entries(iv).map(([id, i]) => [id, i.startMin]));
  const context = { servingMin: 15, pinned };
  const pendingIds = [
    'chicken.carve',
    'chicken.rest',
    'gravy.roux',
    'gravy.simmer',
    'gravy.strain',
    'greens.boil',
    'greens.toss',
  ];

  it('every pending step of the hand-worked RB-a sits at its latest valid position', () => {
    const starts = startsFrom(finalIv);
    expect(
      pendingIds.map((id) => [
        id,
        oracleLatestPosition(SUNDAY_ROAST, HOME_KITCHEN, starts, id, context),
      ]),
    ).toEqual(pendingIds.map((id) => [id, starts[id]]));
  });

  it('gravy.strain at its forward-repair start 2 can still move to 8: the cook is busy with toss at 7 and with carve from 10, and it has no user before serving 15', () => {
    const starts = { ...startsFrom(finalIv), 'gravy.strain': 2 };
    expect(oracleLatestPosition(SUNDAY_ROAST, HOME_KITCHEN, starts, 'gravy.strain', context)).toBe(
      8,
    );
  });

  it('gravy.roux at its forward-repair start -10 can move to -4: gravy.simmer, its pending user, starts at -2 and nothing holds the cook or a burner in -4..-2', () => {
    const starts = { ...startsFrom(finalIv), 'gravy.roux': -10 };
    expect(oracleLatestPosition(SUNDAY_ROAST, HOME_KITCHEN, starts, 'gravy.roux', context)).toBe(
      -4,
    );
  });

  it('without a context the serving minute is 0, as for G9: the same strain cannot move', () => {
    const starts = { ...startsFrom(finalIv), 'gravy.strain': 2 };
    expect(oracleLatestPosition(SUNDAY_ROAST, HOME_KITCHEN, starts, 'gravy.strain')).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------
// Dinnerfile spec, T1.4: the dinnerfile oracles against the hand-written fixtures only.

const WORST_EXPORT_TITLE = WORST_CASE.steps.find((x) => x.id === 'export.x')?.title ?? '';
const WORST_DEFINE_TITLE = WORST_CASE.steps.find((x) => x.id === 'define.y')?.title ?? '';

describe('R10.2 oracleDinnerfile writes the hand-worked exports', () => {
  it('SUNDAY_ROAST with no options is SUNDAY_ROAST_DINNERFILE, character for character', () => {
    expect(oracleDinnerfile(SUNDAY_ROAST, {})).toBe(SUNDAY_ROAST_DINNERFILE);
  });
  it('WORST_CASE with no options is WORST_CASE_DINNERFILE, character for character', () => {
    expect(oracleDinnerfile(WORST_CASE, {})).toBe(WORST_CASE_DINNERFILE);
  });
  it('passing CANONICAL_STYLE is the same as passing no style', () => {
    expect(oracleDinnerfile(SUNDAY_ROAST, {}, CANONICAL_STYLE)).toBe(
      oracleDinnerfile(SUNDAY_ROAST, {}),
    );
  });
  it('a kitchen and a serving time add exactly two lines after the plan line (lines 7 and 8)', () => {
    const lines = oracleDinnerfile(SUNDAY_ROAST, {
      kitchen: HOME_KITCHEN,
      serve: '19:00',
    }).split('\n');
    const plain = SUNDAY_ROAST_DINNERFILE.split('\n');
    expect(lines[5]).toBe('# plan "Sunday roast"');
    expect(lines[6]).toBe('# kitchen burners=4 ovens=1 cooks=1');
    expect(lines[7]).toBe('# serve 19:00');
    expect([...lines.slice(0, 6), ...lines.slice(8)]).toEqual(plain);
  });
  it('a serving time alone is line 7', () => {
    const lines = oracleDinnerfile(SUNDAY_ROAST, { serve: '09:05' }).split('\n');
    expect(lines[6]).toBe('# serve 09:05');
    expect(lines[7]).toBe('# dish chicken "Roast chicken"');
  });
});

describe('R10.2 oracleEncodeText and oracleEchoText on the worst-case titles', () => {
  it('the plan title encodes as "Worst \\"case\\" \\\\ #"', () => {
    expect(oracleEncodeText(WORST_CASE.title)).toBe('"Worst \\"case\\" \\\\ #"');
  });
  it('the define.y title: CR LF, NUL and U+2028 become escapes', () => {
    expect(oracleEncodeText(WORST_DEFINE_TITLE)).toBe('"Line\\r\\nbreak\\u0000 and \\u2028end"');
  });
  it('the export.x title: tab, newline, U+202E, a lone U+D800 and both backslashes', () => {
    expect(oracleEncodeText(WORST_EXPORT_TITLE)).toBe(
      '" It\'s $(MAKE) ${HOME} $$ `touch canary` $(shell touch canary) ; touch canary #1 \\\\ 50% a:=b\\tc\\nd\\u202ee\\ud800 \\\\"',
    );
  });
  it.each([
    ['\u0008\u000c', '"\\b\\f"'],
    ['\u0001\u001f', '"\\u0001\\u001f"'],
    ['\u007f\u0085\u009f', '"\\u007f\\u0085\\u009f"'],
    ['\u061c\u200e\u200f', '"\\u061c\\u200e\\u200f"'],
    ['\u202a\u202e\u2066\u2069', '"\\u202a\\u202e\\u2066\\u2069"'],
    ['\ufeff\u2028\u2029', '"\\ufeff\\u2028\\u2029"'],
    ['\ud800', '"\\ud800"'],
    ['\udfff', '"\\udfff"'],
    ['\u{1F525}', '"\u{1F525}"'],
    ['\ud83d\udd25', '"\u{1F525}"'],
    ['caf\u00e9 e\u0301', '"caf\u00e9 e\u0301"'],
    ["'$#`:=% ", '"\'$#`:=% "'],
    ['a/b', '"a/b"'],
  ])('%j encodes as %s', (text, expected) => {
    expect(oracleEncodeText(text)).toBe(expected);
  });
  it('the display form of the define.y title replaces CR, LF, NUL and U+2028 with spaces', () => {
    expect(oracleEchoText(WORST_DEFINE_TITLE)).toBe('Line  break  and  end');
  });
  it('the display form of the export.x title keeps its quotes and dollars, tab and newline become spaces, U+202E and U+D800 become U+FFFD', () => {
    expect(oracleEchoText(WORST_EXPORT_TITLE)).toBe(
      " It's $(MAKE) ${HOME} $$ `touch canary` $(shell touch canary) ; touch canary #1 \\ 50% a:=b c d\ufffde\ufffd \\",
    );
  });
  it.each([
    ['a\u001b[31mb', 'a [31mb'],
    ['a\u007fb\u0085c\u009fd', 'a b c d'],
    ['a\u2029b', 'a b'],
    ['\u061c\u200e\u200f\u202a\u202e\u2066\u2069\ufeff', '\ufffd'.repeat(8)],
    ['\ud800\udfff', '\ud800\udfff'],
    ['\u{1F525}', '\u{1F525}'],
  ])('the display form of %j is %j', (title, expected) => {
    // The pair \ud800\udfff is a valid pair (U+103FF), kept; every lone half becomes U+FFFD.
    expect(oracleEchoText(title)).toBe(expected);
  });
});

describe('R10.2 oracleMakeLines classifies the lines export may write, and nothing looser', () => {
  it('gives no "other" for any line of the two hand-written exports', () => {
    for (const text of [SUNDAY_ROAST_DINNERFILE, WORST_CASE_DINNERFILE]) {
      const lines = text.split('\n');
      const kinds = oracleMakeLines(text);
      expect(kinds.length).toBe(lines.length);
      expect(kinds.filter((k) => k === 'other')).toEqual([]);
    }
  });
  it('knows each kind on a small text', () => {
    const text = [
      '# note',
      '',
      '.PHONY: dinner a.b',
      'dinner: a.b',
      'a.b:',
      "\t@echo 'x' # a.b",
      '',
    ].join('\n');
    expect(oracleMakeLines(text)).toEqual([
      'comment',
      'blank',
      'rule',
      'rule',
      'rule',
      'recipe',
      'blank',
    ]);
  });
  it.each([
    ['export : x', 'white space before the colon'],
    ['X = 1', 'a variable'],
    ["\t@echo '$$(MAKE)' # a.b", 'a $$( not followed by an empty quote pair'],
    ["\t@echo '$(MAKE)' # a.b", 'a single $'],
    ['# a comment ending in a backslash \\', 'a comment ending in a backslash'],
    ['# trailing space ', 'white space at the end'],
    ['# bell \u0007', 'a control code point'],
    ['a.b: c.d ', 'white space at the end of a rule'],
    ['a.b:c.d', 'no space after the colon'],
    ['A.B: c.d', 'an upper-case target'],
    ['a.b: c.d  e.f', 'two spaces between names'],
    ['include other', 'a directive'],
    ["\t@echo 'x'", 'no step id'],
    ["\t@echo 'it's' # a.b", 'an unquoted apostrophe'],
    ['\t@true', 'a recipe that is not an echo'],
    [' # indented comment', 'a space before the comment'],
  ])('%j is other (%s)', (line) => {
    expect(oracleMakeLines(line)).toEqual(['other']);
  });
  it('"\\n" splits lines and a CR is part of its line, so a CRLF text is all "other"', () => {
    expect(oracleMakeLines('# a\r\n# b\r\n')).toEqual(['other', 'other', 'blank']);
  });
  it("accepts the quoting forms: '\\'' and $$'' before ( or {, and a lone $$", () => {
    expect(oracleMakeLines("\t@echo 'a'\\''b $$''(c) $$''{d} $$$$ e' # a.b")).toEqual(['recipe']);
  });
});

describe('R10.2 decodeEchoLine', () => {
  const recipeLines = WORST_CASE_DINNERFILE.split('\n').filter((l) => l.startsWith('\t@echo'));

  it('decodes the three worst-case recipe lines from the file', () => {
    expect(recipeLines.map((l) => decodeEchoLine(l, 'file'))).toEqual([
      { text: '-n', stepId: '--.--' },
      { text: 'Line  break  and  end', stepId: 'define.y' },
      { text: oracleEchoText(WORST_EXPORT_TITLE), stepId: 'export.x' },
    ]);
  });
  it('decodes the three worst-case printed lines, in the order Make printed them', () => {
    expect(WORST_CASE_MAKE_DINNER.map((l) => decodeEchoLine(l, 'printed'))).toEqual([
      { text: '-n', stepId: '--.--' },
      { text: oracleEchoText(WORST_EXPORT_TITLE), stepId: 'export.x' },
      { text: 'Line  break  and  end', stepId: 'define.y' },
    ]);
  });
  it('decodes the ten Sunday roast printed lines to their titles and step ids', () => {
    expect(SUNDAY_ROAST_MAKE_DINNER.map((l) => decodeEchoLine(l, 'printed')?.stepId)).toEqual([
      'chicken.prep',
      'chicken.roast',
      'chicken.rest',
      'chicken.carve',
      'gravy.roux',
      'gravy.simmer',
      'gravy.strain',
      'greens.shred',
      'greens.boil',
      'greens.toss',
    ]);
    expect(decodeEchoLine(SUNDAY_ROAST_MAKE_DINNER[3] ?? '', 'printed')?.text).toBe(
      'Carve the chicken',
    );
  });
  it('$$ in the file is $ after Make, and the "file" stage undoes it: $$$$ is two dollars', () => {
    expect(decodeEchoLine("\t@echo 'a $$$$ b' # x.y", 'file')).toEqual({
      text: 'a $$ b',
      stepId: 'x.y',
    });
    expect(decodeEchoLine("echo 'a $$ b' # x.y", 'printed')).toEqual({
      text: 'a $$ b',
      stepId: 'x.y',
    });
  });
  it("'\\'' is a quote and '' joins two quoted parts", () => {
    expect(decodeEchoLine("echo 'it'\\''s' # x.y", 'printed')?.text).toBe("it's");
    expect(decodeEchoLine("echo 'a''b' # x.y", 'printed')?.text).toBe('ab');
  });
  it.each([
    ['', 'empty'],
    ['echo hello # x.y', 'unquoted'],
    ["echo 'a' # X.Y", 'step id with capitals'],
    ["echo 'a' # x.y extra", 'text after the step id'],
    ["echo 'a'", 'no step id'],
    ["echo 'a # x.y", 'unterminated quote'],
    ["\techo 'a' # x.y", 'a tab in the printed stage'],
    ["\t@echo 'a'b' # x.y", 'a bare quote in the middle'],
  ])('returns null for %j (%s)', (line) => {
    expect(decodeEchoLine(line, 'printed')).toBeNull();
  });
  it('returns null in the file stage when the line does not start with a tab and @', () => {
    expect(decodeEchoLine("echo 'a' # x.y", 'file')).toBeNull();
    expect(decodeEchoLine("\techo 'a' # x.y", 'file')).toBeNull();
  });
});

describe('R10.2 oracleNeededSteps and oracleDishLastSteps', () => {
  it('the gravy needs the roasting tin: five steps, sorted', () => {
    expect(oracleNeededSteps(SUNDAY_ROAST, 'gravy')).toEqual([
      'chicken.prep',
      'chicken.roast',
      'gravy.roux',
      'gravy.simmer',
      'gravy.strain',
    ]);
    expect(oracleNeededSteps(SUNDAY_ROAST, 'gravy')).toEqual(
      SUNDAY_ROAST_MAKE_GRAVY.map((l) => decodeEchoLine(l, 'printed')?.stepId).sort(),
    );
  });
  it('the chicken needs only its own four steps; the greens only theirs', () => {
    expect(oracleNeededSteps(SUNDAY_ROAST, 'chicken')).toEqual([
      'chicken.carve',
      'chicken.prep',
      'chicken.rest',
      'chicken.roast',
    ]);
    expect(oracleNeededSteps(SUNDAY_ROAST, 'greens')).toEqual([
      'greens.boil',
      'greens.shred',
      'greens.toss',
    ]);
  });
  it('the worst case: the define dish needs all three steps (a chain)', () => {
    expect(oracleNeededSteps(WORST_CASE, 'define')).toEqual(['--.--', 'define.y', 'export.x']);
    expect(oracleNeededSteps(WORST_CASE, 'export')).toEqual(['--.--', 'export.x']);
  });
  it('last steps of the worst case: one per dish, including the dish called dinner', () => {
    expect(oracleDishLastSteps(WORST_CASE)).toEqual({
      define: ['define.y'],
      dinner: ['--.--'],
      export: ['export.x'],
    });
  });
  it('last steps of SUNDAY_ROAST: chicken.roast is not one, chicken.rest waits on it', () => {
    expect(oracleDishLastSteps(SUNDAY_ROAST)).toEqual({
      chicken: ['chicken.carve'],
      gravy: ['gravy.strain'],
      greens: ['greens.toss'],
    });
  });
});

describe('recipe-reader oracles, hand-worked', () => {
  it('oracleMaxInWindow: the busiest window of 10 s', () => {
    // Windows start at a call and are half open: [0, 10000) holds 0, 1000, 9999 (3 calls);
    // 10000 is outside it. [9999, 19999) holds 9999, 10000 (2 calls).
    expect(oracleMaxInWindow([0, 1_000, 9_999, 10_000], 10_000)).toBe(3);
    expect(oracleMaxInWindow([], 10_000)).toBe(0);
    expect(oracleMaxInWindow([5, 5, 5], 1)).toBe(3);
    expect(oracleMaxInWindow([0, 10_000, 20_000], 10_000)).toBe(1);
  });

  it('oracleUtcDay: the day changes exactly at 00:00:00.000 UTC', () => {
    expect(oracleUtcDay(Date.UTC(2026, 10, 11, 23, 59, 59, 999))).toBe('2026-11-11');
    expect(oracleUtcDay(Date.UTC(2026, 10, 12, 0, 0, 0, 0))).toBe('2026-11-12');
    expect(oracleUtcDay(0)).toBe('1970-01-01');
  });
});

describe('cooking-mode oracles, hand-worked (CM-f and CM-g)', () => {
  const facts = Object.fromEntries(
    Object.entries(CM_F_FACTS).map(([id, fact]) => [id, { state: fact.state }]),
  );

  it('CM-f at 17:56: nothing is due, the roast runs, rest, roux and simmer are next', () => {
    expect(oracleCookSections(H1_SCHEDULE, facts, AXIS_MS, cmAt(17, 56))).toEqual({
      due: [],
      running: ['chicken.roast'],
      upNext: ['chicken.rest', 'gravy.roux', 'gravy.simmer'],
    });
  });
  it('CM-f broken input: without the roast fact the roast is due at 17:56, not running', () => {
    const broken = { 'chicken.prep': facts['chicken.prep'], 'greens.shred': facts['greens.shred'] };
    const sections = oracleCookSections(
      H1_SCHEDULE,
      broken as Record<string, { state: 'running' | 'done' }>,
      AXIS_MS,
      cmAt(17, 56),
    );
    expect(sections.due).toEqual(['chicken.roast']);
    expect(sections.running).toEqual([]);
  });
  it('CM-g: at 19:10:00 (n = -20) the rest and the roast are late; at 19:09:45 nothing is', () => {
    expect(oracleOverdue(H1_SCHEDULE, facts, AXIS_MS, cmAt(19, 10))).toEqual([
      'chicken.rest',
      'chicken.roast',
    ]);
    expect(oracleOverdue(H1_SCHEDULE, facts, AXIS_MS, cmAt(19, 9, 45))).toEqual([]);
  });
  it('CM-g broken input: a done roast is never late', () => {
    const broken = { ...facts, 'chicken.roast': { state: 'done' as const } };
    expect(oracleOverdue(H1_SCHEDULE, broken, AXIS_MS, cmAt(19, 10))).toEqual(['chicken.rest']);
  });
  it('the shred, with 75 minutes of slack, is late only from -25 (19:05)', () => {
    const ds = {
      'chicken.prep': { state: 'done' as const },
      'chicken.roast': { state: 'running' as const },
    };
    expect(oracleOverdue(H1_SCHEDULE, ds, AXIS_MS, cmAt(19, 4, 59))).toEqual([]);
    expect(oracleOverdue(H1_SCHEDULE, ds, AXIS_MS, cmAt(19, 5))).toEqual(['greens.shred']);
  });
});
