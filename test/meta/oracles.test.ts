import { describe, expect, it } from 'vitest';
import type { Appliance, Plan, Step } from '../../src/core/schema.js';
import { MEZZE, SUNDAY_ROAST, TIGHT_OVEN } from '../support/fixtures.js';
import {
  isCycleIn,
  oracleLongestChain,
  oracleNormalise,
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
