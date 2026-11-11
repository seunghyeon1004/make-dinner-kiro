import { describe, expect, it } from 'vitest';
import { backwardPass } from '../../src/core/passes/backward.js';
import { assignLanes } from '../../src/core/passes/lanes.js';
import { prepForwardPass } from '../../src/core/passes/prep-forward.js';
import { holdExceededMessage, readout } from '../../src/core/passes/readout.js';
import { rightJustifyPass } from '../../src/core/passes/right-justify.js';
import { canonicalPlan } from '../../src/core/schema.js';
import type { Kitchen, Plan } from '../../src/core/schema.js';
import { capacityOf } from '../../src/core/timeline.js';
import {
  BARE_KITCHEN,
  BIG_KITCHEN,
  BURNER_ONLY_KITCHEN,
  COLD_SAUCE,
  HOME_KITCHEN,
  LONG_DAY,
  MEZZE,
  NO_BURNER_KITCHEN,
  ONE_BURNER_KITCHEN,
  PREP_AHEAD,
  SOLO_BURNER,
  SUNDAY_ROAST,
  TIGHT_OVEN,
  TWO_CHOPS,
} from '../support/fixtures.js';

type Starts = Record<string, number>;

const plain = (starts: ReadonlyMap<string, number>): Starts =>
  Object.fromEntries([...starts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const pass1 = (plan: Plan, kitchen: Kitchen): Starts => {
  const canonical = canonicalPlan(plan);
  return plain(backwardPass(canonical, capacityOf(kitchen)));
};

describe('R3 backward pass (design H1 to H5, "pass 1 start")', () => {
  it('R3.3 H1: SUNDAY_ROAST x HOME_KITCHEN, carve before toss on the hold tie', () => {
    expect(pass1(SUNDAY_ROAST, HOME_KITCHEN)).toEqual({
      'chicken.carve': -5,
      'chicken.prep': -110,
      'chicken.rest': -25,
      'chicken.roast': -100,
      'gravy.roux': -20,
      'gravy.simmer': -18,
      'gravy.strain': -8,
      'greens.boil': -10,
      'greens.shred': -15,
      'greens.toss': -6,
    });
  });
  it('R3.4 H2: one burner pushes simmer and roux earlier', () => {
    expect(pass1(SUNDAY_ROAST, ONE_BURNER_KITCHEN)).toEqual({
      'chicken.carve': -5,
      'chicken.prep': -110,
      'chicken.rest': -25,
      'chicken.roast': -100,
      'gravy.roux': -22,
      'gravy.simmer': -20,
      'gravy.strain': -8,
      'greens.boil': -10,
      'greens.shred': -15,
      'greens.toss': -6,
    });
  });
  it('R3.3 H3: pie.bake before potatoes.roast on the hold tie, one oven', () => {
    expect(pass1(TIGHT_OVEN, HOME_KITCHEN)).toEqual({
      'pie.assemble': -55,
      'pie.bake': -40,
      'potatoes.peel': -95,
      'potatoes.roast': -85,
    });
  });
  it('R3.3 H4: MEZZE, a keeps terminal step is placed after the hot ones', () => {
    expect(pass1(MEZZE, HOME_KITCHEN)).toEqual({
      'flatbread.cook': -14,
      'flatbread.mix': -84,
      'flatbread.rise': -74,
      'hummus.blend': -24,
      'salad.chop': -34,
      'salad.dressing': -39,
      'salad.toss': -2,
    });
  });
  it('R3.1 H5: PREP_AHEAD x NO_BURNER_KITCHEN', () => {
    expect(pass1(PREP_AHEAD, NO_BURNER_KITCHEN)).toEqual({
      'bread.bake': -8,
      'bread.shape': -17,
      'jelly.set': -60,
      'salad.chop': -12,
      'salad.toss': -2,
    });
  });
  it('R3.4 H6: SOLO_BURNER ends at 0', () => {
    expect(pass1(SOLO_BURNER, BURNER_ONLY_KITCHEN)).toEqual({ 'solo.sear': -30 });
  });
  it('R9.4 H6: LONG_DAY stacks 80 steps down to -38400, smallest id first', () => {
    const starts = pass1(LONG_DAY, BARE_KITCHEN);
    const expected: Starts = {};
    for (let n = 1; n <= 80; n++) {
      expected[`feast.s${String(n).padStart(2, '0')}`] = -480 * n;
    }
    expect(starts).toEqual(expected);
  });
});

const withStarts = (base: Starts, moves: Starts): Starts => ({ ...base, ...moves });

const pass2 = (plan: Plan, kitchen: Kitchen, starts: Starts): Starts =>
  plain(prepForwardPass(canonicalPlan(plan), capacityOf(kitchen), new Map(Object.entries(starts))));

const pass3 = (plan: Plan, kitchen: Kitchen, starts: Starts): Starts =>
  plain(
    rightJustifyPass(canonicalPlan(plan), capacityOf(kitchen), new Map(Object.entries(starts))),
  );

// Pass 1 starts, written out from the design tables (not computed).
const H1_PASS1: Starts = {
  'chicken.carve': -5,
  'chicken.prep': -110,
  'chicken.rest': -25,
  'chicken.roast': -100,
  'gravy.roux': -20,
  'gravy.simmer': -18,
  'gravy.strain': -8,
  'greens.boil': -10,
  'greens.shred': -15,
  'greens.toss': -6,
};
const H2_PASS1: Starts = withStarts(H1_PASS1, {
  'gravy.roux': -22,
  'gravy.simmer': -20,
});
const H3_PASS1: Starts = {
  'pie.assemble': -55,
  'pie.bake': -40,
  'potatoes.peel': -95,
  'potatoes.roast': -85,
};
const H4_PASS1: Starts = {
  'flatbread.cook': -14,
  'flatbread.mix': -84,
  'flatbread.rise': -74,
  'hummus.blend': -24,
  'salad.chop': -34,
  'salad.dressing': -39,
  'salad.toss': -2,
};
const H5_PASS1: Starts = {
  'bread.bake': -8,
  'bread.shape': -17,
  'jelly.set': -60,
  'salad.chop': -12,
  'salad.toss': -2,
};

describe('R4 prep-forward pass (design H1 to H5)', () => {
  it('R4.2 H1: only greens.shred (keeps) moves, to -100', () => {
    expect(pass2(SUNDAY_ROAST, HOME_KITCHEN, H1_PASS1)).toEqual(
      withStarts(H1_PASS1, { 'greens.shred': -100 }),
    );
  });
  it('R4.2 H2: only greens.shred moves, to -100, with one burner', () => {
    expect(pass2(SUNDAY_ROAST, ONE_BURNER_KITCHEN, H2_PASS1)).toEqual(
      withStarts(H2_PASS1, { 'greens.shred': -100 }),
    );
  });
  it('R4.2 H3: pie.assemble moves to -85, behind potatoes.peel on the cook', () => {
    expect(pass2(TIGHT_OVEN, HOME_KITCHEN, H3_PASS1)).toEqual(
      withStarts(H3_PASS1, { 'pie.assemble': -85 }),
    );
  });
  it('R4.2 R9.6 H4: hummus (keeps terminal), chop and dressing move to the front', () => {
    expect(pass2(MEZZE, HOME_KITCHEN, H4_PASS1)).toEqual(
      withStarts(H4_PASS1, {
        'hummus.blend': -74,
        'salad.chop': -64,
        'salad.dressing': -54,
      }),
    );
  });
  it('R4.2 H5: only salad.chop moves, to -60', () => {
    expect(pass2(PREP_AHEAD, NO_BURNER_KITCHEN, H5_PASS1)).toEqual(
      withStarts(H5_PASS1, { 'salad.chop': -60 }),
    );
  });
  it('R9.5 H6: sauce.whisk starts at its hot prerequisite end, -13', () => {
    const start: Starts = { 'fish.fry': -8, 'sauce.reduce': -23, 'sauce.whisk': -13 };
    expect(pass2(COLD_SAUCE, BURNER_ONLY_KITCHEN, start)).toEqual(start);
  });
});

describe('R5 right-justify pass (design H1 to H5)', () => {
  const H1_PASS2 = withStarts(H1_PASS1, { 'greens.shred': -100 });
  const H2_PASS2 = withStarts(H2_PASS1, { 'greens.shred': -100 });
  const H3_PASS2 = withStarts(H3_PASS1, { 'pie.assemble': -85 });
  const H4_PASS2 = withStarts(H4_PASS1, {
    'hummus.blend': -74,
    'salad.chop': -64,
    'salad.dressing': -54,
  });
  const H5_PASS2 = withStarts(H5_PASS1, { 'salad.chop': -60 });

  it('R5.1 H1: nothing moves', () => {
    expect(pass3(SUNDAY_ROAST, HOME_KITCHEN, H1_PASS2)).toEqual(H1_PASS2);
  });
  it('R5.1 H2: nothing moves', () => {
    expect(pass3(SUNDAY_ROAST, ONE_BURNER_KITCHEN, H2_PASS2)).toEqual(H2_PASS2);
  });
  it('R5.1 H3: nothing moves', () => {
    expect(pass3(TIGHT_OVEN, HOME_KITCHEN, H3_PASS2)).toEqual(H3_PASS2);
  });
  it('R5.1 H4: nothing moves', () => {
    expect(pass3(MEZZE, HOME_KITCHEN, H4_PASS2)).toEqual(H4_PASS2);
  });
  it('R5.1 H5: only bread.shape moves, to -13', () => {
    expect(pass3(PREP_AHEAD, NO_BURNER_KITCHEN, H5_PASS2)).toEqual(
      withStarts(H5_PASS2, { 'bread.shape': -13 }),
    );
  });
});

// Final starts (after pass 3), from the design tables.
const H1_FINAL: Starts = withStarts(H1_PASS1, { 'greens.shred': -100 });
const H2_FINAL: Starts = withStarts(H2_PASS1, { 'greens.shred': -100 });
const H3_FINAL: Starts = withStarts(H3_PASS1, { 'pie.assemble': -85 });
const H4_FINAL: Starts = withStarts(H4_PASS1, {
  'hummus.blend': -74,
  'salad.chop': -64,
  'salad.dressing': -54,
});
const H5_FINAL: Starts = withStarts(H5_PASS1, { 'salad.chop': -60, 'bread.shape': -13 });

/** [burner, oven, cook] per step id, null for none. */
type Lanes = Record<string, [number | null, number | null, number | null]>;

const lanesOf = (plan: Plan, kitchen: Kitchen, starts: Starts): Lanes =>
  Object.fromEntries(
    [...assignLanes(canonicalPlan(plan), capacityOf(kitchen), new Map(Object.entries(starts)))]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, l]) => [id, [l.burner, l.oven, l.cook]]),
  );

describe('R6 lanes (design H1 to H5, B O C columns)', () => {
  it('R6.2 H1: greens.boil on burner 2, gravy.simmer keeps the burner of gravy.roux', () => {
    expect(lanesOf(SUNDAY_ROAST, HOME_KITCHEN, H1_FINAL)).toEqual({
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
    });
  });
  it('R6.1 H2: with one burner greens.boil is on burner 1', () => {
    expect(lanesOf(SUNDAY_ROAST, ONE_BURNER_KITCHEN, H2_FINAL)).toEqual({
      'chicken.carve': [null, null, 1],
      'chicken.prep': [null, null, 1],
      'chicken.rest': [null, null, null],
      'chicken.roast': [null, 1, null],
      'gravy.roux': [1, null, 1],
      'gravy.simmer': [1, null, null],
      'gravy.strain': [null, null, 1],
      'greens.boil': [1, null, null],
      'greens.shred': [null, null, 1],
      'greens.toss': [null, null, 1],
    });
  });
  it('R6.1 H3: both oven steps on oven 1, one after the other', () => {
    expect(lanesOf(TIGHT_OVEN, HOME_KITCHEN, H3_FINAL)).toEqual({
      'pie.assemble': [null, null, 1],
      'pie.bake': [null, 1, null],
      'potatoes.peel': [null, null, 1],
      'potatoes.roast': [null, 1, null],
    });
  });
  it('R6.2 H4: salad.toss on the cook of salad.dressing', () => {
    expect(lanesOf(MEZZE, HOME_KITCHEN, H4_FINAL)).toEqual({
      'flatbread.cook': [1, null, 1],
      'flatbread.mix': [null, null, 1],
      'flatbread.rise': [null, null, null],
      'hummus.blend': [null, null, 1],
      'salad.chop': [null, null, 1],
      'salad.dressing': [null, null, 1],
      'salad.toss': [null, null, 1],
    });
  });
  it('R1.8 H5: no burner lane when the kitchen has no burner', () => {
    expect(lanesOf(PREP_AHEAD, NO_BURNER_KITCHEN, H5_FINAL)).toEqual({
      'bread.bake': [null, 1, null],
      'bread.shape': [null, null, 1],
      'jelly.set': [null, null, null],
      'salad.chop': [null, null, 1],
      'salad.toss': [null, null, 1],
    });
  });
  it('R9.3 H6: TWO_CHOPS x BIG_KITCHEN uses cook 1 and cook 2, not 5 and 6', () => {
    expect(lanesOf(TWO_CHOPS, BIG_KITCHEN, { 'a.chop': -10, 'b.chop': -10 })).toEqual({
      'a.chop': [null, null, 1],
      'b.chop': [null, null, 2],
    });
  });
});

type Reading = Record<string, { slack: number; wait: number | null }>;

const readingOf = (plan: Plan, kitchen: Kitchen, starts: Starts) => {
  const r = readout(canonicalPlan(plan), capacityOf(kitchen), new Map(Object.entries(starts)));
  const reading: Reading = {};
  for (const [id, slack] of [...r.slackMin].sort(([a], [b]) => (a < b ? -1 : 1))) {
    reading[id] = { slack, wait: r.waitMin.get(id) ?? null };
  }
  return { reading, warnings: r.warnings };
};

const ROAST_WARNING_MESSAGE =
  'Step potatoes.roast will be ready 40 minutes before serving and can wait only 10 minutes. More ovens, burners or cooks may help.';

describe('R7 readout (design H1 to H6)', () => {
  it('R7.1 R7.4 R2.7 H1: slack, wait, chicken.roast wait 5 measured to gravy.roux', () => {
    const { reading, warnings } = readingOf(SUNDAY_ROAST, HOME_KITCHEN, H1_FINAL);
    expect(reading).toEqual({
      'chicken.carve': { slack: 0, wait: 0 },
      'chicken.prep': { slack: 0, wait: null },
      'chicken.rest': { slack: 0, wait: 0 },
      'chicken.roast': { slack: 0, wait: 5 },
      'gravy.roux': { slack: 0, wait: 0 },
      'gravy.simmer': { slack: 0, wait: 0 },
      'gravy.strain': { slack: 0, wait: 6 },
      'greens.boil': { slack: 0, wait: 0 },
      'greens.shred': { slack: 75, wait: null },
      'greens.toss': { slack: 0, wait: 5 },
    });
    expect(warnings).toEqual([]);
  });
  it('R7.1 H2: greens.shred slack 73, gravy.simmer slack 0 and wait 2', () => {
    const { reading, warnings } = readingOf(SUNDAY_ROAST, ONE_BURNER_KITCHEN, H2_FINAL);
    expect(reading['greens.shred']).toEqual({ slack: 73, wait: null });
    expect(reading['gravy.simmer']).toEqual({ slack: 0, wait: 2 });
    expect(reading['chicken.roast']).toEqual({ slack: 0, wait: 3 });
    expect(warnings).toEqual([]);
  });
  it('R7.3 H3: one hold_exceeded for potatoes.roast with the exact message', () => {
    const { reading, warnings } = readingOf(TIGHT_OVEN, HOME_KITCHEN, H3_FINAL);
    expect(reading).toEqual({
      'pie.assemble': { slack: 30, wait: null },
      'pie.bake': { slack: 0, wait: 0 },
      'potatoes.peel': { slack: 0, wait: null },
      'potatoes.roast': { slack: 0, wait: 40 },
    });
    expect(warnings).toEqual([
      {
        severity: 'warning',
        code: 'hold_exceeded',
        message: ROAST_WARNING_MESSAGE,
        stepId: 'potatoes.roast',
        waitMin: 40,
        holdMin: 10,
      },
    ]);
  });
  it('R7.1 H4: packed prep is critical, dressing has slack 35', () => {
    const { reading, warnings } = readingOf(MEZZE, HOME_KITCHEN, H4_FINAL);
    expect(reading).toEqual({
      'flatbread.cook': { slack: 0, wait: 2 },
      'flatbread.mix': { slack: 0, wait: null },
      'flatbread.rise': { slack: 0, wait: 0 },
      'hummus.blend': { slack: 0, wait: null },
      'salad.chop': { slack: 0, wait: null },
      'salad.dressing': { slack: 35, wait: null },
      'salad.toss': { slack: 0, wait: 0 },
    });
    expect(warnings).toEqual([]);
  });
  it('R7.3 H5: shape wait 0 after right-justify, no warning; chop slack 37', () => {
    const { reading, warnings } = readingOf(PREP_AHEAD, NO_BURNER_KITCHEN, H5_FINAL);
    expect(reading).toEqual({
      'bread.bake': { slack: 0, wait: 0 },
      'bread.shape': { slack: 0, wait: 0 },
      'jelly.set': { slack: 0, wait: null },
      'salad.chop': { slack: 37, wait: null },
      'salad.toss': { slack: 0, wait: 0 },
    });
    expect(warnings).toEqual([]);
  });
  it('R7.3 H6: TWO_CHOPS x BARE_KITCHEN, b.chop waits 10 over a hold of 5', () => {
    const { reading, warnings } = readingOf(TWO_CHOPS, BARE_KITCHEN, {
      'a.chop': -10,
      'b.chop': -20,
    });
    expect(reading).toEqual({
      'a.chop': { slack: 0, wait: 0 },
      'b.chop': { slack: 0, wait: 10 },
    });
    expect(warnings).toEqual([
      {
        severity: 'warning',
        code: 'hold_exceeded',
        message:
          'Step b.chop will be ready 10 minutes before serving and can wait only 5 minutes. More ovens, burners or cooks may help.',
        stepId: 'b.chop',
        waitMin: 10,
        holdMin: 5,
      },
    ]);
  });
  it('R7.3 a step that is not terminal: wait to the step that uses it, wording and slack', () => {
    const plan: Plan = {
      title: 'Two waits',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [
        {
          id: 'a.y',
          dish: 'a',
          title: 'Leave it to set',
          minutes: 5,
          appliance: 'none',
          handsOn: false,
          after: ['a.x'],
          holdMin: null,
        },
        {
          id: 'a.x',
          dish: 'a',
          title: 'Leave it to cool',
          minutes: 5,
          appliance: 'none',
          handsOn: false,
          after: [],
          holdMin: 5,
        },
      ],
    };
    const { reading, warnings } = readingOf(plan, HOME_KITCHEN, { 'a.x': -20, 'a.y': -8 });
    expect(reading).toEqual({
      'a.x': { slack: 7, wait: 7 },
      'a.y': { slack: 3, wait: null },
    });
    expect(warnings.map((w) => w.message)).toEqual([
      'Step a.x will be ready 7 minutes before the step that uses it and can wait only 5 minutes. More ovens, burners or cooks may help.',
    ]);
  });
  it('R7.3 holdExceededMessage uses the singular for 1 minute', () => {
    expect(holdExceededMessage('a.x', true, 1, 0)).toBe(
      'Step a.x will be ready 1 minute before serving and can wait only 0 minutes. More ovens, burners or cooks may help.',
    );
    expect(holdExceededMessage('a.x', false, 2, 1)).toBe(
      'Step a.x will be ready 2 minutes before the step that uses it and can wait only 1 minute. More ovens, burners or cooks may help.',
    );
  });
});
