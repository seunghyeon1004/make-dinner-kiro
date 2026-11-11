# Tasks: recipe-graph

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every
task: `testing.md`, `kiro-conduct.md`.

How each task is done (from `testing.md`, "Order of work"):

1. Write the test named in the task.
2. If the module does not exist yet, add it with the exported signatures from `design.md`
   and bodies that return an empty or placeholder value of the right type (`[]`,
   `new Map()`, `''`, `err(...)`), so the test compiles and fails on an assertion, not on a
   missing import or a type error.
3. Run the task's command and see the expected assertion fail.
4. Write the smallest code that makes it pass. Run the command again.

A task is ticked only after its command passed in the same session. Commands run with
`ANTHROPIC_API_KEY` unset. Single-file runs use `npx vitest run --project <examples|props>
<file>`; the project names come from `vitest.config.ts`.

## T1. Schemas and inferred types

- [x] T1.1 Example tests for the bounds of `StepSchema`, `DishSchema`, `PlanSchema` and
  `KitchenSchema`: each bound at its edge and one past it, blank text, `detail` present,
  absent and empty, both id patterns and their length limits, the `after` bound, unknown
  keys rejected, `z.infer` types checked with `expectTypeOf`.
  Files: `test/core/schema.test.ts`, `src/core/schema.ts` (stub).
  Covers: R1.1–R1.8.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T1.2 Implement `LIMITS`, `DISH_ID_PATTERN`, `STEP_ID_PATTERN`, `DishIdSchema`,
  `StepIdSchema`, `ApplianceSchema`, `StepSchema`, `DishSchema`, `PlanSchema`,
  `KitchenSchema` and the five types until T1.1 passes.
  Files: `src/core/schema.ts`.
  Covers: R1.1–R1.8.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T1.3 Example tests for `IssueSchema`: one valid issue per code in the design table,
  each code rejected with the other severity, a missing extra field rejected, an unknown
  key rejected; `ERROR_CODES` and `WARNING_CODES` equal the table's codes in table order;
  `expectTypeOf` shows that narrowing on `code` fixes `severity`.
  Files: `test/core/schema.test.ts`.
  Covers: R1.9, R7.1.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T1.4 Implement `IssueSchema`, `Issue`, `IssueCode`, `ErrorCode`, `WarningCode`,
  `ERROR_CODES`, `WARNING_CODES` until T1.3 passes.
  Files: `src/core/schema.ts`.
  Covers: R1.9, R7.1.
  Command: `npx vitest run --project examples test/core/schema.test.ts && npm run typecheck`

## T2. Test support

- [x] T2.1 Write `SUNDAY_ROAST`, `MEZZE`, `TIGHT_OVEN`, `HOME_KITCHEN` and
  `TWO_COOK_KITCHEN` exactly as the design tables give them, steps in non-topological
  order, each with its hand-worked comment. Add an example test that each fixture passes
  `PlanSchema` or `KitchenSchema`.
  Files: `test/support/fixtures.ts`, `test/core/schema.test.ts`.
  Covers: R10.4.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T2.2 Example tests that each oracle gives the hand-worked facts of the three
  fixtures (successors of `chicken.roast`, terminal steps, topological orders, longest
  chains 110, 82 and 55), plus a hand-made 3-cycle and two disjoint cycles for
  `oracleStronglyConnected`, `oracleShortestCycleLength` and `isCycleIn`, warning
  examples for `oracleWarnings` ("Roasting tin" fires on a `none` step, "ovenproof" does
  not) and one example per rule for `oracleNormalise`.
  Files: `test/meta/oracles.test.ts`, `test/support/oracles.ts` (stub).
  Covers: R10.5.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T2.3 Implement the oracles with plain loops, importing from `src/core` only types
  and schemas, until T2.2 passes.
  Files: `test/support/oracles.ts`.
  Covers: R10.5.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T2.4 Add `fcParams()`.
  Files: `test/support/fc-params.ts`.
  Covers: `testing.md` run-count rule.
  Command: `npm run typecheck`
- [x] T2.5 Example tests for the generators from `fc.sample` with a fixed seed: every
  `arbPlan` value is valid by construction (schema, unique ids, known `after` entries,
  every dish has a step, oracle order of full length); samples cover every item of R10.2,
  `large: true` reaches 12 dishes and 80 steps; `arbPlanAndKitchen` never uses an absent
  appliance; `arbKitchen` stays within `LIMITS`; each `arbBrokenPlan(rule)` case for the
  graph rules parses with `PlanSchema` and the others do not; `arbShuffledPlan` keeps the
  same multiset of steps.
  Files: `test/meta/arbitraries.test.ts`, `test/support/arbitraries.ts` (stub).
  Covers: R10.1, R10.2.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts`
- [x] T2.6 Implement `arbKitchen`, `arbPlan`, `arbPlanAndKitchen`, `arbShuffledPlan`,
  `arbPlanLikeValue`, `arbRecipeText` and `arbBrokenPlan` for every error code in the
  design table until T2.5 passes.
  Files: `test/support/arbitraries.ts`.
  Covers: R10.1–R10.3.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts && npm run typecheck`

## T3. Graph helpers

- [ ] T3.1 Example tests: `compareIds('a-b', 'a.b') === -1`, `compareIds('Z', 'a') === -1`,
  `compareIds('a.b', 'a.b') === 0`; the hand-worked facts of the three fixtures for all five
  helpers; a 3-cycle entered at its middle step reports `['a.x', 'a.y', 'a.z']`; two
  disjoint cycles give two paths in first-id order; a self-loop gives `[id]` from
  `topologicalOrder` and `[]` from `findCycles`; unknown `after` entries are ignored;
  duplicate ids merge as in R3.1; `longestChainMinutes` returns the cycle error on a cycle.
  Files: `test/core/graph.test.ts`, `src/core/graph.ts` (stub).
  Covers: R3.1–R3.8.
  Command: `npx vitest run --project examples test/core/graph.test.ts`
- [ ] T3.2 Property P-RG3 topological order.
  Files: `test/core/graph.pbt.ts`.
  Covers: R3.4.
  Command: `npx vitest run --project props test/core/graph.pbt.ts`
- [ ] T3.3 Property P-RG4 cycles.
  Files: `test/core/graph.pbt.ts`.
  Covers: R3.5, R3.6.
  Command: `npx vitest run --project props test/core/graph.pbt.ts`
- [ ] T3.4 Property P-RG5 successors.
  Files: `test/core/graph.pbt.ts`.
  Covers: R3.2, R3.3.
  Command: `npx vitest run --project props test/core/graph.pbt.ts`
- [ ] T3.5 Property P-RG6 chain.
  Files: `test/core/graph.pbt.ts`.
  Covers: R3.7.
  Command: `npx vitest run --project props test/core/graph.pbt.ts`
- [ ] T3.6 Implement `compareIds` (in `schema.ts`) and the graph helpers, iterative,
  until T3.1 to T3.5 pass.
  Files: `src/core/schema.ts`, `src/core/graph.ts`.
  Covers: R3.1–R3.8, N2.
  Command: `npx vitest run --project examples test/core/graph.test.ts && npx vitest run --project props test/core/graph.pbt.ts`

## T4. Canonical form

- [ ] T4.1 Example tests: `canonicalPlan` on a
  hand-shuffled `SUNDAY_ROAST` with one duplicated `after` entry equals the plan written
  out in id order in the test; equal ids keep input order; the input object is unchanged
  (checked against a deep copy taken before the call); a `detail: undefined` key is
  dropped.
  Files: `test/core/schema.test.ts`.
  Covers: R8.1, R8.2.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [ ] T4.2 Property P-RG1 canonical, except the `checkPlan` clause, which is added in T6.6.
  Files: `test/core/schema.pbt.ts`.
  Covers: R8.1–R8.3, R8.4 (idempotence).
  Command: `npx vitest run --project props test/core/schema.pbt.ts`
- [ ] T4.3 Implement `canonicalPlan` until T4.1 and T4.2 pass.
  Files: `src/core/schema.ts`.
  Covers: R8.1–R8.4.
  Command: `npx vitest run --project examples test/core/schema.test.ts && npx vitest run --project props test/core/schema.pbt.ts`

## T5. Parsing

- [ ] T5.1 Example tests for `parsePlan` and `parseKitchen`, asserting exact issues
  (every field, message included): `null`, `42`, `''`, `[]`, `{}`; each of `empty_plan`
  (once when both arrays are empty), `too_many_dishes`, `too_many_steps`,
  `minutes_out_of_range` and `invalid_field` firing and not firing; `stepId` and `dishId`
  present only when the element's id is valid; position wording (`Step 4`) and 0-based
  `field` paths; an unknown key reported without naming it; a fixture parses to a
  deep-equal plan in the same order; messages contain no title, name or detail text.
  Files: `test/core/sanity.test.ts`, `src/core/sanity.ts` (stub).
  Covers: R2.1–R2.8, R7.1, R7.2.
  Command: `npx vitest run --project examples test/core/sanity.test.ts`
- [ ] T5.2 Property P-RG8 JSON round trip.
  Files: `test/core/schema.pbt.ts`.
  Covers: R1.1, R2.2.
  Command: `npx vitest run --project props test/core/schema.pbt.ts`
- [ ] T5.3 Implement `sortIssues`, `hasErrors`, `parsePlan` and `parseKitchen`, mapping
  zod issues by path only, until T5.1 and T5.2 pass.
  Files: `src/core/sanity.ts`.
  Covers: R2.1–R2.8, R7.1–R7.3.
  Command: `npx vitest run --project examples test/core/sanity.test.ts && npx vitest run --project props test/core/schema.pbt.ts`

## T6. Plan and kitchen rules

- [ ] T6.1 Example tests for `checkPlan` errors: one firing and one non-firing example per
  code (`unknown_dependency`, `self_dependency`, `cycle`, `duplicate_step_id`,
  `duplicate_dish_id`, `unknown_dish`, `dish_without_steps`), asserting exact issues; the
  three fixtures give `[]`; issue order follows `sortIssues` on a plan with several errors.
  Files: `test/core/sanity.test.ts`.
  Covers: R4.1–R4.6, R7.3.
  Command: `npx vitest run --project examples test/core/sanity.test.ts`
- [ ] T6.2 Example tests for warnings: `appliance_mismatch` ("Roasting tin" on a `none`
  step fires with `word: 'roast'`, "stir-fry" fires, `"saute\u0301"` fires after NFC,
  detail-only match fires, the title match wins over the detail, "ovenproof", "boiler" and
  "roaster" do not fire, a `burner` step with "boil" does not fire); `long_hands_on` at 45
  (no) and 46 (yes); `short_hands_free` at 1 (yes), 2 (no), and 1 with `handsOn` or an
  appliance (no); `hasErrors` is false for a warnings-only list.
  Files: `test/core/sanity.test.ts`.
  Covers: R5.1–R5.4.
  Command: `npx vitest run --project examples test/core/sanity.test.ts`
- [ ] T6.3 Example tests for `checkKitchen` and `validatePlan`: `SUNDAY_ROAST` with
  `burners: 0` gives exactly the three `missing_appliance` errors of the design;
  `TIGHT_OVEN` with `ovens: 0` the two; `HOME_KITCHEN` gives `[]`; a duplicated burner
  step gives one issue; `validatePlan` returns `{ plan: null, issues }` for `{}` and
  `{ plan, issues: [] }` for a fixture's JSON.
  Files: `test/core/sanity.test.ts`.
  Covers: R2.9, R6.1.
  Command: `npx vitest run --project examples test/core/sanity.test.ts`
- [ ] T6.4 Property S1 total.
  Files: `test/core/sanity.pbt.ts`.
  Covers: R2.1, R2.8, R2.9, R7.1.
  Command: `npx vitest run --project props test/core/sanity.pbt.ts`
- [ ] T6.5 Property S2 sound, one `it` per error code with the title
  `S2 sound: <code> ...`, plus one for valid plans and kitchens.
  Files: `test/core/sanity.pbt.ts`.
  Covers: R2.3–R2.7, R4.1–R4.7, R6.1, R6.2, R10.3.
  Command: `npx vitest run --project props test/core/sanity.pbt.ts`
- [ ] T6.6 Property P-RG2 order-free, and the `checkPlan(canonicalPlan(p))` clause of
  P-RG1.
  Files: `test/core/sanity.pbt.ts`, `test/core/schema.pbt.ts`.
  Covers: R3.9, R7.3, R7.4, R8.4.
  Command: `npx vitest run --project props test/core/sanity.pbt.ts test/core/schema.pbt.ts`
- [ ] T6.7 Property P-RG9 warnings.
  Files: `test/core/sanity.pbt.ts`.
  Covers: R5.1–R5.3.
  Command: `npx vitest run --project props test/core/sanity.pbt.ts`
- [ ] T6.8 Implement `checkPlan`, `checkKitchen` and `validatePlan` until T6.1 to T6.7
  pass.
  Files: `src/core/sanity.ts`.
  Covers: R2.9, R4.1–R4.7, R5.1–R5.4, R6.1, R6.2, R7.1–R7.4.
  Command: `npx vitest run --project examples test/core/sanity.test.ts && npx vitest run --project props test/core/sanity.pbt.ts test/core/schema.pbt.ts`

## T7. Recipe text normalisation

- [ ] T7.1 Example tests: one per rule of R9.1 (NFC, CRLF, lone CR, trailing spaces and
  tabs, three blank lines become one, a line of only spaces counts as blank, leading and
  trailing trim, indentation kept), each with the expected string written out; each
  `samples/*.md` normalises without throwing and is idempotent.
  Files: `test/core/normalise.test.ts`, `src/core/normalise.ts` (stub).
  Covers: R9.1, R9.2.
  Command: `npx vitest run --project examples test/core/normalise.test.ts`
- [ ] T7.2 Property P-RG7 normalise.
  Files: `test/core/normalise.pbt.ts`.
  Covers: R9.1, R9.2.
  Command: `npx vitest run --project props test/core/normalise.pbt.ts`
- [ ] T7.3 Implement `normaliseRecipeText` until T7.1 and T7.2 pass.
  Files: `src/core/normalise.ts`.
  Covers: R9.1, R9.2.
  Command: `npx vitest run --project examples test/core/normalise.test.ts && npx vitest run --project props test/core/normalise.pbt.ts`

## T8. Public surface and the whole suite

- [ ] T8.1 Example test that every name listed in the design's `src/core/index.ts`
  section is exported from `src/core/index.js` (values with `typeof`, types with
  `expectTypeOf`); then add the exports.
  Files: `test/core/index.test.ts`, `src/core/index.ts`.
  Covers: N4.
  Command: `npx vitest run --project examples test/core/index.test.ts`
- [ ] T8.2 Run the wider suite and fix what it finds (never by weakening a check).
  Files: none expected.
  Covers: N1–N3, N5.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check .`
