import { describe, expect, it } from 'vitest';
import {
  findCycles,
  longestChainMinutes,
  successors,
  terminalSteps,
  topologicalOrder,
} from '../../src/core/graph.js';
import { compareIds, type Plan, type Step } from '../../src/core/schema.js';
import { MEZZE, SUNDAY_ROAST, TIGHT_OVEN } from '../support/fixtures.js';

interface Spec {
  id: string;
  after?: string[];
  minutes?: number;
}

/** A plan from short step specs; the dish is the part of the id before the dot. */
function planOf(specs: Spec[]): Plan {
  const dishIds = [...new Set(specs.map((s) => s.id.split('.')[0] ?? ''))];
  const steps: Step[] = specs.map((s) => ({
    id: s.id,
    dish: s.id.split('.')[0] ?? '',
    title: 'Step',
    minutes: s.minutes ?? 5,
    appliance: 'none',
    handsOn: true,
    after: s.after ?? [],
    holdMin: null,
  }));
  return { title: 'Test', dishes: dishIds.map((id) => ({ id, name: id })), steps };
}

describe('compareIds (R3.8)', () => {
  it('R3.8 compares by UTF-16 code units: "-" (U+002D) sorts before "." (U+002E)', () => {
    expect(compareIds('a-b', 'a.b')).toBe(-1);
    expect(compareIds('a.b', 'a-b')).toBe(1);
  });

  it('R3.8 compares by code units, not locale: "Z" sorts before "a"', () => {
    expect(compareIds('Z', 'a')).toBe(-1);
  });

  it('R3.8 returns 0 for equal ids', () => {
    expect(compareIds('a.b', 'a.b')).toBe(0);
  });
});

describe('fixture facts (R3.2, R3.3, R3.4, R3.7)', () => {
  it('R3.2 SUNDAY_ROAST: successors of chicken.roast are chicken.rest and gravy.roux, keys in id order', () => {
    const succ = successors(SUNDAY_ROAST);
    expect(succ.get('chicken.roast')).toEqual(['chicken.rest', 'gravy.roux']);
    expect(succ.get('chicken.carve')).toEqual([]);
    expect([...succ.keys()]).toEqual([
      'chicken.carve',
      'chicken.prep',
      'chicken.rest',
      'chicken.roast',
      'gravy.roux',
      'gravy.simmer',
      'gravy.strain',
      'greens.boil',
      'greens.shred',
      'greens.toss',
    ]);
  });

  it('R3.2 MEZZE: salad.toss is the only successor of salad.chop and salad.dressing', () => {
    const succ = successors(MEZZE);
    expect(succ.get('salad.chop')).toEqual(['salad.toss']);
    expect(succ.get('salad.dressing')).toEqual(['salad.toss']);
  });

  it('R3.3 terminal steps of the three fixtures', () => {
    expect(terminalSteps(SUNDAY_ROAST)).toEqual(['chicken.carve', 'gravy.strain', 'greens.toss']);
    expect(terminalSteps(MEZZE)).toEqual(['flatbread.cook', 'hummus.blend', 'salad.toss']);
    expect(terminalSteps(TIGHT_OVEN)).toEqual(['pie.bake', 'potatoes.roast']);
  });

  it('R3.4 topological order of the three fixtures takes the smallest ready id first', () => {
    expect(topologicalOrder(SUNDAY_ROAST)).toEqual({
      ok: true,
      value: [
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
      ],
    });
    expect(topologicalOrder(MEZZE)).toEqual({
      ok: true,
      value: [
        'flatbread.mix',
        'flatbread.rise',
        'flatbread.cook',
        'hummus.blend',
        'salad.chop',
        'salad.dressing',
        'salad.toss',
      ],
    });
    expect(topologicalOrder(TIGHT_OVEN)).toEqual({
      ok: true,
      value: ['pie.assemble', 'pie.bake', 'potatoes.peel', 'potatoes.roast'],
    });
  });

  it('R3.7 longest chains are 110, 82 and 55', () => {
    expect(longestChainMinutes(SUNDAY_ROAST)).toEqual({ ok: true, value: 110 });
    expect(longestChainMinutes(MEZZE)).toEqual({ ok: true, value: 82 });
    expect(longestChainMinutes(TIGHT_OVEN)).toEqual({ ok: true, value: 55 });
  });

  it('R3.6 the fixtures have no cycle', () => {
    expect(findCycles(SUNDAY_ROAST)).toEqual([]);
    expect(findCycles(MEZZE)).toEqual([]);
    expect(findCycles(TIGHT_OVEN)).toEqual([]);
  });
});

describe('cycles (R3.5, R3.6)', () => {
  // a.x waits on a.z, a.z on a.y, a.y on a.x. a.y is also entered from b.head and left to
  // b.tail, so the cycle is not the whole plan. Path starts at the smallest id a.x and
  // lists each step before the step that waits on it: a.x, a.y, a.z.
  const threeCycle = planOf([
    { id: 'b.head' },
    { id: 'a.x', after: ['a.z'] },
    { id: 'a.y', after: ['a.x', 'b.head'] },
    { id: 'a.z', after: ['a.y'] },
    { id: 'b.tail', after: ['a.y'] },
  ]);

  it('R3.6 a 3-cycle entered at its middle step reports [a.x, a.y, a.z]', () => {
    expect(findCycles(threeCycle)).toEqual([['a.x', 'a.y', 'a.z']]);
  });

  it('R3.5 topologicalOrder returns the cycle error with the same path', () => {
    expect(topologicalOrder(threeCycle)).toEqual({
      ok: false,
      error: { kind: 'cycle', path: ['a.x', 'a.y', 'a.z'] },
    });
  });

  it('R3.6 two disjoint cycles give two paths in first-id order, whatever the input order', () => {
    const plan = planOf([
      { id: 'c.m', after: ['c.n'] },
      { id: 'c.n', after: ['c.m'] },
      { id: 'a.q', after: ['a.p'] },
      { id: 'a.p', after: ['a.q'] },
    ]);
    expect(findCycles(plan)).toEqual([
      ['a.p', 'a.q'],
      ['c.m', 'c.n'],
    ]);
  });

  it('R3.6 R3.5 a self-dependency gives [id] from topologicalOrder and nothing from findCycles', () => {
    const plan = planOf([{ id: 'a.x' }, { id: 'a.y', after: ['a.x', 'a.y'] }]);
    expect(findCycles(plan)).toEqual([]);
    expect(topologicalOrder(plan)).toEqual({
      ok: false,
      error: { kind: 'cycle', path: ['a.y'] },
    });
  });

  it('R3.7 longestChainMinutes returns the cycle error on a cycle', () => {
    expect(longestChainMinutes(threeCycle)).toEqual({
      ok: false,
      error: { kind: 'cycle', path: ['a.x', 'a.y', 'a.z'] },
    });
  });
});

describe('ids that need care (R3.1)', () => {
  it('R3.1 unknown after entries are ignored', () => {
    const plan = planOf([
      { id: 'a.x', after: ['z.ghost'] },
      { id: 'a.y', after: ['a.x'] },
    ]);
    expect([...successors(plan).keys()]).toEqual(['a.x', 'a.y']);
    expect(topologicalOrder(plan)).toEqual({ ok: true, value: ['a.x', 'a.y'] });
    expect(longestChainMinutes(plan)).toEqual({ ok: true, value: 10 });
  });

  it('R3.1 duplicate ids are one node: union of after lists, largest minutes', () => {
    // a.s appears twice: (5 min, after a.p) and (9 min, after a.q). One node a.s of 9 min
    // after both. Chain: a.q (20) then a.s (9) = 29.
    const plan = planOf([
      { id: 'a.s', after: ['a.p'], minutes: 5 },
      { id: 'a.p', minutes: 3 },
      { id: 'a.q', minutes: 20 },
      { id: 'a.s', after: ['a.q'], minutes: 9 },
    ]);
    const succ = successors(plan);
    expect(succ.get('a.p')).toEqual(['a.s']);
    expect(succ.get('a.q')).toEqual(['a.s']);
    expect(terminalSteps(plan)).toEqual(['a.s']);
    expect(topologicalOrder(plan)).toEqual({ ok: true, value: ['a.p', 'a.q', 'a.s'] });
    expect(longestChainMinutes(plan)).toEqual({ ok: true, value: 29 });
  });
});
