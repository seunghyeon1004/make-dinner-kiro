import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DISH_ID_PATTERN,
  PlanSchema,
  STEP_ID_PATTERN,
  validatePlan,
} from '../../../src/core/index.js';
import type { Plan } from '../../../src/core/index.js';
import { addDish, addStep, removeDish, removeStep } from '../../../src/web/state/plan-edit.js';
import { arbPlan } from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';

const unknownDependencies = (plan: Plan): number =>
  validatePlan(plan).issues.filter((i) => i.code === 'unknown_dependency').length;

/** Oracle: a plain loop. Each remaining step keeps its fields; `after` loses only removed ids. */
function expectUntouched(before: Plan, after: Plan, removedIndices: ReadonlySet<number>): void {
  const kept = before.steps.filter((_, i) => !removedIndices.has(i));
  const removedIds = new Set(before.steps.filter((_, i) => removedIndices.has(i)).map((s) => s.id));
  for (const s of kept) removedIds.delete(s.id);
  expect(after.steps).toHaveLength(kept.length);
  kept.forEach((s, i) => {
    const out = after.steps[i];
    expect({ ...out, after: undefined }).toEqual({ ...s, after: undefined });
    expect(out?.after).toEqual(s.after.filter((a) => !removedIds.has(a)));
  });
}

describe('plan-edit properties', () => {
  it('P-UI6 removeStep gives a plan passing PlanSchema, no unknown_dependency, other fields untouched', () => {
    fc.assert(
      fc.property(arbPlan(), fc.nat(), (plan, n) => {
        const index = n % plan.steps.length;
        const result = removeStep(plan, index);
        if (plan.steps.length === 1) {
          expect(result).toEqual({ ok: false, error: 'last_step' });
          return;
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(PlanSchema.safeParse(result.value.plan).success).toBe(true);
        expect(unknownDependencies(result.value.plan)).toBe(0);
        expect(result.value.plan.dishes).toEqual(plan.dishes);
        expectUntouched(plan, result.value.plan, new Set([index]));
      }),
      fcParams(),
    );
  });

  it('P-UI6 removeDish gives a plan passing PlanSchema, no unknown_dependency, other fields untouched', () => {
    fc.assert(
      fc.property(arbPlan(), fc.nat(), (plan, n) => {
        const index = n % plan.dishes.length;
        const result = removeDish(plan, index);
        const dishId = plan.dishes[index]?.id;
        const removed = new Set<number>();
        plan.steps.forEach((s, i) => {
          if (s.dish === dishId) removed.add(i);
        });
        if (plan.dishes.length === 1) {
          expect(result).toEqual({ ok: false, error: 'last_dish' });
          return;
        }
        if (removed.size === plan.steps.length) {
          expect(result).toEqual({ ok: false, error: 'last_step' });
          return;
        }
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(PlanSchema.safeParse(result.value.plan).success).toBe(true);
        expect(unknownDependencies(result.value.plan)).toBe(0);
        expect(result.value.plan.dishes).toEqual(plan.dishes.filter((_, i) => i !== index));
        expectUntouched(plan, result.value.plan, removed);
      }),
      fcParams(),
    );
  });

  it('P-UI6 addStep and addDish give pattern-valid, unique ids and a plan passing PlanSchema', () => {
    fc.assert(
      fc.property(
        arbPlan(),
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 60 }),
        (plan, n, name) => {
          const stepResult = addStep(plan, n % plan.dishes.length);
          if (stepResult.ok) {
            const ids = stepResult.value.plan.steps.map((s) => s.id);
            expect(new Set(ids).size).toBe(ids.length);
            const created = stepResult.value.plan.steps.at(-1);
            expect(created?.id).toMatch(STEP_ID_PATTERN);
            expect(PlanSchema.safeParse(stepResult.value.plan).success).toBe(true);
          }
          const dishResult = addDish(plan, name);
          if (dishResult.ok) {
            const next = dishResult.value.plan;
            const dishIds = next.dishes.map((d) => d.id);
            expect(new Set(dishIds).size).toBe(dishIds.length);
            expect(next.dishes.at(-1)?.id).toMatch(DISH_ID_PATTERN);
            const stepIds = next.steps.map((s) => s.id);
            expect(new Set(stepIds).size).toBe(stepIds.length);
            expect(next.steps.at(-1)?.id).toMatch(STEP_ID_PATTERN);
            expect(PlanSchema.safeParse(next).success).toBe(true);
          }
        },
      ),
      fcParams(),
    );
  });
});
