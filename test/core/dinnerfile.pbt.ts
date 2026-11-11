import fc from 'fast-check';
import { expect, it } from 'vitest';
import { fromDinnerfile, toDinnerfile } from '../../src/core/dinnerfile.js';
import type { DinnerfileError, DinnerfileOptions } from '../../src/core/dinnerfile.js';
import { ok } from '../../src/core/result.js';
import { checkPlan, validatePlan } from '../../src/core/sanity.js';
import {
  canonicalPlan,
  KitchenSchema,
  PlanSchema,
  ServeTimeSchema,
} from '../../src/core/schema.js';
import type { Plan } from '../../src/core/schema.js';
import {
  arbAnyDinnerfileOptions,
  arbBreakingEdit,
  arbBrokenPlan,
  arbDinnerfileLikeText,
  arbDinnerfileOptions,
  arbDinnerfileStyle,
  arbPlan,
  arbShuffledPlan,
} from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import {
  decodeEchoLine,
  oracleDinnerfile,
  oracleEchoText,
  oracleMakeLines,
} from '../support/oracles.js';

// Dinnerfile properties that need no make (dinnerfile design, "Correctness properties"). Titles
// start with the id and a space. Plans are default-sized and large (12 dishes, 80 steps), with
// hostile titles and details, a dish called dinner and directive-word dish ids from the
// extended generators.

const TIMEOUT_MS = 60_000;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Runs `check` on valid plans of both sizes with options that pass their schemas. */
const forPlans = (check: (plan: Plan, options: DinnerfileOptions) => void): void => {
  for (const large of [false, true]) {
    fc.assert(
      fc.property(arbPlan(large ? { large: true } : {}), arbDinnerfileOptions(), check),
      fcParams(),
    );
  }
};

/** The export of a plan the generators made valid; a failed export fails the property. */
const exportOf = (plan: Plan, options?: DinnerfileOptions): string => {
  const result = toDinnerfile(plan, options);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : '';
};

it(
  'P-DF2 Make lines: every line is a form Make reads as intended, the text ends in one LF, dinner is the first goal',
  () => {
    forPlans((plan, options) => {
      const text = exportOf(plan, options);
      const lines = text.split('\n');
      expect(oracleMakeLines(text).filter((kind) => kind === 'other')).toEqual([]);
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
      expect(text.includes('\r')).toBe(false);
      expect(lines.filter((l) => l.endsWith('\\') || /[ \t]$/.test(l))).toEqual([]);
      expect(LONE_SURROGATE.test(text)).toBe(false);
      const firstGoal = lines.find((l) => /^[^#\t]/.test(l) && !l.startsWith('.PHONY:'));
      expect(firstGoal?.startsWith('dinner:')).toBe(true);
      const recipes = lines.filter((l) => l.startsWith('\t'));
      expect(recipes.filter((l) => l.includes('$(') || l.includes('${'))).toEqual([]);
      expect(recipes.length).toBe(plan.steps.length);
    });
  },
  TIMEOUT_MS,
);

it(
  'P-DF6 echo: the recipe line of each step decodes to its id and the display form of its title',
  () => {
    forPlans((plan, options) => {
      const lines = exportOf(plan, options).split('\n');
      for (const step of plan.steps) {
        const rule = lines.findIndex((l) => l.startsWith(`${step.id}:`));
        expect(rule).toBeGreaterThan(-1);
        expect(decodeEchoLine(lines[rule + 1] ?? '', 'file')).toEqual({
          text: oracleEchoText(step.title),
          stepId: step.id,
        });
      }
    });
  },
  TIMEOUT_MS,
);

it(
  'P-DF9 order-free: any order of steps, dishes and after lists gives the same text',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbPlan(large ? { large: true } : {}).chain((plan) =>
            fc.tuple(fc.constant(plan), arbShuffledPlan(plan)),
          ),
          ([plan, shuffled]) => {
            expect(exportOf(shuffled)).toBe(exportOf(plan));
          },
        ),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-DF10 layout: the export equals the oracle layout, line for line',
  () => {
    forPlans((plan, options) => {
      expect(exportOf(plan, options)).toBe(oracleDinnerfile(plan, options));
    });
  },
  TIMEOUT_MS,
);

// ---------------------------------------------------------------------------------------
// Import: D1, P-DF1, P-DF3, P-DF4, P-DF5, P-DF8 (T3.3).

/** Both sizes of plan, for properties that take a plan and then something drawn from it. */
const forPlansThen = <T>(
  then: (plan: Plan) => fc.Arbitrary<T>,
  check: (plan: Plan, drawn: T) => void,
): void => {
  for (const large of [false, true]) {
    fc.assert(
      fc.property(
        arbPlan(large ? { large: true } : {}).chain((plan) =>
          then(plan).map((drawn) => ({ plan, drawn })),
        ),
        ({ plan, drawn }) => {
          check(plan, drawn);
        },
      ),
      fcParams(),
    );
  }
};

it(
  'D1 round trip: fromDinnerfile(toDinnerfile(p)) is p in canonical order, and validatePlan finds no error in it',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(arbPlan(large ? { large: true } : {}), (plan) => {
          expect(fromDinnerfile(exportOf(plan))).toStrictEqual(
            ok({ plan: canonicalPlan(plan), options: {} }),
          );
          const back = fromDinnerfile(exportOf(plan));
          const checked = validatePlan(back.ok ? back.value.plan : null);
          expect(checked.issues.filter((i) => i.severity === 'error')).toEqual([]);
        }),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

/** `a` before `b` in the order of R7.12: line (null first), code, step id, key. */
const compareErrors = (a: DinnerfileError, b: DinnerfileError): number => {
  const part = (e: DinnerfileError): [number, string, string, string] => [
    e.line === null ? -1 : e.line,
    e.code,
    'stepId' in e && e.stepId !== undefined ? e.stepId : '',
    'key' in e ? e.key : '',
  ];
  const [la, ca, sa, ka] = part(a);
  const [lb, cb, sb, kb] = part(b);
  if (la !== lb) return la - lb;
  for (const [x, y] of [
    [ca, cb],
    [sa, sb],
    [ka, kb],
  ] as const) {
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
};

it(
  'P-DF1 total: fromDinnerfile never throws, gives a plan or at least one well-formed error, sorted and without repeats',
  () => {
    const check = (text: string): void => {
      const result = fromDinnerfile(text);
      if (result.ok) {
        expect(result.value.plan).toStrictEqual(canonicalPlan(result.value.plan));
        return;
      }
      const errors = result.error;
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const lineCount = text.replace(/^\ufeff/, '').split('\n').length;
      // At most 50 errors, then one entry that says how many were left out.
      const summary = errors.filter((e) => e.code === 'too_many_errors');
      if (summary.length > 0) {
        expect(errors.length).toBe(51);
        expect(summary.length).toBe(1);
        expect(errors[50]?.code).toBe('too_many_errors');
      } else {
        expect(errors.length).toBeLessThanOrEqual(50);
      }
      const listed = errors.filter((e) => e.code !== 'too_many_errors');
      for (const e of errors) {
        if (e.code === 'missing_plan') expect(e.line).toBeNull();
        else {
          expect(e.line).not.toBeNull();
          expect(e.line ?? 0).toBeGreaterThanOrEqual(1);
          expect(e.line ?? 0).toBeLessThanOrEqual(lineCount);
        }
        expect(e.message).toMatch(/^[\x20-\x7e]+$/);
      }
      for (let i = 1; i < listed.length; i++) {
        const before = listed[i - 1];
        const after = listed[i];
        if (before === undefined || after === undefined) continue;
        expect(compareErrors(before, after)).toBeLessThan(0);
      }
      const keys = listed.map((e) => JSON.stringify(e));
      expect(new Set(keys).size).toBe(keys.length);
    };
    fc.assert(fc.property(arbDinnerfileLikeText(), check), fcParams());
    fc.assert(fc.property(fc.string({ unit: 'binary' }), check), fcParams());
  },
  TIMEOUT_MS,
);

/** A copy made of plain objects (fc.record builds objects without a prototype). */
const plainCopy = (value: DinnerfileOptions): DinnerfileOptions =>
  JSON.parse(JSON.stringify(value)) as DinnerfileOptions;

it(
  'P-DF3 options: kitchen and serving time round-trip, are comment-only, and bad ones are refused by the export',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(arbPlan(large ? { large: true } : {}), arbDinnerfileOptions(), (plan, o) => {
          expect(fromDinnerfile(exportOf(plan, o))).toStrictEqual(
            // fc.record makes objects without a prototype; the import returns plain objects.
            ok({ plan: canonicalPlan(plan), options: plainCopy(o) }),
          );
          const stripped = exportOf(plan, o)
            .split('\n')
            .filter((l) => !l.startsWith('# kitchen ') && !l.startsWith('# serve '))
            .join('\n');
          expect(stripped).toBe(exportOf(plan));
        }),
        fcParams(),
      );
    }
    fc.assert(
      fc.property(arbPlan(), arbAnyDinnerfileOptions(), (plan, o) => {
        const result = toDinnerfile(plan, o);
        const bad =
          (o.kitchen !== undefined && !KitchenSchema.safeParse(o.kitchen).success) ||
          (o.serve !== undefined && !ServeTimeSchema.safeParse(o.serve).success);
        expect(result.ok).toBe(!bad);
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

it(
  'P-DF4 tolerant: any form of the same file that the import accepts gives the same result',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbPlan(large ? { large: true } : {}).chain((plan) =>
            fc.tuple(fc.constant(plan), arbDinnerfileOptions(), arbDinnerfileStyle(plan)),
          ),
          ([plan, options, style]) => {
            const plain = fromDinnerfile(exportOf(plan, options));
            expect(plain.ok).toBe(true);
            expect(fromDinnerfile(oracleDinnerfile(plan, options, style))).toStrictEqual(plain);
          },
        ),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-DF5 breaking: one meaning-changing edit gives exactly one error, of the expected code, at the expected line',
  () => {
    forPlansThen(arbBreakingEdit, (_plan, edit) => {
      const result = fromDinnerfile(edit.text);
      expect(result.ok).toBe(false);
      const errors = result.ok ? [] : result.error;
      expect(errors.map((e) => [e.code, e.line])).toEqual([[edit.code, edit.line]]);
    });
  },
  TIMEOUT_MS,
);

const GRAPH_RULES = [
  'unknown_dependency',
  'self_dependency',
  'cycle',
  'unknown_dish',
  'dish_without_steps',
  'duplicate_dish_id',
] as const;

it(
  'P-DF8 faults survive: plans with graph faults round-trip and validatePlan finds the same issues; a duplicate step id is a duplicate_target',
  () => {
    for (const rule of GRAPH_RULES) {
      fc.assert(
        fc.property(arbBrokenPlan(rule), (broken) => {
          const plan = PlanSchema.parse(broken.input);
          const back = fromDinnerfile(exportOf(plan));
          expect(back).toStrictEqual(ok({ plan: canonicalPlan(plan), options: {} }));
          const imported = back.ok ? back.value.plan : plan;
          expect(validatePlan(imported).issues).toEqual(checkPlan(plan));
        }),
        fcParams(),
      );
    }
    fc.assert(
      fc.property(arbBrokenPlan('duplicate_step_id'), (broken) => {
        const plan = PlanSchema.parse(broken.input);
        const back = fromDinnerfile(exportOf(plan));
        expect(back.ok).toBe(false);
        const codes = back.ok ? [] : back.error.map((e) => e.code);
        expect(codes.length).toBeGreaterThan(0);
        expect(codes.filter((c) => c !== 'duplicate_target')).toEqual([]);
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);
