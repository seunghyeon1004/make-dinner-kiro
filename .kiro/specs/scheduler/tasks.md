# Tasks: scheduler

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every
task: `testing.md`, `kiro-conduct.md`. Prerequisite: every task of the recipe-graph spec is
ticked (this spec uses its schemas, graph helpers, `validatePlan`, generators, fixtures and
`fcParams`).

How each task is done (from `testing.md`, "Order of work"):

1. Write the test named in the task.
2. If the module does not exist yet, add it with the exported signatures from `design.md` and
   bodies that return a placeholder of the right type (`new Map()`, `[]`, `err(...)`), so the
   test compiles and fails on an assertion, not on a missing import or a type error.
3. Run the task's command and see the expected assertion fail.
4. Write the smallest code that makes it pass. Run the command again.

A task is ticked only after its command passed in the same session. Commands run with
`ANTHROPIC_API_KEY` unset. Single-file runs use `npx vitest run --project <examples|props>
<file>`.

## T1. Schedule types and the `hold_exceeded` issue

- [x] T1.1 Example tests for `StepLanesSchema`, `ScheduledStepSchema` and `ScheduleSchema`: each
  bound at its edge and one past it (`startMin` −38400 and −1 vs −38401 and 0, `endMin` 0 vs 1,
  lane 0 and 9, negative slack, negative wait), unknown keys rejected, the H1 table written out
  as a `Schedule` parses; `IssueSchema` accepts a `hold_exceeded` warning and rejects it as an
  error or without `waitMin`; `WARNING_CODES` ends with `hold_exceeded` (extend the recipe-graph
  expectation in the same file by appending, never by removing); `expectTypeOf` on the types.
  Files: `test/core/schema.test.ts`, `src/core/schema.ts` (stubs).
  Covers: R2.1, R2.2, R2.6, R2.7, R2.8.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T1.2 Implement the three schemas, their types, `HoldExceededIssue` and the `hold_exceeded`
  variant until T1.1 passes.
  Files: `src/core/schema.ts`.
  Covers: R2.1, R2.2, R2.6, R2.7, R2.8.
  Command: `npx vitest run --project examples test/core/schema.test.ts && npm run typecheck`

## T2. Test support

- [x] T2.1 Add `PREP_AHEAD`, `SOLO_BURNER`, `SOLO_KEEPS`, `HANDS_FREE`, `TWO_CHOPS`, `LONG_DAY`,
  `COLD_SAUCE` and the kitchens `ONE_BURNER_KITCHEN`, `NO_BURNER_KITCHEN`, `BURNER_ONLY_KITCHEN`,
  `BARE_KITCHEN`, `BIG_KITCHEN` exactly as in the design, steps in non-topological order where
  there is more than one, each with its expected schedule (H1 to H6) in a comment; add the H1 to
  H4 comments to the existing fixtures. Example test: each new plan passes `PlanSchema` and has
  no `checkPlan` error; each kitchen passes `KitchenSchema`.
  Files: `test/support/fixtures.ts`, `test/core/schema.test.ts`.
  Covers: R10.3.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T2.2 Example tests for the new oracles against hand work: on the H1 and H3 starts,
  `oracleSlack`, `oracleWaits` and `oracleHoldExceeded` give the table values; the H1 to H5
  tables give no capacity, precedence, completeness or lane violation; each hand-made broken
  schedule in the design outline gives exactly its one violation; `oracleValid` is false for an
  end after 0; the C2 example gives `oracleSlack = 2`.
  Files: `test/meta/oracles.test.ts`, `test/support/oracles.ts` (stubs).
  Covers: R10.1.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T2.3 Implement the oracles with plain loops, importing from `src/core` only types and
  schemas, until T2.2 passes. Lint or a test asserts the file imports nothing from
  `schedule`, `passes/` or `timeline`.
  Files: `test/support/oracles.ts`.
  Covers: R10.1.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T2.4 Example tests from `fc.sample` with a fixed seed: every `arbUnlimitedPair` kitchen
  has counts `>=` the plan's burner, oven and hands-on step counts and passes `KitchenSchema`,
  every plan has no `checkPlan` error; `arbHandsFreePair` plans have no hands-on step and their
  kitchens have every needed appliance.
  Files: `test/meta/arbitraries.test.ts`, `test/support/arbitraries.ts` (stubs).
  Covers: R10.2.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts`
- [x] T2.5 Implement `arbUnlimitedKitchen`, `fitUnlimited`, `arbUnlimitedPair` and
  `arbHandsFreePair` until T2.4 passes, changing no existing generator.
  Files: `test/support/arbitraries.ts`.
  Covers: R10.2.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts && npm run typecheck`

## T3. Guarantee coverage check

- [x] T3.1 Write `CLAIMS` and `test/meta/guarantees.test.ts` with checks 1 to 6 of the design.
  Parser checks run on the real steering file and on inline strings (a title cut at `${`, a
  prettier-wrapped `it(`, `G4.10` not covering `G4.1`, an unknown `G9` title). Run it and see the
  coverage check fail listing exactly the G ids (S1 and S2 exist from recipe-graph). This task
  is ticked when every check except coverage passes; T9.1 ticks coverage.
  Files: `test/meta/guarantee-claims.ts`, `test/meta/guarantees.test.ts`.
  Covers: R10.5.
  Command: `npx vitest run --project examples test/meta/guarantees.test.ts -t "parser|unknown|claims"`

## T4. Timeline

- [x] T4.1 Example tests for `capacityOf`, `resourcesOf` (all six appliance and hands-on pairs),
  `usage`, `add`, `remove`, `lastFull`, `firstFull`, `latestFit` and `earliestFit`, as in the
  design outline, including the jump over a busy block giving the same answer as trying every
  candidate, an empty resource list, and the floor and ceiling throws.
  Files: `test/core/timeline.test.ts`, `src/core/timeline.ts` (stubs).
  Covers: R3.4, R3.5, N2.
  Command: `npx vitest run --project examples test/core/timeline.test.ts`
- [x] T4.2 Implement `src/core/timeline.ts` until T4.1 passes.
  Files: `src/core/timeline.ts`.
  Covers: R3.4, R3.5, N2, N3.
  Command: `npx vitest run --project examples test/core/timeline.test.ts`

## T5. Backward pass

- [x] T5.1 Example tests: `backwardPass` gives the "pass 1" starts of H1 to H5 written out in the
  test (placement order checked through the H1 and H3 ties: `chicken.carve` before
  `greens.toss`, `pie.bake` before `potatoes.roast`); `SOLO_BURNER` and `LONG_DAY` starts.
  Files: `test/core/passes.test.ts`, `src/core/passes/backward.ts` (stub).
  Covers: R3.1–R3.6, R9.7.
  Command: `npx vitest run --project examples test/core/passes.test.ts`
- [x] T5.2 Implement `backwardPass` until T5.1 passes.
  Files: `src/core/passes/backward.ts`.
  Covers: R3.1–R3.6, N2.
  Command: `npx vitest run --project examples test/core/passes.test.ts`

## T6. Prep-forward and right-justify passes

- [x] T6.1 Example tests: `prepForwardPass` on the pass 1 starts of H1 to H5 gives the moves the
  design states (shred to −100, assemble to −85, hummus, chop, dressing, `salad.chop` to −60)
  and leaves every hot step; `rightJustifyPass` then moves only `bread.shape` (to −13) in H5 and
  nothing in H1 to H4; `COLD_SAUCE` keeps `sauce.whisk` at −13.
  Files: `test/core/passes.test.ts`, `src/core/passes/prep-forward.ts`,
  `src/core/passes/right-justify.ts` (stubs).
  Covers: R4.1–R4.3, R5.1, R5.2, R9.5, R9.6.
  Command: `npx vitest run --project examples test/core/passes.test.ts`
- [x] T6.2 Implement `prepForwardPass` and `rightJustifyPass` until T6.1 passes.
  Files: `src/core/passes/prep-forward.ts`, `src/core/passes/right-justify.ts`.
  Covers: R4.1–R4.3, R5.1, R5.2.
  Command: `npx vitest run --project examples test/core/passes.test.ts`

## T7. Lanes and readout

- [x] T7.1 Example tests: `assignLanes` on the final H1 to H5 starts gives the B, O and C columns
  (`greens.boil` on burner 2 in H1 and burner 1 in H2, `gravy.simmer` on the burner of
  `gravy.roux`, `salad.toss` on the cook of `salad.dressing`); `TWO_CHOPS` × `BIG_KITCHEN` gives
  cook 1 and cook 2.
  Files: `test/core/passes.test.ts`, `src/core/passes/lanes.ts` (stub).
  Covers: R6.1, R6.2, R9.3.
  Command: `npx vitest run --project examples test/core/passes.test.ts`
- [x] T7.2 Implement `assignLanes` until T7.1 passes.
  Files: `src/core/passes/lanes.ts`.
  Covers: R6.1, R6.2.
  Command: `npx vitest run --project examples test/core/passes.test.ts`
- [x] T7.3 Example tests: `readout` on the final H1 to H6 starts gives the slack, wait and
  warning values (`greens.shred` 75 in H1 and 73 in H2, `potatoes.roast` warning with the exact
  message, `b.chop` warning, the non-terminal message wording on a hand-made case, `1 minute`
  singular); `chicken.roast` wait 0, measured to `chicken.rest`, its first user (it was 5,
  measured to `gravy.roux`, before the definition change of 2026-11-11).
  Files: `test/core/passes.test.ts`, `src/core/passes/readout.ts` (stub).
  Covers: R7.1–R7.4, R2.7.
  Command: `npx vitest run --project examples test/core/passes.test.ts`
- [x] T7.4 Implement `readout` and `holdExceededMessage` until T7.3 passes.
  Files: `src/core/passes/readout.ts`.
  Covers: R7.1–R7.4.
  Command: `npx vitest run --project examples test/core/passes.test.ts`

## T8. `schedule`

- [x] T8.1 Example tests: H1 to H6 through `schedule`, every column, warnings, `spanMin`,
  `chainMin`, `plan` equal to the fixture in id order and `kitchen`; the three `ScheduleError`
  kinds and the non-object inputs from the design outline; a warnings-only plan schedules;
  `HANDS_FREE` with 1 and 6 cooks differs only in `kitchen`; `LONG_DAY` within the default timeout.
  Files: `test/core/schedule.test.ts`, `src/core/schedule.ts` (stub).
  Covers: R1.1–R1.8, R2.2–R2.5, R9.1–R9.6, R10.6.
  Command: `npx vitest run --project examples test/core/schedule.test.ts`
- [x] T8.2 Implement `schedule` until T8.1 passes.
  Files: `src/core/schedule.ts`.
  Covers: R1.1–R1.8, R2.2–R2.5.
  Command: `npx vitest run --project examples test/core/schedule.test.ts`
- [x] T8.3 Property G1 capacity.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R8.1, R3.4.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G1 "`
- [x] T8.4 Property G2 precedence.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R8.1.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G2 "`
- [x] T8.5 Property G3 completeness.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R8.1, R2.4.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G3 "`
- [x] T8.6 Property G4.1 landing unlimited.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R8.1.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G4.1 "`
- [x] T8.7 Property G4.2 landing bound.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R8.1.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G4.2 "`
- [x] T8.8 Property G4.3 holds reported.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R2.7, R7.3, R7.4.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G4.3 "`
- [x] T8.9 Property G5.1 hands-free.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R2.6, R9.2.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G5.1 "`
- [x] T8.10 Property G5.2 span bound.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R2.5.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G5.2 "`
- [x] T8.11 Property G5.3 chain bound.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R2.5.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G5.3 "`
- [x] T8.12 Property G6 lanes.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R6.1.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G6 "`
- [x] T8.13 Property G7.1 same input.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R1.7.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G7.1 "`
- [x] T8.14 Property G7.2 order-free.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R8.3, R9.7.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G7.2 "`
- [x] T8.15 Property G8 slack.
  Files: `test/core/schedule.pbt.ts`.
  Covers: R7.1, R7.2.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G8 "`
- [x] T8.16 Properties P-SC1 errors and P-SC2 total.
  Files: `test/core/passes.pbt.ts`.
  Covers: R1.2–R1.4, R1.6.
  Command: `npx vitest run --project props test/core/passes.pbt.ts -t "^P-SC[12] "`
- [x] T8.17 Property P-SC3 passes.
  Files: `test/core/passes.pbt.ts`.
  Covers: R4.2, R4.3, R5.1, R5.2, R8.2.
  Command: `npx vitest run --project props test/core/passes.pbt.ts -t "^P-SC3 "`
- [x] T8.18 Properties P-SC4 schema and P-SC5 lane preference.
  Files: `test/core/passes.pbt.ts`.
  Covers: R2.1, R2.3, R6.2.
  Command: `npx vitest run --project props test/core/passes.pbt.ts -t "^P-SC[45] "`

A failing property is a scheduler bug until shown otherwise: its counterexample becomes a named
example test in `test/core/schedule.test.ts` with the seed in a comment before the fix
(`testing.md`). If a guarantee itself looks wrong, stop and report.

- [x] T8.19 (added by hand after T8: the mutation check in the T8 session showed that skipping
  the right-justify pass failed no property) Property G9 as late as possible: add
  `oracleLatestPosition` to `test/support/oracles.ts` (brute force over every delay
  `1..deadline - end`, no imports from `src/core` beyond types) with an example test on H5,
  where `bread.shape` moves; then the property over `arbPlanAndKitchen()` asserting that no
  step with `holdMin !== null` has any valid later position. Show it can fail: run it once
  against `schedule` with pass 3 skipped (a temporary local edit, restored afterwards) and
  report the counterexample it prints. Add G9 to the design's property table and to `CLAIMS`
  coverage (it is in the G family, so the coverage check will demand it once it is in the
  steering file, which it now is).
  Files: `test/support/oracles.ts`, `test/meta/oracles.test.ts`, `test/core/schedule.pbt.ts`,
  `.kiro/specs/scheduler/design.md` (property table only).
  Covers: G9.
  Command: `npx vitest run --project props test/core/schedule.pbt.ts -t "^G9 " && npm test`

## T9. Public surface and the whole suite

- [x] T9.1 Example test that `schedule`, `ScheduleSchema`, `ScheduledStepSchema`,
  `StepLanesSchema` and the types `Schedule`, `ScheduledStep`, `StepLanes`, `ScheduleError`,
  `HoldExceededIssue` are exported from `src/core/index.js`, and that no pass or timeline name is;
  add the exports. Then run the guarantee coverage check in full.
  Files: `test/core/index.test.ts`, `src/core/index.ts`.
  Covers: N4, R10.4, R10.5.
  Command: `npx vitest run --project examples test/core/index.test.ts test/meta/guarantees.test.ts`
- [x] T9.2 Run the wider suite and fix what it finds (never by weakening a check); check that no
  identifier, message or comment in `src/core` says "optimal" or "shortest".
  Files: none expected.
  Covers: N1–N6.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check .`
