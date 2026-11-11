import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  findCycles,
  longestChainMinutes,
  successors,
  terminalSteps,
  topologicalOrder,
} from '../../src/core/graph.js';
import {
  checkKitchen,
  checkPlan,
  hasErrors,
  parseKitchen,
  parsePlan,
  validatePlan,
} from '../../src/core/sanity.js';
import {
  ERROR_CODES,
  IssueSchema,
  PlanSchema,
  type ErrorCode,
  type Issue,
  type Kitchen,
  type Plan,
} from '../../src/core/schema.js';
import {
  arbBrokenPlan,
  arbKitchen,
  arbPlan,
  arbPlanAndKitchen,
  arbPlanLikeValue,
  arbShuffledPlan,
} from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import { oracleWarnings } from '../support/oracles.js';

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

const arbGraphRuleCase: fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }> = fc
  .constantFrom(...GRAPH_RULES)
  .chain((rule) => arbBrokenPlan(rule))
  .map((c) => ({ plan: PlanSchema.parse(c.input), kitchen: c.kitchen }));

const errorCodes = (issues: readonly Issue[]): string[] =>
  [...new Set(issues.filter((i) => i.severity === 'error').map((i) => i.code))].sort();

const expectSchemaValid = (issues: readonly Issue[]): void => {
  for (const issue of issues) expect(IssueSchema.safeParse(issue).success).toBe(true);
};

/** JSON with keys in sorted order, so two issues compare by their fields only. */
const keyed = (issue: Issue): string =>
  JSON.stringify(issue, Object.keys(issue as Record<string, unknown>).sort());

/** Sorted as R7.3 asks (severity, then code, stepId, dishId) and free of exact duplicates. */
function expectSortedAndDistinct(issues: readonly Issue[]): void {
  const keys = issues.map(keyed);
  expect(new Set(keys).size).toBe(keys.length);
  const rank = (i: Issue): [number, string, string, string] => [
    i.severity === 'error' ? 0 : 1,
    i.code,
    'stepId' in i && i.stepId !== undefined ? i.stepId : '',
    'dishId' in i && i.dishId !== undefined ? i.dishId : '',
  ];
  for (let k = 1; k < issues.length; k++) {
    const a = rank(issues[k - 1] as Issue); // k - 1 is in range
    const b = rank(issues[k] as Issue); // k is in range
    let order = 0;
    for (let j = 0; j < a.length && order === 0; j++) {
      const x = a[j] ?? '';
      const y = b[j] ?? '';
      order = x < y ? -1 : x > y ? 1 : 0;
    }
    expect(order).toBeLessThanOrEqual(0);
  }
}

describe('S1 total', () => {
  it('S1 total: parsePlan and validatePlan never throw, agree, and return schema-valid issues', () => {
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), arbPlanLikeValue()), arbKitchen(), (input, kitchen) => {
        const parsed = parsePlan(input);
        const checked = validatePlan(input);
        if (parsed.ok) {
          expect(checked.plan).toStrictEqual(parsed.value);
          const issues = checkPlan(parsed.value);
          expect(checked.issues).toStrictEqual(issues);
          expectSchemaValid(issues);
          expectSchemaValid(checkKitchen(parsed.value, kitchen));
        } else {
          expect(parsed.error.length).toBeGreaterThanOrEqual(1);
          expect(hasErrors(parsed.error)).toBe(true);
          expect(checked).toStrictEqual({ plan: null, issues: parsed.error });
          expectSchemaValid(parsed.error);
        }
      }),
      fcParams(),
    );
  });

  it('S1 total: parseKitchen never throws and returns a kitchen or invalid_field errors', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.jsonValue(),
          arbKitchen(),
          fc.record({ burners: fc.jsonValue(), ovens: fc.jsonValue(), cooks: fc.jsonValue() }),
        ),
        (input) => {
          const result = parseKitchen(input);
          if (result.ok) return;
          expect(result.error.length).toBeGreaterThanOrEqual(1);
          expect(result.error.every((i) => i.code === 'invalid_field')).toBe(true);
          expectSchemaValid(result.error);
        },
      ),
      fcParams(),
    );
  });
});

describe('S2 sound', () => {
  for (const rule of ERROR_CODES) {
    it(`S2 sound: ${rule} fires, alone among the errors, on a plan built to break it`, () => {
      fc.assert(
        fc.property(arbBrokenPlan(rule), ({ input, kitchen, target }) => {
          const checked = validatePlan(input);
          const issues = [
            ...checked.issues,
            ...(checked.plan === null ? [] : checkKitchen(checked.plan, kitchen)),
          ];
          expect(errorCodes(issues)).toEqual([rule]);
          const carriesTarget = issues.some(
            (i) =>
              i.code === rule &&
              (target.stepId === undefined || ('stepId' in i && i.stepId === target.stepId)) &&
              (target.dishId === undefined || ('dishId' in i && i.dishId === target.dishId)),
          );
          expect(carriesTarget).toBe(true);
        }),
        fcParams(),
      );
    });
  }

  it('S2 sound: no error fires on a valid plan and its kitchen', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbPlanAndKitchen(), arbPlanAndKitchen({ large: true })),
        ({ plan, kitchen }) => {
          const checked = validatePlan(plan);
          expect(checked.plan).toStrictEqual(plan);
          expect(errorCodes(checked.issues)).toEqual([]);
          expect(checkKitchen(plan, kitchen)).toEqual([]);
        },
      ),
      fcParams(),
    );
  });
});

describe('P-RG2 order-free', () => {
  it('P-RG2 order-free: graph helpers, checkPlan and checkKitchen ignore input order; issues are sorted and distinct', () => {
    fc.assert(
      fc.property(
        fc
          .oneof(arbPlanAndKitchen(), arbGraphRuleCase)
          .chain(({ plan, kitchen }) =>
            arbShuffledPlan(plan).map((shuffled) => ({ plan, shuffled, kitchen })),
          ),
        ({ plan, shuffled, kitchen }) => {
          expect([...successors(shuffled)]).toStrictEqual([...successors(plan)]);
          expect(terminalSteps(shuffled)).toStrictEqual(terminalSteps(plan));
          expect(topologicalOrder(shuffled)).toStrictEqual(topologicalOrder(plan));
          expect(findCycles(shuffled)).toStrictEqual(findCycles(plan));
          expect(longestChainMinutes(shuffled)).toStrictEqual(longestChainMinutes(plan));

          const planIssues = checkPlan(plan);
          const kitchenIssues = checkKitchen(plan, kitchen);
          expect(checkPlan(shuffled)).toStrictEqual(planIssues);
          expect(checkKitchen(shuffled, kitchen)).toStrictEqual(kitchenIssues);
          expectSortedAndDistinct(planIssues);
          expectSortedAndDistinct(kitchenIssues);
        },
      ),
      fcParams(),
    );
  });
});

describe('P-RG9 warnings', () => {
  it('P-RG9 warnings: the (code, stepId) pairs of the warnings equal the oracle', () => {
    fc.assert(
      fc.property(arbPlan(), (plan) => {
        const warnings = checkPlan(plan)
          .filter((i) => i.severity === 'warning')
          .map((i) => ({ code: i.code, stepId: 'stepId' in i ? i.stepId : undefined }));
        expect(warnings).toEqual(oracleWarnings(plan));
      }),
      fcParams(),
    );
  });
});
