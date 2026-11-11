import { describe, expect, it } from 'vitest';
import {
  checkKitchen,
  checkPlan,
  hasErrors,
  parseKitchen,
  parsePlan,
  sortIssues,
  validatePlan,
} from '../../src/core/sanity.js';
import type { Dish, Issue, Plan, Step } from '../../src/core/schema.js';
import { HOME_KITCHEN, MEZZE, SUNDAY_ROAST, TIGHT_OVEN } from '../support/fixtures.js';

const STEP = {
  id: 'a.x',
  dish: 'a',
  title: 'Chop',
  minutes: 5,
  appliance: 'none',
  handsOn: true,
  after: [],
  holdMin: null,
};

/** A small valid plan as plain JSON, with overrides on the plan and on its one step. */
function raw(plan: Record<string, unknown> = {}, step: Record<string, unknown> = {}): unknown {
  return {
    title: 'Plan',
    dishes: [{ id: 'a', name: 'A' }],
    steps: [{ ...STEP, ...step }],
    ...plan,
  };
}

function issuesOf(input: unknown): Issue[] {
  const result = parsePlan(input);
  if (result.ok) throw new Error('expected parsePlan to fail');
  return result.error;
}

const NOT_AN_OBJECT: Issue = {
  severity: 'error',
  code: 'invalid_field',
  field: 'plan',
  message: 'The plan: this value must be an object with a title, dishes and steps.',
};

describe('parsePlan: values that are not plans (R2.1)', () => {
  it.each([[null], [42], [''], [[]]])(
    'R2.1 %j gives one invalid_field issue for the plan',
    (input) => {
      expect(issuesOf(input)).toEqual([NOT_AN_OBJECT]);
    },
  );

  it('R2.1 R2.6 {} gives one invalid_field issue per missing field, in field order', () => {
    expect(issuesOf({})).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'dishes',
        message: 'The plan: dishes must be a list of 1 to 12 dishes.',
      },
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'steps',
        message: 'The plan: steps must be a list of 1 to 80 steps.',
      },
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'title',
        message: 'The plan: the title must be 1 to 120 characters and not blank.',
      },
    ]);
  });
});

describe('parsePlan: valid input (R2.2)', () => {
  it.each([
    ['SUNDAY_ROAST', SUNDAY_ROAST],
    ['MEZZE', MEZZE],
    ['TIGHT_OVEN', TIGHT_OVEN],
  ])('R2.2 %s parses to a deep-equal plan with the same order', (_name, fixture) => {
    const result = parsePlan(JSON.parse(JSON.stringify(fixture)));
    expect(result).toEqual({ ok: true, value: fixture });
    expect(result.ok && result.value.steps.map((s) => s.id)).toEqual(
      fixture.steps.map((s) => s.id),
    );
  });
});

describe('parsePlan: empty_plan and plan size (R2.3, R2.4)', () => {
  it('R2.3 empty dishes gives one empty_plan issue', () => {
    expect(issuesOf(raw({ dishes: [] }))).toEqual([
      {
        severity: 'error',
        code: 'empty_plan',
        message: 'The plan has no dishes or no steps. Add at least one dish with one step.',
      },
    ]);
  });

  it('R2.3 empty steps gives one empty_plan issue', () => {
    expect(issuesOf(raw({ steps: [] })).map((i) => i.code)).toEqual(['empty_plan']);
  });

  it('R2.3 both arrays empty give empty_plan once, not twice', () => {
    expect(issuesOf(raw({ dishes: [], steps: [] })).map((i) => i.code)).toEqual(['empty_plan']);
  });

  it('R2.4 14 dishes give too_many_dishes with count and limit; 12 dishes do not', () => {
    const dishes = (n: number) => Array.from({ length: n }, () => ({ id: 'a', name: 'A' }));
    expect(issuesOf(raw({ dishes: dishes(14) }))).toEqual([
      {
        severity: 'error',
        code: 'too_many_dishes',
        count: 14,
        limit: 12,
        message: 'The plan has 14 dishes and the limit is 12. Remove or merge 2 dishes.',
      },
    ]);
    expect(parsePlan(raw({ dishes: dishes(12) })).ok).toBe(true);
  });

  it('R2.4 81 steps give too_many_steps with count and limit; 80 steps do not', () => {
    const steps = (n: number) => Array.from({ length: n }, () => STEP);
    expect(issuesOf(raw({ steps: steps(81) }))).toEqual([
      {
        severity: 'error',
        code: 'too_many_steps',
        count: 81,
        limit: 80,
        message: 'The plan has 81 steps and the limit is 80. Remove or merge 1 step.',
      },
    ]);
    expect(parsePlan(raw({ steps: steps(80) })).ok).toBe(true);
  });
});

describe('parsePlan: minutes_out_of_range (R2.5)', () => {
  it('R2.5 minutes 481 gives minutes_out_of_range with the step id', () => {
    expect(issuesOf(raw({}, { minutes: 481 }))).toEqual([
      {
        severity: 'error',
        code: 'minutes_out_of_range',
        field: 'steps[0].minutes',
        stepId: 'a.x',
        message: 'Step a.x: minutes must be a whole number from 1 to 480.',
      },
    ]);
  });

  it.each([0, 2.5, '5', null])('R2.5 minutes %j fires', (minutes) => {
    expect(issuesOf(raw({}, { minutes })).map((i) => i.code)).toEqual(['minutes_out_of_range']);
  });

  it('R2.5 a missing minutes fires', () => {
    const withoutMinutes = Object.fromEntries(
      Object.entries(STEP).filter(([key]) => key !== 'minutes'),
    );
    expect(issuesOf(raw({ steps: [withoutMinutes] })).map((i) => i.code)).toEqual([
      'minutes_out_of_range',
    ]);
  });

  it.each([1, 480])('R2.5 minutes %i does not fire', (minutes) => {
    expect(parsePlan(raw({}, { minutes })).ok).toBe(true);
  });

  it('R2.5 R2.7 a step with an invalid id gets no stepId and is named by position', () => {
    const steps = [STEP, { ...STEP, id: 'Bad Id', minutes: 0 }];
    expect(issuesOf(raw({ steps }))).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'steps[1].id',
        message:
          'Step 2: the id must look like chicken.roast: lowercase letters, digits and hyphens around one dot, up to 80 characters.',
      },
      {
        severity: 'error',
        code: 'minutes_out_of_range',
        field: 'steps[1].minutes',
        message: 'Step 2: minutes must be a whole number from 1 to 480.',
      },
    ]);
  });
});

describe('parsePlan: invalid_field (R2.6, R2.7)', () => {
  it('R2.6 R2.7 a bad appliance names the field by its 0-based path and carries the stepId', () => {
    expect(issuesOf(raw({}, { appliance: 'stove' }))).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'steps[0].appliance',
        stepId: 'a.x',
        message: 'Step a.x: the appliance must be burner, oven or none.',
      },
    ]);
  });

  it('R2.6 R2.7 the fourth step is named "Step 4" and its field is steps[3]', () => {
    const steps = [STEP, STEP, STEP, { ...STEP, id: 'nope', appliance: 'stove' }];
    const issues = issuesOf(raw({ steps }));
    expect(issues.map((i) => [i.code, 'field' in i ? i.field : null, 'stepId' in i])).toEqual([
      ['invalid_field', 'steps[3].appliance', false],
      ['invalid_field', 'steps[3].id', false],
    ]);
    expect(issues.map((i) => i.message.slice(0, 7))).toEqual(['Step 4:', 'Step 4:']);
  });

  it('R2.6 a bad prerequisite is named with its index in after', () => {
    expect(issuesOf(raw({}, { after: ['a.y', 'bad'] }))).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'steps[0].after[1]',
        stepId: 'a.x',
        message: 'Step a.x: each prerequisite must be a step id such as chicken.roast.',
      },
    ]);
  });

  it('R2.7 a dish with a valid id carries the dishId; one with an invalid id is named by position', () => {
    const dishes = [
      { id: 'a', name: '   ' },
      { id: 'Bad', name: 'B' },
    ];
    expect(issuesOf(raw({ dishes }))).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'dishes[1].id',
        message:
          'Dish 2: the id must be lowercase letters, digits and hyphens, up to 40 characters.',
      },
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'dishes[0].name',
        dishId: 'a',
        message: 'Dish a: the name must be 1 to 80 characters and not blank.',
      },
    ]);
  });

  it('R2.6 an unknown key is reported on its object without naming the key', () => {
    const issues = issuesOf(raw({}, { hiddenKey: 1 }));
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'steps[0]',
        stepId: 'a.x',
        message: 'Step a.x: this entry has fields this app does not use; remove them.',
      },
    ]);
    expect(issues[0]?.message).not.toContain('hiddenKey');
  });

  it('R2.6 an unknown key on the plan itself is reported for the plan', () => {
    expect(issuesOf(raw({ hiddenKey: 1 }))).toEqual([
      {
        severity: 'error',
        code: 'invalid_field',
        field: 'plan',
        message: 'The plan: this entry has fields this app does not use; remove them.',
      },
    ]);
  });

  it('R7.2 messages contain no title, name or detail text from the input', () => {
    const input = raw(
      {
        title: 'SECRET-TITLE',
        dishes: [
          { id: 'a', name: 'SECRET-NAME' },
          { id: 'Bad', name: 'SECRET-NAME' },
        ],
      },
      {
        title: 'SECRET-STEP',
        detail: 'SECRET-DETAIL',
        appliance: 'SECRET-APPLIANCE',
        extra: 'SECRET-KEY',
      },
    );
    const issues = issuesOf(input);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    for (const issue of issues) expect(issue.message).not.toContain('SECRET');
  });
});

describe('parseKitchen (R2.8)', () => {
  it('R2.8 HOME_KITCHEN parses to itself', () => {
    expect(parseKitchen({ ...HOME_KITCHEN })).toEqual({ ok: true, value: HOME_KITCHEN });
  });

  it('R2.8 the bounds hold at their edges: 0 and 8 burners, 1 and 6 cooks are fine', () => {
    expect(parseKitchen({ burners: 0, ovens: 4, cooks: 1 }).ok).toBe(true);
    expect(parseKitchen({ burners: 8, ovens: 0, cooks: 6 }).ok).toBe(true);
  });

  it('R2.8 cooks 0 gives one invalid_field issue', () => {
    expect(parseKitchen({ burners: 4, ovens: 1, cooks: 0 })).toEqual({
      ok: false,
      error: [
        {
          severity: 'error',
          code: 'invalid_field',
          field: 'cooks',
          message: 'The kitchen: cooks must be a whole number from 1 to 6.',
        },
      ],
    });
  });

  it('R2.8 {} gives one issue per field, and null gives one for the kitchen', () => {
    const empty = parseKitchen({});
    expect(
      empty.ok ? [] : empty.error.map((i) => (i.code === 'invalid_field' ? i.field : '')),
    ).toEqual(['burners', 'cooks', 'ovens']);
    expect(parseKitchen(null)).toEqual({
      ok: false,
      error: [
        {
          severity: 'error',
          code: 'invalid_field',
          field: 'kitchen',
          message: 'The kitchen: this value must be an object with burners, ovens and cooks.',
        },
      ],
    });
  });

  it('R2.8 an unknown key is reported for the kitchen without naming it', () => {
    expect(parseKitchen({ ...HOME_KITCHEN, hiddenKey: 1 })).toEqual({
      ok: false,
      error: [
        {
          severity: 'error',
          code: 'invalid_field',
          field: 'kitchen',
          message: 'The kitchen: this entry has fields this app does not use; remove them.',
        },
      ],
    });
  });
});

describe('sortIssues and hasErrors (R7.3, R5.4)', () => {
  const warning: Issue = {
    severity: 'warning',
    code: 'long_hands_on',
    stepId: 'a.x',
    minutes: 50,
    message: 'Step a.x keeps a cook busy for 50 minutes.',
  };
  const selfDependency = (stepId: string): Issue => ({
    severity: 'error',
    code: 'self_dependency',
    stepId,
    message: `Step ${stepId} lists itself as a prerequisite. Remove it.`,
  });
  const dishGap: Issue = {
    severity: 'error',
    code: 'dish_without_steps',
    dishId: 'greens',
    message: 'Dish greens has no steps. Add a step or remove the dish.',
  };

  it('R7.3 puts errors first, then orders by code and stepId, and drops exact duplicates', () => {
    const sorted = sortIssues([
      warning,
      selfDependency('b.y'),
      dishGap,
      selfDependency('a.z'),
      selfDependency('b.y'),
    ]);
    expect(sorted).toEqual([dishGap, selfDependency('a.z'), selfDependency('b.y'), warning]);
  });

  it('R5.4 hasErrors counts errors only', () => {
    expect(hasErrors([warning])).toBe(false);
    expect(hasErrors([warning, dishGap])).toBe(true);
    expect(hasErrors([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// checkPlan, checkKitchen, validatePlan (T6.1 to T6.3)

/** A step with neutral fields (no warning fires on it), overridden as given. */
function step(id: string, fields: Partial<Step> = {}): Step {
  return {
    id,
    dish: id.slice(0, id.indexOf('.')),
    title: 'Chop',
    minutes: 5,
    appliance: 'none',
    handsOn: true,
    after: [],
    holdMin: null,
    ...fields,
  };
}

function plan(steps: Step[], dishes: Dish[] = [{ id: 'a', name: 'A' }]): Plan {
  return { title: 'Plan', dishes, steps };
}

describe('checkPlan errors (R4)', () => {
  it('R4.1 unknown_dependency fires once per step and missing id', () => {
    const p = plan([step('a.x'), step('a.y', { after: ['a.x', 'a.nope', 'a.nope'] })]);
    expect(checkPlan(p)).toEqual([
      {
        severity: 'error',
        code: 'unknown_dependency',
        stepId: 'a.y',
        ref: 'a.nope',
        message:
          'Step a.y waits for a.nope, which is not a step in this plan. Fix the prerequisite or remove it.',
      },
    ]);
  });
  it('R4.1 unknown_dependency does not fire when every prerequisite is a step', () => {
    expect(checkPlan(plan([step('a.x'), step('a.y', { after: ['a.x'] })]))).toEqual([]);
  });

  it('R4.2 self_dependency fires once for a step listing itself, and no cycle fires', () => {
    expect(checkPlan(plan([step('a.x', { after: ['a.x', 'a.x'] })]))).toEqual([
      {
        severity: 'error',
        code: 'self_dependency',
        stepId: 'a.x',
        message: 'Step a.x lists itself as a prerequisite. Remove it.',
      },
    ]);
  });
  it('R4.2 self_dependency does not fire for a step that lists another step', () => {
    expect(checkPlan(plan([step('a.x', { after: ['a.y'] }), step('a.y')]))).toEqual([]);
  });

  it('R4.3 cycle fires once with the path of the two steps that wait on each other', () => {
    const p = plan([step('a.y', { after: ['a.x'] }), step('a.x', { after: ['a.y'] })]);
    expect(checkPlan(p)).toEqual([
      {
        severity: 'error',
        code: 'cycle',
        stepId: 'a.x',
        path: ['a.x', 'a.y'],
        message:
          'Steps a.x → a.y → a.x wait on each other, so none of them can start. Remove one of these prerequisites.',
      },
    ]);
  });
  it('R4.3 cycle does not fire on a chain', () => {
    const p = plan([step('a.z', { after: ['a.y'] }), step('a.y', { after: ['a.x'] }), step('a.x')]);
    expect(checkPlan(p)).toEqual([]);
  });

  it('R4.4 duplicate_step_id fires once with the number of occurrences', () => {
    const p = plan([step('a.x'), step('a.x', { title: 'Dice' }), step('a.x', { minutes: 7 })]);
    expect(checkPlan(p)).toEqual([
      {
        severity: 'error',
        code: 'duplicate_step_id',
        stepId: 'a.x',
        count: 3,
        message: '3 steps have the id a.x. Give each step its own id.',
      },
    ]);
  });
  it('R4.4 duplicate_step_id does not fire when step ids differ', () => {
    expect(checkPlan(plan([step('a.x'), step('a.y')]))).toEqual([]);
  });

  it('R4.4 duplicate_dish_id fires once with the number of occurrences', () => {
    const p = plan(
      [step('a.x')],
      [
        { id: 'a', name: 'A' },
        { id: 'a', name: 'Another A' },
      ],
    );
    expect(checkPlan(p)).toEqual([
      {
        severity: 'error',
        code: 'duplicate_dish_id',
        dishId: 'a',
        count: 2,
        message: '2 dishes have the id a. Give each dish its own id.',
      },
    ]);
  });
  it('R4.4 duplicate_dish_id does not fire when dish ids differ', () => {
    const p = plan(
      [step('a.x'), step('b.x')],
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    );
    expect(checkPlan(p)).toEqual([]);
  });

  it('R4.5 unknown_dish fires for a step whose dish is not in the plan', () => {
    const p = plan([step('a.x'), step('a.y', { dish: 'sauce' })]);
    expect(checkPlan(p)).toEqual([
      {
        severity: 'error',
        code: 'unknown_dish',
        stepId: 'a.y',
        dishId: 'sauce',
        message:
          "Step a.y belongs to dish sauce, which is not in this plan. Pick one of the plan's dishes.",
      },
    ]);
  });
  it('R4.5 unknown_dish does not fire when a step id prefix differs from its dish', () => {
    expect(checkPlan(plan([step('b.x', { dish: 'a' })]))).toEqual([]);
  });

  it('R4.6 dish_without_steps fires for a dish no step belongs to', () => {
    const p = plan(
      [step('a.x')],
      [
        { id: 'greens', name: 'Greens' },
        { id: 'a', name: 'A' },
      ],
    );
    expect(checkPlan(p)).toEqual([
      {
        severity: 'error',
        code: 'dish_without_steps',
        dishId: 'greens',
        message: 'Dish greens has no steps. Add a step or remove the dish.',
      },
    ]);
  });
  it('R4.6 dish_without_steps does not fire when every dish has a step', () => {
    expect(checkPlan(plan([step('a.x')]))).toEqual([]);
  });

  it.each([
    ['SUNDAY_ROAST', SUNDAY_ROAST],
    ['MEZZE', MEZZE],
    ['TIGHT_OVEN', TIGHT_OVEN],
  ])('R4.7 the fixture %s gives no issues', (_name, fixture) => {
    expect(checkPlan(fixture)).toEqual([]);
  });

  it('R7.3 several errors come sorted by code, then step id', () => {
    const p = plan(
      [
        step('a.z', { after: ['a.missing'] }),
        step('a.y', { after: ['a.y'] }),
        step('a.x'),
        step('a.x'),
      ],
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    );
    // compareIds order of the codes: dish_without_steps < duplicate_step_id <
    // self_dependency < unknown_dependency.
    expect(
      checkPlan(p).map((i) => [i.code, 'stepId' in i ? i.stepId : 'dishId' in i ? i.dishId : '']),
    ).toEqual([
      ['dish_without_steps', 'b'],
      ['duplicate_step_id', 'a.x'],
      ['self_dependency', 'a.y'],
      ['unknown_dependency', 'a.z'],
    ]);
  });
});

describe('checkPlan warnings (R5)', () => {
  const mismatch = (stepId: string, word: string, suggested: 'burner' | 'oven'): Issue => ({
    severity: 'warning',
    code: 'appliance_mismatch',
    stepId,
    word,
    suggested,
    message:
      suggested === 'oven'
        ? `Step ${stepId} mentions "${word}" but uses no appliance. If it needs the oven, set its appliance to oven.`
        : `Step ${stepId} mentions "${word}" but uses no appliance. If it needs a burner, set its appliance to burner.`,
  });

  it('R5.1 "Roasting tin" on a none step fires with the base word roast', () => {
    expect(checkPlan(plan([step('a.x', { title: 'Roasting tin' })]))).toEqual([
      mismatch('a.x', 'roast', 'oven'),
    ]);
  });
  it('R5.1 a hyphen is a word boundary: "stir-fry" fires with fry', () => {
    expect(checkPlan(plan([step('a.x', { title: 'Quick stir-fry' })]))).toEqual([
      mismatch('a.x', 'fry', 'burner'),
    ]);
  });
  it('R5.1 a decomposed "saute\u0301" fires after NFC with sauté', () => {
    expect(checkPlan(plan([step('a.x', { title: 'Saute\u0301 the onions' })]))).toEqual([
      mismatch('a.x', 'saut\u00e9', 'burner'),
    ]);
  });
  it('R5.1 a match in the detail only fires', () => {
    expect(
      checkPlan(plan([step('a.x', { title: 'Finish', detail: 'Then bake it for a while.' })])),
    ).toEqual([mismatch('a.x', 'bake', 'oven')]);
  });
  it('R5.1 the title match wins over the detail match', () => {
    expect(
      checkPlan(plan([step('a.x', { title: 'Boil the kettle', detail: 'Roast the nuts.' })])),
    ).toEqual([mismatch('a.x', 'boil', 'burner')]);
  });
  it.each([['Use the ovenproof dish'], ['Fill the boiler'], ['Set out the roaster']])(
    'R5.1 "%s" does not fire: the word is part of a longer word',
    (title) => {
      expect(checkPlan(plan([step('a.x', { title })]))).toEqual([]);
    },
  );
  it('R5.1 a burner step that says boil does not fire', () => {
    expect(
      checkPlan(plan([step('a.x', { title: 'Boil the pasta', appliance: 'burner' })])),
    ).toEqual([]);
  });

  it('R5.2 long_hands_on does not fire at 45 minutes', () => {
    expect(checkPlan(plan([step('a.x', { minutes: 45 })]))).toEqual([]);
  });
  it('R5.2 long_hands_on fires at 46 minutes', () => {
    expect(checkPlan(plan([step('a.x', { minutes: 46 })]))).toEqual([
      {
        severity: 'warning',
        code: 'long_hands_on',
        stepId: 'a.x',
        minutes: 46,
        message:
          'Step a.x keeps a cook busy for 46 minutes. If part of it runs by itself, split it into a hands-on step and a hands-free step.',
      },
    ]);
  });

  it('R5.3 short_hands_free fires at 1 minute, hands-free, no appliance', () => {
    expect(checkPlan(plan([step('a.x', { minutes: 1, handsOn: false })]))).toEqual([
      {
        severity: 'warning',
        code: 'short_hands_free',
        stepId: 'a.x',
        minutes: 1,
        message:
          'Step a.x runs by itself for only 1 minute. Mark it hands-on or merge it into the step after it.',
      },
    ]);
  });
  it.each([
    ['2 minutes', { minutes: 2, handsOn: false }],
    ['1 minute hands-on', { minutes: 1, handsOn: true }],
    ['1 minute on a burner', { minutes: 1, handsOn: false, appliance: 'burner' as const }],
  ])('R5.3 short_hands_free does not fire at %s', (_name, fields) => {
    expect(checkPlan(plan([step('a.x', fields)]))).toEqual([]);
  });

  it('R5.4 hasErrors is false for a plan with warnings only', () => {
    const issues = checkPlan(plan([step('a.x', { minutes: 50, title: 'Roast' })]));
    expect(issues.map((i) => i.code)).toEqual(['appliance_mismatch', 'long_hands_on']);
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('checkKitchen and validatePlan (R6.1, R2.9)', () => {
  const missing = (stepId: string, appliance: 'burner' | 'oven'): Issue => ({
    severity: 'error',
    code: 'missing_appliance',
    stepId,
    appliance,
    message:
      appliance === 'oven'
        ? `Step ${stepId} needs an oven and the kitchen has none. Add an oven in the kitchen settings or change the step.`
        : `Step ${stepId} needs a burner and the kitchen has none. Add a burner in the kitchen settings or change the step.`,
  });

  it('R6.1 SUNDAY_ROAST with no burners gives the three burner steps', () => {
    expect(checkKitchen(SUNDAY_ROAST, { ...HOME_KITCHEN, burners: 0 })).toEqual([
      missing('gravy.roux', 'burner'),
      missing('gravy.simmer', 'burner'),
      missing('greens.boil', 'burner'),
    ]);
  });
  it('R6.1 TIGHT_OVEN with no oven gives the two oven steps', () => {
    expect(checkKitchen(TIGHT_OVEN, { ...HOME_KITCHEN, ovens: 0 })).toEqual([
      missing('pie.bake', 'oven'),
      missing('potatoes.roast', 'oven'),
    ]);
  });
  it('R6.1 HOME_KITCHEN has every appliance SUNDAY_ROAST needs', () => {
    expect(checkKitchen(SUNDAY_ROAST, HOME_KITCHEN)).toEqual([]);
  });
  it('R6.1 a duplicated burner step gives one issue', () => {
    const p = plan([step('a.x', { appliance: 'burner' }), step('a.x', { appliance: 'burner' })]);
    expect(checkKitchen(p, { burners: 0, ovens: 1, cooks: 1 })).toEqual([missing('a.x', 'burner')]);
  });

  it('R2.9 validatePlan({}) gives no plan and the parse issues', () => {
    const result = validatePlan({});
    expect(result.plan).toBe(null);
    expect(result.issues.map((i) => [i.code, i.code === 'invalid_field' ? i.field : ''])).toEqual([
      ['invalid_field', 'dishes'],
      ['invalid_field', 'steps'],
      ['invalid_field', 'title'],
    ]);
  });
  it('R2.9 validatePlan on a fixture as JSON gives the plan and no issues', () => {
    expect(validatePlan(JSON.parse(JSON.stringify(MEZZE)))).toStrictEqual({
      plan: MEZZE,
      issues: [],
    });
  });
  it('R2.9 validatePlan on a parsed plan with an error gives the checkPlan issues', () => {
    const result = validatePlan(plan([step('a.x', { after: ['a.x'] })]));
    expect(result.plan?.steps.map((s) => s.id)).toEqual(['a.x']);
    expect(result.issues.map((i) => i.code)).toEqual(['self_dependency']);
  });
});
