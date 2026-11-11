import { describe, expect, it } from 'vitest';
import type { Appliance, Kitchen, Plan, ScheduledStep, Step } from '../../src/core/schema.js';
import {
  BARE_KITCHEN,
  HOME_KITCHEN,
  MEZZE,
  NO_BURNER_KITCHEN,
  ONE_BURNER_KITCHEN,
  PREP_AHEAD,
  SUNDAY_ROAST,
  TIGHT_OVEN,
  TWO_CHOPS,
} from '../support/fixtures.js';
import {
  isCycleIn,
  oracleCapacityViolations,
  oracleCompletenessViolations,
  oracleHoldExceeded,
  oracleLaneViolations,
  oracleLongestChain,
  oracleNormalise,
  oraclePrecedenceViolations,
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
