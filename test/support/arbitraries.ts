import fc from 'fast-check';
import { schedule } from '../../src/core/schedule.js';
import { oracleDinnerfile, oracleDishLastSteps } from './oracles.js';
import type { DinnerfileStyle } from './oracles.js';
import type { DinnerfileErrorCode, DinnerfileOptions } from '../../src/core/dinnerfile.js';
import { AXIS_MIN } from '../../src/core/schema.js';
import type {
  Appliance,
  Dish,
  ErrorCode,
  Kitchen,
  Plan,
  Progress,
  ProgressEntry,
  RebuiltSchedule,
  Schedule,
  Step,
} from '../../src/core/schema.js';

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

const ALNUM: readonly string[] = [...'abcdefghijklmnopqrstuvwxyz0123456789'];

const arbSegment = (maxLength: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength }).map((chars) => chars.join(''));

/** Dish ids that are Make directive words or file names Make knows (dinnerfile spec). */
const DIRECTIVE_DISH_IDS: readonly string[] = [
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
];

/** A dish id: 1 to 3 segments joined by `-`, at most 20 characters; sometimes a Make word. */
const arbDishId: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .array(arbSegment(6), { minLength: 1, maxLength: 3 })
      .map((segments) => segments.join('-')),
  },
  { weight: 1, arbitrary: fc.constantFrom(...DIRECTIVE_DISH_IDS) },
);

/**
 * The part of a step id after the dot: 1 to 3 segments joined by `-`, at most 14 characters;
 * sometimes one that starts or ends with `-`, or has nothing else (dinnerfile spec).
 */
const arbSlug: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .array(arbSegment(4), { minLength: 1, maxLength: 3 })
      .map((segments) => segments.join('-')),
  },
  { weight: 1, arbitrary: fc.constantFrom('-x', 'x-', '--', '-0-') },
);

/** The hostile alphabet of the dinnerfile design: what titles and details may hold. */
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
  ' ',
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
  '\ud800',
  '\udfff',
  '\u6f22\u5b57',
  'word',
];

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
    { weight: 2, arbitrary: arbHostileText(max) },
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

/** Everything one step needs besides its id, drawn up front so no draw depends on a closure. */
interface StepDraft {
  dishPick: number;
  earlier: number[];
  title: string;
  detail: string | undefined;
  minutes: number;
  appliance: Appliance;
  handsOn: boolean;
  holdMin: number | null;
}

function arbStepDraft(
  k: number,
  dishCount: number,
  appliances: readonly Appliance[],
): fc.Arbitrary<StepDraft> {
  return fc.record({
    dishPick: fc.integer({ min: 0, max: dishCount - 1 }),
    earlier:
      k === 0
        ? fc.constant<number[]>([])
        : fc.uniqueArray(fc.integer({ min: 0, max: k - 1 }), { maxLength: Math.min(k, 4) }),
    title: arbTitle,
    detail: arbDetail,
    minutes: arbMinutes,
    appliance: fc.constantFrom(...appliances),
    handsOn: fc.boolean(),
    holdMin: arbHold,
  });
}

/**
 * A plan that is valid by construction: step `k` may only wait on steps `0..k-1` (so it is
 * acyclic), every dish gets a step, ids are unique, then everything is put in random order.
 * Built with plain `chain`/`map` composition, not `fc.gen()`, so that a failing property
 * shrinks to a counterexample instead of exhausting memory (T2.7).
 */
function arbShaped(
  arbDishCount: fc.Arbitrary<number>,
  arbStepCount: (dishCount: number) => fc.Arbitrary<number>,
  appliances: readonly Appliance[],
): fc.Arbitrary<Plan> {
  return arbDishCount
    .chain((dishCount) =>
      arbStepCount(dishCount).chain((stepCount) =>
        fc
          .tuple(
            fc.uniqueArray(arbDishId, { minLength: dishCount, maxLength: dishCount }),
            fc.array(arbNonBlank(80), { minLength: dishCount, maxLength: dishCount }),
            fc.uniqueArray(arbSlug, { minLength: stepCount, maxLength: stepCount }),
            fc.tuple(
              ...Array.from({ length: stepCount }, (_, k) =>
                arbStepDraft(k, dishCount, appliances),
              ),
            ),
            arbNonBlank(120),
          )
          .map(([dishIds, names, slugs, drafts, title]): Plan => {
            const dishes: Dish[] = dishIds.map((id, i) => ({ id, name: names[i] ?? '' }));
            const ids: string[] = [];
            const steps: Step[] = drafts.map((draft, k): Step => {
              const dish = dishIds[k < dishCount ? k : draft.dishPick] ?? '';
              const id = `${dish}.${slugs[k] ?? ''}`;
              ids.push(id);
              return {
                id,
                dish,
                title: draft.title,
                ...(draft.detail === undefined ? {} : { detail: draft.detail }),
                minutes: draft.minutes,
                appliance: draft.appliance,
                handsOn: draft.handsOn,
                after: draft.earlier.map((i) => ids[i] ?? ''),
                holdMin: draft.holdMin,
              };
            });
            return { title, dishes, steps };
          }),
      ),
    )
    .chain((plan) => arbShuffledPlan(plan));
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

/**
 * Makes a plan small enough for an "unlimited" kitchen to exist (C1): in step-id order, every
 * hands-on step after the 6th becomes hands-free, every burner step after the 8th and every
 * oven step after the 4th uses no appliance. Step order and all other fields stay. Only fields
 * that no error rule reads change, so a valid plan stays valid (warnings may appear).
 */
export function fitUnlimited(plan: Plan): Plan {
  const ordered = [...plan.steps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const changed = new Map<string, Step>();
  let hands = 0;
  let burners = 0;
  let ovens = 0;
  for (const step of ordered) {
    let next = step;
    if (step.handsOn) {
      hands++;
      if (hands > 6) next = { ...next, handsOn: false };
    }
    if (step.appliance === 'burner') {
      burners++;
      if (burners > 8) next = { ...next, appliance: 'none' };
    }
    if (step.appliance === 'oven') {
      ovens++;
      if (ovens > 4) next = { ...next, appliance: 'none' };
    }
    changed.set(step.id, next);
  }
  return { ...plan, steps: plan.steps.map((s) => changed.get(s.id) ?? s) };
}

/**
 * Counts at least the steps needing each resource; only for plans with at most 8 burner, 4
 * oven and 6 hands-on steps (see C1). Each count is drawn from the number needed up to the
 * schema maximum (and cooks from at least 1).
 */
export function arbUnlimitedKitchen(plan: Plan): fc.Arbitrary<Kitchen> {
  const burners = plan.steps.filter((s) => s.appliance === 'burner').length;
  const ovens = plan.steps.filter((s) => s.appliance === 'oven').length;
  const cooks = plan.steps.filter((s) => s.handsOn).length;
  return fc.record({
    burners: fc.integer({ min: burners, max: 8 }),
    ovens: fc.integer({ min: ovens, max: 4 }),
    cooks: fc.integer({ min: Math.max(1, cooks), max: 6 }),
  });
}

/** `arbPlan()` fitted by `fitUnlimited`, then a kitchen from `arbUnlimitedKitchen`. */
export function arbUnlimitedPair(): fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }> {
  return arbPlan()
    .map(fitUnlimited)
    .chain((plan) => arbUnlimitedKitchen(plan).map((kitchen) => ({ plan, kitchen })));
}

/** `arbPlanAndKitchen()` with every step's `handsOn` set to false. */
export function arbHandsFreePair(): fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }> {
  return arbPlanAndKitchen().map(({ plan, kitchen }) => ({
    plan: { ...plan, steps: plan.steps.map((s) => ({ ...s, handsOn: false })) },
    kitchen,
  }));
}

/** The same plan with `steps`, `dishes` and every `after` list in another order. */
export function arbShuffledPlan(plan: Plan): fc.Arbitrary<Plan> {
  const indices = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
  return fc
    .tuple(
      arbPermutation(indices(plan.dishes.length)),
      arbPermutation(indices(plan.steps.length)),
      fc.tuple(...plan.steps.map((s) => arbPermutation(s.after))),
    )
    .map(([dishOrder, stepOrder, afters]): Plan => {
      const steps = plan.steps.map((s, i) => ({ ...s, after: afters[i] ?? [] }));
      return {
        title: plan.title,
        dishes: dishOrder.map((i) => ({ ...(plan.dishes[i] as Dish) })), // i is in range
        steps: stepOrder.map((i) => steps[i] as Step), // i is in range
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
  return fc
    .tuple(
      arbPlan(),
      fc.integer({ min: 0, max: 6 }),
      fc.nat(),
      fc.nat(),
      fc.jsonValue(),
      fc.constantFrom(...unknownKeys),
      fc.constantFrom(...oddValues),
      fc.constantFrom(...minutesValues),
      fc.constantFrom('dishes', 'steps'),
    )
    .map(([plan, kind, targetPick, keyPick, json, unknownKey, odd, badMinutes, list]): unknown => {
      const root = structuredClone(plan) as unknown as Json & { dishes: Json[]; steps: Json[] };
      if (kind === 6) return root; // unchanged: a valid plan

      const targets: Json[] = [root, ...root.dishes, ...root.steps];
      const target = targets[targetPick % targets.length] ?? root;
      const keys = Object.keys(target);
      const key = keys[keyPick % keys.length] ?? 'title';
      switch (kind) {
        case 0:
          target[key] = json;
          break;
        case 1:
          delete target[key];
          break;
        case 2:
          target[unknownKey] = json;
          break;
        case 3:
          target[key] = odd;
          break;
        case 4: {
          const step = root.steps[targetPick % root.steps.length];
          if (step !== undefined) step.minutes = badMinutes;
          break;
        }
        default:
          root[list] = [];
          break;
      }
      return root;
    });
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
// Broken plans: exactly one rule broken. Built with `chain`/`map` only, so a failing
// property shrinks to a counterexample (T2.7). Every `map` clones the base plan before
// changing it, because shrinking calls it again on the same value.

const DEFAULT_BASE = arbDefaultSizes(1, ALL_APPLIANCES);

/** `items[pick % length]`; the callers never pass an empty list. */
const nth = <T>(items: readonly T[], pick: number): T => items[pick % items.length] as T;

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

const arbFreshDishId = (plan: Plan): fc.Arbitrary<string> =>
  arbDishId.filter((id) => !plan.dishes.some((d) => d.id === id));

const arbFreshStepId = (plan: Plan): fc.Arbitrary<string> =>
  fc
    .tuple(arbDishId, arbSlug)
    .map(([dish, slug]) => `${dish}.${slug}`)
    .filter((id) => !plan.steps.some((s) => s.id === id));

/** What a rule's construction gives besides the rule and the kitchen. */
interface Broken {
  input: unknown;
  target: BrokenCase['target'];
}

/** A clone of a default-size base plan, with draws that depend on it. */
const onBase = <T>(
  dependent: (plan: Plan) => fc.Arbitrary<T>,
  change: (plan: Plan, drawn: T) => Broken,
  baseArb: fc.Arbitrary<Plan> = DEFAULT_BASE,
): fc.Arbitrary<Broken> =>
  baseArb.chain((base) => dependent(base).map((drawn) => change(structuredClone(base), drawn)));

const arbBadMinutes: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant<unknown>(0),
  fc.integer({ min: -480, max: -1 }),
  fc.integer({ min: 481, max: 100000 }),
  fc.double({ min: 1.01, max: 479.99, noNaN: true }).filter((x) => !Number.isInteger(x)),
  fc.constantFrom('5', '75'),
  fc.constant(null),
  fc.constant(true),
  fc.constant(undefined),
);

const INVALID_VARIANTS = [
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
] as const;

function invalidField(
  plan: Plan,
  [stepPick, dishPick, variant, valuePick]: [
    number,
    number,
    (typeof INVALID_VARIANTS)[number],
    number,
  ],
): Broken {
  const input = plan as unknown as Json & { dishes: Json[]; steps: Json[] };
  const index = stepPick % plan.steps.length;
  const step = input.steps[index] as Json; // index is in range
  const stepId = plan.steps[index]?.id ?? '';
  const dishIndex = dishPick % plan.dishes.length;
  const dish = input.dishes[dishIndex] as Json; // dishIndex is in range
  const dishId = plan.dishes[dishIndex]?.id ?? '';
  const value = <T>(items: readonly T[]): T => nth(items, valuePick);
  switch (variant) {
    case 'appliance':
      step.appliance = value(['stove', 'Oven', '', 'BURNER', null, 3]);
      return { input, target: { stepId } };
    case 'handsOn':
      step.handsOn = value(['yes', 1, 0, null, 'true']);
      return { input, target: { stepId } };
    case 'step_id':
      step.id = value([
        'Bad.id',
        'nodot',
        'a.b.c',
        '',
        'a b.c',
        `${'x'.repeat(41)}.${'y'.repeat(40)}`,
      ]);
      return { input, target: {} };
    case 'step_dish':
      step.dish = value(['Bad Dish', '', 'UPPER', 'a'.repeat(41)]);
      return { input, target: { stepId } };
    case 'after_entry':
      step.after = [...(plan.steps[index]?.after ?? []), value(['Not.valid', 'nodot', ''])];
      return { input, target: { stepId } };
    case 'blank_title':
      step.title = value(['', '   ', '\t\n', '\u00a0']);
      return { input, target: { stepId } };
    case 'long_title':
      step.title = 'a'.repeat(121);
      return { input, target: { stepId } };
    case 'empty_detail':
      step.detail = value(['', '  ']);
      return { input, target: { stepId } };
    case 'hold':
      step.holdMin = value([-1, 481, 1.5, '5', true]);
      return { input, target: { stepId } };
    case 'no_hold':
      delete step.holdMin;
      return { input, target: { stepId } };
    case 'long_dish_name':
      dish.name = 'a'.repeat(81);
      return { input, target: { dishId } };
    case 'dish_id':
      dish.id = value(['Bad Id', '', '-a', 'a--b']);
      return { input, target: {} };
    case 'no_title':
      delete input.title;
      return { input, target: {} };
    case 'unknown_key': {
      const key = value(['details', 'hold_min', 'notes', 'extra']);
      const where = nth(['root', 'step', 'dish'] as const, Math.floor(valuePick / 4));
      if (where === 'step') {
        step[key] = 1;
        return { input, target: { stepId } };
      }
      if (where === 'dish') {
        dish[key] = 1;
        return { input, target: { dishId } };
      }
      input[key] = 1;
      return { input, target: {} };
    }
    case 'root':
      return { input: value([null, 42, 'plan', [], true, 3.5, [1, 2]]), target: {} };
  }
}

function brokenFor(rule: Exclude<ErrorCode, 'missing_appliance'>): fc.Arbitrary<Broken> {
  const stepPick = fc.nat();
  switch (rule) {
    case 'empty_plan':
      return onBase(
        () => fc.constantFrom('steps', 'dishes', 'both'),
        (plan, which) => ({
          input: {
            ...plan,
            ...(which !== 'dishes' ? { steps: [] } : {}),
            ...(which !== 'steps' ? { dishes: [] } : {}),
          },
          target: {},
        }),
      );
    case 'too_many_dishes':
      return arbShaped(
        fc.integer({ min: 13, max: 20 }),
        (d) => fc.integer({ min: d, max: 80 }),
        ALL_APPLIANCES,
      ).map((input) => ({ input, target: {} }));
    case 'too_many_steps':
      return arbShaped(
        fc.integer({ min: 1, max: 12 }),
        () => fc.integer({ min: 81, max: 120 }),
        ALL_APPLIANCES,
      ).map((input) => ({ input, target: {} }));
    case 'minutes_out_of_range':
      return onBase(
        () => fc.tuple(stepPick, arbBadMinutes),
        (plan, [pick, bad]) => {
          const step = nth(plan.steps, pick) as Step & Json;
          if (bad === undefined) delete (step as Json).minutes;
          else (step as Json).minutes = bad;
          return { input: plan, target: { stepId: step.id } };
        },
      );
    case 'invalid_field':
      return onBase(
        () => fc.tuple(stepPick, fc.nat(), fc.constantFrom(...INVALID_VARIANTS), fc.nat()),
        invalidField,
      );
    case 'unknown_dependency':
      return onBase(
        (base) => fc.tuple(stepPick, arbFreshStepId(base)),
        (plan, [pick, ref]) => {
          const step = nth(plan.steps, pick);
          step.after.push(ref);
          return { input: plan, target: { stepId: step.id } };
        },
      );
    case 'self_dependency':
      return onBase(
        () => stepPick,
        (plan, pick) => {
          const step = nth(plan.steps, pick);
          step.after.push(step.id);
          return { input: plan, target: { stepId: step.id } };
        },
      );
    case 'cycle':
      return onBase(
        (base) =>
          fc.tuple(fc.nat({ max: base.steps.length - 1 }), fc.nat({ max: base.steps.length - 2 })),
        (plan, [x, y]) => {
          const first = plan.steps[x] as Step; // x is in range
          const second = plan.steps[y >= x ? y + 1 : y] as Step; // a different step
          const addAfter = (s: Step, id: string): void => {
            if (!s.after.includes(id)) s.after.push(id);
          };
          addAfter(first, second.id);
          // If `second` already waits on `first`, that one edge closes the cycle; otherwise
          // add the other way too.
          if (!ancestorsOf(plan, second.id).has(first.id)) addAfter(second, first.id);
          return { input: plan, target: {} };
        },
        arbDefaultSizes(2, ALL_APPLIANCES),
      );
    case 'duplicate_step_id':
      return onBase(
        (base) =>
          fc.tuple(
            stepPick,
            fc.option(arbNonBlank(120), { nil: undefined }),
            fc.option(arbMinutes, { nil: undefined }),
            fc.nat({ max: base.steps.length }),
          ),
        (plan, [pick, title, minutes, at]) => {
          const original = nth(plan.steps, pick);
          const copy: Step = { ...original, after: [...original.after] };
          if (title !== undefined) copy.title = title;
          if (minutes !== undefined) copy.minutes = minutes;
          plan.steps.splice(at, 0, copy);
          return { input: plan, target: { stepId: original.id } };
        },
      );
    case 'duplicate_dish_id':
      return onBase(
        (base) => fc.tuple(fc.nat(), arbNonBlank(80), fc.nat({ max: base.dishes.length })),
        (plan, [pick, name, at]) => {
          const original = nth(plan.dishes, pick);
          plan.dishes.splice(at, 0, { id: original.id, name });
          return { input: plan, target: { dishId: original.id } };
        },
      );
    case 'unknown_dish':
      return onBase(
        (base) => fc.tuple(arbFreshDishId(base), stepPick, arbSlug, arbNonBlank(120), arbMinutes),
        (plan, [missing, pick, slug, title, minutes]) => {
          const crowded = plan.steps.filter(
            (s) => plan.steps.filter((t) => t.dish === s.dish).length >= 2,
          );
          if (crowded.length > 0) {
            const step = nth(crowded, pick);
            step.dish = missing; // its old dish keeps at least one other step
            return { input: plan, target: { stepId: step.id } };
          }
          const id = `${missing}.${slug}`;
          plan.steps.push({
            id,
            dish: missing,
            title,
            minutes,
            appliance: 'none',
            handsOn: true,
            after: [],
            holdMin: null,
          });
          return { input: plan, target: { stepId: id } };
        },
      );
    case 'dish_without_steps':
      return onBase(
        (base) =>
          fc.tuple(arbFreshDishId(base), arbNonBlank(80), fc.nat({ max: base.dishes.length })),
        (plan, [id, name, at]) => {
          plan.dishes.splice(at, 0, { id, name });
          return { input: plan, target: { dishId: id } };
        },
      );
  }
}

/** Cases that break exactly one rule; see the table in the recipe-graph design. */
export function arbBrokenPlan(rule: ErrorCode): fc.Arbitrary<BrokenCase> {
  if (rule === 'missing_appliance') {
    return arbPlanAndKitchen()
      .filter(({ plan }) => plan.steps.some((s) => s.appliance !== 'none'))
      .chain(({ plan, kitchen: complete }) =>
        fc.nat().map((pick): BrokenCase => {
          const step = nth(
            plan.steps.filter((s) => s.appliance !== 'none'),
            pick,
          );
          const kitchen: Kitchen =
            step.appliance === 'burner' ? { ...complete, burners: 0 } : { ...complete, ovens: 0 };
          return { rule, input: structuredClone(plan), kitchen, target: { stepId: step.id } };
        }),
      );
  }
  return fc
    .tuple(arbEquippedKitchen, brokenFor(rule))
    .map(([kitchen, { input, target }]): BrokenCase => ({ rule, input, kitchen, target }));
}

// ---------------------------------------------------------------------------------------
// Rebuild generators (rebuild spec): a schedule, the minute it is now, and what the cook did.

/** A schedule `rebuild` accepts: a `schedule` output or a rebuilt one. */
export type AnySchedule = Schedule | RebuiltSchedule;

/** What the cook did and when: progress per step, and `now` on the axis. */
export interface Run {
  progress: Progress;
  now: number;
}

export interface RunOpts {
  /** Some steps are started before their prerequisites are done. */
  outOfOrder?: boolean;
  /** Resources are not checked: two steps may run on one unit. */
  overCapacity?: boolean;
  /** A rebuild that already happened: its facts stay, the cook goes on from there. */
  base?: Run;
}

/** A valid plan and kitchen run through `schedule`; an error is a bug and throws. */
export function arbScheduled(opts: Omit<PlanOpts, 'appliances'> = {}): fc.Arbitrary<Schedule> {
  return arbPlanAndKitchen(opts).map(({ plan, kitchen }) => {
    const result = schedule(plan, kitchen);
    if (!result.ok) throw new Error(`arbScheduled: ${JSON.stringify(result.error)}`);
    return result.value;
  });
}

const REBUILD_MAX_MIN = 1440;
const servingOf = (s: AnySchedule): number => ('servingMin' in s ? s.servingMin : 0);
const clampMinute = (minute: number): number =>
  Math.min(REBUILD_MAX_MIN, Math.max(AXIS_MIN, minute));

/** `[earliest start - 10, serving + 30]`, a third of the draws on a start or an end of a step. */
export function arbNow(s: AnySchedule): fc.Arbitrary<number> {
  const low = clampMinute(Math.min(...s.steps.map((x) => x.startMin)) - 10);
  const high = clampMinute(servingOf(s) + 30);
  const edges = s.steps.flatMap((x) => [x.startMin, x.endMin]);
  return fc.oneof(
    { weight: 2, arbitrary: fc.integer({ min: low, max: high }) },
    { weight: 1, arbitrary: fc.constantFrom(...edges).map(clampMinute) },
  );
}

/** What one step does in a run, drawn up front. */
interface RunDraw {
  /** Minutes later (or earlier, if negative) than planned that the cook gets to it. */
  startShift: number;
  /** Minutes longer (or shorter) than `minutes` it really takes. */
  durDelta: number;
  /** The extra minutes the cook has tapped if the step is still running. */
  taps: number;
  /** The cook starts it without waiting for its prerequisites (only with `outOfOrder`). */
  ignoresAfter: boolean;
  /** For a step running in `base`: how much earlier (or later) than expected it really ends. */
  endShift: number;
}

const TAP_CHOICES: readonly number[] = [0, 0, 0, 5, 10, 15, 20, 30];

const arbRunDraw = (outOfOrder: boolean): fc.Arbitrary<RunDraw> =>
  fc.record({
    startShift: fc.integer({ min: -10, max: 15 }),
    durDelta: fc.integer({ min: -5, max: 20 }),
    taps: fc.constantFrom(...TAP_CHOICES),
    ignoresAfter: outOfOrder
      ? fc.integer({ min: 0, max: 4 }).map((n) => n === 0)
      : fc.constant(false),
    endShift: fc.integer({ min: -15, max: 30 }),
  });

interface Actual {
  startMin: number;
  endMin: number;
}

/**
 * Plays the meal: base facts are placed first, then the other steps one at a time, the ready
 * step with the smallest `(planned start + shift, id)` first, each at the first minute from
 * which its resources are free for its real duration (every minute counts as free with
 * `overCapacity`). Returns the real interval of every step.
 */
function playRun(s: AnySchedule, draws: readonly RunDraw[], opts: RunOpts): Map<string, Actual> {
  const steps = [...s.plan.steps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const drawOf = new Map<string, RunDraw>(steps.map((x, i) => [x.id, draws[i] as RunDraw]));
  const kitchenOf: Record<'burner' | 'oven' | 'cook', number> = {
    burner: s.kitchen.burners,
    oven: s.kitchen.ovens,
    cook: s.kitchen.cooks,
  };
  const used = new Map<string, number>();
  const placed = new Map<string, Actual>();
  const resourcesOfStep = (step: Step): ('burner' | 'oven' | 'cook')[] => {
    const out: ('burner' | 'oven' | 'cook')[] = [];
    if (step.appliance !== 'none') out.push(step.appliance);
    if (step.handsOn) out.push('cook');
    return out;
  };
  const place = (step: Step, startMin: number, endMin: number): void => {
    placed.set(step.id, { startMin, endMin });
    for (const r of resourcesOfStep(step)) {
      for (let minute = startMin; minute < endMin; minute++) {
        used.set(`${r}:${minute}`, (used.get(`${r}:${minute}`) ?? 0) + 1);
      }
    }
  };
  const plannedStart = (id: string): number => s.steps.find((x) => x.id === id)?.startMin ?? 0;
  const floorMin = opts.base === undefined ? AXIS_MIN : opts.base.now;

  // Facts of an earlier rebuild stay.
  for (const step of steps) {
    const fact = opts.base?.progress[step.id];
    const draw = drawOf.get(step.id);
    if (fact === undefined || draw === undefined || opts.base === undefined) continue;
    if (fact.state === 'done') {
      place(step, fact.startMin, fact.endMin);
    } else {
      const expected = Math.max(fact.startMin + step.minutes + fact.extraMin, opts.base.now);
      place(step, fact.startMin, Math.max(opts.base.now, expected + draw.endShift));
    }
  }

  const todo = steps.filter((x) => !placed.has(x.id));
  while (todo.length > 0) {
    let pick: Step | undefined;
    let pickDesired = 0;
    for (const step of todo) {
      const draw = drawOf.get(step.id) as RunDraw;
      if (!draw.ignoresAfter && !step.after.every((p) => placed.has(p))) continue;
      const desired = Math.max(floorMin, plannedStart(step.id) + draw.startShift);
      if (
        pick === undefined ||
        desired < pickDesired ||
        (desired === pickDesired && step.id < pick.id)
      ) {
        pick = step;
        pickDesired = desired;
      }
    }
    if (pick === undefined) throw new Error('playRun: no ready step');
    const draw = drawOf.get(pick.id) as RunDraw;
    const duration = Math.max(0, pick.minutes + draw.durDelta);
    let start = pickDesired;
    if (!draw.ignoresAfter) {
      for (const p of pick.after) start = Math.max(start, placed.get(p)?.endMin ?? start);
    }
    for (;;) {
      if (opts.overCapacity === true || duration === 0) break;
      let full: number | null = null;
      for (let minute = start; minute < start + duration && full === null; minute++) {
        for (const r of resourcesOfStep(pick)) {
          if ((used.get(`${r}:${minute}`) ?? 0) + 1 > kitchenOf[r]) full = minute;
        }
      }
      if (full === null) break;
      start = full + 1;
    }
    place(pick, start, start + duration);
    todo.splice(todo.indexOf(pick), 1);
  }
  return placed;
}

/**
 * The cook's run as progress at `now`: a step that has not started is absent, one that ended
 * is done at its real times, one under way is running with the minutes the cook tapped.
 */
function cutRun(
  s: AnySchedule,
  actual: ReadonlyMap<string, Actual>,
  draws: readonly RunDraw[],
  now: number,
  base: Run | undefined,
): Progress {
  const steps = [...s.plan.steps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const progress: Progress = {};
  steps.forEach((step, i) => {
    const real = actual.get(step.id);
    const draw = draws[i] as RunDraw;
    if (real === undefined || real.startMin > now) return;
    if (real.endMin <= now) {
      progress[step.id] = { state: 'done', startMin: real.startMin, endMin: real.endMin };
      return;
    }
    const before = base?.progress[step.id];
    const alreadyTapped = before?.state === 'running' ? before.extraMin : 0;
    progress[step.id] = {
      state: 'running',
      startMin: real.startMin,
      extraMin: Math.min(1440, alreadyTapped + draw.taps),
    };
  });
  return progress;
}

/**
 * Plays a meal on `s` and cuts it at a `now`: early and late starts, steps that take longer
 * or shorter, running steps with or without tapped minutes. A run respects precedence and
 * capacity unless `outOfOrder` or `overCapacity` say otherwise; with `base` the facts of an
 * earlier rebuild stay and the meal goes on from its `now`.
 */
export function arbProgress(s: AnySchedule, opts: RunOpts = {}): fc.Arbitrary<Run> {
  const n = s.plan.steps.length;
  const arbDraws = fc.array(arbRunDraw(opts.outOfOrder === true), { minLength: n, maxLength: n });
  const arbNowDraw =
    opts.base === undefined
      ? fc.tuple(fc.integer({ min: 0, max: 7 }), arbNow(s))
      : fc.tuple(fc.constant(0), fc.integer({ min: 0, max: 90 }));
  return fc.tuple(arbDraws, arbNowDraw).map(([draws, [pickNow, drawn]]): Run => {
    const actual = playRun(s, draws, opts);
    let now: number;
    if (opts.base !== undefined) {
      now = Math.min(REBUILD_MAX_MIN, opts.base.now + drawn);
    } else if (pickNow === 6) {
      now = clampMinute(Math.max(...[...actual.values()].map((x) => x.endMin)));
    } else if (pickNow === 7) {
      now = clampMinute(Math.min(...s.steps.map((x) => x.startMin)) - 1);
    } else {
      now = drawn;
    }
    return { progress: cutRun(s, actual, draws, now, opts.base), now };
  });
}

/**
 * The cook goes on exactly as `s` says up to `now`, on top of what `base` already knows: a
 * pending step planned to start before `now` is done at its planned interval if that ends by
 * `now`, else running with no extra minutes; a running step whose interval in `s` ends by
 * `now` is done at it; everything else is kept.
 */
export function followPlan(s: AnySchedule, base: Progress, now: number): Progress {
  const progress: Progress = { ...base };
  for (const step of s.steps) {
    const known: ProgressEntry | undefined = base[step.id];
    if (known?.state === 'done') continue;
    if (known === undefined && step.startMin >= now) continue;
    if (step.endMin <= now) {
      progress[step.id] = { state: 'done', startMin: step.startMin, endMin: step.endMin };
    } else if (known === undefined) {
      progress[step.id] = { state: 'running', startMin: step.startMin, extraMin: 0 };
    }
  }
  return progress;
}

/** A cook who follows the schedule exactly up to some `now` (the premise of R4). */
export function arbOnPlan(s: Schedule): fc.Arbitrary<Run> {
  return arbNow(s).map((now): Run => ({ progress: followPlan(s, {}, now), now }));
}

// ---------------------------------------------------------------------------------------
// Dinnerfile generators (dinnerfile spec).

/**
 * 1 to 12 hostile tokens joined, cut to at most `max` code points, with a non-white-space
 * character. The tokens are the design's alphabet: shell and Make metacharacters, line breaks,
 * control, bidirectional and lone-surrogate code points, accents and emoji.
 */
export function arbHostileText(max: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...HOSTILE_TOKENS), { minLength: 1, maxLength: 12 })
    .map((tokens) => [...tokens.join('')].slice(0, max).join(''))
    .filter((text) => /\S/.test(text));
}

/** A serving time `HH:MM`, hour 0..23 and minute 0..59, zero-padded. */
export function arbServeTime(): fc.Arbitrary<string> {
  return fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

/** Options with a valid kitchen and serving time; each key present or absent, never `undefined`. */
export function arbDinnerfileOptions(): fc.Arbitrary<DinnerfileOptions> {
  return fc.record({ kitchen: arbKitchen(), serve: arbServeTime() }, { requiredKeys: [] });
}

const arbBadKitchen: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ burners: fc.constant(-1), ovens: fc.constant(1), cooks: fc.constant(1) }),
  fc.record({ burners: fc.constant(2), ovens: fc.constant(9), cooks: fc.constant(1) }),
  fc.record({ burners: fc.constant(9), ovens: fc.constant(1), cooks: fc.constant(2) }),
  fc.record({ burners: fc.constant(2), ovens: fc.constant(1), cooks: fc.constant(1.5) }),
  fc.record({ burners: fc.constant(2), ovens: fc.constant(1), cooks: fc.constant(0) }),
  fc.record({ burners: fc.constant('2'), ovens: fc.constant(1), cooks: fc.constant(1) }),
  fc.constantFrom('4 burners', '', 'kitchen'),
);

const arbBadServe: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom('24:00', '7:00', '19:60', '19:00\n.PHONY: x', ''),
  fc.string().filter((value) => !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)),
);

/**
 * Like `arbDinnerfileOptions`, but each present value is, half the time, one that fails its
 * schema (typed by a cast here and nowhere else).
 */
export function arbAnyDinnerfileOptions(): fc.Arbitrary<DinnerfileOptions> {
  return fc
    .record(
      {
        kitchen: fc.oneof(arbKitchen() as fc.Arbitrary<unknown>, arbBadKitchen),
        serve: fc.oneof(arbServeTime() as fc.Arbitrary<unknown>, arbBadServe),
      },
      { requiredKeys: [] },
    )
    .map((options) => options as unknown as DinnerfileOptions);
}

const COMMENT_POOL: readonly string[] = [
  '#',
  '# note',
  '#   Plan "x"',
  '# steps below',
  '# plan2',
  '#stepping',
];
const STEP_KEYS: readonly string[] = [
  'dish',
  'minutes',
  'appliance',
  'handsOn',
  'hold',
  'title',
  'detail',
];
const KITCHEN_KEYS: readonly string[] = ['burners', 'ovens', 'cooks'];

/**
 * A way of writing the same plan that the import must read the same (R6.6): line endings, BOM,
 * header, `.PHONY` forms, missing dish and dinner rules, other recipe lines, white space,
 * blank lines, unknown comments, key and block orders, escapes, a repeated prerequisite. The
 * rates of blank lines and comments grow with the size of the plan, up to every sixth line.
 */
export function arbDinnerfileStyle(plan: Plan): fc.Arbitrary<DinnerfileStyle> {
  const maxEvery = Math.min(6, 2 + plan.steps.length);
  const order = fc.constantFrom<DinnerfileStyle['stepOrder'][]>('canonical', 'reversed', 'rotated');
  return fc.record({
    eol: fc.constantFrom<DinnerfileStyle['eol'][]>('lf', 'crlf'),
    bom: fc.boolean(),
    header: fc.boolean(),
    phony: fc.constantFrom<DinnerfileStyle['phony'][]>('one', 'none', 'per-rule'),
    dinnerRule: fc.boolean(),
    dishRules: fc.boolean(),
    recipes: fc.constantFrom<DinnerfileStyle['recipes'][]>('echo', 'none', 'true', 'fail'),
    lineEndSpace: fc.constantFrom('', ' ', '\t', '  \t'),
    blankEvery: fc.integer({ min: 0, max: maxEvery }),
    comments: fc.shuffledSubarray([...COMMENT_POOL]),
    commentEvery: fc.integer({ min: 0, max: maxEvery }),
    indent: fc.constantFrom('', ' ', '   '),
    ruleNote: fc.boolean(),
    stepKeys: arbPermutation(STEP_KEYS),
    kitchenKeys: arbPermutation(KITCHEN_KEYS),
    separator: fc.constantFrom(' ', '  ', '\t', ' \t ', '\t\t'),
    spaceAfterColon: fc.boolean(),
    stepOrder: order,
    dishOrder: order,
    optionOrder: fc.constantFrom<DinnerfileStyle['optionOrder'][]>('canonical', 'reversed'),
    metadataAtBottom: fc.boolean(),
    escapes: fc.boolean(),
    repeatPrerequisite: fc.boolean(),
  });
}

/** Valid and broken metadata, rule and recipe lines, to be joined into Dinnerfile-like text. */
const LIKE_LINES: readonly string[] = [
  '# plan "Sunday roast"',
  '# plan Sunday',
  '# plan "unterminated',
  '# dish a "A"',
  '# dish A "A"',
  '# dish a',
  '# dish a "A" extra',
  '# step dish=a minutes=5 appliance=none handsOn=true hold=keeps title="Do it"',
  '# step dish=a minutes=1.5 appliance=none handsOn=true hold=keeps title="Do it"',
  '# step dish=a minutes=abc appliance=oven handsOn=yes hold=keep title="Do it"',
  '# step dish=a minutes=5 minutes=6 title="Do it" extra=1',
  '# step dish=a title="unterminated',
  '# step dish=a title="bad \\q escape"',
  '# step title="\\ud800" detail="\\u00e9"',
  '#step dish=a',
  '#stepping',
  '# Step dish=a',
  '# kitchen burners=4 ovens=1 cooks=1',
  '# kitchen burners=-1 ovens=1',
  '# serve 19:00',
  '# serve 25:00',
  '# serve',
  '# a comment',
  ' # indented comment',
  '#',
  'a.x:',
  'a.x: b.y',
  'a.x: b.y c.z # note',
  'a.x:b.y',
  'a.x : b.y',
  'a.x b.y:',
  'a.x:: b.y',
  'a: a.x',
  'dinner: a.x',
  '.PHONY: dinner a a.x',
  '.PHONY:',
  'A.X: B.Y',
  '-.-:',
  'export: export.x',
  '$(X): y',
  '%.o: %.c',
  'a.x: $(Y)',
  'a.x: b.y \\',
  'X = 1',
  'include other',
  'ifeq (a,b)',
  "\t@echo 'hi' # a.x",
  '\t# step dish=x minutes=1',
  '\t@touch canary',
  '   ',
  '',
  ':',
  ': x',
];

const arbLikeLines: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.constantFrom(...LIKE_LINES), { minLength: 0, maxLength: 40 }),
    fc.constantFrom('\n', '\r\n', '\r'),
  )
  .map(([lines, eol]) => lines.join(eol));

interface Mutation {
  kind: 'insert' | 'delete' | 'swap';
  where: 'start' | 'end' | 'anywhere';
  a: number;
  b: number;
  ch: string;
}

const arbMutation: fc.Arbitrary<Mutation> = fc.record({
  kind: fc.constantFrom<Mutation['kind'][]>('insert', 'delete', 'swap'),
  where: fc.constantFrom<Mutation['where'][]>('start', 'end', 'anywhere', 'anywhere'),
  a: fc.nat(),
  b: fc.nat(),
  ch: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
});

function mutate(text: string, m: Mutation): string {
  if (m.kind === 'swap') {
    const lines = text.split('\n');
    if (lines.length < 2) return text;
    const i = m.a % lines.length;
    const j = m.b % lines.length;
    const copy = [...lines];
    copy[i] = lines[j] ?? '';
    copy[j] = lines[i] ?? '';
    return copy.join('\n');
  }
  const at = m.where === 'start' ? 0 : m.where === 'end' ? text.length : m.a % (text.length + 1);
  if (m.kind === 'insert') return text.slice(0, at) + m.ch + text.slice(at);
  const from = m.where === 'end' ? Math.max(0, text.length - 1) : Math.min(at, text.length);
  return text.slice(0, from) + text.slice(from + 1);
}

const arbMutatedExport: fc.Arbitrary<string> = arbPlan()
  .chain((plan) =>
    fc.tuple(
      fc.constant(plan),
      arbDinnerfileOptions(),
      fc.array(arbMutation, { minLength: 1, maxLength: 3 }),
    ),
  )
  .map(([plan, options, mutations]) => mutations.reduce(mutate, oracleDinnerfile(plan, options)));

/**
 * Text for the totality property of import: arbitrary binary strings, lines from a vocabulary
 * of valid and broken Dinnerfile lines joined by LF, CRLF or CR, and an export with one to
 * three random insertions, deletions or line swaps.
 */
export function arbDinnerfileLikeText(): fc.Arbitrary<string> {
  return fc.oneof(
    { weight: 2, arbitrary: fc.string({ unit: 'binary' }) },
    { weight: 3, arbitrary: arbLikeLines },
    { weight: 3, arbitrary: arbMutatedExport },
  );
}

export interface BreakingCase {
  /** The canonical export with exactly one meaning-changing edit. */
  text: string;
  /** The one error import must report, and where (computed on the edited text). */
  code: DinnerfileErrorCode;
  line: number | null;
  /** The row of the design's edit table, for the coverage check. */
  edit: string;
}

interface EditResult {
  lines: string[];
  /** 0-based index in `lines` of the line the error is on, or null. */
  at: number | null;
  code: DinnerfileErrorCode;
  edit: string;
}

const BAD_MINUTES: readonly string[] = ['1.5', '-3', '007', '', 'abc', '1e3', '1234567'];
const UNSUPPORTED_LINES: readonly string[] = ['X = 1', 'include other', 'a.x : b.y', 'a.x b.y:'];

/**
 * The canonical export of `plan` with exactly one meaning-changing edit from the design's
 * table, and the one error import must report. Edits that need a shape the plan lacks (a dish
 * with a non-last step, a non-terminal step, a step with a free id to add) are not drawn.
 * Note: `duplicate-rule` copies the step's `# step` line along with the rule (a rule alone
 * would also be a `target_without_step`, and the property says exactly one error).
 */
export function arbBreakingEdit(plan: Plan): fc.Arbitrary<BreakingCase> {
  const base = oracleDinnerfile(plan, {}).split('\n');
  const ids = plan.steps.map((st) => st.id);
  const ruleIdxOf = (id: string): number => base.findIndex((l) => l.startsWith(`${id}:`));
  const afterOf = (id: string): readonly string[] =>
    plan.steps.find((st) => st.id === id)?.after ?? [];
  const freeIds = (id: string): string[] =>
    ids.filter((other) => other !== id && !afterOf(id).includes(other));
  const lastSteps = oracleDishLastSteps(plan);
  const nonLastOf = (dishId: string): string[] =>
    plan.steps
      .filter((st) => st.dish === dishId && !(lastSteps[dishId] ?? []).includes(st.id))
      .map((st) => st.id);
  const dishesWithNonLast = Object.keys(lastSteps).filter(
    (d) => d !== 'dinner' && nonLastOf(d).length > 0,
  );
  const used = new Set(plan.steps.flatMap((st) => st.after));
  const nonTerminal = ids.filter((id) => used.has(id));
  const pick = <T>(items: readonly T[], n: number): T => items[n % items.length] as T;
  // `as T` above is sound: every call site passes a non-empty list (the edit is drawn only then).

  const edits: [string, (n: number, m: number) => EditResult][] = [
    [
      'remove-step-line',
      (n) => {
        const r = ruleIdxOf(pick(ids, n));
        const lines = base.filter((_, i) => i !== r - 1);
        return { lines, at: r - 1, code: 'target_without_step', edit: 'remove-step-line' };
      },
    ],
    [
      'remove-rule-line',
      (n) => {
        const r = ruleIdxOf(pick(ids, n));
        const lines = base.filter((_, i) => i !== r);
        return { lines, at: r - 1, code: 'step_without_target', edit: 'remove-rule-line' };
      },
    ],
    [
      'unknown-key',
      (n) => {
        const r = ruleIdxOf(pick(ids, n)) - 1;
        const lines = base.map((l, i) => (i === r ? `${l} extra=1` : l));
        return { lines, at: r, code: 'unknown_key', edit: 'unknown-key' };
      },
    ],
    [
      'bad-minutes',
      (n, m) => {
        const r = ruleIdxOf(pick(ids, n)) - 1;
        const bad = pick(BAD_MINUTES, m);
        const lines = base.map((l, i) =>
          i === r ? l.replace(/ minutes=\d+/, ` minutes=${bad}`) : l,
        );
        return { lines, at: r, code: 'bad_value', edit: 'bad-minutes' };
      },
    ],
    [
      'bad-handsOn',
      (n) => {
        const r = ruleIdxOf(pick(ids, n)) - 1;
        const lines = base.map((l, i) =>
          i === r ? l.replace(/ handsOn=(?:true|false)/, ' handsOn=yes') : l,
        );
        return { lines, at: r, code: 'bad_value', edit: 'bad-handsOn' };
      },
    ],
    [
      'bad-hold',
      (n) => {
        const r = ruleIdxOf(pick(ids, n)) - 1;
        const lines = base.map((l, i) =>
          i === r ? l.replace(/ hold=(?:\d+|keeps)/, ' hold=keep') : l,
        );
        return { lines, at: r, code: 'bad_value', edit: 'bad-hold' };
      },
    ],
    [
      'remove-minutes',
      (n) => {
        const r = ruleIdxOf(pick(ids, n)) - 1;
        const lines = base.map((l, i) => (i === r ? l.replace(/ minutes=\d+/, '') : l));
        return { lines, at: r, code: 'missing_key', edit: 'remove-minutes' };
      },
    ],
    [
      'repeat-plan',
      () => {
        const planIdx = base.findIndex((l) => l.startsWith('# plan '));
        let lastDish = -1;
        base.forEach((l, i) => {
          if (l.startsWith('# dish ')) lastDish = i;
        });
        const lines = [...base];
        lines.splice(lastDish + 1, 0, base[planIdx] ?? '');
        return { lines, at: lastDish + 1, code: 'duplicate_metadata', edit: 'repeat-plan' };
      },
    ],
    [
      'remove-plan',
      () => {
        const lines = base.filter((l) => !l.startsWith('# plan '));
        return { lines, at: null, code: 'missing_plan', edit: 'remove-plan' };
      },
    ],
    [
      'line-continuation',
      (n) => {
        const r = n % (base.length - 1); // not the empty piece after the final LF
        const lines = base.map((l, i) => (i === r ? `${l} \\` : l));
        return { lines, at: r, code: 'line_continuation', edit: 'line-continuation' };
      },
    ],
    [
      'unsupported-line',
      (n, m) => {
        const r = ruleIdxOf(pick(ids, n)) - 1;
        const lines = [...base];
        lines.splice(r, 0, pick(UNSUPPORTED_LINES, m));
        return { lines, at: r, code: 'unsupported_line', edit: 'unsupported-line' };
      },
    ],
    [
      'recipe-before-rule',
      () => {
        const phony = base.findIndex((l) => l.startsWith('.PHONY:'));
        const lines = [...base];
        lines.splice(phony, 0, '\t@true');
        return { lines, at: phony, code: 'recipe_before_rule', edit: 'recipe-before-rule' };
      },
    ],
  ];
  const withExtra = ids.filter((id) => freeIds(id).length > 0);
  if (withExtra.length > 0) {
    edits.push([
      'duplicate-rule',
      (n, m) => {
        const id = pick(withExtra, n);
        const r = ruleIdxOf(id);
        const copy = [
          '',
          base[r - 1] ?? '',
          `${base[r] ?? ''} ${pick(freeIds(id), m)}`,
          base[r + 1] ?? '',
        ];
        const lines = [...base.slice(0, -1), ...copy, ''];
        return {
          lines,
          at: lines.length - 3,
          code: 'duplicate_target',
          edit: 'duplicate-rule',
        };
      },
    ]);
  }
  if (dishesWithNonLast.length > 0) {
    edits.push([
      'dish-rule-extra',
      (n, m) => {
        const dishId = pick(dishesWithNonLast, n);
        const r = base.findIndex((l) => l.startsWith(`${dishId}:`));
        const lines = base.map((l, i) => (i === r ? `${l} ${pick(nonLastOf(dishId), m)}` : l));
        return { lines, at: r, code: 'dish_target_mismatch', edit: 'dish-rule-extra' };
      },
    ]);
  }
  if (nonTerminal.length > 0) {
    edits.push([
      'dinner-rule-extra',
      (n) => {
        const r = base.findIndex((l) => l.startsWith('dinner:'));
        const lines = base.map((l, i) => (i === r ? `${l} ${pick(nonTerminal, n)}` : l));
        return { lines, at: r, code: 'dinner_mismatch', edit: 'dinner-rule-extra' };
      },
    ]);
  }
  return fc
    .tuple(fc.constantFrom(...edits), fc.nat(), fc.nat())
    .map(([[, make], n, m]): BreakingCase => {
      const { lines, at, code, edit } = make(n, m);
      return { text: lines.join('\n'), code, line: at === null ? null : at + 1, edit };
    });
}

// ---------------------------------------------------------------------------------------
// recipe-reader (limits, client keys, prompt, recorded match)

const SECOND_MS = 1_000;
const DAY_MS = 86_400_000;

export interface LimiterRun {
  limit: number;
  windowSec: number;
  maxClients: number;
  startMs: number;
  events: Array<{ dtMs: number; client: string }>;
}

/** Calls to the rate limiter: time never goes back, and the edges of the window are hit. */
export function arbLimiterRun(): fc.Arbitrary<LimiterRun> {
  return fc
    .record({
      limit: fc.integer({ min: 1, max: 6 }),
      windowSec: fc.integer({ min: 1, max: 1200 }),
      maxClients: fc.oneof(fc.constant(10_000), fc.integer({ min: 1, max: 4 })),
      startMs: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    })
    .chain((base) => {
      const windowMs = base.windowSec * SECOND_MS;
      const dtMs = fc.oneof(
        fc.constant(0),
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 1000, max: 2 * windowMs }),
        fc.constantFrom(windowMs - 1, windowMs, windowMs + 1),
      );
      const event = fc.record({ dtMs, client: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f') });
      return fc.array(event, { maxLength: 120 }).map((events) => ({ ...base, events }));
    });
}

export interface CapRun {
  cap: number;
  startMs: number;
  events: Array<{ dtMs: number }>;
}

/** Calls to the daily cap: anywhere in 2020 to 2035, or within 5 s before a UTC midnight. */
export function arbCapRun(): fc.Arbitrary<CapRun> {
  const start = fc.oneof(
    fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 11, 31) }),
    fc
      .tuple(
        fc.integer({ min: Date.UTC(2020, 0, 1) / DAY_MS, max: Date.UTC(2035, 11, 31) / DAY_MS }),
        fc.integer({ min: 0, max: 5_000 }),
      )
      .map(([day, before]) => (Math.floor(day) + 1) * DAY_MS - before),
  );
  const dtMs = fc.oneof(
    fc.constant(0),
    fc.integer({ min: 1, max: 60_000 }),
    fc.constantFrom(DAY_MS - 1, DAY_MS, DAY_MS + 1),
    fc.integer({ min: 1, max: 3 * DAY_MS }),
  );
  return fc.record({
    cap: fc.integer({ min: 1, max: 10 }),
    startMs: start,
    events: fc.array(fc.record({ dtMs }), { maxLength: 150 }),
  });
}

const hex4 = (value: number, upper: boolean, pad: boolean): string => {
  const text = value.toString(16);
  const cased = upper ? text.toUpperCase() : text;
  return pad ? cased.padStart(4, '0') : cased;
};

/** IPv4, full and compressed IPv6, IPv4-mapped IPv6 in either case; IPv6 with or without a zone. */
export function arbIpAddress(): fc.Arbitrary<string> {
  const octet = fc.integer({ min: 0, max: 255 });
  const ipv4 = fc.tuple(octet, octet, octet, octet).map((o) => o.join('.'));
  const hextet = fc.integer({ min: 0, max: 0xffff });
  const style = fc.record({ upper: fc.boolean(), pad: fc.boolean() });
  const zone = fc.constantFrom('', '', '%eth0', '%1');
  const full = fc
    .tuple(fc.array(hextet, { minLength: 8, maxLength: 8 }), style, zone)
    .map(([parts, s, z]) => parts.map((p) => hex4(p, s.upper, s.pad)).join(':') + z);
  const compressed = fc
    .tuple(
      fc.array(fc.integer({ min: 1, max: 0xffff }), { maxLength: 4 }),
      fc.array(fc.integer({ min: 1, max: 0xffff }), { maxLength: 3 }),
      style,
      zone,
    )
    .map(([head, tail, s, z]) => {
      const h = head.map((p) => hex4(p, s.upper, s.pad)).join(':');
      const t = tail.map((p) => hex4(p, s.upper, s.pad)).join(':');
      return `${h}::${t}${z}`;
    });
  const mapped = fc
    .tuple(ipv4, fc.constantFrom('::ffff:', '::FFFF:', '::Ffff:'))
    .map(([v4, prefix]) => prefix + v4);
  return fc.oneof(
    { weight: 3, arbitrary: ipv4 },
    { weight: 2, arbitrary: full },
    { weight: 2, arbitrary: compressed },
    { weight: 1, arbitrary: mapped },
  );
}

/** An `X-Forwarded-For` header (or none) and a TCP peer (or none). */
export function arbForwardedFor(): fc.Arbitrary<{
  header: string | undefined;
  peer: string | undefined;
}> {
  const withPort = (ip: string, port: number, bracket: boolean): string => {
    const isV6 = ip.includes(':');
    if (isV6) return bracket ? `[${ip}]:${port}` : `[${ip}]`;
    return bracket ? `${ip}:${port}` : ip;
  };
  const entry = fc.oneof(
    { weight: 4, arbitrary: arbIpAddress() },
    {
      weight: 3,
      arbitrary: fc
        .tuple(arbIpAddress(), fc.integer({ min: 1, max: 65535 }), fc.boolean())
        .map(([ip, port, bracket]) => withPort(ip, port, bracket)),
    },
    {
      weight: 2,
      arbitrary: fc.constantFrom(
        '',
        ' ',
        'unknown',
        'garbage',
        '999.1.1.1',
        '1.2.3',
        '[::1',
        'for=1.2.3.4',
      ),
    },
    { weight: 1, arbitrary: fc.string({ maxLength: 12 }).map((s) => s.replaceAll(',', ';')) },
  );
  const header = fc.oneof(
    fc.constant(undefined),
    fc.array(entry, { minLength: 1, maxLength: 4 }).map((entries) => entries.join(', ')),
    fc.array(entry, { minLength: 1, maxLength: 4 }).map((entries) => entries.join(',')),
  );
  const peer = fc.oneof(fc.constant(undefined), arbIpAddress(), fc.constantFrom('', 'nonsense'));
  return fc.record({ header, peer });
}

const TAGS = [
  '<recipes>',
  '</recipes>',
  '< /RECIPES >',
  '<recipes >',
  '</ Recipes>',
  '<  RECIPES  >',
  '< / recipes >',
];

/** `arbRecipeText()` with recipes tags, in several spellings, inserted at random positions. */
export function arbTagInjectedText(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbRecipeText(),
      fc.array(fc.tuple(fc.constantFrom(...TAGS), fc.nat(1000)), { minLength: 1, maxLength: 5 }),
    )
    .map(([text, tags]) => {
      let out = text;
      for (const [tag, pick] of tags) {
        const at = out.length === 0 ? 0 : pick % (out.length + 1);
        out = out.slice(0, at) + tag + out.slice(at);
      }
      return out;
    });
}

/**
 * Changes that `normaliseRecipeText` undoes: line endings to CRLF or CR, spaces and tabs at
 * line ends, extra blank lines where the text already has one, white space before and after,
 * NFD on some lines. `text` is already normalised.
 */
export function arbPerturbedText(text: string): fc.Arbitrary<string> {
  const lines = text.split('\n');
  const perLine = fc.array(
    fc.record({
      trailing: fc.constantFrom('', ' ', '\t', '  \t '),
      decompose: fc.boolean(),
      extraBlank: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 3 })),
      blankFill: fc.constantFrom('', ' ', '\t'),
    }),
    { minLength: lines.length, maxLength: lines.length },
  );
  return fc
    .tuple(
      perLine,
      fc.constantFrom('\r\n', '\r', '\n'),
      fc.constantFrom('', ' ', '\n', ' \t\n\n'),
      fc.constantFrom('', ' ', '\n', '\n \t'),
    )
    .map(([marks, eol, before, after]) => {
      const out: string[] = [];
      lines.forEach((line, i) => {
        const mark = marks[i];
        const shown = mark?.decompose === true ? line.normalize('NFD') : line;
        out.push(shown + (line === '' ? (mark?.blankFill ?? '') : (mark?.trailing ?? '')));
        // Only where the text already has a blank line may more blank lines be added.
        if (line === '' && mark !== undefined) {
          for (let k = 0; k < mark.extraBlank; k++) out.push(mark.blankFill);
        }
      });
      return before + out.join(eol) + after;
    });
}

// ---------------------------------------------------------------------------------------
// Cooking-mode generators (cooking-mode spec, "Test support").

/** Minute 0 of the cooking-mode properties: Wed 2026-11-11 19:30 London (19:30Z). */
const COOK_AXIS_MS = Date.UTC(2026, 10, 11, 19, 30);

export interface CookBegin {
  schedule: Schedule;
  axisMs: number;
  beginMs: number;
}

/** A schedule, the axis, and a begin time from 30 min before the first start to 30 min after. */
export function arbCookBegin(): fc.Arbitrary<CookBegin> {
  return fc
    .tuple(
      arbScheduled(),
      fc.oneof(
        { weight: 1, arbitrary: fc.constant({ minutes: 0, seconds: 0 }) },
        {
          weight: 2,
          arbitrary: fc.record({
            minutes: fc.integer({ min: -30, max: 30 }),
            seconds: fc.integer({ min: 0, max: 59 }),
          }),
        },
      ),
    )
    .map(([sched, offset]) => {
      const first = Math.min(...sched.steps.map((s) => s.startMin));
      return {
        schedule: sched,
        axisMs: COOK_AXIS_MS,
        beginMs: COOK_AXIS_MS + (first + offset.minutes) * 60_000 + offset.seconds * 1000,
      };
    });
}

export type CookIntentKind =
  'start' | 'done' | 'extra' | 'behind' | 'undo' | 'tick' | 'start-now' | 'alerts' | 'resume';

export interface CookIntent {
  advanceSec: number;
  kind: CookIntentKind;
  pick: number;
  minutes: 5 | 10 | 15;
}

/** Up to 60 intents; a quarter advance no time, so several land on one instant. */
export function arbCookIntents(): fc.Arbitrary<CookIntent[]> {
  return fc.array(
    fc.record({
      advanceSec: fc.oneof(
        { weight: 1, arbitrary: fc.constant(0) },
        { weight: 3, arbitrary: fc.integer({ min: 0, max: 1800 }) },
      ),
      kind: fc.constantFrom<CookIntentKind>(
        'start',
        'start',
        'start',
        'done',
        'done',
        'done',
        'extra',
        'behind',
        'undo',
        'tick',
        'start-now',
        'alerts',
        'resume',
      ),
      pick: fc.nat({ max: 79 }),
      minutes: fc.constantFrom<5 | 10 | 15>(5, 10, 15),
    }),
    { maxLength: 60 },
  );
}

/** What `cookActionFor` needs of a session: its schedule's step ids and its facts. */
export interface CookActionSource {
  core: {
    schedule: { steps: readonly { id: string }[] };
    facts: Readonly<Record<string, { state: 'running' | 'done' }>>;
  };
}

export type CookActionOut =
  | {
      type: 'cook/start-now' | 'cook/behind' | 'cook/undo' | 'cook/tick' | 'cook/resume';
      nowMs: number;
    }
  | { type: 'cook/start' | 'cook/done'; stepId: string; nowMs: number }
  | { type: 'cook/extra'; stepId: string; minutes: 5 | 10 | 15; nowMs: number }
  | { type: 'cook/alerts'; wanted: boolean };

/**
 * The action an intent stands for: the `pick`-th (modulo) pending id for a start, running id for
 * a done or extra, by id, from the schedule and facts. With none to pick, an id that is not in
 * the schedule, which the reducer must ignore. Never goes through `cookView`.
 */
export function cookActionFor(
  state: CookActionSource,
  nowMs: number,
  intent: CookIntent,
): CookActionOut {
  const ids = state.core.schedule.steps.map((s) => s.id).sort();
  const pending = ids.filter((id) => state.core.facts[id] === undefined);
  const running = ids.filter((id) => state.core.facts[id]?.state === 'running');
  const choose = (list: string[]): string =>
    list.length === 0 ? 'ghost.step' : (list[intent.pick % list.length] ?? 'ghost.step');
  switch (intent.kind) {
    case 'start':
      return { type: 'cook/start', stepId: choose(pending), nowMs };
    case 'done':
      return { type: 'cook/done', stepId: choose(running), nowMs };
    case 'extra':
      return { type: 'cook/extra', stepId: choose(running), minutes: intent.minutes, nowMs };
    case 'alerts':
      return { type: 'cook/alerts', wanted: intent.pick % 2 === 0 };
    case 'behind':
      return { type: 'cook/behind', nowMs };
    case 'undo':
      return { type: 'cook/undo', nowMs };
    case 'tick':
      return { type: 'cook/tick', nowMs };
    case 'start-now':
      return { type: 'cook/start-now', nowMs };
    case 'resume':
      return { type: 'cook/resume', nowMs };
  }
}
