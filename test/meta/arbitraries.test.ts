import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AXIS_MIN,
  ERROR_CODES,
  KitchenSchema,
  LIMITS,
  PlanSchema,
  ProgressSchema,
  ScheduleSchema,
  SERVE_TIME_PATTERN,
} from '../../src/core/schema.js';
import type { ErrorCode, Plan, Progress, RebuiltStep, Schedule } from '../../src/core/schema.js';
import {
  arbAnyDinnerfileOptions,
  arbBreakingEdit,
  arbBrokenPlan,
  arbDinnerfileLikeText,
  arbDinnerfileOptions,
  arbDinnerfileStyle,
  arbHostileText,
  arbServeTime,
  arbHandsFreePair,
  arbNow,
  arbOnPlan,
  arbProgress,
  arbScheduled,
  followPlan,
  arbKitchen,
  arbPlan,
  arbPlanAndKitchen,
  arbPlanLikeValue,
  arbRecipeText,
  arbShuffledPlan,
  arbUnlimitedKitchen,
  arbUnlimitedPair,
  fitUnlimited,
} from '../support/arbitraries.js';
import type { BrokenCase, Run, RunOpts } from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import {
  H1_SCHEDULE,
  HOME_KITCHEN,
  RB_C_PROGRESS,
  SUNDAY_ROAST,
  WORST_CASE,
} from '../support/fixtures.js';
import { checkKitchen, checkPlan } from '../../src/core/sanity.js';
import {
  CANONICAL_STYLE,
  oracleDinnerfile,
  oracleMakeLines,
  oraclePinnedIntervals,
  oracleRebuildViolations,
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

describe('R10.1 a failing property reports a shrunk counterexample (T2.7)', () => {
  // Session 3 found that a false property over arbPlan() ran out of memory while shrinking
  // and crashed the worker instead of printing the failing plan.
  it('fc.check over arbPlan() fails with a valid plan of exactly 3 steps, the smallest that breaks it', () => {
    const result = fc.check(
      fc.property(arbPlan(), (plan) => plan.steps.length < 3),
      { ...fcParams(), seed: SEED },
    );
    expect(result.failed).toBe(true);
    const [counterexample] = (result.counterexample ?? []) as Plan[];
    expect(counterexample?.steps.length).toBe(3);
    expect(PlanSchema.safeParse(counterexample).success).toBe(true);
  });
  it.each(ERROR_CODES)(
    'fc.check over arbBrokenPlan(%s) fails with a shrunk case of that rule',
    (rule) => {
      const result = fc.check(
        fc.property(arbBrokenPlan(rule), () => false),
        { ...fcParams(), seed: SEED },
      );
      expect(result.failed).toBe(true);
      const [counterexample] = (result.counterexample ?? []) as BrokenCase[];
      expect(counterexample?.rule).toBe(rule);
    },
  );
});

// ---------------------------------------------------------------------------------------
// Scheduler spec, T2.4: arbUnlimitedKitchen, fitUnlimited, arbUnlimitedPair, arbHandsFreePair

const needs = (plan: Plan) => ({
  burners: plan.steps.filter((s) => s.appliance === 'burner').length,
  ovens: plan.steps.filter((s) => s.appliance === 'oven').length,
  cooks: plan.steps.filter((s) => s.handsOn).length,
});

/** A plan of `n` steps `t.s01`..`t.sNN` with the given appliance and handsOn, no prerequisites. */
function uniformPlan(n: number, appliance: 'burner' | 'oven' | 'none', handsOn: boolean): Plan {
  return {
    title: 'Uniform',
    dishes: [{ id: 't', name: 'Test' }],
    steps: Array.from({ length: n }, (_, i) => ({
      id: `t.s${String(i + 1).padStart(2, '0')}`,
      dish: 't',
      title: 'Prepare the thing',
      minutes: 5,
      appliance,
      handsOn,
      after: [],
      holdMin: null,
    })),
  };
}

describe('R10.2 arbUnlimitedKitchen', () => {
  it('SUNDAY_ROAST needs 3 burners, 1 oven and 6 cooks, so those are the lowest counts drawn', () => {
    const kitchens = sampleOf(arbUnlimitedKitchen(SUNDAY_ROAST), 300);
    for (const k of kitchens) {
      expect(KitchenSchema.safeParse(k).success).toBe(true);
      expect(k.burners).toBeGreaterThanOrEqual(3);
      expect(k.ovens).toBeGreaterThanOrEqual(1);
      expect(k.cooks).toBe(6);
    }
    expect(kitchens.some((k) => k.burners === 3)).toBe(true);
    expect(kitchens.some((k) => k.burners === 8)).toBe(true);
    expect(kitchens.some((k) => k.ovens === 1)).toBe(true);
    expect(kitchens.some((k) => k.ovens === 4)).toBe(true);
  });
  it('a plan that needs nothing still gets at least one cook', () => {
    const kitchens = sampleOf(arbUnlimitedKitchen(uniformPlan(2, 'none', false)), 200);
    for (const k of kitchens) expect(k.cooks).toBeGreaterThanOrEqual(1);
    expect(kitchens.some((k) => k.burners === 0)).toBe(true);
  });
});

describe('R10.2 fitUnlimited', () => {
  it('changes nothing in a plan within the bounds', () => {
    expect(fitUnlimited(SUNDAY_ROAST)).toEqual(SUNDAY_ROAST);
  });
  it('8 hands-on steps: the first 6 by id stay hands-on, s07 and s08 become hands-free', () => {
    const fitted = fitUnlimited(uniformPlan(8, 'none', true));
    expect(fitted.steps.filter((s) => s.handsOn).map((s) => s.id)).toEqual([
      't.s01',
      't.s02',
      't.s03',
      't.s04',
      't.s05',
      't.s06',
    ]);
  });
  it('10 burner steps keep 8 burner steps; 6 oven steps keep 4; the rest use no appliance', () => {
    const burners = fitUnlimited(uniformPlan(10, 'burner', false));
    expect(burners.steps.filter((s) => s.appliance === 'burner').map((s) => s.id)).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08'].map((n) => `t.s${n}`),
    );
    expect(burners.steps.filter((s) => s.appliance === 'none').map((s) => s.id)).toEqual([
      't.s09',
      't.s10',
    ]);
    const ovens = fitUnlimited(uniformPlan(6, 'oven', false));
    expect(ovens.steps.filter((s) => s.appliance === 'oven')).toHaveLength(4);
    expect(ovens.steps.filter((s) => s.appliance === 'none').map((s) => s.id)).toEqual([
      't.s05',
      't.s06',
    ]);
  });
  it('keeps the step order of the input and every other field', () => {
    const plan = uniformPlan(8, 'none', true);
    const reversed: Plan = { ...plan, steps: [...plan.steps].reverse() };
    const fitted = fitUnlimited(reversed);
    expect(fitted.steps.map((s) => s.id)).toEqual(reversed.steps.map((s) => s.id));
    expect(fitted.steps.map((s) => s.handsOn)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(fitted.steps.every((s) => s.minutes === 5 && s.title === 'Prepare the thing')).toBe(
      true,
    );
  });
});

describe('R10.2 arbUnlimitedPair', () => {
  const pairs = sampleOf(arbUnlimitedPair(), 300);
  it('every kitchen has counts at least the burner, oven and hands-on step counts and passes KitchenSchema', () => {
    expect(pairs).toHaveLength(300);
    for (const { plan, kitchen } of pairs) {
      const need = needs(plan);
      expect(KitchenSchema.safeParse(kitchen).success).toBe(true);
      expect(kitchen.burners).toBeGreaterThanOrEqual(need.burners);
      expect(kitchen.ovens).toBeGreaterThanOrEqual(need.ovens);
      expect(kitchen.cooks).toBeGreaterThanOrEqual(need.cooks);
    }
  });
  it('every plan passes PlanSchema, has no checkPlan error and fits its kitchen', () => {
    for (const { plan, kitchen } of pairs) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
      expect(checkPlan(plan).filter((i) => i.severity === 'error')).toEqual([]);
      expect(checkKitchen(plan, kitchen)).toEqual([]);
    }
  });
  it('reaches the schema maxima: 6 cooks needed, 8 burners and 4 ovens available', () => {
    expect(pairs.some((p) => needs(p.plan).cooks === 6)).toBe(true);
    expect(pairs.some((p) => p.kitchen.burners === 8)).toBe(true);
    expect(pairs.some((p) => p.kitchen.ovens === 4)).toBe(true);
    expect(pairs.some((p) => needs(p.plan).burners > 0)).toBe(true);
  });
});

describe('R10.2 arbHandsFreePair', () => {
  const pairs = sampleOf(arbHandsFreePair(), 300);
  it('no step is hands-on', () => {
    expect(pairs).toHaveLength(300);
    for (const { plan } of pairs) expect(plan.steps.some((s) => s.handsOn)).toBe(false);
  });
  it('plans pass the schema, kitchens have every needed appliance, no error', () => {
    for (const { plan, kitchen } of pairs) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
      expect(KitchenSchema.safeParse(kitchen).success).toBe(true);
      expect(checkPlan(plan).filter((i) => i.severity === 'error')).toEqual([]);
      expect(checkKitchen(plan, kitchen)).toEqual([]);
    }
  });
  it('still varies the kitchen: cooks of 1 and of 6, with and without burners', () => {
    expect(pairs.some((p) => p.kitchen.cooks === 1)).toBe(true);
    expect(pairs.some((p) => p.kitchen.cooks === 6)).toBe(true);
    expect(pairs.some((p) => p.kitchen.burners === 0)).toBe(true);
    expect(pairs.some((p) => p.plan.steps.some((s) => s.appliance === 'burner'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Rebuild spec, T2.4: arbScheduled, arbNow, arbProgress, followPlan, arbOnPlan.

interface RunSample extends Run {
  s: Schedule;
}

const runsOf = (opts: RunOpts = {}, numRuns = 200, large = false): RunSample[] =>
  sampleOf(
    arbScheduled(large ? { large: true } : {}).chain((s) =>
      arbProgress(s, opts).map((run): RunSample => ({ s, ...run })),
    ),
    numRuns,
  );

const stepOf = (plan: Plan, id: string) => plan.steps.find((x) => x.id === id);
const plannedOf = (s: Schedule, id: string) => s.steps.find((x) => x.id === id);

describe('RQ11.1 arbScheduled', () => {
  it('gives schedules that pass ScheduleSchema, at both sizes', () => {
    for (const large of [false, true]) {
      for (const s of sampleOf(arbScheduled(large ? { large: true } : {}), 40)) {
        expect(ScheduleSchema.safeParse(s).success).toBe(true);
      }
    }
  });
});

describe('RQ11.1 arbNow', () => {
  const samples = sampleOf(
    arbScheduled().chain((s) => arbNow(s).map((now) => ({ s, now }))),
    300,
  );
  it('stays in [earliest start - 10, 30 after serving], inside the axis, and is an integer', () => {
    for (const { s, now } of samples) {
      const first = Math.min(...s.steps.map((x) => x.startMin));
      expect(Number.isInteger(now)).toBe(true);
      expect(now).toBeGreaterThanOrEqual(Math.max(AXIS_MIN, first - 10));
      expect(now).toBeLessThanOrEqual(30);
    }
  });
  it('lands on a start or an end of a step for about a third of the samples, and elsewhere too', () => {
    const edges = samples.filter(({ s, now }) =>
      s.steps.some((x) => x.startMin === now || x.endMin === now),
    );
    expect(edges.length).toBeGreaterThanOrEqual(60);
    expect(edges.length).toBeLessThan(samples.length);
  });
  it('before the first start, during the meal and after serving all occur', () => {
    expect(samples.some(({ s, now }) => now < Math.min(...s.steps.map((x) => x.startMin)))).toBe(
      true,
    );
    expect(samples.some(({ now }) => now > 0)).toBe(true);
    expect(
      samples.some(({ s, now }) => now > Math.min(...s.steps.map((x) => x.startMin)) && now < 0),
    ).toBe(true);
  });
});

describe('RQ11.1 arbProgress, default runs', () => {
  const runs = runsOf();
  it('gives progress that passes ProgressSchema, names real steps and now in range', () => {
    expect(runs.length).toBe(200);
    for (const { s, progress, now } of runs) {
      expect(ProgressSchema.safeParse(progress).success).toBe(true);
      for (const id of Object.keys(progress)) expect(stepOf(s.plan, id)).not.toBeUndefined();
      expect(Number.isInteger(now)).toBe(true);
      expect(now).toBeGreaterThanOrEqual(AXIS_MIN);
      expect(now).toBeLessThanOrEqual(1440);
    }
  });
  it('rebuild would accept every fact: done ends at or after its start and at or before now; running starts at or before now', () => {
    for (const { progress, now } of runs) {
      for (const entry of Object.values(progress)) {
        expect(entry.startMin).toBeLessThanOrEqual(now);
        if (entry.state === 'done') {
          expect(entry.endMin).toBeGreaterThanOrEqual(entry.startMin);
          expect(entry.endMin).toBeLessThanOrEqual(now);
        }
      }
    }
  });
  it('respects precedence among pinned steps: a pinned step started after every prerequisite was done', () => {
    for (const { s, progress } of runs) {
      for (const [id, entry] of Object.entries(progress)) {
        for (const p of stepOf(s.plan, id)?.after ?? []) {
          const before = progress[p];
          expect(before?.state).toBe('done');
          if (before?.state === 'done') {
            expect(entry.startMin).toBeGreaterThanOrEqual(before.endMin);
          }
        }
      }
    }
  });
  it('has no capacity violation at t >= now when the pinned steps alone are counted', () => {
    for (const { s, progress, now } of runs) {
      const iv = oraclePinnedIntervals(s.plan, progress, now);
      const pinned: RebuiltStep[] = Object.entries(iv).map(([id, i]) => ({
        id,
        startMin: i.startMin,
        endMin: i.endMin,
        lanes: { burner: null, oven: null, cook: null },
        slackMin: 0,
        critical: false,
        waitMin: null,
      }));
      const subPlan = { ...s.plan, steps: s.plan.steps.filter((x) => iv[x.id] !== undefined) };
      const capacity = oracleRebuildViolations(subPlan, s.kitchen, {}, now, pinned, 1440).filter(
        (v) => v.startsWith('capacity:'),
      );
      expect(capacity).toEqual([]);
    }
  });

  const early = (r: RunSample): boolean =>
    Object.entries(r.progress).some(([id, e]) => e.startMin < (plannedOf(r.s, id)?.startMin ?? 0));
  const doneOverrun = (r: RunSample): boolean =>
    Object.entries(r.progress).some(
      ([id, e]) =>
        e.state === 'done' && e.endMin - e.startMin > (stepOf(r.s.plan, id)?.minutes ?? 0),
    );
  const runningExtra = (r: RunSample): boolean =>
    Object.values(r.progress).some((e) => e.state === 'running' && e.extraMin > 0);
  const overrunNoTaps = (r: RunSample): boolean =>
    Object.entries(r.progress).some(
      ([id, e]) =>
        e.state === 'running' &&
        e.extraMin === 0 &&
        e.startMin + (stepOf(r.s.plan, id)?.minutes ?? 0) < r.now,
    );
  const allDone = (r: RunSample): boolean =>
    Object.keys(r.progress).length === r.s.plan.steps.length &&
    Object.values(r.progress).every((e) => e.state === 'done');
  const nothingStarted = (r: RunSample): boolean => Object.keys(r.progress).length === 0;

  it.each([
    ['an early start', early],
    ['a done overrun', doneOverrun],
    ['a running step with extraMin > 0', runningExtra],
    ['an overrun without taps', overrunNoTaps],
    ['an all-done case', allDone],
    ['a nothing-started case', nothingStarted],
  ] as const)('across 200 samples there is at least one: %s', (_name, has) => {
    expect(runs.filter(has).length).toBeGreaterThanOrEqual(1);
  });
  it('the cases are not the whole sample: most runs have both pinned and pending steps', () => {
    const mixed = runs.filter(
      (r) =>
        Object.keys(r.progress).length > 0 &&
        Object.keys(r.progress).length < r.s.plan.steps.length,
    );
    expect(mixed.length).toBeGreaterThanOrEqual(80);
  });
});

describe('RQ11.1 arbProgress options', () => {
  const pinnedBeforePrereq = (r: RunSample): boolean =>
    Object.entries(r.progress).some(([id, e]) =>
      (stepOf(r.s.plan, id)?.after ?? []).some((p) => {
        const before = r.progress[p];
        return before === undefined || before.state === 'running' || e.startMin < before.endMin;
      }),
    );
  const overCapacityPinned = (r: RunSample): boolean => {
    const iv = oraclePinnedIntervals(r.s.plan, r.progress, r.now);
    const sub = { ...r.s.plan, steps: r.s.plan.steps.filter((x) => iv[x.id] !== undefined) };
    return oracleRebuildViolations(
      sub,
      r.s.kitchen,
      {},
      Number.NEGATIVE_INFINITY,
      Object.entries(iv).map(([id, i]) => ({
        id,
        startMin: i.startMin,
        endMin: i.endMin,
        lanes: { burner: null, oven: null, cook: null },
        slackMin: 0,
        critical: false,
        waitMin: null,
      })),
      1440,
    ).some((v) => v.startsWith('capacity:'));
  };
  it('outOfOrder produces a step pinned before its prerequisite was done, in some sample; default never does', () => {
    expect(runsOf({ outOfOrder: true }).some(pinnedBeforePrereq)).toBe(true);
    expect(runsOf().some(pinnedBeforePrereq)).toBe(false);
  });
  it('overCapacity produces pinned steps over the kitchen, in some sample; default never does', () => {
    expect(runsOf({ overCapacity: true }).some(overCapacityPinned)).toBe(true);
    expect(runsOf().some(overCapacityPinned)).toBe(false);
  });
  it('options still give schema-valid progress', () => {
    for (const r of runsOf({ outOfOrder: true, overCapacity: true })) {
      expect(ProgressSchema.safeParse(r.progress).success).toBe(true);
    }
  });
  it('large plans give valid runs too', () => {
    for (const r of runsOf({}, 15, true)) {
      expect(ProgressSchema.safeParse(r.progress).success).toBe(true);
      expect(r.now).toBeLessThanOrEqual(1440);
    }
  });
});

describe('RQ11.1 arbProgress with base: every base fact stays', () => {
  const baseSamples = sampleOf(
    arbScheduled().chain((s) =>
      arbProgress(s).chain((base) => arbProgress(s, { base }).map((next) => ({ s, base, next }))),
    ),
    200,
  );
  it("done stays done and identical; running keeps its start, with extraMin at least the base's or done from there", () => {
    let runningKept = 0;
    let doneFromRunning = 0;
    for (const { base, next } of baseSamples) {
      for (const [id, entry] of Object.entries(base.progress)) {
        const now = next.progress[id];
        expect(now).not.toBeUndefined();
        if (entry.state === 'done') {
          expect(now).toEqual(entry);
        } else if (now?.state === 'running') {
          runningKept++;
          expect(now.startMin).toBe(entry.startMin);
          expect(now.extraMin).toBeGreaterThanOrEqual(entry.extraMin);
        } else {
          doneFromRunning++;
          expect(now?.startMin).toBe(entry.startMin);
          expect(now?.state).toBe('done');
          if (now?.state === 'done') expect(now.endMin).toBeGreaterThanOrEqual(base.now);
        }
      }
    }
    expect(runningKept).toBeGreaterThan(0);
    expect(doneFromRunning).toBeGreaterThan(0);
  });
  it('now is the base now plus 0 to 90 (capped at 1440); new facts start at or after the base now', () => {
    for (const { base, next } of baseSamples) {
      expect(next.now).toBeGreaterThanOrEqual(base.now);
      expect(next.now).toBeLessThanOrEqual(Math.min(1440, base.now + 90));
      for (const [id, entry] of Object.entries(next.progress)) {
        if (base.progress[id] === undefined)
          expect(entry.startMin).toBeGreaterThanOrEqual(base.now);
      }
      expect(ProgressSchema.safeParse(next.progress).success).toBe(true);
    }
  });
  it('some base runs start new steps and some finish nothing new (the cases are mixed)', () => {
    expect(
      baseSamples.some(
        ({ base, next }) => Object.keys(next.progress).length > Object.keys(base.progress).length,
      ),
    ).toBe(true);
    expect(
      baseSamples.some(
        ({ base, next }) => Object.keys(next.progress).length === Object.keys(base.progress).length,
      ),
    ).toBe(true);
  });
});

describe('RQ11.1 followPlan and arbOnPlan meet the premise of R4', () => {
  const onPlan = sampleOf(
    arbScheduled().chain((s) => arbOnPlan(s).map((run) => ({ s, ...run }))),
    200,
  );
  it('every done step ran as planned, every running step started as planned with extraMin 0 and ends at or after now, every pending step starts at or after now', () => {
    let doneCount = 0;
    let runningCount = 0;
    for (const { s, progress, now } of onPlan) {
      for (const step of s.steps) {
        const entry = progress[step.id];
        if (entry === undefined) {
          expect(step.startMin).toBeGreaterThanOrEqual(now);
        } else if (entry.state === 'done') {
          doneCount++;
          expect(entry).toEqual({ state: 'done', startMin: step.startMin, endMin: step.endMin });
          expect(step.endMin).toBeLessThanOrEqual(now);
        } else {
          runningCount++;
          expect(entry).toEqual({ state: 'running', startMin: step.startMin, extraMin: 0 });
          expect(step.startMin).toBeLessThan(now);
          expect(step.endMin).toBeGreaterThan(now);
        }
      }
    }
    expect(doneCount).toBeGreaterThan(0);
    expect(runningCount).toBeGreaterThan(0);
  });
  it('followPlan on the H1 schedule, nothing known, now -60: prep and shred done, roast running (RB-c)', () => {
    expect(followPlan(H1_SCHEDULE, {}, -60)).toEqual(RB_C_PROGRESS);
  });
  it('followPlan on H1 with the roast running with 15 extra: still running at -26, done at its planned end -25', () => {
    const base: Progress = { 'chicken.roast': { state: 'running', startMin: -100, extraMin: 15 } };
    expect(followPlan(H1_SCHEDULE, base, -26)['chicken.roast']).toEqual(base['chicken.roast']);
    expect(followPlan(H1_SCHEDULE, base, -25)['chicken.roast']).toEqual({
      state: 'done',
      startMin: -100,
      endMin: -25,
    });
  });
  it('followPlan keeps base facts: a base running step whose planned end is at or before now becomes done there', () => {
    let seen = 0;
    for (const { s } of onPlan.slice(0, 60)) {
      const first = [...s.steps].sort(
        (a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : 1),
      )[0];
      if (first === undefined) continue;
      const base: Progress = {
        [first.id]: { state: 'running', startMin: first.startMin, extraMin: 3 },
      };
      const later = followPlan(s, base, first.endMin);
      expect(later[first.id]).toEqual({
        state: 'done',
        startMin: first.startMin,
        endMin: first.endMin,
      });
      const earlier = followPlan(
        s,
        base,
        first.startMin + 1 <= first.endMin - 1 ? first.startMin + 1 : first.startMin,
      );
      expect(earlier[first.id]?.state === 'running' || earlier[first.id]?.state === 'done').toBe(
        true,
      );
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------
// Dinnerfile spec, T1.2: the hostile extensions of the existing generators and the new ones.

/** The hostile alphabet of the dinnerfile design, written out here (not read from the generator). */
const HOSTILE_TOKENS: readonly string[] = [
  "'",
  '"',
  '$',
  '$$',
  '$(MAKE)',
  '${MAKE}',
  '$(shell touch canary)',
  '`touch canary`',
  "'\\''",
  '; touch canary',
  '#',
  '# step dish=x',
  '\\',
  '\\c',
  '\n',
  '\r',
  '\r\n',
  '\t',
  '\t@touch canary',
  ':',
  '=',
  ':=',
  '%',
  '|',
  '*',
  '-n',
  '-e',
  '  ',
  '\u0000',
  '\u001b[31m',
  '\u007f',
  '\u0085',
  '\u00a0',
  '\u2028',
  '\u2029',
  '\u202e',
  '\u2066',
  '\ufeff',
  '\u00e9',
  'e\u0301',
  '\u{1F525}',
  '\u6f22\u5b57',
  'word',
];
const LONE_HIGH = /[\ud800-\udbff](?![\udc00-\udfff])/;
const LONE_LOW = /(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Every title, detail, dish name and plan title of the plans, one string each. */
const textsOf = (plans: readonly Plan[]): string[] =>
  plans.flatMap((p) => [
    p.title,
    ...p.dishes.map((d) => d.name),
    ...p.steps.flatMap((s) => (s.detail === undefined ? [s.title] : [s.title, s.detail])),
  ]);

describe('R10.1 (dinnerfile) the extended plan generators stay valid and reach the hostile cases', () => {
  const plans = [
    ...sampleOf(arbPlan(), 400),
    ...fc.sample(arbPlan({ large: true }), { numRuns: 100, seed: SEED }),
  ];
  const texts = textsOf(plans);

  it('every sample, large ones included, passes PlanSchema with unique ids', () => {
    for (const plan of plans) {
      expect(PlanSchema.safeParse(plan).success).toBe(true);
      expect(duplicates(plan.steps.map((s) => s.id))).toEqual([]);
      expect(duplicates(plan.dishes.map((d) => d.id))).toEqual([]);
    }
  });
  it('no sample has a sanity error', () => {
    for (const plan of plans) {
      expect(checkPlan(plan).filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
  it.each(HOSTILE_TOKENS.map((t) => [JSON.stringify(t), t] as const))(
    'some title, name or detail holds the token %s',
    (_name, token) => {
      expect(texts.some((t) => t.includes(token))).toBe(true);
    },
  );
  it('some text holds a lone high surrogate and some a lone low surrogate', () => {
    expect(texts.some((t) => LONE_HIGH.test(t))).toBe(true);
    expect(texts.some((t) => LONE_LOW.test(t))).toBe(true);
  });
  it('some plan has a dish called dinner and one for each directive word', () => {
    const dishIds = new Set(plans.flatMap((p) => p.dishes.map((d) => d.id)));
    for (const id of [
      'dinner',
      'define',
      'export',
      'include',
      'ifeq',
      'else',
      'endif',
      'override',
      'vpath',
      'makefile',
    ]) {
      expect(dishIds.has(id)).toBe(true);
    }
  });
  it('some step slug starts with a dash, some ends with one, and some are only dashes', () => {
    const slugs = plans.flatMap((p) => p.steps.map((s) => s.id.slice(s.dish.length + 1)));
    expect(slugs.some((s) => s.startsWith('-'))).toBe(true);
    expect(slugs.some((s) => s.endsWith('-'))).toBe(true);
    expect(slugs.some((s) => /^-+$/.test(s))).toBe(true);
  });
});

describe('R10.1 (dinnerfile) arbHostileText', () => {
  const samples = sampleOf(arbHostileText(120), 300);

  it('gives at most max code points and a non-white-space character', () => {
    for (const text of samples) {
      expect([...text].length).toBeLessThanOrEqual(120);
      expect(/\S/.test(text)).toBe(true);
    }
    for (const text of sampleOf(arbHostileText(5), 300)) {
      expect([...text].length).toBeLessThanOrEqual(5);
      expect(/\S/.test(text)).toBe(true);
    }
  });
  it('reaches every token of the hostile alphabet', () => {
    for (const token of HOSTILE_TOKENS) {
      expect(samples.some((t) => t.includes(token))).toBe(true);
    }
  });
});

describe('R10.1 (dinnerfile) arbServeTime and the option generators', () => {
  it('arbServeTime always matches SERVE_TIME_PATTERN and reaches 00:xx, 23:xx and xx:59', () => {
    const times = sampleOf(arbServeTime(), 1000);
    for (const t of times) expect(SERVE_TIME_PATTERN.test(t)).toBe(true);
    expect(times.some((t) => t.startsWith('00:'))).toBe(true);
    expect(times.some((t) => t.startsWith('23:'))).toBe(true);
    expect(times.some((t) => t.endsWith(':59'))).toBe(true);
    expect(times.some((t) => t.endsWith(':00'))).toBe(true);
  });
  it('arbDinnerfileOptions: valid values, every key combination, keys absent never undefined', () => {
    const options = sampleOf(arbDinnerfileOptions(), 300);
    for (const o of options) {
      expect(Object.keys(o).filter((k) => k !== 'kitchen' && k !== 'serve')).toEqual([]);
      if ('kitchen' in o) expect(KitchenSchema.safeParse(o.kitchen).success).toBe(true);
      if ('serve' in o) expect(SERVE_TIME_PATTERN.test(o.serve ?? '')).toBe(true);
    }
    const shapes = new Set(options.map((o) => `${'kitchen' in o}/${'serve' in o}`));
    expect([...shapes].sort()).toEqual(['false/false', 'false/true', 'true/false', 'true/true']);
  });
  it('arbAnyDinnerfileOptions: valid and invalid kitchens and serving times, keys never undefined', () => {
    const options = sampleOf(arbAnyDinnerfileOptions(), 500);
    for (const o of options) {
      expect(Object.keys(o).filter((k) => k !== 'kitchen' && k !== 'serve')).toEqual([]);
      for (const key of ['kitchen', 'serve'] as const) {
        if (key in o) expect(o[key]).not.toBeUndefined();
      }
    }
    const kitchens = options.flatMap((o) => ('kitchen' in o ? [o.kitchen] : []));
    const serves = options.flatMap((o) => ('serve' in o ? [o.serve] : []));
    expect(kitchens.some((k) => KitchenSchema.safeParse(k).success)).toBe(true);
    expect(kitchens.some((k) => !KitchenSchema.safeParse(k).success)).toBe(true);
    expect(serves.some((v) => SERVE_TIME_PATTERN.test(String(v)))).toBe(true);
    expect(serves.some((v) => !SERVE_TIME_PATTERN.test(String(v)))).toBe(true);
    // The named invalid values of the design are all reached.
    for (const bad of ['24:00', '7:00', '19:60', '19:00\n.PHONY: x', '']) {
      expect(serves).toContain(bad);
    }
    expect(kitchens.some((k) => (k as { burners?: unknown }).burners === -1)).toBe(true);
    expect(kitchens.some((k) => (k as { burners?: unknown }).burners === 9)).toBe(true);
    expect(kitchens.some((k) => (k as { cooks?: unknown }).cooks === 1.5)).toBe(true);
    expect(kitchens.some((k) => typeof k === 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Dinnerfile spec, T1.5: styles, Dinnerfile-like text and breaking edits.

describe('R10.1 (dinnerfile) arbDinnerfileStyle covers every style field', () => {
  const styles = sampleOf(arbDinnerfileStyle(SUNDAY_ROAST), 400);
  const valuesOf = (key: keyof typeof CANONICAL_STYLE): Set<string> =>
    new Set(styles.map((st) => JSON.stringify(st[key])));

  it.each([
    ['eol', ['lf', 'crlf']],
    ['bom', [true, false]],
    ['header', [true, false]],
    ['phony', ['one', 'none', 'per-rule']],
    ['dinnerRule', [true, false]],
    ['dishRules', [true, false]],
    ['recipes', ['echo', 'none', 'true', 'fail']],
    ['stepOrder', ['canonical', 'reversed', 'rotated']],
    ['dishOrder', ['canonical', 'reversed', 'rotated']],
    ['optionOrder', ['canonical', 'reversed']],
    ['metadataAtBottom', [true, false]],
    ['escapes', [true, false]],
    ['ruleNote', [true, false]],
    ['spaceAfterColon', [true, false]],
    ['repeatPrerequisite', [true, false]],
  ] as const)('%s takes every value of its set', (key, expected) => {
    expect([...valuesOf(key)].sort()).toEqual(expected.map((v) => JSON.stringify(v)).sort());
  });
  it('white space at line ends, indents and separators take several values, tabs among them', () => {
    expect(valuesOf('lineEndSpace').size).toBeGreaterThan(2);
    expect(styles.some((st) => st.lineEndSpace.includes('\t'))).toBe(true);
    expect(valuesOf('indent').size).toBeGreaterThan(1);
    expect(valuesOf('separator').size).toBeGreaterThan(2);
    expect(styles.some((st) => st.separator.includes('\t'))).toBe(true);
    expect(styles.every((st) => /^[ \t]+$/.test(st.separator))).toBe(true);
    expect(styles.every((st) => /^[ \t]*$/.test(st.lineEndSpace) && /^ *$/.test(st.indent))).toBe(
      true,
    );
  });
  it('blank lines and unknown comments are drawn at several rates, comments from a fixed pool', () => {
    expect(valuesOf('blankEvery').size).toBeGreaterThan(2);
    expect(valuesOf('commentEvery').size).toBeGreaterThan(2);
    expect(styles.some((st) => st.commentEvery > 0 && st.comments.length > 0)).toBe(true);
    const pool = new Set(styles.flatMap((st) => st.comments));
    expect([...pool].sort()).toEqual(
      ['#', '# note', '#   Plan "x"', '# plan2', '# steps below', '#stepping'].sort(),
    );
  });
  it('step keys and kitchen keys are permutations of the full key sets, in several orders', () => {
    const stepKeys = ['dish', 'minutes', 'appliance', 'handsOn', 'hold', 'title', 'detail'].sort();
    const kitchenKeys = ['burners', 'ovens', 'cooks'].sort();
    for (const st of styles) {
      expect([...st.stepKeys].sort()).toEqual(stepKeys);
      expect([...st.kitchenKeys].sort()).toEqual(kitchenKeys);
    }
    expect(valuesOf('stepKeys').size).toBeGreaterThan(5);
    expect(valuesOf('kitchenKeys').size).toBeGreaterThan(2);
  });
});

describe('R10.2 (dinnerfile) CANONICAL_STYLE and styled texts', () => {
  const plans = [SUNDAY_ROAST, WORST_CASE, ...sampleOf(arbPlan(), 60)];
  it('oracleDinnerfile with CANONICAL_STYLE equals oracleDinnerfile with no style, for 62 plans', () => {
    for (const plan of plans) {
      expect(
        oracleDinnerfile(plan, { kitchen: HOME_KITCHEN, serve: '19:00' }, CANONICAL_STYLE),
      ).toBe(oracleDinnerfile(plan, { kitchen: HOME_KITCHEN, serve: '19:00' }));
    }
  });
  it('the canonical text is made of the line forms export writes, and no line is "other"', () => {
    for (const plan of plans) {
      const kinds = oracleMakeLines(
        oracleDinnerfile(plan, { kitchen: HOME_KITCHEN, serve: '07:30' }),
      );
      expect(kinds.filter((k) => k === 'other')).toEqual([]);
    }
  });
  it('a styled text has the same number of step blocks as the canonical one', () => {
    const styles = sampleOf(arbDinnerfileStyle(SUNDAY_ROAST), 100);
    for (const style of styles) {
      const text = oracleDinnerfile(SUNDAY_ROAST, {}, style);
      const stepLines = text
        .split(/\r?\n/)
        .filter((l) => /^[ \t]*#[ \t]*step[ \t]/.test(l.replace('\ufeff', '')));
      expect(stepLines.length).toBe(10);
    }
  });
});

describe('R10.1 (dinnerfile) arbDinnerfileLikeText', () => {
  const texts = sampleOf(arbDinnerfileLikeText(), 600);

  it('gives strings, including the empty one, and many that look like a Dinnerfile', () => {
    expect(texts.every((t) => typeof t === 'string')).toBe(true);
    expect(texts.some((t) => t === '')).toBe(true);
    expect(texts.filter((t) => /^[ \t]*# *(plan|dish|step)\b/m.test(t)).length).toBeGreaterThan(50);
  });
  it('reaches CRLF, a lone CR, tab lines, lines ending in a backslash and the design vocabulary', () => {
    expect(texts.some((t) => t.includes('\r\n'))).toBe(true);
    expect(texts.some((t) => /\r(?!\n)/.test(t))).toBe(true);
    expect(texts.some((t) => /^\t/m.test(t))).toBe(true);
    expect(texts.some((t) => /\\$/m.test(t))).toBe(true);
    expect(texts.some((t) => t.includes('X = 1'))).toBe(true);
    expect(texts.some((t) => t.includes('include '))).toBe(true);
    expect(texts.some((t) => t.includes('::'))).toBe(true);
    expect(texts.some((t) => /minutes=-?1\.5|minutes=abc|minutes=007/.test(t))).toBe(true);
  });
  it('includes texts that are an export with a few characters inserted, deleted or lines swapped', () => {
    const exportLike = texts.filter((t) => t.includes('# Dinnerfile written by Make Dinner'));
    expect(exportLike.length).toBeGreaterThan(20);
    expect(exportLike.some((t) => !t.endsWith('\n'))).toBe(true);
  });
});

describe('R10.1 (dinnerfile) arbBreakingEdit', () => {
  const plans = [SUNDAY_ROAST, WORST_CASE, ...sampleOf(arbPlan(), 40)];
  // A different seed per plan, or every plan would see the same sequence of draws.
  const cases = plans.flatMap((plan, i) =>
    fc.sample(arbBreakingEdit(plan), { numRuns: 60, seed: SEED + i }),
  );

  it('every case has a text and a line that is null (missing_plan only) or inside the text', () => {
    expect(cases.length).toBe(plans.length * 60);
    for (const c of cases) {
      const lines = c.text.split('\n');
      if (c.line === null) {
        expect(c.code).toBe('missing_plan');
      } else {
        expect(c.line).toBeGreaterThanOrEqual(1);
        expect(c.line).toBeLessThanOrEqual(lines.length);
      }
    }
  });
  it('the line points at the edited line: the form each edit leaves there', () => {
    for (const c of cases) {
      if (c.line === null) continue;
      const line = c.text.split('\n')[c.line - 1] ?? '';
      switch (c.code) {
        case 'target_without_step':
        case 'duplicate_target':
          expect(oracleMakeLines(line)).toEqual(['rule']);
          expect(line.startsWith('.PHONY')).toBe(false);
          break;
        case 'step_without_target':
        case 'missing_key':
        case 'bad_value':
          expect(line.startsWith('# step ')).toBe(true);
          break;
        case 'unknown_key':
          expect(line.startsWith('# step ') && line.includes(' extra=1')).toBe(true);
          break;
        case 'duplicate_metadata':
          expect(line.startsWith('# plan ')).toBe(true);
          break;
        case 'dish_target_mismatch':
          expect(oracleMakeLines(line)).toEqual(['rule']);
          expect(line.split(':')[0]?.includes('.')).toBe(false);
          break;
        case 'dinner_mismatch':
          expect(line.startsWith('dinner:')).toBe(true);
          break;
        case 'line_continuation':
          expect(line.endsWith(' \\')).toBe(true);
          break;
        case 'unsupported_line':
          expect(['X = 1', 'include other', 'a.x : b.y', 'a.x b.y:']).toContain(line);
          break;
        case 'recipe_before_rule':
          expect(line).toBe('\t@true');
          expect(c.text.split('\n')[c.line] ?? '').toMatch(/^\.PHONY:/);
          break;
        default:
          throw new Error(`unexpected code ${c.code}`);
      }
    }
  });
  it('the edit leaves the text different from the canonical export of its plan', () => {
    for (const plan of plans.slice(0, 10)) {
      const canonicalText = oracleDinnerfile(plan, {});
      for (const c of sampleOf(arbBreakingEdit(plan), 40)) expect(c.text).not.toBe(canonicalText);
    }
  });
  it('every row of the design table occurs, with its code', () => {
    const byEdit = new Map<string, Set<string>>();
    for (const c of cases) {
      const codes = byEdit.get(c.edit) ?? new Set<string>();
      codes.add(c.code);
      byEdit.set(c.edit, codes);
    }
    const expected: Record<string, string> = {
      'remove-step-line': 'target_without_step',
      'remove-rule-line': 'step_without_target',
      'duplicate-rule': 'duplicate_target',
      'unknown-key': 'unknown_key',
      'bad-minutes': 'bad_value',
      'bad-handsOn': 'bad_value',
      'bad-hold': 'bad_value',
      'remove-minutes': 'missing_key',
      'repeat-plan': 'duplicate_metadata',
      'remove-plan': 'missing_plan',
      'dish-rule-extra': 'dish_target_mismatch',
      'dinner-rule-extra': 'dinner_mismatch',
      'line-continuation': 'line_continuation',
      'unsupported-line': 'unsupported_line',
      'recipe-before-rule': 'recipe_before_rule',
    };
    expect([...byEdit.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [edit, code] of Object.entries(expected)) {
      expect([edit, [...(byEdit.get(edit) ?? [])]]).toEqual([edit, [code]]);
    }
  });
  it('the bad minutes of the table all occur, and the four unsupported lines', () => {
    const texts = cases.map((c) => c.text);
    for (const bad of ['1.5', '-3', '007', '', 'abc', '1e3', '1234567']) {
      expect(texts.some((t) => t.includes(` minutes=${bad} `))).toBe(true);
    }
    for (const line of ['X = 1', 'include other', 'a.x : b.y', 'a.x b.y:']) {
      expect(texts.some((t) => t.split('\n').includes(line))).toBe(true);
    }
    expect(texts.some((t) => t.includes(' handsOn=yes '))).toBe(true);
    expect(texts.some((t) => t.includes(' hold=keep '))).toBe(true);
  });
  it('edits that need a shape the plan lacks are not drawn for it', () => {
    // SUNDAY_ROAST has a non-terminal step and dishes with several steps; a one-step plan has
    // neither a non-last step nor a non-terminal one.
    const single: Plan = {
      title: 'One',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [
        {
          id: 'a.x',
          dish: 'a',
          title: 'Do it',
          minutes: 5,
          appliance: 'none',
          handsOn: true,
          after: [],
          holdMin: null,
        },
      ],
    };
    const edits = new Set(sampleOf(arbBreakingEdit(single), 200).map((c) => c.edit));
    expect(edits.has('dish-rule-extra')).toBe(false);
    expect(edits.has('dinner-rule-extra')).toBe(false);
    expect(edits.has('duplicate-rule')).toBe(false);
    expect(edits.has('bad-minutes')).toBe(true);
  });
});
