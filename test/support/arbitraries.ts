import fc from 'fast-check';
import type { Appliance, Dish, ErrorCode, Kitchen, Plan, Step } from '../../src/core/schema.js';

// Generators for tests (testing.md). They may be extended to cover more cases, never narrowed
// to avoid a failing case.

export interface PlanOpts {
  /** Reach the limits of 12 dishes and 80 steps. */
  large?: boolean;
  /** Appliances the steps may use. Default: all three. */
  appliances?: readonly Appliance[];
}

export interface BrokenCase {
  rule: ErrorCode;
  /** Passed to `validatePlan`. */
  input: unknown;
  /** Passed to `checkKitchen` when the plan parses. Has a burner and an oven, except for `missing_appliance`. */
  kitchen: Kitchen;
  /** An issue with `rule` must carry these ids. */
  target: { stepId?: string; dishId?: string };
}

const ALL_APPLIANCES: readonly Appliance[] = ['burner', 'oven', 'none'];

// ---------------------------------------------------------------------------------------
// Small building blocks

type Draw = fc.GeneratorValue;

/** Draws one value of `arb` inside `fc.gen()`. */
const draw = <T>(g: Draw, arb: fc.Arbitrary<T>): T => g(() => arb);

const ALNUM: readonly string[] = [...'abcdefghijklmnopqrstuvwxyz0123456789'];

const arbSegment = (maxLength: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength }).map((chars) => chars.join(''));

/** A dish id: 1 to 3 segments joined by `-`, at most 20 characters. */
const arbDishId: fc.Arbitrary<string> = fc
  .array(arbSegment(6), { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('-'));

/** The part of a step id after the dot: 1 to 3 segments joined by `-`, at most 14 characters. */
const arbSlug: fc.Arbitrary<string> = fc
  .array(arbSegment(4), { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('-'));

const UNICODE_TEXT: readonly string[] = [
  'Saut\u00e9 the onions',
  'Cr\u00e8me br\u00fbl\u00e9e',
  'Fire \u{1F525} roast',
  'Caf\u0065\u0301 au lait',
  'Stir  in the butter',
  '  Padded  ',
];

/** Non-blank text of 1..max characters (code points). */
const arbNonBlank = (max: number): fc.Arbitrary<string> =>
  fc.oneof(
    {
      weight: 8,
      arbitrary: fc.string({ minLength: 1, maxLength: max }).filter((s) => /\S/.test(s)),
    },
    {
      weight: 1,
      arbitrary: fc.constantFrom(...UNICODE_TEXT).filter((s) => [...s].length <= max),
    },
  );

// Words for titles and details: every form the appliance_mismatch warning looks for, near
// misses that must not fire, and neutral words.
const MISMATCH_FORMS: readonly string[] = [
  'oven',
  'ovens',
  'roast',
  'roasts',
  'roasted',
  'roasting',
  'bake',
  'bakes',
  'baked',
  'baking',
  'simmer',
  'simmers',
  'simmered',
  'simmering',
  'boil',
  'boils',
  'boiled',
  'boiling',
  'fry',
  'fries',
  'fried',
  'frying',
  'sear',
  'sears',
  'seared',
  'searing',
  'saut\u00e9',
  'saut\u00e9s',
  'saut\u00e9ed',
  'saut\u00e9ing',
  'saute',
  'sautes',
  'sauteed',
  'sauteing',
  'saute\u0301',
  'stir-fry',
];
const NEAR_MISSES: readonly string[] = ['ovenproof', 'boiler', 'roaster', 'baker', 'fryer'];
const NEUTRAL_WORDS: readonly string[] = [
  'Prepare',
  'Chop',
  'the',
  'onions',
  'Mix',
  'Rest',
  'Slice',
  'Carve',
  'dough',
  'salad',
  'Season',
  'Whisk',
  'Peel',
  'Toss',
  'Stir',
  'Roasting',
  'tin',
  'under',
  'foil',
];

const arbWords: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...MISMATCH_FORMS, ...NEAR_MISSES, ...NEUTRAL_WORDS), {
    minLength: 1,
    maxLength: 4,
  })
  .map((words) => words.join(' '));

const arbTitle: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: arbWords },
  { weight: 1, arbitrary: arbNonBlank(120) },
);

/** `undefined` means the `detail` key is absent. */
const arbDetail: fc.Arbitrary<string | undefined> = fc.oneof(
  { weight: 4, arbitrary: fc.constant(undefined) },
  { weight: 2, arbitrary: arbWords },
  { weight: 2, arbitrary: arbNonBlank(60) },
  { weight: 1, arbitrary: arbNonBlank(1000) },
);

const arbMinutes: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(1) },
  { weight: 5, arbitrary: fc.integer({ min: 2, max: 10 }) },
  { weight: 4, arbitrary: fc.integer({ min: 11, max: 60 }) },
  { weight: 1, arbitrary: fc.integer({ min: 61, max: 480 }) },
);

const arbHold: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 30 }) },
  { weight: 1, arbitrary: fc.integer({ min: 31, max: 480 }) },
);

/** A random reordering of `items`. */
const arbPermutation = <T>(items: readonly T[]): fc.Arbitrary<T[]> =>
  fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });

// ---------------------------------------------------------------------------------------
// Kitchens and plans

export function arbKitchen(): fc.Arbitrary<Kitchen> {
  return fc.record({
    burners: fc.integer({ min: 0, max: 8 }),
    ovens: fc.integer({ min: 0, max: 4 }),
    cooks: fc.integer({ min: 1, max: 6 }),
  });
}

/** A kitchen with at least one burner and one oven, for every rule but `missing_appliance`. */
const arbEquippedKitchen: fc.Arbitrary<Kitchen> = fc.record({
  burners: fc.integer({ min: 1, max: 8 }),
  ovens: fc.integer({ min: 1, max: 4 }),
  cooks: fc.integer({ min: 1, max: 6 }),
});

/**
 * A plan that is valid by construction: step `k` may only wait on steps `0..k-1` (so it is
 * acyclic), every dish gets a step, ids are unique, then everything is put in random order.
 */
function arbShaped(
  arbDishCount: fc.Arbitrary<number>,
  arbStepCount: (dishCount: number) => fc.Arbitrary<number>,
  appliances: readonly Appliance[],
): fc.Arbitrary<Plan> {
  return fc.gen().map((g): Plan => {
    const dishCount = draw(g, arbDishCount);
    const dishIds = draw(
      g,
      fc.uniqueArray(arbDishId, { minLength: dishCount, maxLength: dishCount }),
    );
    const dishes: Dish[] = dishIds.map((id) => ({ id, name: draw(g, arbNonBlank(80)) }));

    const stepCount = draw(g, arbStepCount(dishCount));
    const slugs = draw(g, fc.uniqueArray(arbSlug, { minLength: stepCount, maxLength: stepCount }));
    const ids: string[] = [];
    const steps: Step[] = [];
    for (let k = 0; k < stepCount; k++) {
      const dishIndex = k < dishCount ? k : draw(g, fc.integer({ min: 0, max: dishCount - 1 }));
      const dish = dishIds[dishIndex] ?? '';
      const id = `${dish}.${slugs[k] ?? ''}`;
      const earlier =
        k === 0
          ? []
          : draw(
              g,
              fc.uniqueArray(fc.integer({ min: 0, max: k - 1 }), { maxLength: Math.min(k, 4) }),
            );
      const detail = draw(g, arbDetail);
      const step: Step = {
        id,
        dish,
        title: draw(g, arbTitle),
        ...(detail === undefined ? {} : { detail }),
        minutes: draw(g, arbMinutes),
        appliance: draw(g, fc.constantFrom(...appliances)),
        handsOn: draw(g, fc.boolean()),
        after: draw(g, arbPermutation(earlier.map((i) => ids[i] ?? ''))),
        holdMin: draw(g, arbHold),
      };
      ids.push(id);
      steps.push(step);
    }
    return {
      title: draw(g, arbNonBlank(120)),
      dishes: draw(g, arbPermutation(dishes)),
      steps: draw(g, arbPermutation(steps)),
    };
  });
}

function arbDefaultSizes(minSteps: number, appliances: readonly Appliance[]): fc.Arbitrary<Plan> {
  return arbShaped(
    fc.integer({ min: 1, max: 6 }),
    (d) => fc.integer({ min: Math.max(d, minSteps), max: 30 }),
    appliances,
  );
}

export function arbPlan(opts: PlanOpts = {}): fc.Arbitrary<Plan> {
  const appliances = opts.appliances ?? ALL_APPLIANCES;
  if (opts.large === true) {
    return arbShaped(
      fc.oneof(fc.constant(12), fc.integer({ min: 1, max: 12 })),
      (d) => fc.oneof(fc.constant(80), fc.integer({ min: d, max: 80 })),
      appliances,
    );
  }
  return arbDefaultSizes(1, appliances);
}

export function arbPlanAndKitchen(
  opts: Omit<PlanOpts, 'appliances'> = {},
): fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }> {
  return arbKitchen().chain((kitchen) => {
    const appliances: Appliance[] = ['none'];
    if (kitchen.burners > 0) appliances.push('burner');
    if (kitchen.ovens > 0) appliances.push('oven');
    return arbPlan({ ...opts, appliances }).map((plan) => ({ plan, kitchen }));
  });
}

/** The same plan with `steps`, `dishes` and every `after` list in another order. */
export function arbShuffledPlan(plan: Plan): fc.Arbitrary<Plan> {
  return fc.gen().map((g): Plan => {
    const steps = plan.steps.map((s) => ({ ...s, after: draw(g, arbPermutation(s.after)) }));
    return {
      title: plan.title,
      dishes: draw(g, arbPermutation(plan.dishes.map((d) => ({ ...d })))),
      steps: draw(g, arbPermutation(steps)),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Values that look like plans, and recipe text

type Json = Record<string, unknown>;

/** A valid plan with at most one random change, so inputs reach deep paths of the parser. */
export function arbPlanLikeValue(): fc.Arbitrary<unknown> {
  const unknownKeys = ['details', 'hold_min', 'notes', 'extra'] as const;
  const oddValues: readonly unknown[] = [
    null,
    [],
    {},
    'x',
    '',
    0,
    -1,
    2.5,
    1e9,
    true,
    [1],
    ['a.b'],
  ];
  const minutesValues: readonly unknown[] = [0, -1, 481, 2.5, '5', null, true];
  return arbPlan().chain((plan) =>
    fc.gen().map((g): unknown => {
      const root = structuredClone(plan) as unknown as Json & { dishes: Json[]; steps: Json[] };
      const kind = draw(g, fc.integer({ min: 0, max: 6 }));
      if (kind === 6) return root; // unchanged: a valid plan

      const targets: Json[] = [root, ...root.dishes, ...root.steps];
      const target = targets[draw(g, fc.nat({ max: targets.length - 1 }))] ?? root;
      const keys = Object.keys(target);
      const key = keys[draw(g, fc.nat({ max: keys.length - 1 }))] ?? 'title';
      switch (kind) {
        case 0:
          target[key] = draw(g, fc.jsonValue());
          break;
        case 1:
          delete target[key];
          break;
        case 2:
          target[draw(g, fc.constantFrom(...unknownKeys))] = draw(g, fc.jsonValue());
          break;
        case 3:
          target[key] = draw(g, fc.constantFrom(...oddValues));
          break;
        case 4: {
          const step = root.steps[draw(g, fc.nat({ max: root.steps.length - 1 }))];
          if (step !== undefined) step.minutes = draw(g, fc.constantFrom(...minutesValues));
          break;
        }
        default:
          root[draw(g, fc.constantFrom('dishes', 'steps'))] = [];
          break;
      }
      return root;
    }),
  );
}

const TEXT_FRAGMENTS: readonly string[] = [
  '\r',
  '\n',
  '\r\n',
  ' ',
  '\t',
  '\u00a0',
  '\u2028',
  'e',
  '\u0301',
  '\u00e9',
  '\n\n\n',
  '  ',
  '\n\n',
  ' \n',
  'a',
  'Z',
  '7',
];

/** Recipe text with the awkward characters that normalisation deals with. */
export function arbRecipeText(): fc.Arbitrary<string> {
  return fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom(...TEXT_FRAGMENTS) },
        { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
      ),
      { maxLength: 60 },
    )
    .map((parts) => parts.join(''));
}

// ---------------------------------------------------------------------------------------
// Broken plans: exactly one rule broken

const DEFAULT_BASE = arbDefaultSizes(1, ALL_APPLIANCES);

const pick = <T>(g: Draw, items: readonly T[]): T =>
  items[draw(g, fc.nat({ max: items.length - 1 }))] as T; // the callers never pass an empty list

/** Ids of all steps that `id` waits on, directly or through other steps. */
function ancestorsOf(plan: Plan, id: string): Set<string> {
  const byId = new Map<string, readonly string[]>();
  for (const s of plan.steps) byId.set(s.id, s.after);
  const seen = new Set<string>();
  const stack = [...(byId.get(id) ?? [])];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(byId.get(next) ?? []));
  }
  return seen;
}

function freshDishId(g: Draw, plan: Plan): string {
  return draw(
    g,
    arbDishId.filter((id) => !plan.dishes.some((d) => d.id === id)),
  );
}

function freshStepId(g: Draw, plan: Plan): string {
  return draw(
    g,
    fc
      .tuple(arbDishId, arbSlug)
      .map(([dish, slug]) => `${dish}.${slug}`)
      .filter((id) => !plan.steps.some((s) => s.id === id)),
  );
}

function build(rule: ErrorCode, g: Draw): BrokenCase {
  const kitchen = draw(g, arbEquippedKitchen);
  const done = (input: unknown, target: BrokenCase['target'] = {}): BrokenCase => ({
    rule,
    input,
    kitchen,
    target,
  });
  const base = (): Plan => structuredClone(draw(g, DEFAULT_BASE));
  const stepIndex = (plan: Plan): number => draw(g, fc.nat({ max: plan.steps.length - 1 }));

  switch (rule) {
    case 'empty_plan': {
      const plan = base();
      const which = pick(g, ['steps', 'dishes', 'both'] as const);
      return done({
        ...plan,
        ...(which !== 'dishes' ? { steps: [] } : {}),
        ...(which !== 'steps' ? { dishes: [] } : {}),
      });
    }
    case 'too_many_dishes': {
      const plan = draw(
        g,
        arbShaped(
          fc.integer({ min: 13, max: 20 }),
          (d) => fc.integer({ min: d, max: 80 }),
          ALL_APPLIANCES,
        ),
      );
      return done(plan);
    }
    case 'too_many_steps': {
      const plan = draw(
        g,
        arbShaped(
          fc.integer({ min: 1, max: 12 }),
          () => fc.integer({ min: 81, max: 120 }),
          ALL_APPLIANCES,
        ),
      );
      return done(plan);
    }
    case 'minutes_out_of_range': {
      const plan = base();
      const index = stepIndex(plan);
      const step = plan.steps[index] as Step & Json; // index is in range
      const bad = draw(
        g,
        fc.oneof(
          fc.constant<unknown>(0),
          fc.integer({ min: -480, max: -1 }),
          fc.integer({ min: 481, max: 100000 }),
          fc.double({ min: 1.01, max: 479.99, noNaN: true }).filter((x) => !Number.isInteger(x)),
          fc.constantFrom('5', '75'),
          fc.constant(null),
          fc.constant(true),
          fc.constant(undefined),
        ),
      );
      if (bad === undefined) delete (step as Json).minutes;
      else (step as Json).minutes = bad;
      return done(plan, { stepId: step.id });
    }
    case 'invalid_field': {
      const plan = base();
      const input = plan as unknown as Json & { dishes: Json[]; steps: Json[] };
      const index = stepIndex(plan);
      const step = input.steps[index] as Json;
      const stepId = plan.steps[index]?.id ?? '';
      const dishIndex = draw(g, fc.nat({ max: plan.dishes.length - 1 }));
      const dish = input.dishes[dishIndex] as Json;
      const dishId = plan.dishes[dishIndex]?.id ?? '';
      const variant = pick(g, [
        'appliance',
        'handsOn',
        'step_id',
        'step_dish',
        'after_entry',
        'blank_title',
        'long_title',
        'empty_detail',
        'hold',
        'no_hold',
        'long_dish_name',
        'dish_id',
        'no_title',
        'unknown_key',
        'root',
      ] as const);
      switch (variant) {
        case 'appliance':
          step.appliance = pick(g, ['stove', 'Oven', '', 'BURNER', null, 3]);
          return done(input, { stepId });
        case 'handsOn':
          step.handsOn = pick(g, ['yes', 1, 0, null, 'true']);
          return done(input, { stepId });
        case 'step_id':
          step.id = pick(g, [
            'Bad.id',
            'nodot',
            'a.b.c',
            '',
            'a b.c',
            `${'x'.repeat(41)}.${'y'.repeat(40)}`,
          ]);
          return done(input);
        case 'step_dish':
          step.dish = pick(g, ['Bad Dish', '', 'UPPER', 'a'.repeat(41)]);
          return done(input, { stepId });
        case 'after_entry':
          step.after = [...(plan.steps[index]?.after ?? []), pick(g, ['Not.valid', 'nodot', ''])];
          return done(input, { stepId });
        case 'blank_title':
          step.title = pick(g, ['', '   ', '\t\n', '\u00a0']);
          return done(input, { stepId });
        case 'long_title':
          step.title = 'a'.repeat(121);
          return done(input, { stepId });
        case 'empty_detail':
          step.detail = pick(g, ['', '  ']);
          return done(input, { stepId });
        case 'hold':
          step.holdMin = pick(g, [-1, 481, 1.5, '5', true]);
          return done(input, { stepId });
        case 'no_hold':
          delete step.holdMin;
          return done(input, { stepId });
        case 'long_dish_name':
          dish.name = 'a'.repeat(81);
          return done(input, { dishId });
        case 'dish_id':
          dish.id = pick(g, ['Bad Id', '', '-a', 'a--b']);
          return done(input);
        case 'no_title':
          delete input.title;
          return done(input);
        case 'unknown_key': {
          const where = pick(g, ['root', 'step', 'dish'] as const);
          const key = pick(g, ['details', 'hold_min', 'notes', 'extra']);
          if (where === 'step') {
            step[key] = 1;
            return done(input, { stepId });
          }
          if (where === 'dish') {
            dish[key] = 1;
            return done(input, { dishId });
          }
          input[key] = 1;
          return done(input);
        }
        case 'root':
          return done(pick(g, [null, 42, 'plan', [], true, 3.5, [1, 2]]));
      }
      break;
    }
    case 'unknown_dependency': {
      const plan = base();
      const step = plan.steps[stepIndex(plan)] as Step;
      step.after.push(freshStepId(g, plan));
      return done(plan, { stepId: step.id });
    }
    case 'self_dependency': {
      const plan = base();
      const step = plan.steps[stepIndex(plan)] as Step;
      step.after.push(step.id);
      return done(plan, { stepId: step.id });
    }
    case 'cycle': {
      const plan = structuredClone(draw(g, arbDefaultSizes(2, ALL_APPLIANCES)));
      const x = stepIndex(plan);
      const y = draw(g, fc.nat({ max: plan.steps.length - 2 }));
      const first = plan.steps[x] as Step;
      const second = plan.steps[y >= x ? y + 1 : y] as Step; // a different step
      const addAfter = (s: Step, id: string): void => {
        if (!s.after.includes(id)) s.after.push(id);
      };
      addAfter(first, second.id);
      // If `second` already waits on `first`, that one edge closes the cycle; otherwise add the other way too.
      if (!ancestorsOf(plan, second.id).has(first.id)) addAfter(second, first.id);
      return done(plan);
    }
    case 'duplicate_step_id': {
      const plan = base();
      const original = plan.steps[stepIndex(plan)] as Step;
      const copy: Step = { ...original, after: [...original.after] };
      if (draw(g, fc.boolean())) copy.title = draw(g, arbNonBlank(120));
      if (draw(g, fc.boolean())) copy.minutes = draw(g, arbMinutes);
      plan.steps.splice(draw(g, fc.nat({ max: plan.steps.length })), 0, copy);
      return done(plan, { stepId: original.id });
    }
    case 'duplicate_dish_id': {
      const plan = base();
      const original = plan.dishes[draw(g, fc.nat({ max: plan.dishes.length - 1 }))] as Dish;
      plan.dishes.splice(draw(g, fc.nat({ max: plan.dishes.length })), 0, {
        id: original.id,
        name: draw(g, arbNonBlank(80)),
      });
      return done(plan, { dishId: original.id });
    }
    case 'unknown_dish': {
      const plan = base();
      const missing = freshDishId(g, plan);
      const crowded = plan.steps.filter(
        (s) => plan.steps.filter((t) => t.dish === s.dish).length >= 2,
      );
      if (crowded.length > 0) {
        const step = pick(g, crowded);
        step.dish = missing; // its old dish keeps at least one other step
        return done(plan, { stepId: step.id });
      }
      const id = `${missing}.${draw(g, arbSlug)}`;
      plan.steps.push({
        id,
        dish: missing,
        title: draw(g, arbNonBlank(120)),
        minutes: draw(g, arbMinutes),
        appliance: 'none',
        handsOn: true,
        after: [],
        holdMin: null,
      });
      return done(plan, { stepId: id });
    }
    case 'dish_without_steps': {
      const plan = base();
      const id = freshDishId(g, plan);
      plan.dishes.splice(draw(g, fc.nat({ max: plan.dishes.length })), 0, {
        id,
        name: draw(g, arbNonBlank(80)),
      });
      return done(plan, { dishId: id });
    }
    case 'missing_appliance': {
      const { plan, kitchen: complete } = draw(
        g,
        arbPlanAndKitchen().filter(({ plan: p }) => p.steps.some((s) => s.appliance !== 'none')),
      );
      const needing = plan.steps.filter((s) => s.appliance !== 'none');
      const step = pick(g, needing);
      const lacking: Kitchen =
        step.appliance === 'burner' ? { ...complete, burners: 0 } : { ...complete, ovens: 0 };
      return { rule, input: plan, kitchen: lacking, target: { stepId: step.id } };
    }
  }
  throw new Error(`arbBrokenPlan: no construction for ${rule}`);
}

/** Cases that break exactly one rule; see the table in the recipe-graph design. */
export function arbBrokenPlan(rule: ErrorCode): fc.Arbitrary<BrokenCase> {
  return fc.gen().map((g) => build(rule, g));
}
