# Tasks: rebuild

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every
task: `testing.md`, `kiro-conduct.md`. Prerequisite: every task of the scheduler spec is ticked
(this spec uses `schedule`, the schedule schemas, the timeline, `Readout`, `holdExceededMessage`,
the scheduler oracles, generators and fixtures).

How each task is done (`testing.md`, "Order of work"): write the test named in the task; if the
module does not exist yet, add it with the exported signatures from `design.md` and placeholder
bodies of the right type, so the test fails on an assertion, not on a missing import; run the
task's command and see that assertion fail; write the smallest code that passes; run it again.

A task is ticked only after its command passed in the same session. Commands run with
`ANTHROPIC_API_KEY` unset. A failing property is a rebuild bug until shown otherwise: its
counterexample becomes a named example test in `test/core/rebuild.test.ts` with the seed in a
comment before the fix. If a guarantee itself looks wrong, stop and report (C1 to C5 are already
reported and need the user's decision, not a code change).

## T1. Types

- [x] T1.1 Example tests for the new schemas: `ProgressEntrySchema` (both states, unknown keys,
  non-integer minutes, `extraMin` −1 and 1441 rejected, 0 and 1440 accepted), `ProgressSchema`,
  `RebuiltStepSchema` and `RebuiltScheduleSchema` bounds at their edges (`startMin` −38400 and
  1440, `endMin` 1441 rejected), the refine (a step with `endMin < startMin`, an end after
  `servingMin`), `H1_SCHEDULE` written without `servingMin` parsing with `servingMin` 0,
  `ScheduleSchema` still rejecting `endMin 1`; `RebuildDiffSchema`, `RebuiltSchema`; `AXIS_MIN`
  equals −38400; `expectTypeOf` on the inferred types.
  Files: `test/core/schema.test.ts`, `src/core/schema.ts` (stubs).
  Covers: RQ3.1, RQ3.2.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T1.2 Implement the schemas, `AXIS_MIN` export, `REBUILD_LIMITS` and the types until T1.1
  passes, changing no existing schema.
  Files: `src/core/schema.ts`.
  Covers: RQ3.1, RQ3.2.
  Command: `npx vitest run --project examples test/core/schema.test.ts && npm run typecheck`

## T2. Test support

- [x] T2.1 Add `H1_SCHEDULE`, `H3_SCHEDULE` and the progress fixtures of RB-a, RB-b, RB-b2, RB-c
  and E1 to E8 exactly as in the design, each with its expected rebuild in a comment. Example
  test: the two schedules pass `ScheduleSchema` and their starts, ends and lanes equal the
  scheduler's H1 and H3 tables written out in the test; every progress fixture passes
  `ProgressSchema`.
  Files: `test/support/fixtures.ts`, `test/core/schema.test.ts`.
  Covers: RQ11.1.
  Command: `npx vitest run --project examples test/core/schema.test.ts`
- [x] T2.2 Example tests for the rebuild oracles against hand work: on RB-a, RB-b and E7 written
  out in the test, `oraclePinnedIntervals`, `oracleRebuildWaits`, `oracleRebuildHoldExceeded`
  and `oracleRebuildSlack` give the table values and `oracleForwardRepair` the forward-repair
  starts; RB-a to RB-c give no violation of any kind; the three hand-made broken rebuilds give
  exactly one violation each; E7 gives oven capacity violations at exactly minutes −50 to −41 from
  `oracleRebuildViolations` and none from `oraclePendingOverfull`.
  Files: `test/meta/oracles.test.ts`, `test/support/oracles.ts` (stubs).
  Covers: RQ11.1.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T2.3 Implement the rebuild oracles with plain loops, importing from `src/core` only types
  and schemas, until T2.2 passes.
  Files: `test/support/oracles.ts`.
  Covers: RQ11.1.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T2.4 Example tests from `fc.sample` with a fixed seed: default `arbProgress` runs respect
  precedence among pinned steps and have no capacity violation at `t >= now`
  (`oracleRebuildViolations` on the pinned steps alone); across 200 samples there is at least one
  early start, one done overrun, one running step with `extraMin > 0`, one overrun without taps,
  one all-done and one nothing-started case; `outOfOrder` and `overCapacity` each produce their
  case at least once; `base` runs keep every base fact; `followPlan` and `arbOnPlan` meet R4's
  premise; `arbNow` stays in its range.
  Files: `test/meta/arbitraries.test.ts`, `test/support/arbitraries.ts` (stubs).
  Covers: RQ11.1.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts`
- [x] T2.5 Implement `arbScheduled`, `arbNow`, `arbProgress`, `followPlan` and `arbOnPlan` until
  T2.4 passes, changing no existing generator.
  Files: `test/support/arbitraries.ts`.
  Covers: RQ11.1.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts && npm run typecheck`

## T3. Forward repair and re-align

- [x] T3.1 Example tests: `timelineFrom` clips at `fromMin`; `forwardRepair` gives the
  forward-repair starts of RB-a, RB-b, RB-b2, RB-c, E3 and E8 (ready order: boil before toss);
  `reAlign` on RB-a's and E3's forward-repair intervals gives their final starts and on RB-b's
  moves nothing.
  Files: `test/core/rebuild.test.ts`, `src/core/timeline.ts`, `src/core/passes/forward-repair.ts`,
  `src/core/passes/re-align.ts` (stubs).
  Covers: RQ2.2, RQ2.3, RQ4.1, RQ4.2, RQ6.1, RQ6.3.
  Command: `npx vitest run --project examples test/core/rebuild.test.ts`
- [x] T3.2 Implement `Interval`, `timelineFrom`, `forwardRepair` and `reAlign` with their bounds
  (N1) until T3.1 passes.
  Files: `src/core/timeline.ts`, `src/core/passes/forward-repair.ts`, `src/core/passes/re-align.ts`.
  Covers: RQ4.1, RQ4.2, RQ6.1, RQ6.3, N1.
  Command: `npx vitest run --project examples test/core/rebuild.test.ts`

## T4. Lanes and readout

- [x] T4.1 Example tests: `assignRebuildLanes` on RB-a, RB-b, E6 and E7 gives the lanes in the
  design (H1's lanes, boil burner 2, both oven steps lane 1); `rebuildReadout` gives the slack,
  wait and warning values of RB-a, RB-b, RB-b2, RB-c, E1, E2, E5, E5′ and E6, with the exact
  messages of RB-a.
  Files: `test/core/rebuild.test.ts`, `src/core/passes/lanes.ts`, `src/core/passes/readout.ts`.
  Covers: RQ7.1, RQ7.2, RQ8.1–RQ8.4.
  Command: `npx vitest run --project examples test/core/rebuild.test.ts`
- [x] T4.2 Implement `assignRebuildLanes` and `rebuildReadout` until T4.1 passes, changing no
  scheduler pass.
  Files: `src/core/passes/lanes.ts`, `src/core/passes/readout.ts`.
  Covers: RQ7.1, RQ7.2, RQ8.1–RQ8.4.
  Command: `npx vitest run --project examples test/core/rebuild.test.ts`

## T5. `rebuild`

- [x] T5.1 Example tests through `rebuild`: RB-a, RB-b, RB-b2 and RB-c in full (every column,
  lanes, warnings, `servingMin`, `spanMin`, `chainMin`, diff); E1 to E8; every error case of the
  design with its exact error; RB-a's output rebuilt with RB-a's progress and now equals RB-a's
  schedule with an empty diff; arguments unchanged after the call.
  Files: `test/core/rebuild.test.ts`, `src/core/rebuild.ts` (stub).
  Covers: RQ1.1–RQ1.3, RQ2.1–RQ2.4, RQ3.3, RQ5.1, RQ5.2, RQ6.2, RQ9.1–RQ9.3, RQ11.2.
  Command: `npx vitest run --project examples test/core/rebuild.test.ts`
- [x] T5.2 Implement `rebuild` (checks, pinned intervals, the passes, assembly, diff) until T5.1
  passes.
  Files: `src/core/rebuild.ts`.
  Covers: RQ1.1–RQ1.3, RQ2, RQ3.3, RQ5, RQ6.2, RQ9.
  Command: `npx vitest run --project examples test/core/rebuild.test.ts`

## T6. Properties

- [x] T6.1 Add `rebuild: ['R']` to `CLAIMS`; properties R1 valid and R2 pinned. The coverage
  check in `test/meta/guarantees.test.ts` lists R3 to R6 as missing until T6.3; T7.1 runs it.
  Files: `test/meta/guarantee-claims.ts`, `test/core/rebuild.pbt.ts`.
  Covers: RQ10.1, RQ2.2, RQ3.3, RQ11.2.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^R[12] "`
- [x] T6.2 Properties R3 never earlier and R4 no slip.
  Files: `test/core/rebuild.pbt.ts`.
  Covers: RQ4.2, RQ6.2, RQ6.3.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^R[34] "`
- [x] T6.3 Properties R5 serving time and R6 honest diff.
  Files: `test/core/rebuild.pbt.ts`.
  Covers: RQ5.1, RQ9.1, RQ9.2.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^R[56] "`
- [x] T6.4 Properties P-RB1 idempotent, P-RB2 no slip twice and P-RB3 slips twice.
  Files: `test/core/rebuild.pbt.ts`.
  Covers: RQ9.3, RQ5.1, RQ10.1.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^P-RB[123] "`
- [x] T6.5 Properties P-RB4 reality first, P-RB5 lanes and P-RB6 readout.
  Files: `test/core/rebuild.pbt.ts`.
  Covers: RQ2.1, RQ7, RQ8, RQ10.1.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^P-RB[456] "`
- [x] T6.6 Properties P-RB7 errors, P-RB8 order-free and P-RB9 schema.
  Files: `test/core/rebuild.pbt.ts`.
  Covers: RQ1, RQ3, RQ9.3.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^P-RB[789] "`

- [x] T6.9 (added by hand after T6: the mutation check in the T5 to T7 session showed that
  removing the re-align pass failed no property) Property R7 re-aligned, as worded in
  `scheduler-guarantees.md`: for rebuilds with `servingShiftMin > 0`, no pending step with
  `holdMin !== null` has a valid later position (reuse `oracleLatestPosition`, extended to take
  the serving minute and the pinned intervals, with one example test on RB-a). Show it can
  fail: run it once with re-align skipped (a temporary local edit, restored afterwards) and
  report the counterexample. Add R7 to the design's property table.
  Files: `test/support/oracles.ts`, `test/meta/oracles.test.ts`, `test/core/rebuild.pbt.ts`,
  `.kiro/specs/rebuild/design.md` (property table only).
  Covers: R7.
  Command: `npx vitest run --project props test/core/rebuild.pbt.ts -t "^R7 " && npm test`

## T7. Public surface and the whole suite

- [x] T7.1 Example test that `rebuild`, `RebuildError`, the new schemas and their types are
  exported from `src/core/index.js` and that `forwardRepair`, `reAlign`, `assignRebuildLanes`,
  `rebuildReadout` and `timelineFrom` are not; add the exports. Then run the guarantee coverage
  check in full (R1 to R6 now required).
  Files: `test/core/index.test.ts`, `src/core/index.ts`.
  Covers: N2, RQ11.2.
  Command: `npx vitest run --project examples test/core/index.test.ts test/meta/guarantees.test.ts`
- [x] T7.2 Run the wider suite and fix what it finds, never by weakening a check; confirm no
  identifier, message or comment in the new files says "optimal" or "shortest".
  Files: none expected.
  Covers: N1–N3.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check .`
