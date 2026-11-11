# Requirements: recipe-graph

## Why

Every other feature (parse, scheduler, rebuild, Dinnerfile, cooking mode, MCP) reads and
writes the same `Plan`. It needs one definition of what a plan is, which plans are
schedulable, and what "the same plan" means. Model output, hand edits, Dinnerfile imports
and share links all go through these checks, so a cook sees the same issues whatever the
source.

## Scope

In `src/core` (pure, see `tech.md` and `structure.md`):

- zod schemas and inferred types for `Step`, `Dish`, `Plan`, `Kitchen` and `Issue`.
- `parsePlan` and `parseKitchen`: any JSON value to a typed value or a list of issues.
- Graph helpers: successors, terminal steps, deterministic topological order, cycle
  detection with the cycle path, longest dependency chain in minutes.
- `checkPlan` (every brief sanity rule that does not need the kitchen), `checkKitchen` (the
  missing-appliance error) and `validatePlan` (parse then check, the one pipeline every
  plan source uses).
- `canonicalPlan`: one definition of "the same plan".
- `normaliseRecipeText` as defined in `tech.md`.

In `test/support`: the generators `arbKitchen`, `arbPlan`, `arbPlanAndKitchen`,
`arbBrokenPlan`, the oracles this spec needs, and three hand-written fixture plans.

Terms are the glossary in `product.md`. "Issue", "error" and "warning" mean an `Issue` with
that severity.

## Requirements

### R1. Domain schemas

**User story:** As the developer of any later feature, I want one zod schema per domain type
so that every package agrees on what a valid plan and kitchen look like.

- R1.1 THE SYSTEM SHALL define `StepSchema`, `DishSchema`, `PlanSchema`, `KitchenSchema` and
  `IssueSchema` in `src/core/schema.ts`, with the types `Step`, `Dish`, `Plan`, `Kitchen`
  and `Issue` inferred from them by `z.infer`.
- R1.2 THE SYSTEM SHALL accept a step's `minutes` only as an integer from 1 to 480.
- R1.3 THE SYSTEM SHALL accept a step's `holdMin` only as `null` or an integer from 0 to 480
  (decided here).
- R1.4 THE SYSTEM SHALL accept a dish id only if it matches `^[a-z0-9]+(-[a-z0-9]+)*$` and
  has at most 40 characters, and a step id, a step's `dish` and every `after` entry only if
  they match the patterns in `structure.md` (step id at most 80 characters) (lengths
  decided here).
- R1.5 THE SYSTEM SHALL accept text fields only within these lengths, counted in UTF-16 code
  units, and only if they contain at least one non-white-space character (decided here):
  plan title 1..120, dish name 1..80, step title 1..120, step detail 1..1000 when present.
- R1.6 THE SYSTEM SHALL accept a plan with 1 to 12 dishes and 1 to 80 steps, and an `after`
  list with at most 80 entries (the `after` bound decided here).
- R1.7 THE SYSTEM SHALL accept a kitchen only with integer `burners` 0..8, `ovens` 0..4 and
  `cooks` 1..6.
- R1.8 IF an object in the input has a key the schema does not define, THEN THE SYSTEM SHALL
  reject it (strict objects, decided here).
- R1.9 THE SYSTEM SHALL fix each issue code to exactly one severity, so that the type of an
  `Issue` with a given `code` also fixes its `severity` and its extra fields.

### R2. Parsing any value into a plan or a kitchen

**User story:** As the server, the importer and the share-link reader, I want to turn an
untrusted JSON value into a `Plan` or a list of issues, so that bad input never crashes the
app and the cook learns what to fix.

- R2.1 WHEN `parsePlan(input)` receives any value, THE SYSTEM SHALL return either
  `{ ok: true, value: Plan }` or `{ ok: false, error: Issue[] }` with at least one error,
  and SHALL NOT throw (S1).
- R2.2 WHEN the input passes `PlanSchema`, THE SYSTEM SHALL return a plan deep-equal to the
  input, with the same order of dishes, steps and `after` entries.
- R2.3 IF `dishes` or `steps` is an empty array, THEN THE SYSTEM SHALL report one
  `empty_plan` error.
- R2.4 IF `dishes` has more than 12 entries, THEN THE SYSTEM SHALL report a
  `too_many_dishes` error; IF `steps` has more than 80 entries, THEN THE SYSTEM SHALL report
  a `too_many_steps` error. Each carries the actual count and the limit.
- R2.5 IF a step's `minutes` is missing or is not an integer from 1 to 480, THEN THE SYSTEM
  SHALL report a `minutes_out_of_range` error for that step.
- R2.6 IF any other part of the input fails the schema, THEN THE SYSTEM SHALL report an
  `invalid_field` error naming the field by its path (`steps[3].appliance`).
- R2.7 WHEN a parse issue concerns an element of `steps` whose `id` is a valid step id, THE
  SYSTEM SHALL put that id in the issue's `stepId`; likewise `dishId` for an element of
  `dishes`.
- R2.8 WHEN `parseKitchen(input)` receives any value, THE SYSTEM SHALL return
  `{ ok: true, value: Kitchen }` or `{ ok: false, error: Issue[] }` of `invalid_field`
  errors, and SHALL NOT throw (decided here).
- R2.9 WHEN `validatePlan(input)` receives any value, THE SYSTEM SHALL return
  `{ plan: null, issues }` with the parse issues if parsing fails, and otherwise
  `{ plan, issues: checkPlan(plan) }`, and SHALL NOT throw (decided here).

### R3. Dependency-graph helpers

**User story:** As the scheduler, the Dinnerfile export and the sanity rules, I want one set
of graph helpers with defined behaviour on every plan, so that all of them see the same
graph.

- R3.1 THE SYSTEM SHALL treat a step id as one node; WHEN a step id occurs more than once,
  THE SYSTEM SHALL use the union of the occurrences' `after` lists and the largest of their
  `minutes`; THE SYSTEM SHALL ignore `after` entries that name no step (decided here).
- R3.2 WHEN `successors(plan)` is called, THE SYSTEM SHALL return, for every step id in the
  plan, the ids of the steps that list it in `after`, without duplicates and sorted by id.
- R3.3 WHEN `terminalSteps(plan)` is called, THE SYSTEM SHALL return the ids of the steps
  with no successors, without duplicates and sorted by id.
- R3.4 WHEN `topologicalOrder(plan)` is called on a plan with no cycle and no
  self-dependency, THE SYSTEM SHALL return every step id once, each after all its
  prerequisites, choosing the smallest id among the ready steps at every point.
- R3.5 IF the plan has a cycle or a self-dependency, THEN `topologicalOrder` SHALL return
  `{ ok: false, error: { kind: 'cycle', path } }` with the path defined in R3.6.
- R3.6 WHEN `findCycles(plan)` is called, THE SYSTEM SHALL return one path for every group
  of two or more steps that all wait on each other (a strongly connected component),
  ignoring self-dependencies. Each path starts at the smallest id in the group, is the
  shortest cycle through that id (ties broken by smallest id), and lists each step before
  the step that waits on it.
- R3.7 WHEN `longestChainMinutes(plan)` is called on a plan with no cycle and no
  self-dependency, THE SYSTEM SHALL return the largest sum of `minutes` along any
  dependency path; otherwise it SHALL return the cycle error of R3.5.
- R3.8 THE SYSTEM SHALL compare ids by UTF-16 code units, never by locale (decided here).
- R3.9 THE SYSTEM SHALL give every graph helper the same output for any permutation of
  `steps`, `dishes` and each `after` list.

### R4. Plan errors

**User story:** As a cook, I want a plan that cannot be scheduled to tell me exactly which
step or dish is wrong and how to fix it, so that I can correct the model's mistakes.

- R4.1 IF a step's `after` names an id that is not a step in the plan, THEN `checkPlan`
  SHALL report one `unknown_dependency` error per step and missing id.
- R4.2 IF a step lists its own id in `after`, THEN `checkPlan` SHALL report one
  `self_dependency` error for that step.
- R4.3 IF the plan has a cycle of two or more steps, THEN `checkPlan` SHALL report one
  `cycle` error per path from `findCycles`, carrying the path.
- R4.4 IF two or more steps share an id, THEN `checkPlan` SHALL report one
  `duplicate_step_id` error for that id with the number of occurrences; likewise
  `duplicate_dish_id` for dishes.
- R4.5 IF a step's `dish` names no dish in the plan, THEN `checkPlan` SHALL report an
  `unknown_dish` error for that step.
- R4.6 IF a dish has no step whose `dish` is its id, THEN `checkPlan` SHALL report a
  `dish_without_steps` error for that dish.
- R4.7 WHEN a plan comes from `arbPlan`, THE SYSTEM SHALL report no error for it (S2).

### R5. Plan warnings

**User story:** As a cook, I want to be told about steps that look wrong but may be right,
so that I can check them without being blocked.

- R5.1 IF a step's `appliance` is `none` AND its title or detail contains one of the words
  oven, roast, bake, simmer, boil, fry, sear or sauté (or an inflection listed in the
  design), THEN `checkPlan` SHALL report one `appliance_mismatch` warning for that step,
  naming the word and suggesting `oven` or `burner`.
- R5.2 IF a step has `handsOn = true` AND `minutes > 45`, THEN `checkPlan` SHALL report a
  `long_hands_on` warning for that step.
- R5.3 IF a step has `handsOn = false` AND `appliance = 'none'` AND `minutes < 2`, THEN
  `checkPlan` SHALL report a `short_hands_free` warning for that step.
- R5.4 THE SYSTEM SHALL never let a warning block scheduling: `hasErrors` counts errors only.

### R6. Kitchen errors

**User story:** As a cook, I want to know before scheduling that my kitchen lacks an
appliance a step needs, so that I can change the kitchen settings or the step.

- R6.1 IF a step's `appliance` is `burner` AND the kitchen has 0 burners, or `oven` AND 0
  ovens, THEN `checkKitchen(plan, kitchen)` SHALL report one `missing_appliance` error for
  that step, naming the appliance.
- R6.2 WHEN a plan and kitchen come from `arbPlanAndKitchen`, THEN `checkKitchen` SHALL
  return no issue (S2).

### R7. Issues

**User story:** As the UI, I want every issue in a fixed shape and order, with a message I
can show as is, so that issues appear next to the step they concern and do not jump around.

- R7.1 THE SYSTEM SHALL give every issue a `severity`, a snake_case `code`, a non-empty
  plain-English `message`, the `stepId` or `dishId` it concerns when there is one, and the
  extra fields listed for its code in the design.
- R7.2 THE SYSTEM SHALL build messages only from ids, numbers, field paths and fixed words,
  never from titles, details, names or other input text (decided here, following the
  "no raw model output" rule in `tech.md`).
- R7.3 THE SYSTEM SHALL return issues without exact duplicates, sorted errors first, then by
  code, `stepId`, `dishId` and the code's extra fields.
- R7.4 WHEN `checkPlan` or `checkKitchen` is called on any permutation of `steps`, `dishes`
  and each `after` list, THE SYSTEM SHALL return a deep-equal issue list.

### R8. Canonical form

**User story:** As the scheduler (G7.2) and the Dinnerfile round trip (D1), I want one
definition of "the same plan", so that order in the input never changes a result.

- R8.1 WHEN `canonicalPlan(plan)` is called, THE SYSTEM SHALL return a new plan with dishes
  sorted by id, steps sorted by id and each `after` list sorted by id with duplicate entries
  removed; all other fields unchanged, `detail` absent when it was absent or `undefined`.
- R8.2 THE SYSTEM SHALL keep the input order of equal ids (stable sort) and SHALL NOT change
  the input plan.
- R8.3 WHEN two plans with unique ids differ only in the order of `steps`, `dishes` or any
  `after` list, THE SYSTEM SHALL give them deep-equal canonical forms.
- R8.4 THE SYSTEM SHALL make `canonicalPlan` idempotent, and `checkPlan(canonicalPlan(p))`
  SHALL equal `checkPlan(p)`.

### R9. Recipe text normalisation

**User story:** As the parse route, I want pasted recipe text in one normal form, so that a
pasted sample matches its recording and the model sees tidy text.

- R9.1 WHEN `normaliseRecipeText(text)` is called, THE SYSTEM SHALL, in this order: apply
  Unicode NFC; turn CRLF and then any lone CR into LF (lone CR decided here); remove trailing
  white space from every line; collapse every run of two or more blank lines into one blank
  line; trim the whole text.
- R9.2 THE SYSTEM SHALL make `normaliseRecipeText` idempotent.

### R10. Test support

**User story:** As the author of any later spec, I want valid-by-construction generators and
hand-worked fixture plans, so that properties and examples start from shared, trusted data.

- R10.1 `test/support/arbitraries.ts` SHALL export `arbKitchen()`, `arbPlan(opts)`,
  `arbPlanAndKitchen(opts)` and `arbBrokenPlan(rule)` with the contracts in `testing.md` and
  the design.
- R10.2 `arbPlan` SHALL produce, over a run, plans with cross-dish dependencies, every
  appliance, both `handsOn` values, null and finite holds, steps in non-topological input
  order, and every warning code; with `large: true` it SHALL reach 12 dishes and 80 steps.
- R10.3 WHEN `arbBrokenPlan(rule)` is given any error code, THE SYSTEM SHALL produce cases
  whose error codes are exactly `{ rule }`.
- R10.4 `test/support/fixtures.ts` SHALL export three hand-written plans, including a Sunday
  roast whose gravy waits on the chicken leaving the oven, and two kitchens, each with a
  comment giving its hand-worked graph facts.
- R10.5 `test/support/oracles.ts` SHALL hold independent recomputations of successors,
  topological order validity, cycle validity and longest chain, with no imports from
  `src/core` other than types and schemas.

## Non-functional requirements

- N1 Purity: every function in this spec follows the `src/core` rules in `tech.md` (no
  throw on bad input, no clock, no randomness, no I/O, imports only zod).
- N2 Totality on any `Plan` value: graph helpers and `checkPlan` terminate without throwing
  on plans of any size, including sizes above the schema bounds, so they use no recursion
  (decided here).
- N3 Cost: every function is polynomial in steps and edges; on an 80-step plan the full
  property suite of this spec at `numRuns: 200` finishes within the default vitest timeout.
- N4 Public surface: other packages reach every export of this spec through
  `src/core/index.ts` only.
- N5 Glossary: identifiers, codes and messages use the glossary words in `product.md`.

## Out of scope

- Scheduling, slack, lanes, `hold_exceeded` (scheduler spec), rebuild, Dinnerfile
  export/import, the parse route and the prompt, recordings, the UI, the MCP server.
- `arbUnlimitedKitchen`, `arbProgress`, `arbNow` (needed by the scheduler and rebuild specs).
- `test/meta/guarantees.test.ts` (see open questions in the session reply).
- Checking that a step id's prefix equals its `dish`: a convention for the prompt, not a
  rule (decided here).
- Any sanity rule not listed in the brief.
