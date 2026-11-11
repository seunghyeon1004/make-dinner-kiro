import fc from 'fast-check';
import { expect, it } from 'vitest';
import { backwardPass } from '../../src/core/passes/backward.js';
import { prepForwardPass } from '../../src/core/passes/prep-forward.js';
import { rightJustifyPass } from '../../src/core/passes/right-justify.js';
import { schedule } from '../../src/core/schedule.js';
import { checkKitchen, validatePlan } from '../../src/core/sanity.js';
import {
  ERROR_CODES,
  KitchenSchema,
  ScheduleSchema,
  canonicalPlan,
} from '../../src/core/schema.js';
import type { Kitchen, Plan, Schedule } from '../../src/core/schema.js';
import { capacityOf } from '../../src/core/timeline.js';
import {
  arbBrokenPlan,
  arbKitchen,
  arbPlanAndKitchen,
  arbPlanLikeValue,
} from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import { oracleValid, startsOf } from '../support/oracles.js';
import type { Starts } from '../support/oracles.js';

const TIMEOUT_MS = 60_000;

interface Pair {
  plan: Plan;
  kitchen: Kitchen;
}

const mustSchedule = ({ plan, kitchen }: Pair): Schedule => {
  const result = schedule(plan, kitchen);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const bothSizes = (): fc.Arbitrary<Pair>[] => [
  arbPlanAndKitchen(),
  arbPlanAndKitchen({ large: true }),
];

it(
  'P-SC1 errors: every error rule gives err with the kind and exactly the error issues',
  () => {
    for (const rule of ERROR_CODES) {
      fc.assert(
        fc.property(arbBrokenPlan(rule), ({ input, kitchen }) => {
          const result = schedule(input as Plan, kitchen);
          if (result.ok) throw new Error(`rule ${rule}: expected err`);
          const checked = validatePlan(input);
          if (rule === 'missing_appliance') {
            expect(checked.issues.filter((i) => i.severity === 'error')).toEqual([]);
            expect(result.error.kind).toBe('missing_appliance');
            const plan = checked.plan;
            if (plan === null) throw new Error('missing_appliance case must parse');
            expect(result.error.issues).toEqual(
              checkKitchen(plan, kitchen).filter((i) => i.severity === 'error'),
            );
          } else {
            expect(result.error.kind).toBe('invalid_plan');
            expect(result.error.issues).toEqual(
              checked.issues.filter((i) => i.severity === 'error'),
            );
            expect(result.error.issues.map((i) => i.code)).toContain(rule);
          }
        }),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-SC2 total: schedule never throws on any values; a bad kitchen on a valid plan is invalid_kitchen',
  () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.jsonValue(), arbPlanLikeValue()),
        fc.oneof(fc.jsonValue(), arbKitchen()),
        (plan, kitchen) => {
          const result = schedule(plan as Plan, kitchen as Kitchen);
          if (!result.ok) {
            expect(['invalid_plan', 'invalid_kitchen', 'missing_appliance']).toContain(
              result.error.kind,
            );
          }
        },
      ),
      fcParams(),
    );
    fc.assert(
      fc.property(
        arbPlanAndKitchen(),
        fc.jsonValue().filter((k) => !KitchenSchema.safeParse(k).success),
        ({ plan }, badKitchen) => {
          const result = schedule(plan, badKitchen as Kitchen);
          if (result.ok) throw new Error('expected err');
          expect(result.error.kind).toBe('invalid_kitchen');
        },
      ),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

const asStarts = (m: ReadonlyMap<string, number>): Starts => Object.fromEntries(m);

it(
  'P-SC3 passes: G1 to G3 after each pass; prep-forward moves only keeps steps earlier, right-justify only hot steps later',
  () => {
    for (const arb of bothSizes()) {
      fc.assert(
        fc.property(arb, ({ plan, kitchen }) => {
          const canonical = canonicalPlan(plan);
          const cap = capacityOf(kitchen);
          const p1 = backwardPass(canonical, cap);
          const p2 = prepForwardPass(canonical, cap, p1);
          const p3 = rightJustifyPass(canonical, cap, p2);
          for (const p of [p1, p2, p3])
            expect(oracleValid(canonical, kitchen, asStarts(p))).toBe(true);
          const t0 = Math.min(...p1.values());
          for (const step of canonical.steps) {
            const a = p1.get(step.id) ?? NaN;
            const b = p2.get(step.id) ?? NaN;
            const c = p3.get(step.id) ?? NaN;
            if (step.holdMin === null) {
              expect(b).toBeLessThanOrEqual(a);
              expect(b).toBeGreaterThanOrEqual(t0);
              expect(c).toBe(b);
            } else {
              expect(b).toBe(a);
              expect(c).toBeGreaterThanOrEqual(b);
            }
          }
        }),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-SC4 schema: the schedule survives JSON and its plan is the canonical plan',
  () => {
    fc.assert(
      fc.property(arbPlanAndKitchen(), (pair) => {
        const s = mustSchedule(pair);
        expect(ScheduleSchema.parse(JSON.parse(JSON.stringify(s)))).toStrictEqual(s);
        expect(s.plan).toEqual(canonicalPlan(pair.plan));
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

const RESOURCES = ['burner', 'oven', 'cook'] as const;

it(
  'P-SC5 lane preference: a step takes the lane of the prerequisite that ended last when that lane is free',
  () => {
    for (const arb of bothSizes()) {
      fc.assert(
        fc.property(arb, (pair) => {
          const s = mustSchedule(pair);
          const starts = startsOf(s.steps);
          const stepById = new Map(s.plan.steps.map((x) => [x.id, x]));
          const scheduledById = new Map(s.steps.map((x) => [x.id, x]));
          const uses = (id: string, r: (typeof RESOURCES)[number]): boolean => {
            const step = stepById.get(id);
            if (step === undefined) return false;
            return r === 'cook' ? step.handsOn : step.appliance === r;
          };
          const endOf = (id: string): number =>
            (starts[id] ?? 0) + (stepById.get(id)?.minutes ?? 0);
          for (const step of s.plan.steps) {
            const mine = starts[step.id] ?? 0;
            for (const r of RESOURCES) {
              if (!uses(step.id, r)) continue;
              // Steps assigned before this one: started earlier, or at the same minute with a smaller id.
              const held = new Set<number>();
              for (const u of s.plan.steps) {
                if (u.id === step.id || !uses(u.id, r)) continue;
                const theirs = starts[u.id] ?? 0;
                const before = theirs < mine || (theirs === mine && u.id < step.id);
                if (before && endOf(u.id) > mine) {
                  const lane = scheduledById.get(u.id)?.lanes[r];
                  if (lane !== null && lane !== undefined) held.add(lane);
                }
              }
              const candidates = step.after
                .filter((p) => uses(p, r))
                .sort((a, b) => endOf(b) - endOf(a) || (a < b ? -1 : a > b ? 1 : 0));
              for (const p of candidates) {
                const lane = scheduledById.get(p)?.lanes[r];
                if (lane === null || lane === undefined || held.has(lane)) continue;
                expect(scheduledById.get(step.id)?.lanes[r]).toBe(lane);
                break;
              }
            }
          }
        }),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);
