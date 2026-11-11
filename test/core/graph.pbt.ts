import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  findCycles,
  longestChainMinutes,
  successors,
  terminalSteps,
  topologicalOrder,
} from '../../src/core/graph.js';
import { PlanSchema, type ErrorCode, type Plan } from '../../src/core/schema.js';
import { arbBrokenPlan, arbPlan } from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import {
  isCycleIn,
  oracleLongestChain,
  oracleShortestCycleLength,
  oracleStronglyConnected,
  oracleSuccessors,
  oracleTopologicalOrder,
  respectsPrecedence,
} from '../support/oracles.js';

/** The rules whose input still parses (design: "graph-rule arbBrokenPlan cases"). */
const GRAPH_RULES: readonly ErrorCode[] = [
  'unknown_dependency',
  'self_dependency',
  'cycle',
  'duplicate_step_id',
  'duplicate_dish_id',
  'unknown_dish',
  'dish_without_steps',
];

/** A graph-rule broken case as a Plan, through the schema (not parsePlan). */
const arbGraphRulePlan = fc
  .constantFrom(...GRAPH_RULES)
  .chain((rule) => arbBrokenPlan(rule))
  .map((c): Plan => PlanSchema.parse(c.input));

const arbCyclePlan = arbBrokenPlan('cycle').map((c): Plan => PlanSchema.parse(c.input));
const arbSelfPlan = arbBrokenPlan('self_dependency').map((c) => ({
  plan: PlanSchema.parse(c.input),
  stepId: c.target.stepId,
}));

describe('P-RG3 topological order', () => {
  for (const [label, arb] of [
    ['default', arbPlan()],
    ['large', arbPlan({ large: true })],
  ] as const) {
    it(`P-RG3 topological order: on valid ${label} plans it is ok, complete, respects precedence and equals the oracle`, () => {
      fc.assert(
        fc.property(arb, (plan) => {
          const result = topologicalOrder(plan);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const ids = plan.steps.map((s) => s.id);
          expect([...result.value].sort()).toEqual([...ids].sort());
          expect(respectsPrecedence(plan, result.value)).toBe(true);
          expect(result.value).toEqual(oracleTopologicalOrder(plan));
        }),
        fcParams(),
      );
    });
  }
});

describe('P-RG4 cycles', () => {
  it('P-RG4 cycles: on cycle cases findCycles matches the oracle groups and topologicalOrder returns the first path', () => {
    fc.assert(
      fc.property(arbCyclePlan, (plan) => {
        const paths = findCycles(plan);
        const groups = oracleStronglyConnected(plan)
          .map((g) => [...g].sort())
          .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '', 'en', { sensitivity: 'variant' }));
        expect(paths.length).toBeGreaterThan(0);
        expect(paths.length).toBe(groups.length);
        const firsts = paths.map((p) => p[0] ?? '');
        expect(firsts).toEqual([...firsts].sort());
        for (const path of paths) {
          expect(isCycleIn(plan, path)).toBe(true);
          const group = groups.find((g) => g.includes(path[0] ?? ''));
          expect(group).not.toBeUndefined();
          expect(path[0]).toBe(group?.[0]);
          for (const id of path) expect(group).toContain(id);
          expect(path.length).toBe(oracleShortestCycleLength(plan, path[0] ?? ''));
        }
        expect(topologicalOrder(plan)).toEqual({
          ok: false,
          error: { kind: 'cycle', path: paths[0] },
        });
      }),
      fcParams(),
    );
  });

  it('P-RG4 cycles: on self_dependency cases topologicalOrder is err with [id] and findCycles is empty', () => {
    fc.assert(
      fc.property(arbSelfPlan, ({ plan, stepId }) => {
        expect(stepId).not.toBeUndefined();
        expect(findCycles(plan)).toEqual([]);
        expect(topologicalOrder(plan)).toEqual({
          ok: false,
          error: { kind: 'cycle', path: [stepId] },
        });
      }),
      fcParams(),
    );
  });

  it('P-RG4 cycles: on valid plans findCycles is empty', () => {
    fc.assert(
      fc.property(arbPlan(), (plan) => {
        expect(findCycles(plan)).toEqual([]);
      }),
      fcParams(),
    );
  });
});

describe('P-RG5 successors', () => {
  it('P-RG5 successors: successors and terminalSteps equal the oracle on valid and graph-rule plans', () => {
    fc.assert(
      fc.property(fc.oneof(arbPlan(), arbGraphRulePlan), (plan) => {
        const expected = oracleSuccessors(plan);
        const actual = successors(plan);
        expect(Object.fromEntries(actual)).toEqual(expected);
        const expectedTerminal = Object.keys(expected)
          .filter((id) => expected[id]?.length === 0)
          .sort();
        expect(terminalSteps(plan)).toEqual(expectedTerminal);
      }),
      fcParams(),
    );
  });
});

describe('P-RG6 chain', () => {
  for (const [label, arb] of [
    ['default', arbPlan()],
    ['large', arbPlan({ large: true })],
  ] as const) {
    it(`P-RG6 chain: on valid ${label} plans longestChainMinutes equals the oracle and lies between the largest and the total minutes`, () => {
      fc.assert(
        fc.property(arb, (plan) => {
          const result = longestChainMinutes(plan);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const minutes = plan.steps.map((s) => s.minutes);
          expect(result.value).toBe(oracleLongestChain(plan));
          expect(result.value).toBeGreaterThanOrEqual(Math.max(...minutes));
          expect(result.value).toBeLessThanOrEqual(minutes.reduce((a, b) => a + b, 0));
        }),
        fcParams(),
      );
    });
  }
});
