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
  BARE_KITCHEN,
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
  TIGHT_OVEN,
  TWO_CHOPS,
} from '../support/fixtures.js';
import {
  isCycleIn,
  type Iv,
  oracleCapacityViolations,
  oracleCompletenessViolations,
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
  ['chicken.roast', -100, -25, null, 1, null, 0, 5],
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
  ['chicken.roast', -100, -25, null, 1, null, 0, 3],
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
  ['chicken.roast', -100, -10, 0, 6],
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
  ['chicken.roast', -100, -25, 0, 13],
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
  ['chicken.roast', -100, -25, 0, 5],
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
  it('RB-a: roast waits 6 > 5 and toss 7 > 5', () => {
    expect(
      oracleRebuildHoldExceeded(SUNDAY_ROAST, ivOf(rebuiltStepsOf(RB_A_ROWS, H1_SCHEDULE)), 15),
    ).toEqual([
      { stepId: 'chicken.roast', waitMin: 6, holdMin: 5 },
      { stepId: 'greens.toss', waitMin: 7, holdMin: 5 },
    ]);
  });
  it('RB-b: roast waits 13 > 5 and toss 7 > 5', () => {
    expect(
      oracleRebuildHoldExceeded(SUNDAY_ROAST, ivOf(rebuiltStepsOf(RB_B_ROWS, H1_SCHEDULE)), 2),
    ).toEqual([
      { stepId: 'chicken.roast', waitMin: 13, holdMin: 5 },
      { stepId: 'greens.toss', waitMin: 7, holdMin: 5 },
    ]);
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
