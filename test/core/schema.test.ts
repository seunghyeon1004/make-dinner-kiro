import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  ERROR_CODES,
  WARNING_CODES,
  IssueSchema,
  ApplianceSchema,
  DISH_ID_PATTERN,
  DishIdSchema,
  DishSchema,
  KitchenSchema,
  PlanSchema,
  STEP_ID_PATTERN,
  StepIdSchema,
  StepSchema,
} from '../../src/core/schema.js';
import {
  HOME_KITCHEN,
  MEZZE,
  SUNDAY_ROAST,
  TIGHT_OVEN,
  TWO_COOK_KITCHEN,
} from '../support/fixtures.js';
import type {
  Appliance,
  Dish,
  ErrorCode,
  Issue,
  IssueCode,
  Kitchen,
  Plan,
  Step,
  WarningCode,
} from '../../src/core/schema.js';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

const step = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'chicken.roast',
  dish: 'chicken',
  title: 'Roast the chicken',
  minutes: 75,
  appliance: 'oven',
  handsOn: false,
  after: [],
  holdMin: 5,
  ...over,
});

const plan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Sunday roast',
  dishes: [{ id: 'chicken', name: 'Roast chicken' }],
  steps: [step()],
  ...over,
});

const kitchen = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  burners: 4,
  ovens: 1,
  cooks: 1,
  ...over,
});

const without = (obj: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

const ofLength = (n: number, ch = 'a') => ch.repeat(n);

describe('R1.2 minutes: an integer from 1 to 480', () => {
  it.each([1, 2, 479, 480])('accepts %s', (minutes) => {
    expect(accepts(StepSchema, step({ minutes }))).toBe(true);
  });
  it.each([0, -1, 481, 2.5, Number.NaN, Infinity, '5', null, true])('rejects %s', (minutes) => {
    expect(accepts(StepSchema, step({ minutes }))).toBe(false);
  });
  it('rejects a step with no minutes', () => {
    expect(accepts(StepSchema, without(step(), 'minutes'))).toBe(false);
  });
});

describe('R1.3 holdMin: null or an integer from 0 to 480', () => {
  it.each([null, 0, 1, 480])('accepts %s', (holdMin) => {
    expect(accepts(StepSchema, step({ holdMin }))).toBe(true);
  });
  it.each([-1, 481, 1.5, Number.NaN, '5', true])('rejects %s', (holdMin) => {
    expect(accepts(StepSchema, step({ holdMin }))).toBe(false);
  });
  it('rejects a step with no holdMin key', () => {
    expect(accepts(StepSchema, without(step(), 'holdMin'))).toBe(false);
  });
});

describe('R1.4 id patterns and lengths', () => {
  it.each(['a', 'chicken', 'roast-chicken', 'a1-b2-c3', '0', ofLength(40)])(
    'DishIdSchema accepts %s',
    (id) => {
      expect(accepts(DishIdSchema, id)).toBe(true);
    },
  );
  it.each(['', 'A', 'Chicken', '-a', 'a-', 'a--b', 'a_b', 'a b', 'a.b', 'é', ofLength(41)])(
    'DishIdSchema rejects %j',
    (id) => {
      expect(accepts(DishIdSchema, id)).toBe(false);
    },
  );
  it('DISH_ID_PATTERN is the pattern of structure.md', () => {
    expect(DISH_ID_PATTERN.test('roast-chicken')).toBe(true);
    expect(DISH_ID_PATTERN.test('a--b')).toBe(false);
    expect(DISH_ID_PATTERN.test('Roast')).toBe(false);
  });

  const longest = `${ofLength(40)}.${ofLength(39)}`; // 80 characters
  it.each(['chicken.roast', 'a.b', 'a-b.c-d', '0.0', longest])('StepIdSchema accepts %s', (id) => {
    expect(id.length).toBeLessThanOrEqual(80);
    expect(accepts(StepIdSchema, id)).toBe(true);
  });
  it.each(['', 'chicken', 'a.b.c', 'A.b', 'a.B', '.b', 'a.', 'a_b.c', 'a b.c', `${longest}a`])(
    'StepIdSchema rejects %j',
    (id) => {
      expect(accepts(StepIdSchema, id)).toBe(false);
    },
  );
  it('the 81-character step id is exactly one past the limit', () => {
    expect(`${longest}a`.length).toBe(81);
  });
  it('STEP_ID_PATTERN is the pattern of structure.md', () => {
    expect(STEP_ID_PATTERN.test('chicken.roast')).toBe(true);
    expect(STEP_ID_PATTERN.test('chicken')).toBe(false);
    expect(STEP_ID_PATTERN.test('a.b.c')).toBe(false);
  });

  it('a step rejects a dish that is not a dish id', () => {
    expect(accepts(StepSchema, step({ dish: 'Chicken' }))).toBe(false);
    expect(accepts(StepSchema, step({ dish: ofLength(41) }))).toBe(false);
    expect(accepts(StepSchema, step({ dish: ofLength(40) }))).toBe(true);
  });
  it('a step rejects an after entry that is not a step id', () => {
    expect(accepts(StepSchema, step({ after: ['chicken.prep'] }))).toBe(true);
    expect(accepts(StepSchema, step({ after: ['chicken'] }))).toBe(false);
    expect(accepts(StepSchema, step({ after: ['chicken.prep', 'Bad.id'] }))).toBe(false);
  });
  it('a step rejects an id that is not a step id', () => {
    expect(accepts(StepSchema, step({ id: 'chicken' }))).toBe(false);
  });
});

describe('R1.5 text fields: counted in Unicode code points, not blank', () => {
  it('step title accepts 120 and rejects 121 code points', () => {
    expect(accepts(StepSchema, step({ title: ofLength(120) }))).toBe(true);
    expect(accepts(StepSchema, step({ title: ofLength(121) }))).toBe(false);
  });
  it('R1.5 counts an astral character (a surrogate pair) as one code point', () => {
    expect(accepts(StepSchema, step({ title: `${ofLength(119)}😀` }))).toBe(true); // 120 code points
    expect(accepts(StepSchema, step({ title: `${ofLength(120)}😀` }))).toBe(false); // 121 code points
  });
  it.each(['', ' ', '   ', '\t\n', '\u00a0', '\u2028'])('step title rejects blank %j', (title) => {
    expect(accepts(StepSchema, step({ title }))).toBe(false);
  });
  it('accepts a title with surrounding white space but some content', () => {
    expect(accepts(StepSchema, step({ title: '  Roast  ' }))).toBe(true);
  });
  it('rejects a missing title', () => {
    expect(accepts(StepSchema, without(step(), 'title'))).toBe(false);
  });

  it('detail may be absent', () => {
    expect(Object.hasOwn(step(), 'detail')).toBe(false);
    expect(accepts(StepSchema, step())).toBe(true);
  });
  it('detail may be present, up to 1000 code points', () => {
    expect(accepts(StepSchema, step({ detail: 'Salt it first.' }))).toBe(true);
    expect(accepts(StepSchema, step({ detail: ofLength(1000) }))).toBe(true);
    expect(accepts(StepSchema, step({ detail: ofLength(1001) }))).toBe(false);
  });
  it.each(['', '  ', '\n'])('detail rejects empty or blank %j', (detail) => {
    expect(accepts(StepSchema, step({ detail }))).toBe(false);
  });

  it('dish name accepts 80 and rejects 81 code points', () => {
    expect(accepts(DishSchema, { id: 'chicken', name: ofLength(80) })).toBe(true);
    expect(accepts(DishSchema, { id: 'chicken', name: ofLength(81) })).toBe(false);
  });
  it.each(['', '   ', '\u00a0'])('dish name rejects blank %j', (name) => {
    expect(accepts(DishSchema, { id: 'chicken', name })).toBe(false);
  });
  it('dish rejects an id that is not a dish id', () => {
    expect(accepts(DishSchema, { id: 'Chicken', name: 'Chicken' })).toBe(false);
  });

  it('plan title accepts 120 and rejects 121 code points', () => {
    expect(accepts(PlanSchema, plan({ title: ofLength(120) }))).toBe(true);
    expect(accepts(PlanSchema, plan({ title: ofLength(121) }))).toBe(false);
  });
  it.each(['', '   '])('plan title rejects blank %j', (title) => {
    expect(accepts(PlanSchema, plan({ title }))).toBe(false);
  });
});

describe('R1.6 plan size and the after bound', () => {
  const dishN = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `dish-${i}`, name: `Dish ${i}` }));
  const stepN = (n: number) => Array.from({ length: n }, () => step());

  it('accepts 1 and 12 dishes, rejects 0 and 13', () => {
    expect(accepts(PlanSchema, plan({ dishes: dishN(1) }))).toBe(true);
    expect(accepts(PlanSchema, plan({ dishes: dishN(12) }))).toBe(true);
    expect(accepts(PlanSchema, plan({ dishes: dishN(0) }))).toBe(false);
    expect(accepts(PlanSchema, plan({ dishes: dishN(13) }))).toBe(false);
  });
  it('accepts 1 and 80 steps, rejects 0 and 81', () => {
    expect(accepts(PlanSchema, plan({ steps: stepN(1) }))).toBe(true);
    expect(accepts(PlanSchema, plan({ steps: stepN(80) }))).toBe(true);
    expect(accepts(PlanSchema, plan({ steps: stepN(0) }))).toBe(false);
    expect(accepts(PlanSchema, plan({ steps: stepN(81) }))).toBe(false);
  });
  it('rejects a plan whose steps or dishes are not arrays', () => {
    expect(accepts(PlanSchema, plan({ steps: 'none' }))).toBe(false);
    expect(accepts(PlanSchema, plan({ dishes: null }))).toBe(false);
  });
  it('accepts an after list of 0 and 80 entries, rejects 81', () => {
    const afterN = (n: number) => Array.from({ length: n }, (_, i) => `dish.s${i}`);
    expect(accepts(StepSchema, step({ after: afterN(0) }))).toBe(true);
    expect(accepts(StepSchema, step({ after: afterN(80) }))).toBe(true);
    expect(accepts(StepSchema, step({ after: afterN(81) }))).toBe(false);
  });
  it('a valid plan with an out-of-range step is rejected as a whole', () => {
    expect(accepts(PlanSchema, plan({ steps: [step(), step({ minutes: 0 })] }))).toBe(false);
  });
});

describe('R1.2 appliance and handsOn', () => {
  it.each(['burner', 'oven', 'none'])('ApplianceSchema accepts %s', (a) => {
    expect(accepts(ApplianceSchema, a)).toBe(true);
  });
  it.each(['Burner', 'stove', '', null, 1])('ApplianceSchema rejects %j', (a) => {
    expect(accepts(ApplianceSchema, a)).toBe(false);
  });
  it('a step rejects a non-boolean handsOn and a bad appliance', () => {
    expect(accepts(StepSchema, step({ handsOn: 'yes' }))).toBe(false);
    expect(accepts(StepSchema, step({ handsOn: 1 }))).toBe(false);
    expect(accepts(StepSchema, step({ appliance: 'stove' }))).toBe(false);
  });
});

describe('R1.7 kitchen bounds', () => {
  it.each([0, 8])('accepts burners %s', (burners) => {
    expect(accepts(KitchenSchema, kitchen({ burners }))).toBe(true);
  });
  it.each([-1, 9, 1.5, '4'])('rejects burners %s', (burners) => {
    expect(accepts(KitchenSchema, kitchen({ burners }))).toBe(false);
  });
  it.each([0, 4])('accepts ovens %s', (ovens) => {
    expect(accepts(KitchenSchema, kitchen({ ovens }))).toBe(true);
  });
  it.each([-1, 5, 0.5])('rejects ovens %s', (ovens) => {
    expect(accepts(KitchenSchema, kitchen({ ovens }))).toBe(false);
  });
  it.each([1, 6])('accepts cooks %s', (cooks) => {
    expect(accepts(KitchenSchema, kitchen({ cooks }))).toBe(true);
  });
  it.each([0, 7, 2.5, null])('rejects cooks %s', (cooks) => {
    expect(accepts(KitchenSchema, kitchen({ cooks }))).toBe(false);
  });
  it('rejects a kitchen with a missing count', () => {
    expect(accepts(KitchenSchema, without(kitchen(), 'ovens'))).toBe(false);
  });
});

describe('R1.8 unknown keys are rejected', () => {
  it('Step', () => {
    expect(accepts(StepSchema, step({ details: 'typo for detail' }))).toBe(false);
    expect(accepts(StepSchema, step({ hold_min: 5 }))).toBe(false);
  });
  it('Dish', () => {
    expect(accepts(DishSchema, { id: 'chicken', name: 'Chicken', extra: 1 })).toBe(false);
  });
  it('Plan', () => {
    expect(accepts(PlanSchema, plan({ notes: 'x' }))).toBe(false);
  });
  it('Kitchen', () => {
    expect(accepts(KitchenSchema, kitchen({ grills: 1 }))).toBe(false);
  });
});

describe('R1.1 parsing keeps a valid value as it is', () => {
  it('a valid plan parses to the same fields in the same order', () => {
    const input = plan({
      steps: [
        step({ id: 'chicken.roast', after: ['chicken.prep', 'chicken.salt'] }),
        step({ id: 'chicken.prep', minutes: 10, appliance: 'none', handsOn: true, holdMin: null }),
      ],
    });
    const parsed = PlanSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.steps.map((s) => s.id)).toEqual(['chicken.roast', 'chicken.prep']);
    expect(parsed.data?.steps[0]?.after).toEqual(['chicken.prep', 'chicken.salt']);
    expect(parsed.data?.steps[1]?.holdMin).toBeNull();
    expect(parsed.data?.title).toBe('Sunday roast');
  });
});

describe('R1.1 inferred types', () => {
  it('Step, Dish, Plan, Kitchen and Appliance have the shapes of the design', () => {
    expectTypeOf<Appliance>().toEqualTypeOf<'burner' | 'oven' | 'none'>();
    expectTypeOf<Step>().toEqualTypeOf<{
      id: string;
      dish: string;
      title: string;
      detail?: string | undefined;
      minutes: number;
      appliance: 'burner' | 'oven' | 'none';
      handsOn: boolean;
      after: string[];
      holdMin: number | null;
    }>();
    expectTypeOf<Dish>().toEqualTypeOf<{ id: string; name: string }>();
    expectTypeOf<Kitchen>().toEqualTypeOf<{ burners: number; ovens: number; cooks: number }>();
    expectTypeOf<Plan>().toEqualTypeOf<{ title: string; dishes: Dish[]; steps: Step[] }>();
  });
  it('the schemas output those types', () => {
    expectTypeOf<z.infer<typeof StepSchema>>().toEqualTypeOf<Step>();
    expectTypeOf<z.infer<typeof PlanSchema>>().toEqualTypeOf<Plan>();
    expectTypeOf<z.infer<typeof KitchenSchema>>().toEqualTypeOf<Kitchen>();
    expectTypeOf<z.infer<typeof DishSchema>>().toEqualTypeOf<Dish>();
  });
});

// R1.9, R7.1: one valid issue per code of the design table, in table order.
const ISSUES: readonly {
  code: string;
  severity: 'error' | 'warning';
  issue: Record<string, unknown>;
}[] = [
  {
    code: 'invalid_field',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'invalid_field',
      message: 'Step chicken.roast: the appliance must be burner, oven or none.',
      field: 'steps[0].appliance',
      stepId: 'chicken.roast',
    },
  },
  {
    code: 'minutes_out_of_range',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'minutes_out_of_range',
      message: 'Step chicken.roast: minutes must be a whole number from 1 to 480.',
      field: 'steps[0].minutes',
      stepId: 'chicken.roast',
    },
  },
  {
    code: 'empty_plan',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'empty_plan',
      message: 'The plan has no dishes or no steps. Add at least one dish with one step.',
    },
  },
  {
    code: 'too_many_dishes',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'too_many_dishes',
      message: 'The plan has 14 dishes and the limit is 12. Remove or merge 2 dishes.',
      count: 14,
      limit: 12,
    },
  },
  {
    code: 'too_many_steps',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'too_many_steps',
      message: 'The plan has 95 steps and the limit is 80. Remove or merge 15 steps.',
      count: 95,
      limit: 80,
    },
  },
  {
    code: 'unknown_dependency',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'unknown_dependency',
      message: 'Step gravy.roux waits for chicken.rost, which is not a step in this plan.',
      stepId: 'gravy.roux',
      ref: 'chicken.rost',
    },
  },
  {
    code: 'self_dependency',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'self_dependency',
      message: 'Step gravy.roux lists itself as a prerequisite. Remove it.',
      stepId: 'gravy.roux',
    },
  },
  {
    code: 'cycle',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'cycle',
      message: 'Steps chicken.rest and chicken.carve wait on each other.',
      stepId: 'chicken.carve',
      path: ['chicken.carve', 'chicken.rest'],
    },
  },
  {
    code: 'duplicate_step_id',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'duplicate_step_id',
      message: '2 steps have the id gravy.simmer. Give each step its own id.',
      stepId: 'gravy.simmer',
      count: 2,
    },
  },
  {
    code: 'duplicate_dish_id',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'duplicate_dish_id',
      message: '2 dishes have the id gravy. Give each dish its own id.',
      dishId: 'gravy',
      count: 2,
    },
  },
  {
    code: 'unknown_dish',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'unknown_dish',
      message: 'Step gravy.roux belongs to dish sauce, which is not in this plan.',
      stepId: 'gravy.roux',
      dishId: 'sauce',
    },
  },
  {
    code: 'dish_without_steps',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'dish_without_steps',
      message: 'Dish greens has no steps. Add a step or remove the dish.',
      dishId: 'greens',
    },
  },
  {
    code: 'missing_appliance',
    severity: 'error',
    issue: {
      severity: 'error',
      code: 'missing_appliance',
      message: 'Step chicken.roast needs an oven and the kitchen has none.',
      stepId: 'chicken.roast',
      appliance: 'oven',
    },
  },
  {
    code: 'appliance_mismatch',
    severity: 'warning',
    issue: {
      severity: 'warning',
      code: 'appliance_mismatch',
      message: 'Step chicken.rest mentions "roast" but uses no appliance.',
      stepId: 'chicken.rest',
      word: 'roast',
      suggested: 'oven',
    },
  },
  {
    code: 'long_hands_on',
    severity: 'warning',
    issue: {
      severity: 'warning',
      code: 'long_hands_on',
      message: 'Step risotto.stir keeps a cook busy for 50 minutes.',
      stepId: 'risotto.stir',
      minutes: 50,
    },
  },
  {
    code: 'short_hands_free',
    severity: 'warning',
    issue: {
      severity: 'warning',
      code: 'short_hands_free',
      message: 'Step pasta.drain runs by itself for only 1 minute.',
      stepId: 'pasta.drain',
      minutes: 1,
    },
  },
];

describe('R1.9, R7.1 IssueSchema', () => {
  it('has the design table codes: 13 errors then 3 warnings, in table order', () => {
    expect(ERROR_CODES).toEqual([
      'invalid_field',
      'minutes_out_of_range',
      'empty_plan',
      'too_many_dishes',
      'too_many_steps',
      'unknown_dependency',
      'self_dependency',
      'cycle',
      'duplicate_step_id',
      'duplicate_dish_id',
      'unknown_dish',
      'dish_without_steps',
      'missing_appliance',
    ]);
    expect(WARNING_CODES).toEqual(['appliance_mismatch', 'long_hands_on', 'short_hands_free']);
  });

  it('the test table covers exactly the codes of ERROR_CODES then WARNING_CODES', () => {
    expect(ISSUES.map((i) => i.code)).toEqual([...ERROR_CODES, ...WARNING_CODES]);
  });

  describe.each(ISSUES)('$code', ({ severity, issue }) => {
    const other = severity === 'error' ? 'warning' : 'error';
    it('accepts a valid issue', () => {
      expect(accepts(IssueSchema, issue)).toBe(true);
    });
    it(`rejects it with severity ${other}`, () => {
      expect(accepts(IssueSchema, { ...issue, severity: other })).toBe(false);
    });
    it('rejects an empty message', () => {
      expect(accepts(IssueSchema, { ...issue, message: '' })).toBe(false);
    });
    it('rejects an unknown key', () => {
      expect(accepts(IssueSchema, { ...issue, extra: 1 })).toBe(false);
    });
    it('rejects the loss of any required extra field', () => {
      const required = Object.keys(issue).filter(
        (k) => !['severity', 'code', 'message'].includes(k),
      );
      // invalid_field and minutes_out_of_range have `stepId` optional, `field` required.
      const optional = ['invalid_field', 'minutes_out_of_range'].includes(String(issue.code))
        ? ['stepId']
        : [];
      for (const key of required.filter((k) => !optional.includes(k))) {
        expect(accepts(IssueSchema, without(issue, key))).toBe(false);
      }
    });
  });

  it('accepts invalid_field with stepId, with dishId, and with neither', () => {
    const base = {
      severity: 'error',
      code: 'invalid_field',
      message: 'Dish 2: the name is not valid.',
      field: 'dishes[1].name',
    };
    expect(accepts(IssueSchema, base)).toBe(true);
    expect(accepts(IssueSchema, { ...base, dishId: 'greens' })).toBe(true);
    expect(accepts(IssueSchema, { ...base, stepId: 'a.b' })).toBe(true);
  });
  it('rejects an id that does not match its pattern', () => {
    expect(accepts(IssueSchema, { ...ISSUES[6]?.issue, stepId: 'Gravy Roux' })).toBe(false);
  });
  it('rejects an unknown code', () => {
    expect(accepts(IssueSchema, { severity: 'error', code: 'hold_exceeded', message: 'x' })).toBe(
      false,
    );
  });
  it('rejects the wrong limit and a cycle path of one step', () => {
    expect(accepts(IssueSchema, { ...ISSUES[3]?.issue, limit: 13 })).toBe(false);
    expect(accepts(IssueSchema, { ...ISSUES[4]?.issue, limit: 12 })).toBe(false);
    expect(accepts(IssueSchema, { ...ISSUES[7]?.issue, path: ['chicken.carve'] })).toBe(false);
  });
  it('rejects a missing_appliance for the appliance none', () => {
    expect(accepts(IssueSchema, { ...ISSUES[12]?.issue, appliance: 'none' })).toBe(false);
  });
  it('rejects a duplicate count below 2', () => {
    expect(accepts(IssueSchema, { ...ISSUES[8]?.issue, count: 1 })).toBe(false);
  });
});

describe('R1.9 types: narrowing on code fixes severity and extra fields', () => {
  it('code unions', () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<
      | 'invalid_field'
      | 'minutes_out_of_range'
      | 'empty_plan'
      | 'too_many_dishes'
      | 'too_many_steps'
      | 'unknown_dependency'
      | 'self_dependency'
      | 'cycle'
      | 'duplicate_step_id'
      | 'duplicate_dish_id'
      | 'unknown_dish'
      | 'dish_without_steps'
      | 'missing_appliance'
    >();
    expectTypeOf<WarningCode>().toEqualTypeOf<
      'appliance_mismatch' | 'long_hands_on' | 'short_hands_free'
    >();
    expectTypeOf<IssueCode>().toEqualTypeOf<ErrorCode | WarningCode>();
  });
  it('severity follows code', () => {
    expectTypeOf<Extract<Issue, { code: 'cycle' }>['severity']>().toEqualTypeOf<'error'>();
    expectTypeOf<
      Extract<Issue, { code: 'long_hands_on' }>['severity']
    >().toEqualTypeOf<'warning'>();
    expectTypeOf<Extract<Issue, { code: 'cycle' }>['path']>().toEqualTypeOf<string[]>();
    expectTypeOf<Extract<Issue, { code: 'missing_appliance' }>['appliance']>().toEqualTypeOf<
      'burner' | 'oven'
    >();
    expectTypeOf<Extract<Issue, { code: 'too_many_steps' }>['limit']>().toEqualTypeOf<80>();
  });
  it('the schema outputs Issue', () => {
    expectTypeOf<z.infer<typeof IssueSchema>>().toEqualTypeOf<Issue>();
  });
});

describe('R10.4 fixtures pass the schemas and have the sizes of the design', () => {
  it.each([
    ['SUNDAY_ROAST', SUNDAY_ROAST, 'Sunday roast', ['chicken', 'gravy', 'greens'], 10],
    ['MEZZE', MEZZE, 'Mezze', ['flatbread', 'hummus', 'salad'], 7],
    ['TIGHT_OVEN', TIGHT_OVEN, 'Pie and potatoes', ['pie', 'potatoes'], 4],
  ] as const)('%s', (_name, fixture, title, dishIds, stepCount) => {
    expect(PlanSchema.safeParse(fixture).success).toBe(true);
    expect(fixture.title).toBe(title);
    expect(fixture.dishes.map((d) => d.id)).toEqual(dishIds);
    expect(fixture.steps).toHaveLength(stepCount);
    expect(new Set(fixture.steps.map((s) => s.id)).size).toBe(stepCount);
  });

  it('SUNDAY_ROAST has the gravy waiting on the chicken leaving the oven', () => {
    const roux = SUNDAY_ROAST.steps.find((s) => s.id === 'gravy.roux');
    expect(roux?.after).toEqual(['chicken.roast']);
    expect(roux?.appliance).toBe('burner');
  });

  it('the fixture steps are not written in topological order', () => {
    for (const fixture of [SUNDAY_ROAST, MEZZE, TIGHT_OVEN]) {
      const position = new Map(fixture.steps.map((s, i) => [s.id, i]));
      const backwards = fixture.steps.some((s) =>
        s.after.some((p) => (position.get(p) ?? -1) > (position.get(s.id) ?? -1)),
      );
      expect(backwards).toBe(true);
    }
  });

  it('every after entry names a step of the same fixture', () => {
    for (const fixture of [SUNDAY_ROAST, MEZZE, TIGHT_OVEN]) {
      const ids = new Set(fixture.steps.map((s) => s.id));
      for (const s of fixture.steps) {
        for (const p of s.after) expect(ids.has(p)).toBe(true);
      }
    }
  });

  it('kitchens', () => {
    expect(KitchenSchema.safeParse(HOME_KITCHEN).success).toBe(true);
    expect(KitchenSchema.safeParse(TWO_COOK_KITCHEN).success).toBe(true);
    expect(HOME_KITCHEN).toEqual({ burners: 4, ovens: 1, cooks: 1 });
    expect(TWO_COOK_KITCHEN).toEqual({ burners: 4, ovens: 1, cooks: 2 });
  });
});
