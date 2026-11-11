import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, KitchenSchema, LIMITS, PlanSchema } from '../../src/core/schema.js';
import type { ErrorCode, Plan } from '../../src/core/schema.js';
import {
  arbBrokenPlan,
  arbKitchen,
  arbPlan,
  arbPlanAndKitchen,
  arbPlanLikeValue,
  arbRecipeText,
  arbShuffledPlan,
} from '../support/arbitraries.js';
import {
  oracleStronglyConnected,
  oracleTopologicalOrder,
  oracleWarnings,
} from '../support/oracles.js';

// Fixed seed: these tests look at what the generators produce, so the sample must not change.
const SEED = 20260101;
const sampleOf = <T>(arb: fc.Arbitrary<T>, numRuns = 300): T[] =>
  fc.sample(arb, { numRuns, seed: SEED });

const duplicates = (values: readonly string[]): string[] =>
  values.filter((v, i) => values.indexOf(v) !== i);

describe('R10.1 arbPlan is valid by construction', () => {
  const plans = sampleOf(arbPlan());

  it('every sample passes PlanSchema', () => {
    expect(plans.length).toBe(300);
    for (const plan of plans) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
    }
  });
  it('step ids and dish ids are unique', () => {
    for (const plan of plans) {
      expect(duplicates(plan.steps.map((s) => s.id))).toEqual([]);
      expect(duplicates(plan.dishes.map((d) => d.id))).toEqual([]);
    }
  });
  it('every after entry and every step dish is known, and no step waits on itself', () => {
    for (const plan of plans) {
      const stepIds = new Set(plan.steps.map((s) => s.id));
      const dishIds = new Set(plan.dishes.map((d) => d.id));
      for (const step of plan.steps) {
        expect(dishIds.has(step.dish)).toBe(true);
        expect(step.after.includes(step.id)).toBe(false);
        for (const p of step.after) expect(stepIds.has(p)).toBe(true);
        expect(duplicates(step.after)).toEqual([]);
      }
    }
  });
  it('every dish has a step', () => {
    for (const plan of plans) {
      for (const dish of plan.dishes) {
        expect(plan.steps.some((s) => s.dish === dish.id)).toBe(true);
      }
    }
  });
  it('the oracle topological order has every step (acyclic)', () => {
    for (const plan of plans) {
      expect(oracleTopologicalOrder(plan)?.length).toBe(plan.steps.length);
    }
  });
  it('default sizes are 1..6 dishes and 1..30 steps, at least as many steps as dishes', () => {
    for (const plan of plans) {
      expect(plan.dishes.length).toBeGreaterThanOrEqual(1);
      expect(plan.dishes.length).toBeLessThanOrEqual(6);
      expect(plan.steps.length).toBeGreaterThanOrEqual(plan.dishes.length);
      expect(plan.steps.length).toBeLessThanOrEqual(30);
    }
  });
  it('a detail key is absent or a string, never undefined', () => {
    for (const plan of plans) {
      for (const step of plan.steps) {
        if (Object.hasOwn(step, 'detail')) expect(typeof step.detail).toBe('string');
      }
    }
  });
  it('the appliances option limits the appliances', () => {
    for (const plan of sampleOf(arbPlan({ appliances: ['none'] }), 50)) {
      expect(plan.steps.every((s) => s.appliance === 'none')).toBe(true);
    }
    for (const plan of sampleOf(arbPlan({ appliances: ['none', 'oven'] }), 50)) {
      expect(plan.steps.every((s) => s.appliance !== 'burner')).toBe(true);
    }
  });
});

describe('R10.2 arbPlan coverage over a run of 300', () => {
  const plans = sampleOf(arbPlan());
  const steps = plans.flatMap((p) => p.steps);

  it('cross-dish dependencies', () => {
    const crossDish = plans.some((plan) =>
      plan.steps.some((s) =>
        s.after.some((p) => plan.steps.find((q) => q.id === p)?.dish !== s.dish),
      ),
    );
    expect(crossDish).toBe(true);
  });
  it('every appliance', () => {
    for (const appliance of ['burner', 'oven', 'none'] as const) {
      expect(steps.some((s) => s.appliance === appliance)).toBe(true);
    }
  });
  it('both handsOn values', () => {
    expect(steps.some((s) => s.handsOn)).toBe(true);
    expect(steps.some((s) => !s.handsOn)).toBe(true);
  });
  it('null holds, zero holds and finite holds above 30', () => {
    expect(steps.some((s) => s.holdMin === null)).toBe(true);
    expect(steps.some((s) => s.holdMin === 0)).toBe(true);
    expect(steps.some((s) => s.holdMin !== null && s.holdMin > 30)).toBe(true);
  });
  it('steps in non-topological input order', () => {
    const backwards = plans.some((plan) =>
      plan.steps.some((s, i) => s.after.some((p) => plan.steps.findIndex((q) => q.id === p) > i)),
    );
    expect(backwards).toBe(true);
  });
  it('steps with no after, one after and several after entries', () => {
    expect(steps.some((s) => s.after.length === 0)).toBe(true);
    expect(steps.some((s) => s.after.length === 1)).toBe(true);
    expect(steps.some((s) => s.after.length >= 3)).toBe(true);
  });
  it('minutes of 1, of 45 or less, and above 45', () => {
    expect(steps.some((s) => s.minutes === 1)).toBe(true);
    expect(steps.some((s) => s.minutes > 45)).toBe(true);
    expect(steps.some((s) => s.minutes <= 45)).toBe(true);
  });
  it('details present and absent', () => {
    expect(steps.some((s) => s.detail !== undefined)).toBe(true);
    expect(steps.some((s) => s.detail === undefined)).toBe(true);
  });
  it('every warning code, seen through oracleWarnings', () => {
    const codes = new Set(plans.flatMap((p) => oracleWarnings(p).map((w) => w.code)));
    expect([...codes].sort()).toEqual(['appliance_mismatch', 'long_hands_on', 'short_hands_free']);
  });
  it('plans with no warning at all', () => {
    expect(plans.some((p) => oracleWarnings(p).length === 0)).toBe(true);
  });
  it('large: true reaches 12 dishes and 80 steps and stays inside the limits', () => {
    const large = sampleOf(arbPlan({ large: true }), 100);
    expect(Math.max(...large.map((p) => p.dishes.length))).toBe(12);
    expect(Math.max(...large.map((p) => p.steps.length))).toBe(80);
    for (const plan of large) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
      expect(plan.dishes.length).toBeLessThanOrEqual(12);
      expect(plan.steps.length).toBeLessThanOrEqual(80);
      expect(oracleTopologicalOrder(plan)?.length).toBe(plan.steps.length);
    }
  });
});

describe('R10.1 arbKitchen and arbPlanAndKitchen', () => {
  it('arbKitchen stays within LIMITS and passes KitchenSchema', () => {
    for (const k of sampleOf(arbKitchen())) {
      expect(KitchenSchema.safeParse(k).success).toBe(true);
      expect(k.burners).toBeGreaterThanOrEqual(0);
      expect(k.burners).toBeLessThanOrEqual(LIMITS.burnersMax);
      expect(k.ovens).toBeGreaterThanOrEqual(0);
      expect(k.ovens).toBeLessThanOrEqual(LIMITS.ovensMax);
      expect(k.cooks).toBeGreaterThanOrEqual(LIMITS.cooksMin);
      expect(k.cooks).toBeLessThanOrEqual(LIMITS.cooksMax);
    }
  });
  it('arbKitchen reaches the edges of every count', () => {
    const kitchens = sampleOf(arbKitchen(), 500);
    expect(kitchens.some((k) => k.burners === 0)).toBe(true);
    expect(kitchens.some((k) => k.burners === 8)).toBe(true);
    expect(kitchens.some((k) => k.ovens === 0)).toBe(true);
    expect(kitchens.some((k) => k.ovens === 4)).toBe(true);
    expect(kitchens.some((k) => k.cooks === 1)).toBe(true);
    expect(kitchens.some((k) => k.cooks === 6)).toBe(true);
  });
  it('arbPlanAndKitchen never uses an absent appliance', () => {
    const pairs = sampleOf(arbPlanAndKitchen());
    for (const { plan, kitchen } of pairs) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
      expect(KitchenSchema.safeParse(kitchen).success).toBe(true);
      for (const step of plan.steps) {
        if (step.appliance === 'burner') expect(kitchen.burners).toBeGreaterThan(0);
        if (step.appliance === 'oven') expect(kitchen.ovens).toBeGreaterThan(0);
      }
    }
    expect(pairs.some((p) => p.kitchen.burners === 0)).toBe(true);
    expect(pairs.some((p) => p.kitchen.ovens === 0)).toBe(true);
  });
  it('arbPlanAndKitchen honours large', () => {
    const pairs = sampleOf(arbPlanAndKitchen({ large: true }), 100);
    expect(Math.max(...pairs.map((p) => p.plan.steps.length))).toBe(80);
  });
});

const GRAPH_RULES: readonly ErrorCode[] = [
  'unknown_dependency',
  'self_dependency',
  'cycle',
  'duplicate_step_id',
  'duplicate_dish_id',
  'unknown_dish',
  'dish_without_steps',
];

/** The paths of the issues zod finds in `input`, as dotted strings like `steps.3.minutes`. */
function zodPaths(input: unknown): string[] {
  const result = PlanSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('R10.3 arbBrokenPlan breaks exactly the rule it is given', () => {
  it('covers every error code of the design table', () => {
    expect(ERROR_CODES).toHaveLength(13);
  });

  describe.each(ERROR_CODES)('%s', (rule) => {
    const cases = sampleOf(arbBrokenPlan(rule), 150);

    it('carries its rule, a valid kitchen and an input', () => {
      for (const c of cases) {
        expect(c.rule).toBe(rule);
        expect(KitchenSchema.safeParse(c.kitchen).success).toBe(true);
      }
    });

    if (GRAPH_RULES.includes(rule)) {
      it('the input still parses with PlanSchema', () => {
        for (const c of cases) {
          expect(PlanSchema.safeParse(c.input).success).toBe(true);
        }
      });
    } else if (rule === 'missing_appliance') {
      it('the plan parses and the kitchen lacks the appliance of the target step', () => {
        for (const c of cases) {
          const plan = PlanSchema.parse(c.input);
          const target = plan.steps.find((s) => s.id === c.target.stepId);
          expect(target).not.toBeUndefined();
          if (target?.appliance === 'burner') expect(c.kitchen.burners).toBe(0);
          else if (target?.appliance === 'oven') expect(c.kitchen.ovens).toBe(0);
          else expect.unreachable('the target step must need a burner or an oven');
        }
      });
    } else {
      it('the input does not parse with PlanSchema', () => {
        for (const c of cases) {
          expect(PlanSchema.safeParse(c.input).success).toBe(false);
        }
      });
    }

    if (!GRAPH_RULES.includes(rule) && rule !== 'missing_appliance') {
      it('zod finds only the kind of failure that belongs to the rule', () => {
        for (const c of cases) {
          const paths = zodPaths(c.input);
          expect(paths.length).toBeGreaterThan(0);
          const isMinutes = (p: string) => /^steps\.\d+\.minutes$/.test(p);
          if (rule === 'minutes_out_of_range') {
            expect(paths.every(isMinutes)).toBe(true);
          } else if (rule === 'invalid_field') {
            expect(paths.some(isMinutes)).toBe(false);
            expect(paths.includes('dishes') || paths.includes('steps')).toBe(false);
          } else if (rule === 'empty_plan') {
            expect(paths.every((p) => p === 'dishes' || p === 'steps')).toBe(true);
            const input = c.input as { dishes: unknown[]; steps: unknown[] };
            expect(input.dishes.length === 0 || input.steps.length === 0).toBe(true);
          } else {
            // too_many_dishes, too_many_steps
            const key = rule === 'too_many_dishes' ? 'dishes' : 'steps';
            expect(paths).toEqual([key]);
          }
        }
      });
    }

    it('names its target', () => {
      for (const c of cases) {
        if (rule === 'empty_plan' || rule === 'cycle' || rule === 'too_many_dishes') {
          expect(c.target).toEqual({});
          continue;
        }
        if (rule === 'too_many_steps') {
          expect(c.target).toEqual({});
          continue;
        }
        if (rule === 'invalid_field') continue; // the target is optional here
        if (rule === 'minutes_out_of_range') {
          const input = c.input as { steps: { id: string; minutes?: unknown }[] };
          const step = input.steps.find((s) => s.id === c.target.stepId);
          expect(step).not.toBeUndefined();
          const m = step?.minutes;
          expect(typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= 480).toBe(false);
          continue;
        }
        const plan = PlanSchema.parse(c.input);
        const ids = plan.steps.map((s) => s.id);
        const dishIds = plan.dishes.map((d) => d.id);
        const step = plan.steps.find((s) => s.id === c.target.stepId);
        if (rule === 'unknown_dependency') {
          expect(step?.after.some((p) => !ids.includes(p))).toBe(true);
        } else if (rule === 'self_dependency') {
          expect(step?.after.includes(step.id)).toBe(true);
        } else if (rule === 'duplicate_step_id') {
          expect(ids.filter((id) => id === c.target.stepId).length).toBeGreaterThanOrEqual(2);
        } else if (rule === 'duplicate_dish_id') {
          expect(dishIds.filter((id) => id === c.target.dishId).length).toBeGreaterThanOrEqual(2);
        } else if (rule === 'unknown_dish') {
          expect(step).not.toBeUndefined();
          expect(dishIds.includes(step?.dish ?? '')).toBe(false);
        } else if (rule === 'dish_without_steps') {
          expect(dishIds.includes(c.target.dishId ?? '')).toBe(true);
          expect(plan.steps.some((s) => s.dish === c.target.dishId)).toBe(false);
        }
      }
    });
  });

  describe('each graph-rule case breaks only its own rule, checked by oracles', () => {
    const planOf = (rule: ErrorCode): Plan[] =>
      sampleOf(arbBrokenPlan(rule), 150).map((c) => PlanSchema.parse(c.input));

    it('cycle: one or more strongly connected groups, no self-dependency, no unknown ids', () => {
      for (const plan of planOf('cycle')) {
        const ids = plan.steps.map((s) => s.id);
        expect(oracleStronglyConnected(plan).length).toBe(1);
        expect(duplicates(ids)).toEqual([]);
        for (const s of plan.steps) {
          expect(s.after.includes(s.id)).toBe(false);
          expect(s.after.every((p) => ids.includes(p))).toBe(true);
        }
      }
    });
    it('self_dependency: no cycle of two or more steps', () => {
      for (const plan of planOf('self_dependency')) {
        expect(oracleStronglyConnected(plan)).toEqual([]);
      }
    });
    it('unknown_dependency, duplicate ids, unknown_dish and dish_without_steps: no cycle', () => {
      for (const rule of [
        'unknown_dependency',
        'duplicate_step_id',
        'duplicate_dish_id',
        'unknown_dish',
        'dish_without_steps',
      ] as const) {
        for (const plan of planOf(rule)) {
          expect(oracleStronglyConnected(plan)).toEqual([]);
        }
      }
    });
  });
});

describe('arbShuffledPlan keeps the same plan in another order', () => {
  const canonical = (plan: Plan): string =>
    JSON.stringify({
      title: plan.title,
      dishes: plan.dishes.map((d) => JSON.stringify(d)).sort(),
      steps: plan.steps.map((s) => JSON.stringify({ ...s, after: [...s.after].sort() })).sort(),
    });

  const pairs = sampleOf(
    arbPlan().chain((plan) => fc.tuple(fc.constant(plan), arbShuffledPlan(plan))),
    200,
  );

  it('has the same multiset of dishes, steps and after entries', () => {
    for (const [plan, shuffled] of pairs) {
      expect(PlanSchema.safeParse(shuffled).success).toBe(true);
      expect(canonical(shuffled)).toBe(canonical(plan));
    }
  });
  it('changes the order of steps, of dishes and of after lists in some samples', () => {
    expect(pairs.some(([p, s]) => JSON.stringify(p.steps) !== JSON.stringify(s.steps))).toBe(true);
    expect(pairs.some(([p, s]) => JSON.stringify(p.dishes) !== JSON.stringify(s.dishes))).toBe(
      true,
    );
    expect(
      pairs.some(([p, s]) =>
        p.steps.some((step) => {
          const other = s.steps.find((q) => q.id === step.id);
          return JSON.stringify(step.after) !== JSON.stringify(other?.after);
        }),
      ),
    ).toBe(true);
  });
});

describe('arbPlanLikeValue reaches deep paths of the parser', () => {
  const values = sampleOf(arbPlanLikeValue(), 400);
  it('mostly objects, some of them valid plans, many of them not', () => {
    const invalid = values.filter((v) => !PlanSchema.safeParse(v).success);
    expect(invalid.length).toBeGreaterThan(50);
    expect(values.some((v) => PlanSchema.safeParse(v).success)).toBe(true);
    expect(values.filter((v) => typeof v === 'object' && v !== null).length).toBeGreaterThan(200);
  });
  it('some values fail inside a step, some in the root fields', () => {
    const paths = values.flatMap((v) => zodPaths(v));
    expect(paths.some((p) => p.startsWith('steps.'))).toBe(true);
    expect(paths.some((p) => p.startsWith('dishes.'))).toBe(true);
    expect(paths.some((p) => p === 'title')).toBe(true);
  });
});

describe('arbRecipeText produces the awkward characters of R9.1', () => {
  const texts = sampleOf(arbRecipeText(), 400);
  it.each([
    ['CR LF', '\r\n'],
    ['a lone CR', '\r'],
    ['LF', '\n'],
    ['tab', '\t'],
    ['no-break space', '\u00a0'],
    ['line separator', '\u2028'],
    ['a combining acute accent', '\u0301'],
    ['three newlines', '\n\n\n'],
  ])('some text has %s', (_name, fragment) => {
    expect(texts.some((t) => t.includes(fragment))).toBe(true);
  });
  it('some text is already in NFC and some is not', () => {
    expect(texts.some((t) => t === t.normalize('NFC'))).toBe(true);
    expect(texts.some((t) => t !== t.normalize('NFC'))).toBe(true);
  });
});
