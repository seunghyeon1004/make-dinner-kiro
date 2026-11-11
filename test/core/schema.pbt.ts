import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkPlan, parsePlan } from '../../src/core/sanity.js';
import { canonicalPlan, PlanSchema, type ErrorCode, type Plan } from '../../src/core/schema.js';
import { arbBrokenPlan, arbPlan, arbShuffledPlan } from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';

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

const arbGraphRulePlan = fc
  .constantFrom(...GRAPH_RULES)
  .chain((rule) => arbBrokenPlan(rule))
  .map((c): Plan => PlanSchema.parse(c.input));

/** `after` as the set it means: distinct entries in code-unit order. */
const asSet = (after: readonly string[]): string[] => [...new Set(after)].sort();

/** JSON with the keys in sorted order, so that key order does not matter. */
const keyed = (value: object): string => JSON.stringify(value, Object.keys(value).sort());

/** Each step with its `after` as a set, as one comparable string per step, sorted. */
const stepKeys = (plan: Plan): string[] =>
  plan.steps.map((s) => keyed({ ...s, after: asSet(s.after) })).sort();

const hasUniqueIds = (plan: Plan): boolean =>
  new Set(plan.steps.map((s) => s.id)).size === plan.steps.length &&
  new Set(plan.dishes.map((d) => d.id)).size === plan.dishes.length;

describe('P-RG1 canonical', () => {
  it('P-RG1 canonical: idempotent, sorted by id, after lists sorted and duplicate-free, same steps, input unchanged', () => {
    fc.assert(
      fc.property(fc.oneof(arbPlan(), arbPlan({ large: true }), arbGraphRulePlan), (plan) => {
        const before = structuredClone(plan);
        const canon = canonicalPlan(plan);
        expect(plan).toStrictEqual(before);
        expect(canonicalPlan(canon)).toStrictEqual(canon);
        expect(canon.title).toBe(plan.title);
        for (let i = 1; i < canon.steps.length; i++) {
          expect((canon.steps[i - 1]?.id ?? '') <= (canon.steps[i]?.id ?? '')).toBe(true);
        }
        for (let i = 1; i < canon.dishes.length; i++) {
          expect((canon.dishes[i - 1]?.id ?? '') <= (canon.dishes[i]?.id ?? '')).toBe(true);
        }
        for (const step of canon.steps) {
          expect(step.after).toEqual(asSet(step.after));
          expect(Object.values(step).every((v) => v !== undefined)).toBe(true);
        }
        expect(stepKeys(canon)).toEqual(stepKeys(plan));
        expect(canon.dishes.map(keyed).sort()).toEqual(plan.dishes.map(keyed).sort());
      }),
      fcParams(),
    );
  });

  it('P-RG1 canonical: plans with unique ids that differ only in order have deep-equal canonical forms', () => {
    fc.assert(
      fc.property(
        fc
          .oneof(arbPlan(), arbGraphRulePlan)
          .chain((plan) => arbShuffledPlan(plan).map((shuffled) => ({ plan, shuffled }))),
        ({ plan, shuffled }) => {
          fc.pre(hasUniqueIds(plan));
          expect(canonicalPlan(shuffled)).toStrictEqual(canonicalPlan(plan));
        },
      ),
      fcParams(),
    );
  });

  it('P-RG1 canonical: checkPlan(canonicalPlan(p)) equals checkPlan(p)', () => {
    fc.assert(
      fc.property(fc.oneof(arbPlan(), arbPlan({ large: true }), arbGraphRulePlan), (plan) => {
        expect(checkPlan(canonicalPlan(plan))).toStrictEqual(checkPlan(plan));
      }),
      fcParams(),
    );
  });
});

describe('P-RG8 JSON round trip', () => {
  for (const [label, arb] of [
    ['default', arbPlan()],
    ['large', arbPlan({ large: true })],
  ] as const) {
    it(`P-RG8 JSON round trip: parsePlan(JSON.parse(JSON.stringify(p))) is ok and strictly deep-equals p (${label})`, () => {
      fc.assert(
        fc.property(arb, (plan) => {
          const result = parsePlan(JSON.parse(JSON.stringify(plan)));
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toStrictEqual(plan);
        }),
        fcParams(),
      );
    });
  }
});
