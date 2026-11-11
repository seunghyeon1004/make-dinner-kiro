# Design: recipe-graph

Requirements: `requirements.md` in this folder. Rules this design follows without restating
them: `tech.md` (Result, error handling, TypeScript flags), `structure.md` (layout, import
rules, id patterns, naming), `testing.md` (test kinds, generators, oracles),
`scheduler-guarantees.md` (S1, S2), `product.md` (glossary).

## Files

| file | holds |
| ---- | ----- |
| `src/core/schema.ts` | limits, id patterns, zod schemas, inferred types, issue codes, `compareIds`, `canonicalPlan` |
| `src/core/result.ts` | exists; unchanged |
| `src/core/graph.ts` | `successors`, `terminalSteps`, `topologicalOrder`, `findCycles`, `longestChainMinutes` |
| `src/core/sanity.ts` | `parsePlan`, `parseKitchen`, `checkPlan`, `checkKitchen`, `validatePlan`, `sortIssues`, `hasErrors` |
| `src/core/normalise.ts` | `normaliseRecipeText` |
| `src/core/index.ts` | re-exports everything below |
| `test/support/fixtures.ts` | `SUNDAY_ROAST`, `MEZZE`, `TIGHT_OVEN`, `HOME_KITCHEN`, `TWO_COOK_KITCHEN` |
| `test/support/arbitraries.ts` | `arbKitchen`, `arbPlan`, `arbPlanAndKitchen`, `arbBrokenPlan`, `arbShuffledPlan`, `arbPlanLikeValue`, `arbRecipeText` |
| `test/support/oracles.ts` | `oracleSuccessors`, `oracleTopologicalOrder`, `respectsPrecedence`, `isCycleIn`, `oracleStronglyConnected`, `oracleShortestCycleLength`, `oracleLongestChain`, `oracleWarnings`, `oracleNormalise` |
| `test/support/fc-params.ts` | `fcParams()`: the shared fast-check run count (decided here) |

`canonicalPlan` and `compareIds` sit in `schema.ts` and the parse functions in `sanity.ts`,
so the layout in `structure.md` gets no new file (decided here). Import direction inside
core: `sanity.ts` → `graph.ts` → `schema.ts` → zod; `result.ts` is imported by `graph.ts`
and `sanity.ts`. No cycles.

## `src/core/schema.ts`

```ts
export const LIMITS = {
  minutesMin: 1, minutesMax: 480,
  holdMin: 0, holdMax: 480,                 // decided here
  dishesMax: 12, stepsMax: 80,
  afterMax: 80,                             // decided here
  burnersMax: 8, ovensMax: 4, cooksMin: 1, cooksMax: 6,
  planTitleMax: 120, dishNameMax: 80, stepTitleMax: 120, detailMax: 1000, // decided here
  dishIdMax: 40, stepIdMax: 80,             // decided here
  handsOnWarnOverMin: 45, handsFreeWarnUnderMin: 2,
} as const;

export const DISH_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const STEP_ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** Non-blank text of 1..max Unicode code points (what zod's `max` counts; changed by hand
 * from UTF-16 code units after the first implementation session found the mismatch). */
const text = (max: number) => z.string().max(max).regex(/\S/);

export const DishIdSchema = z.string().max(LIMITS.dishIdMax).regex(DISH_ID_PATTERN);
export const StepIdSchema = z.string().max(LIMITS.stepIdMax).regex(STEP_ID_PATTERN);
export const ApplianceSchema = z.enum(['burner', 'oven', 'none']);

export const StepSchema = z.strictObject({
  id: StepIdSchema,
  dish: DishIdSchema,
  title: text(LIMITS.stepTitleMax),
  detail: text(LIMITS.detailMax).optional(),
  minutes: z.int().min(LIMITS.minutesMin).max(LIMITS.minutesMax),
  appliance: ApplianceSchema,
  handsOn: z.boolean(),
  after: z.array(StepIdSchema).max(LIMITS.afterMax),
  holdMin: z.int().min(LIMITS.holdMin).max(LIMITS.holdMax).nullable(),
});
export const DishSchema = z.strictObject({ id: DishIdSchema, name: text(LIMITS.dishNameMax) });
export const PlanSchema = z.strictObject({
  title: text(LIMITS.planTitleMax),
  dishes: z.array(DishSchema).min(1).max(LIMITS.dishesMax),
  steps: z.array(StepSchema).min(1).max(LIMITS.stepsMax),
});
export const KitchenSchema = z.strictObject({
  burners: z.int().min(0).max(LIMITS.burnersMax),
  ovens: z.int().min(0).max(LIMITS.ovensMax),
  cooks: z.int().min(LIMITS.cooksMin).max(LIMITS.cooksMax),
});

export type Appliance = z.infer<typeof ApplianceSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Dish = z.infer<typeof DishSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Kitchen = z.infer<typeof KitchenSchema>;

export const IssueSchema = z.discriminatedUnion('code', [/* one strictObject per row of the
  issue table below, each with severity: z.literal('error' | 'warning'), code: z.literal(...),
  message: z.string().min(1), stepId?/dishId? and the listed extra fields */]);
export type Issue = z.infer<typeof IssueSchema>;
export type IssueCode = Issue['code'];
export type ErrorCode = Extract<Issue, { severity: 'error' }>['code'];
export type WarningCode = Extract<Issue, { severity: 'warning' }>['code'];
export const ERROR_CODES: readonly ErrorCode[];   // in table order
export const WARNING_CODES: readonly WarningCode[];

/** Order on ids by UTF-16 code units: -1, 0 or 1. Never localeCompare. */
export function compareIds(a: string, b: string): number;

/** Dishes and steps sorted by id (stable), each after list sorted by id and deduplicated. */
export function canonicalPlan(plan: Plan): Plan;
```

Notes:

- `z.int()` rejects fractions, `NaN`, infinities and unsafe integers. zod is 4.6.7 (pinned).
- Strict objects reject unknown keys (decided here). Model output uses the schema as
  structured output and the Dinnerfile importer and share link build the object
  themselves, so an unknown key can only be a bug or a typo (`details`, `hold_min`) that a
  stripping schema would hide.
- Later specs append issue variants (the scheduler adds `hold_exceeded`) to `IssueSchema`;
  existing codes are never renamed.
- With `exactOptionalPropertyTypes`, code in this spec never writes `detail: undefined`;
  the key is absent. `canonicalPlan` drops a `detail` whose value is `undefined`.

### Issue codes

Every issue: `{ severity, code, message, stepId?, dishId?, ...extra }`. `tech.md` names
`stepId?`; `dishId?` and the per-code extra fields are added here (decided here). Messages
use only ids, numbers, field paths and fixed words (R7.2). Ids in issues always match their
pattern, because every id put into an issue has passed `StepIdSchema` or `DishIdSchema`.

| code | sev | extra fields | fires when (source) | example message |
| ---- | --- | ------------ | ------------------- | --------------- |
| `invalid_field` | error | `field: string`; `stepId?`, `dishId?` | any schema failure not covered by the four codes below (`parsePlan`, `parseKitchen`) | `Step chicken.roast: the appliance must be burner, oven or none.` |
| `minutes_out_of_range` | error | `field`; `stepId?` | `steps[i].minutes` missing or not an integer 1..480 (`parsePlan`) | `Step chicken.roast: minutes must be a whole number from 1 to 480.` |
| `empty_plan` | error | none | `dishes` or `steps` is an empty array; at most one per plan (`parsePlan`) | `The plan has no dishes or no steps. Add at least one dish with one step.` |
| `too_many_dishes` | error | `count`, `limit: 12` | `dishes.length > 12` (`parsePlan`) | `The plan has 14 dishes and the limit is 12. Remove or merge 2 dishes.` |
| `too_many_steps` | error | `count`, `limit: 80` | `steps.length > 80` (`parsePlan`) | `The plan has 95 steps and the limit is 80. Remove or merge 15 steps.` |
| `unknown_dependency` | error | `stepId`, `ref` | an `after` entry names no step; one per step and distinct `ref` (`checkPlan`) | `Step gravy.roux waits for chicken.rost, which is not a step in this plan. Fix the prerequisite or remove it.` |
| `self_dependency` | error | `stepId` | a step's `after` contains its own id; one per step (`checkPlan`) | `Step gravy.roux lists itself as a prerequisite. Remove it.` |
| `cycle` | error | `stepId` (= `path[0]`), `path: string[]` (length >= 2) | one per path from `findCycles` (`checkPlan`) | `Steps chicken.rest → chicken.carve → chicken.rest wait on each other, so none of them can start. Remove one of these prerequisites.` |
| `duplicate_step_id` | error | `stepId`, `count` | a step id occurs `count >= 2` times (`checkPlan`) | `2 steps have the id gravy.simmer. Give each step its own id.` |
| `duplicate_dish_id` | error | `dishId`, `count` | a dish id occurs `count >= 2` times (`checkPlan`) | `2 dishes have the id gravy. Give each dish its own id.` |
| `unknown_dish` | error | `stepId`, `dishId` (the missing dish) | `step.dish` is no dish's id (`checkPlan`) | `Step gravy.roux belongs to dish sauce, which is not in this plan. Pick one of the plan's dishes.` |
| `dish_without_steps` | error | `dishId` | no step has `dish` equal to this dish id (`checkPlan`) | `Dish greens has no steps. Add a step or remove the dish.` |
| `missing_appliance` | error | `stepId`, `appliance: 'burner' \| 'oven'` | the step's appliance count in the kitchen is 0 (`checkKitchen`) | `Step chicken.roast needs an oven and the kitchen has none. Add an oven in the kitchen settings or change the step.` |
| `appliance_mismatch` | warning | `stepId`, `word`, `suggested: 'burner' \| 'oven'` | `appliance = 'none'` and the title or detail contains a listed word (`checkPlan`) | `Step chicken.rest mentions "roast" but uses no appliance. If it needs the oven, set its appliance to oven.` |
| `long_hands_on` | warning | `stepId`, `minutes` | `handsOn` and `minutes > 45` (`checkPlan`) | `Step risotto.stir keeps a cook busy for 50 minutes. If part of it runs by itself, split it into a hands-on step and a hands-free step.` |
| `short_hands_free` | warning | `stepId`, `minutes` | `!handsOn`, `appliance = 'none'`, `minutes < 2` (`checkPlan`) | `Step pasta.drain runs by itself for only 1 minute. Mark it hands-on or merge it into the step after it.` |

Where a message names a step or dish that has no valid id, it uses its 1-based position
(`Step 4`, `Dish 2`); `field` keeps the 0-based JSON path (`steps[3].appliance`)
(decided here).

### `canonicalPlan`

Copies, never mutates. `dishes` sorted by `compareIds(a.id, b.id)`, `steps` by
`compareIds(a.id, b.id)`, both with `Array.prototype.toSorted` (stable). Each step's
`after` becomes the sorted list of its distinct entries. `after` is a set: listing a
prerequisite twice means the same as once (decided here). `title`, every other field and
key presence are unchanged. Two plans are "the same plan" when their canonical forms are
deep-equal; G7.2 and D1 use this definition.

## `src/core/graph.ts`

```ts
export interface CycleError { kind: 'cycle'; path: string[] }

export function successors(plan: Plan): ReadonlyMap<string, readonly string[]>;
export function terminalSteps(plan: Plan): string[];
export function topologicalOrder(plan: Plan): Result<string[], CycleError>;
export function findCycles(plan: Plan): string[][];
export function longestChainMinutes(plan: Plan): Result<number, CycleError>;
```

All helpers first build one internal node table (not exported): node ids are the distinct
step ids in `compareIds` order; `prereqs(id)` is the sorted set union of `after` over every
occurrence, keeping only entries that are step ids; `minutes(id)` is the largest `minutes`
over occurrences (R3.1). A self-dependency stays in `prereqs` as a self-loop. Every
algorithm is iterative (N2).

- **successors**: for each node `s` and each `p` in `prereqs(s)`, add `s` to `succ(p)`.
  Map keys are inserted in id order; values sorted. A self-loop makes a node its own
  successor.
- **terminalSteps**: nodes whose `succ` is empty, in id order.
- **topologicalOrder**: Kahn's algorithm. `indegree(s) = |prereqs(s)|`. Keep the ready
  nodes in an array sorted by id; repeatedly remove the smallest, append it, and decrement
  its successors. If fewer than all nodes are placed, return the cycle error: the
  smallest-id self-loop node `x` gives path `[x]`, compared against `findCycles()[0]` by
  first id; the smaller first id wins.
- **findCycles**: `reach(x)` = nodes reachable from `x` along `p → s` edges (BFS, self-loops
  ignored). Nodes `x != y` are in one group iff `y ∈ reach(x)` and `x ∈ reach(y)`. For each
  group of size >= 2 with smallest id `m`: BFS from `m` inside the group, visiting
  successors in id order and recording the first parent, until a node `v` with
  `m ∈ succ(v)` is dequeued; the path is `m … v`, rebuilt from parents. This is the
  shortest cycle through `m`, ties broken by id. Paths are returned ordered by first id.
  `path[i] ∈ prereqs(path[i+1])` and `path[last] ∈ prereqs(path[0])`. Cost
  O(n · (n + e)), fine at 80 steps.
- **longestChainMinutes**: if `topologicalOrder` fails, return its error. Otherwise in that
  order `chain(s) = minutes(s) + max(0, chain(p) for p in prereqs(s))`; return the maximum.

## `src/core/sanity.ts`

```ts
export function parsePlan(input: unknown): Result<Plan, Issue[]>;
export function parseKitchen(input: unknown): Result<Kitchen, Issue[]>;
export function checkPlan(plan: Plan): Issue[];
export function checkKitchen(plan: Plan, kitchen: Kitchen): Issue[];
export type PlanCheck = { plan: Plan; issues: Issue[] } | { plan: null; issues: Issue[] };
export function validatePlan(input: unknown): PlanCheck;
export function sortIssues(issues: readonly Issue[]): Issue[];
export function hasErrors(issues: readonly Issue[]): boolean;
```

### `parsePlan`

1. `PlanSchema.safeParse(input)`. On success return `ok(result.data)` (deep-equal to the
   input, R2.2).
2. On failure map each zod issue by its `path` and the input value at that path, never by
   zod's message text (stable across zod versions):
   - path `['dishes']` or `['steps']` and the input value there is an array: length 0 gives
     `empty_plan`, length above the limit gives `too_many_dishes` / `too_many_steps` with
     `count`. Any other issue at that path gives `invalid_field`.
   - path starting `['steps', i, 'minutes']` gives `minutes_out_of_range`.
   - everything else gives `invalid_field` with `field` rendered from the path (`plan` for
     the root, `steps[3].after[1]`, `dishes[0].name`). An `unrecognized_keys` issue uses the
     object's path and says "has fields this app does not use; remove them" without naming
     the keys (R7.2).
   - `stepId`: when the path starts `['steps', i]` and `input.steps[i].id` passes
     `StepIdSchema`. `dishId` likewise for `['dishes', i]`.
3. Messages come from a fixed table keyed by the last named path segment (`title`,
   `name`, `id`, `dish`, `detail`, `appliance`, `handsOn`, `after`, `holdMin`, root,
   element) plus the location prefix; an unlisted path falls back to
   `<location>: this value is not valid.` (decided here).
4. Return `err(sortIssues(issues))`. `sortIssues` also merges the two `empty_plan` issues a
   plan with both arrays empty would give.

`parseKitchen` follows the same scheme with root `kitchen` and only `invalid_field`
(`The kitchen: burners must be a whole number from 0 to 8.`).

### `checkPlan`

On the plan as given, collecting issues, then `sortIssues`:

1. Count step ids, then dish ids: `duplicate_step_id` / `duplicate_dish_id` for counts >= 2.
2. `unknown_dish` for each step whose `dish` is not in the dish id set.
3. `dish_without_steps` for each distinct dish id that no step's `dish` names.
4. For each step and each distinct `after` entry `p`: `p === step.id` gives
   `self_dependency`; `p` not a step id gives `unknown_dependency` with `ref: p`.
5. `cycle` for each path of `findCycles(plan)`.
6. Warnings, per step:
   - `appliance_mismatch`: on `title.normalize('NFC')`, then `detail`, search
     `(?<![\p{L}\p{M}\p{N}])(<forms>)(?![\p{L}\p{M}\p{N}])` with flags `iu`. The first match
     in the title wins, else the first in the detail. `word` is the base form.

     | base (`word`) | `suggested` | forms matched (decided here) |
     | ------------- | ----------- | ---------------------------- |
     | oven | oven | oven, ovens |
     | roast | oven | roast, roasts, roasted, roasting |
     | bake | oven | bake, bakes, baked, baking |
     | simmer | burner | simmer, simmers, simmered, simmering |
     | boil | burner | boil, boils, boiled, boiling |
     | fry | burner | fry, fries, fried, frying |
     | sear | burner | sear, sears, seared, searing |
     | sauté | burner | sauté, sautés, sautéed, sautéing, saute, sautes, sauteed, sauteing |

     Hyphens are boundaries ("stir-fry" matches fry); "ovenproof", "boiler" and "roaster"
     do not match. False positives are acceptable: it is a warning.
   - `long_hands_on`, `short_hands_free` as in the table.

`checkKitchen`: for each step occurrence whose appliance is `burner` with
`kitchen.burners === 0` or `oven` with `kitchen.ovens === 0`, a `missing_appliance` error
for `(stepId, appliance)`; then `sortIssues`, which drops the exact duplicates two
occurrences of one id would give. Looking at every occurrence, not the first, keeps the
result independent of step order (R7.4).

`validatePlan(input)`: `parsePlan`; on failure `{ plan: null, issues: error }`, else
`{ plan, issues: checkPlan(plan) }`. The parse route, Dinnerfile import, share link and MCP
all call this one function, so every source meets the same rules (decided here).

`sortIssues`: removes exact duplicates (all fields equal), then sorts by: errors before
warnings; `code`; `stepId ?? ''`; `dishId ?? ''`; the extra fields in table order
(`field`, `ref`, `path` joined by `>`, `appliance`, `word`); `message`. String parts compare
with `compareIds`. `hasErrors` is `issues.some((i) => i.severity === 'error')`.

## `src/core/normalise.ts`

```ts
export function normaliseRecipeText(text: string): string;
```

`text.normalize('NFC')` → replace `\r\n` with `\n`, then remaining `\r` with `\n` →
split on `\n` → `trimEnd()` each line (removes the ECMAScript white space and line
terminator set) → join with `\n` → replace `\n{3,}` with `\n\n` → `trim()`.

## `src/core/index.ts`

Adds: `LIMITS`, `DISH_ID_PATTERN`, `STEP_ID_PATTERN`, every `*Schema`, the types `Appliance`,
`Step`, `Dish`, `Plan`, `Kitchen`, `Issue`, `IssueCode`, `ErrorCode`, `WarningCode`,
`CycleError`, `PlanCheck`, and `ERROR_CODES`, `WARNING_CODES`, `compareIds`,
`canonicalPlan`, the five graph functions, the seven sanity functions,
`normaliseRecipeText`. Keeps `ok`, `err`, `Result`.

## Test support

### `test/support/fixtures.ts`

Each constant is typed `Plan` or `Kitchen` (type import from `src/core/schema.js`). Steps
are written in non-topological order in the file so order-dependence shows. Each carries a
comment with the facts below, worked out by hand.

**`SUNDAY_ROAST`** ("Sunday roast"), dishes `chicken`, `gravy`, `greens`:

| id | min | appliance | handsOn | after | hold |
| -- | --- | --------- | ------- | ----- | ---- |
| chicken.prep | 10 | none | true | | null |
| chicken.roast | 75 | oven | false | chicken.prep | 5 |
| chicken.rest | 20 | none | false | chicken.roast | 30 |
| chicken.carve | 5 | none | true | chicken.rest | 5 |
| gravy.roux | 2 | burner | true | chicken.roast | 5 |
| gravy.simmer | 10 | burner | false | gravy.roux | 5 |
| gravy.strain | 2 | none | true | gravy.simmer | 15 |
| greens.shred | 5 | none | true | | null |
| greens.boil | 4 | burner | false | greens.shred | 0 |
| greens.toss | 1 | none | true | greens.boil | 5 |

`gravy.roux` ("Make a roux in the roasting tin", appliance burner) waits for
`chicken.roast`: the tin is free only once the chicken is out. Hand-worked:
successors of `chicken.roast` = `[chicken.rest, gravy.roux]`; terminal =
`[chicken.carve, gravy.strain, greens.toss]`; topological order = chicken.prep,
chicken.roast, chicken.rest, chicken.carve, gravy.roux, gravy.simmer, gravy.strain,
greens.shred, greens.boil, greens.toss; longest chain = 10 + 75 + 20 + 5 = 110 (the gravy
chain is 10 + 75 + 2 + 10 + 2 = 99); `checkPlan` = no issues (no `none` step's text uses a
listed word); `checkKitchen` with `burners: 0` = `missing_appliance` for gravy.roux,
gravy.simmer, greens.boil.

**`MEZZE`** ("Mezze"), dishes `flatbread`, `hummus`, `salad`; shows terminal steps whose
result keeps:

| id | min | appliance | handsOn | after | hold |
| -- | --- | --------- | ------- | ----- | ---- |
| hummus.blend | 10 | none | true | | null |
| flatbread.mix | 10 | none | true | | null |
| flatbread.rise | 60 | none | false | flatbread.mix | 30 |
| flatbread.cook | 12 | burner | true | flatbread.rise | 10 |
| salad.dressing | 5 | none | true | | null |
| salad.chop | 10 | none | true | | null |
| salad.toss | 2 | none | true | salad.chop, salad.dressing | 5 |

Terminal = `[flatbread.cook, hummus.blend, salad.toss]`; topological order =
flatbread.mix, flatbread.rise, flatbread.cook, hummus.blend, salad.chop, salad.dressing,
salad.toss; longest chain = 82; no issues.

**`TIGHT_OVEN`** ("Pie and potatoes"), dishes `pie`, `potatoes`; two oven steps compete for
one oven:

| id | min | appliance | handsOn | after | hold |
| -- | --- | --------- | ------- | ----- | ---- |
| pie.assemble | 15 | none | true | | null |
| pie.bake | 40 | oven | false | pie.assemble | 10 |
| potatoes.peel | 10 | none | true | | null |
| potatoes.roast | 45 | oven | false | potatoes.peel | 10 |

Terminal = `[pie.bake, potatoes.roast]`; topological order = pie.assemble, pie.bake,
potatoes.peel, potatoes.roast; longest chain = 55 (both chains); no issues;
`checkKitchen` with `ovens: 0` = `missing_appliance` for pie.bake and potatoes.roast.

**`HOME_KITCHEN`** `{ burners: 4, ovens: 1, cooks: 1 }`, **`TWO_COOK_KITCHEN`**
`{ burners: 4, ovens: 1, cooks: 2 }`.

Expected schedules for these fixtures are not worked out here; see the open question in
the session reply.

### `test/support/arbitraries.ts`

```ts
export interface PlanOpts { large?: boolean; appliances?: readonly Appliance[] }
export interface BrokenCase {
  rule: ErrorCode;
  input: unknown;        // passed to validatePlan
  kitchen: Kitchen;      // passed to checkKitchen when the plan parses
  target: { stepId?: string; dishId?: string }; // an issue with `rule` must carry these
}
export function arbKitchen(): fc.Arbitrary<Kitchen>;
export function arbPlan(opts?: PlanOpts): fc.Arbitrary<Plan>;
export function arbPlanAndKitchen(opts?: Omit<PlanOpts, 'appliances'>):
  fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }>;
export function arbBrokenPlan(rule: ErrorCode): fc.Arbitrary<BrokenCase>;
export function arbShuffledPlan(plan: Plan): fc.Arbitrary<Plan>;   // decided here
export function arbPlanLikeValue(): fc.Arbitrary<unknown>;         // decided here
export function arbRecipeText(): fc.Arbitrary<string>;             // decided here
```

- **arbKitchen**: integers within `LIMITS`.
- **arbPlan** (internal `arbPlanShaped(dishRange, stepRange, appliances)` shared with the
  broken cases):
  1. `d` dishes: 1..6, or with `large` `oneof(constant(12), 1..12)`. `n` steps: `d`..30, or
     with `large` `oneof(constant(80), d..80)`, so the limits are reached.
  2. Dish ids from `fc.uniqueArray` of pattern-valid slugs (1 to 3 segments of `[a-z0-9]`,
     at most 40 characters); names non-blank text up to 80.
  3. Step `k` (k in hidden topological position `0..n-1`) belongs to dish `k` when `k < d`
     (every dish gets a step), otherwise to a drawn dish. Ids `<dish>.<slug>` with slugs
     unique in the plan.
  4. `after(k)`: a drawn subset of steps `0..k-1`, size 0..min(k, 4). Drawing from every
     earlier step gives cross-dish edges. Acyclic by construction.
  5. `minutes`: weighted 1..10, 11..60, 61..480 (so 1 and > 45 both occur). `appliance`
     from `opts.appliances` (default all three). `handsOn`: boolean. `holdMin`: `null`,
     0..30 or 31..480. `title`: either words from a list that includes every form in the
     mismatch table, or arbitrary non-blank text up to 120. `detail`: absent or non-blank
     text up to 1000 (absent key, never `undefined`).
  6. Shuffle `dishes`, `steps` and every `after`.
- **arbPlanAndKitchen**: `arbKitchen()` then `arbPlan` with
  `appliances = ['none', ...burner if burners > 0, ...oven if ovens > 0]`.
- **arbShuffledPlan**: a random permutation of `steps`, `dishes` and each `after`.
- **arbPlanLikeValue**: an `arbPlan` value with one random change: a field replaced by
  `fc.jsonValue()`, a key removed, an unknown key added, or an array replaced. Feeds S1
  with inputs that reach deep paths.
- **arbRecipeText**: strings over an alphabet with `\r`, `\n`, `\r\n`, space, tab, U+00A0,
  U+2028, `e`, U+0301, `é`, letters and digits, plus `fc.string()`.
- **arbBrokenPlan(rule)**. Plan-shape rules start from `arbPlanShaped` with a kitchen that
  has at least one burner and one oven; exactly one change:

  | rule | construction | target |
  | ---- | ------------ | ------ |
  | `empty_plan` | `steps: []`, or `dishes: []`, or both | none |
  | `too_many_dishes` | 13..20 dishes, `d`..80 steps | none |
  | `too_many_steps` | 1..12 dishes, 81..120 steps | none |
  | `minutes_out_of_range` | one step's `minutes` set to one of: 0, -480..-1, 481..100000, a non-integer in (1, 480), a digit string, `null`, `true`, key removed | that step |
  | `invalid_field` | one of: bad appliance string; non-boolean `handsOn`; step id, `dish` or an `after` entry failing its pattern; blank or 121-character title; empty detail; `holdMin` negative, fractional or 481; dish name 81 characters; plan title removed; an unknown key; root replaced by a non-object JSON value | the step or dish when its id stays valid |
  | `unknown_dependency` | add a pattern-valid id that is not a step to one step's `after` | that step |
  | `self_dependency` | add a step's own id to its `after` | that step |
  | `cycle` | pick two distinct steps `x`, `y` (n >= 2): if `y` depends on `x` transitively add `y` to `x.after`, else add each to the other's `after` | none |
  | `duplicate_step_id` | append a copy of a step, optionally with another title and minutes | that step |
  | `duplicate_dish_id` | append a dish with an existing id and another name | that dish |
  | `unknown_dish` | set the `dish` of a step from a dish with two or more steps to a fresh dish id; if no dish has two steps, append a new step with a fresh dish id, unique id and empty `after` | that step |
  | `dish_without_steps` | append a dish with a fresh id | that dish |
  | `missing_appliance` | `arbPlanAndKitchen` with a plan using `burner` or `oven`; set that count to 0 | one step using it |

  Default-size bases keep `steps <= 30` and `dishes <= 6`, so appending never crosses a
  limit.

### `test/support/oracles.ts`

Plain loops, written without looking at `src/core/graph.ts`; imports from `src/core` only
types and schemas.

- `oracleSuccessors(plan)`: for every pair of steps, `s` is a successor of `p` iff `p` is in
  `s.after`; `Record<string, string[]>` sorted.
- `oracleTopologicalOrder(plan)`: repeat n times: scan all unplaced ids and take the
  smallest whose prerequisites (that are step ids) are all placed. O(n³).
- `respectsPrecedence(plan, order)`: every edge `p → s` has `p` before `s`.
- `isCycleIn(plan, path)`: distinct ids, length >= 2, each consecutive pair and the closing
  pair is an edge.
- `oracleStronglyConnected(plan)`: reachability matrix by Floyd–Warshall on booleans,
  groups of size >= 2.
- `oracleShortestCycleLength(plan, id)`: BFS distance from `id` back to `id`.
- `oracleLongestChain(plan)`: Bellman–Ford-style relaxation for `n` rounds on
  `best(s) = minutes(s) + max best(p)`.
- `oracleWarnings(plan)`: `(code, stepId)` pairs; the mismatch check splits text on every
  character that is not a letter, mark or digit, lowercases, and tests membership in the
  form list.
- `oracleNormalise(text)`: character-by-character line building and blank-line counting.

## Correctness properties

All run with `numRuns: 200` (overridable by `FC_NUM_RUNS`), titles start with the id.
The run count comes from one helper, `fcParams()` in `test/support/fc-params.ts`, returning
`{ numRuns: Number(process.env.FC_NUM_RUNS ?? 200) }` (decided here); no property file sets
`numRuns` itself.

Property files (decided here): `test/core/schema.pbt.ts` (P-RG1, P-RG8),
`test/core/graph.pbt.ts` (P-RG3 to P-RG6), `test/core/sanity.pbt.ts` (S1, S2, P-RG2, P-RG9),
`test/core/normalise.pbt.ts` (P-RG7).

| id | statement | validates | generator |
| -- | --------- | --------- | --------- |
| S1 total | `parsePlan`, `parseKitchen` and `validatePlan` never throw on any value; `parsePlan` returns `ok` or `err` with >= 1 error; `validatePlan` agrees with `parsePlan`; when a plan parses, `checkPlan` and `checkKitchen` do not throw; every returned issue passes `IssueSchema` | R2.1, R2.8, R2.9, R7.1 | `fc.jsonValue()`, `arbPlanLikeValue()`, `arbKitchen()` |
| S2 sound | for each `rule` in `ERROR_CODES`: the set of error codes from `validatePlan(input)` plus `checkKitchen` is exactly `{ rule }`, and some issue with that code carries `target`; `validatePlan(arbPlan)` and `checkKitchen` on `arbPlanAndKitchen` give no error | R2.3–R2.7, R4.1–R4.7, R6.1, R6.2, R10.3 | `arbBrokenPlan(rule)`, `arbPlan()`, `arbPlanAndKitchen()` |
| P-RG1 canonical | `canonicalPlan` is idempotent; its steps and dishes are sorted by id, each `after` sorted and duplicate-free; it holds the same steps (after-lists as sets) as the input; for unique ids, `canonicalPlan(shuffled) ≡ canonicalPlan(p)`; `checkPlan(canonicalPlan(p)) ≡ checkPlan(p)`; the input is unchanged | R8.1–R8.4 | `arbPlan()`, `arbShuffledPlan`, graph-rule `arbBrokenPlan` cases |
| P-RG2 order-free | every graph helper, `checkPlan` and `checkKitchen` give deep-equal output on a shuffled plan; issue lists are sorted and duplicate-free | R3.9, R7.3, R7.4 | `arbPlanAndKitchen()`, graph-rule `arbBrokenPlan` cases, `arbShuffledPlan` |
| P-RG3 topological order | on valid plans `topologicalOrder` is `ok`, lists each step id once, satisfies `respectsPrecedence`, and equals `oracleTopologicalOrder` | R3.4 | `arbPlan()`, `arbPlan({ large: true })` |
| P-RG4 cycles | on `cycle` cases `findCycles` is non-empty and every path satisfies `isCycleIn`, starts at the smallest id of its oracle group, has the oracle's shortest length, and there is one path per oracle group; `topologicalOrder` is `err` with the first path; on `self_dependency` cases `topologicalOrder` is `err` with `[id]` and `findCycles` is empty; on valid plans `findCycles` is `[]` | R3.5, R3.6, R4.3 | `arbBrokenPlan('cycle')`, `arbBrokenPlan('self_dependency')`, `arbPlan()` |
| P-RG5 successors | `successors` equals `oracleSuccessors`; `terminalSteps` equals the oracle ids with no successors | R3.2, R3.3 | `arbPlan()`, graph-rule `arbBrokenPlan` cases |
| P-RG6 chain | on valid plans `longestChainMinutes` equals `oracleLongestChain`, is >= the largest `minutes` and <= the sum of `minutes` | R3.7 | `arbPlan()`, `arbPlan({ large: true })` |
| P-RG7 normalise | output equals `oracleNormalise`; is idempotent; has no `\r`, no line ending in white space, no `\n\n\n`, no leading or trailing white space; equals its own NFC | R9.1, R9.2 | `arbRecipeText()` |
| P-RG8 JSON round trip | `parsePlan(JSON.parse(JSON.stringify(p)))` is `ok` and strictly deep-equals `p` | R2.2, R1.1 | `arbPlan()`, `arbPlan({ large: true })` |
| P-RG9 warnings | the `(code, stepId)` pairs of warnings from `checkPlan` equal `oracleWarnings` | R5.1–R5.3 | `arbPlan()` |

"Graph-rule `arbBrokenPlan` cases" are the rules whose input still parses:
`unknown_dependency`, `self_dependency`, `cycle`, `duplicate_step_id`, `duplicate_dish_id`,
`unknown_dish`, `dish_without_steps`. The test turns them into a `Plan` with
`PlanSchema.parse` (the schema, not `parsePlan`, so graph and canonical properties do not
wait for the parse task).

S1 as worded in `scheduler-guarantees.md` says "`checkPlan` on any JSON value". In this
design `checkPlan` takes a `Plan`, and S1 is proved on `parsePlan`/`validatePlan`, the
functions that accept any value (see open questions).

## Example tests (outline)

- `test/core/schema.test.ts`: each bound at its edge and one past it (minutes 1/480 vs
  0/481/2.5, hold 0/480 vs -1/481, title 120 vs 121, blank title, detail present/absent/
  empty, id patterns, dish id 40 vs 41, step id 80 vs 81, `after` 80 vs 81, kitchen bounds);
  unknown key rejected; each fixture passes `PlanSchema`; `IssueSchema` rejects a code with
  the wrong severity; `canonicalPlan` on a hand-shuffled
  `SUNDAY_ROAST` with a duplicated `after` entry equals the plan written in id order.
- `test/core/sanity.test.ts`: per code one firing example asserting the exact issue (all
  fields, message included) and one non-firing example; `parsePlan` on `null`, `42`, `''`,
  `[]`, `{}`; `stepId` present only when the id is valid; `empty_plan` once when both arrays
  are empty; fixtures give `[]`; word cases ("Roasting tin" fires, "stir-fry" fires,
  `"saute\u0301"` fires, "ovenproof" and "boiler" do not, detail-only match fires, title
  match wins over detail); `hasErrors` is false for warnings only; `validatePlan` on a
  fixture's JSON.
- `test/core/graph.test.ts`: `compareIds('a-b', 'a.b') === -1` (hand-worked: `-` is
  U+002D and `.` is U+002E), `compareIds('Z', 'a') === -1`, `compareIds('a.b', 'a.b') === 0`;
  the hand-worked facts for each fixture; a hand-made 3-cycle
  `a.x → a.y → a.z` entered starting at `a.y` reports `['a.x', 'a.y', 'a.z']`; two disjoint
  cycles give two paths in first-id order; a self-loop gives `[id]` from
  `topologicalOrder` and nothing from `findCycles`; unknown `after` entries are ignored;
  duplicate ids merge as in R3.1.
- `test/core/normalise.test.ts`: one example per rule (NFC, CRLF, lone CR, trailing spaces
  and tabs, three blank lines become one, leading/trailing trim, indentation kept), and
  each `samples/*.md` normalises without throwing and is idempotent.
- `test/meta/oracles.test.ts`: each oracle on the three fixtures gives the hand-worked
  facts above, so the oracles are checked against hand work, not against `src/`
  (decided here).
- `test/meta/arbitraries.test.ts` (decided here: `test/meta/` holds tests about the test
  support): from `fc.sample` with a fixed seed, every `arbPlan` value passes `PlanSchema`,
  has unique ids, known `after` entries, a step for every dish, and an oracle topological
  order of full length; the samples together cover every item in R10.2 (warning codes
  through `oracleWarnings`); `arbPlanAndKitchen` never pairs a step with an absent
  appliance.
