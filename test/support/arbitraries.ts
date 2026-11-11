import fc from 'fast-check';
import { schedule } from '../../src/core/schedule.js';
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
