import fc from 'fast-check';
import { expect, it } from 'vitest';
import { schedule } from '../../src/core/schedule.js';
import { PlanSchema } from '../../src/core/schema.js';
import type { ErrorCode, Kitchen, Plan, Schedule } from '../../src/core/schema.js';
import {
  arbBrokenPlan,
  arbHandsFreePair,
  arbPlanAndKitchen,
  arbShuffledPlan,
  arbUnlimitedPair,
} from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import {
  oracleCapacityViolations,
  oracleCompletenessViolations,
  oracleHoldExceeded,
  oracleLaneViolations,
  oracleLongestChain,
  oraclePrecedenceViolations,
  oracleSlack,
  oracleValid,
  oracleWaits,
  startsOf,
} from '../support/oracles.js';

// Each scheduler guarantee has its own property; titles start with the id and a space
// (scheduler-guarantees.md). A scheduler run on 80 steps of 480 minutes is slow to check
// by brute force, hence the longer timeout (design: Correctness properties).
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

/** Runs `check` on default-sized and on large (12 dishes, 80 steps) valid pairs. */
const forBothSizes = (check: (pair: Pair, s: Schedule) => void): void => {
  for (const arb of [arbPlanAndKitchen(), arbPlanAndKitchen({ large: true })]) {
    fc.assert(
      fc.property(arb, (pair) => {
        check(pair, mustSchedule(pair));
      }),
      fcParams(),
    );
  }
};

const terminalIds = (plan: Plan): string[] => {
  const used = new Set(plan.steps.flatMap((s) => s.after));
  return plan.steps.filter((s) => !used.has(s.id)).map((s) => s.id);
};

const minutesOf = (plan: Plan, id: string): number =>
  plan.steps.find((s) => s.id === id)?.minutes ?? 0;

it(
  'G1 capacity: no minute has more active steps than burners, ovens or cooks',
  () => {
    forBothSizes(({ plan, kitchen }, s) => {
      expect(oracleCapacityViolations(plan, kitchen, startsOf(s.steps))).toEqual([]);
    });
  },
  TIMEOUT_MS,
);

it(
  'G2 precedence: every step starts at or after the end of each prerequisite',
  () => {
    forBothSizes(({ plan }, s) => {
      expect(oraclePrecedenceViolations(plan, startsOf(s.steps))).toEqual([]);
    });
  },
  TIMEOUT_MS,
);

it(
  'G3 completeness: every step once, exact minutes, integers, ends at or before 0, sorted by id',
  () => {
    forBothSizes(({ plan }, s) => {
      expect(oracleCompletenessViolations(plan, s.steps)).toEqual([]);
      const ids = s.steps.map((x) => x.id);
      expect(ids).toEqual([...ids].sort());
    });
  },
  TIMEOUT_MS,
);

it(
  'G4.1 landing unlimited: with enough resources every hot terminal step ends at 0',
  () => {
    fc.assert(
      fc.property(arbUnlimitedPair(), (pair) => {
        const s = mustSchedule(pair);
        for (const id of terminalIds(pair.plan)) {
          const step = pair.plan.steps.find((x) => x.id === id);
          if (step === undefined || step.holdMin === null) continue;
          expect(s.steps.find((x) => x.id === id)?.endMin).toBe(0);
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

it(
  'G4.2 landing bound: a hot terminal step ends no earlier than minus the other terminal minutes',
  () => {
    forBothSizes(({ plan }, s) => {
      const terminals = terminalIds(plan);
      for (const id of terminals) {
        const step = plan.steps.find((x) => x.id === id);
        if (step === undefined || step.holdMin === null) continue;
        const others = terminals
          .filter((t) => t !== id)
          .reduce((sum, t) => sum + minutesOf(plan, t), 0);
        expect(s.steps.find((x) => x.id === id)?.endMin).toBeGreaterThanOrEqual(-others);
      }
    });
  },
  TIMEOUT_MS,
);

it(
  'G4.3 holds reported: one hold_exceeded per step that waits too long, waits match the oracle',
  () => {
    forBothSizes(({ plan }, s) => {
      const starts = startsOf(s.steps);
      expect(
        s.warnings.map((w) => ({ stepId: w.stepId, waitMin: w.waitMin, holdMin: w.holdMin })),
      ).toEqual(oracleHoldExceeded(plan, starts));
      const waits = oracleWaits(plan, starts);
      for (const x of s.steps) expect(x.waitMin).toBe(waits[x.id]);
      for (const w of s.warnings) expect(w.code).toBe('hold_exceeded');
    });
  },
  TIMEOUT_MS,
);

it(
  'G5.1 hands-free: a step with handsOn false has no cook lane, and the cook count changes nothing on hands-free plans',
  () => {
    forBothSizes(({ plan }, s) => {
      for (const step of plan.steps) {
        const scheduled = s.steps.find((x) => x.id === step.id);
        expect(scheduled?.lanes.cook === null).toBe(!step.handsOn);
      }
    });
    fc.assert(
      fc.property(arbHandsFreePair(), fc.integer({ min: 1, max: 6 }), (pair, cooks) => {
        const base = mustSchedule(pair);
        const other = mustSchedule({ plan: pair.plan, kitchen: { ...pair.kitchen, cooks } });
        expect(other).toEqual({ ...base, kitchen: { ...pair.kitchen, cooks } });
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

it(
  'G5.2 span bound: spanMin is minus the earliest start and at most the sum of all minutes',
  () => {
    forBothSizes(({ plan }, s) => {
      expect(s.spanMin).toBe(-Math.min(...s.steps.map((x) => x.startMin)));
      expect(s.spanMin).toBeLessThanOrEqual(plan.steps.reduce((sum, x) => sum + x.minutes, 0));
    });
  },
  TIMEOUT_MS,
);

it(
  'G5.3 chain bound: chainMin is the longest dependency path and spanMin is at least that',
  () => {
    forBothSizes(({ plan }, s) => {
      expect(s.chainMin).toBe(oracleLongestChain(plan));
      expect(s.spanMin).toBeGreaterThanOrEqual(s.chainMin);
    });
  },
  TIMEOUT_MS,
);

it(
  'G6 lanes: lane fields match the resources, are in range and never shared by overlapping steps',
  () => {
    forBothSizes(({ plan, kitchen }, s) => {
      expect(oracleLaneViolations(plan, kitchen, s.steps)).toEqual([]);
    });
  },
  TIMEOUT_MS,
);

it(
  'G7.1 same input: two calls are deep-equal and the arguments are not changed',
  () => {
    fc.assert(
      fc.property(arbPlanAndKitchen(), ({ plan, kitchen }) => {
        const planBefore = structuredClone(plan);
        const kitchenBefore = structuredClone(kitchen);
        const first = schedule(plan, kitchen);
        const second = schedule(plan, kitchen);
        expect(second).toStrictEqual(first);
        // toEqual: structuredClone drops the null prototype some generated kitchens have.
        expect(plan).toEqual(planBefore);
        expect(kitchen).toEqual(kitchenBefore);
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

/** The rules whose input still parses (as in sanity.pbt.ts). */
const GRAPH_RULES: readonly ErrorCode[] = [
  'unknown_dependency',
  'self_dependency',
  'cycle',
  'duplicate_step_id',
  'duplicate_dish_id',
  'unknown_dish',
  'dish_without_steps',
];

const arbGraphRuleCase: fc.Arbitrary<Pair> = fc
  .constantFrom(...GRAPH_RULES)
  .chain((rule) => arbBrokenPlan(rule))
  .map((c) => ({ plan: PlanSchema.parse(c.input), kitchen: c.kitchen }));

it(
  'G7.2 order-free: permuting steps, dishes and after lists gives deep-equal results, errors included',
  () => {
    for (const arb of [arbPlanAndKitchen(), arbGraphRuleCase]) {
      fc.assert(
        fc.property(
          arb.chain(({ plan, kitchen }) =>
            arbShuffledPlan(plan).map((shuffled) => ({ plan, shuffled, kitchen })),
          ),
          ({ plan, shuffled, kitchen }) => {
            expect(schedule(shuffled, kitchen)).toStrictEqual(schedule(plan, kitchen));
          },
        ),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'G8 slack: delaying by slackMin keeps G1 to G3, by one more breaks one; slackMin is the definition',
  () => {
    fc.assert(
      fc.property(arbPlanAndKitchen(), ({ plan, kitchen }) => {
        const s = mustSchedule({ plan, kitchen });
        const starts = startsOf(s.steps);
        for (const x of s.steps) {
          expect(x.slackMin).toBe(oracleSlack(plan, kitchen, starts, x.id));
          expect(x.critical).toBe(x.slackMin === 0);
          const delayed = (d: number): boolean =>
            oracleValid(plan, kitchen, { ...starts, [x.id]: x.startMin + d });
          expect(delayed(x.slackMin)).toBe(true);
          expect(delayed(x.slackMin + 1)).toBe(false);
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);
