# Tasks: dinnerfile

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every
task: `testing.md`, `kiro-conduct.md`. Prerequisite: every task of the recipe-graph spec is
ticked (this spec uses `canonicalPlan`, `compareIds`, `parsePlan`, `parseKitchen`,
`validatePlan`, `terminalSteps`, the generators, fixtures, oracles and `fcParams`). T4.1 also
needs scheduler task T3.1 (`test/meta/guarantee-claims.ts`). Conflicts C1 to C3 in the design
need the user's answer before T1.6, T2.1 and T3.1 are started.

How each task is done (from `testing.md`, "Order of work"):

1. Write the test named in the task.
2. If the module does not exist yet, add it with the exported signatures from `design.md`
   and bodies that return a placeholder of the right type (`err([])`, `''`, `[]`), so the
   test compiles and fails on an assertion, not on a missing import or a type error.
3. Run the task's command and see the expected assertion fail.
4. Write the smallest code that makes it pass. Run the command again.

A task is ticked only after its command passed in the same session. Commands run with
`ANTHROPIC_API_KEY` unset. Tests in `test/core/dinnerfile-make.*` and `test/meta/make.test.ts`
need GNU Make on `PATH` and fail without it. If an extended generator makes an existing
property fail, the counterexample becomes a named example test in the matching `*.test.ts`
with its seed in a comment before anything else changes (`testing.md`).

## T1. Types and test support

- [x] T1.1 Example tests for `ServeTimeSchema`: `00:00`, `09:05`, `19:00`, `23:59` pass;
  `24:00`, `7:00`, `19:60`, `19:00 `, `1900`, `''` fail. Then add `SERVE_TIME_PATTERN`,
  `ServeTimeSchema` and `ServeTime`, and `src/core/dinnerfile.ts` with the design's types and
  both functions returning `err([])`.
  Files: `test/core/schema.test.ts`, `src/core/schema.ts`, `src/core/dinnerfile.ts` (stub).
  Covers: R5.1.
  Command: `npx vitest run --project examples test/core/schema.test.ts && npm run typecheck`
- [x] T1.2 Extend `arbNonBlank`, `arbDishId` and `arbSlug`, and add `arbHostileText`,
  `arbServeTime`, `arbDinnerfileOptions` and `arbAnyDinnerfileOptions` as in the design.
  Meta tests from `fc.sample` with a fixed seed: every extended `arbPlan` value still passes
  the existing validity checks; the samples hold every hostile token, a `dinner` dish, a
  directive-word dish and a slug with a leading `-`; `arbServeTime` matches
  `SERVE_TIME_PATTERN`; `arbAnyDinnerfileOptions` yields valid and invalid values; options
  keys are absent, never `undefined`. Then run the existing property suite.
  Files: `test/support/arbitraries.ts`, `test/meta/arbitraries.test.ts`.
  Covers: R10.1.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts && npm run test:props`
- [x] T1.3 Write `SUNDAY_ROAST_DINNERFILE`, `SUNDAY_ROAST_MAKE_DINNER`,
  `SUNDAY_ROAST_MAKE_GRAVY`, `WORST_CASE`, `WORST_CASE_DINNERFILE` and
  `WORST_CASE_MAKE_DINNER` by hand exactly as the design gives them (tabs as `\t`, lines
  joined with `'\n'`, a final `'\n'`), each with a comment saying where it was worked out.
  Example test: `WORST_CASE` passes `PlanSchema` and `validatePlan` gives it no issue.
  Files: `test/support/fixtures.ts`, `test/core/sanity.test.ts`.
  Covers: R10.3.
  Command: `npx vitest run --project examples test/core/sanity.test.ts`
- [x] T1.4 Example tests for the oracles, against the hand-written fixtures only:
  `oracleDinnerfile(SUNDAY_ROAST, {})` equals `SUNDAY_ROAST_DINNERFILE` and
  `oracleDinnerfile(WORST_CASE, {})` equals `WORST_CASE_DINNERFILE`; `oracleEncodeText` and
  `oracleEchoText` on the worst-case title give the design's strings; `oracleMakeLines`
  gives `other` for `export : x`, `X = 1`, `\t@echo '$$(MAKE)' # a.b` and a comment ending
  in `\`; `decodeEchoLine` decodes `WORST_CASE_MAKE_DINNER`; `oracleNeededSteps` and
  `oracleDishLastSteps` give the design's values. Then write the oracles with plain loops,
  importing from `src/core` only types and schemas.
  Files: `test/meta/oracles.test.ts`, `test/support/oracles.ts`.
  Covers: R10.2.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts`
- [x] T1.5 Add `arbDinnerfileStyle`, `arbDinnerfileLikeText` and `arbBreakingEdit`. Meta tests
  from `fc.sample` with a fixed seed: the style samples cover every style field;
  `oracleDinnerfile` with `CANONICAL_STYLE` equals `oracleDinnerfile` with no style; every
  breaking case's line is `null` or within its text, points at the edited line, and every row
  of the design's edit table occurs.
  Files: `test/support/arbitraries.ts`, `test/meta/arbitraries.test.ts`.
  Covers: R10.1.
  Command: `npx vitest run --project examples test/meta/arbitraries.test.ts`
- [x] T1.6 Add `gnuMakeVersion`, `makeDir`, `runMake` and `fcMakeParams`. Meta tests:
  `gnuMakeVersion()` starts with `GNU Make`; `gnuMakeVersion('')` throws the design's
  message; `runMake` on a two-rule text prints the expected line with status 0 and empty
  stderr; `fcMakeParams()` gives 50, and `FC_MAKE_RUNS=7` gives 7; the directory is removed
  in `afterAll`.
  Files: `test/support/make.ts`, `test/support/fc-params.ts`, `test/meta/make.test.ts`.
  Covers: R9.3, R10.4, R10.5.
  Command: `npx vitest run --project examples test/meta/make.test.ts && npm run typecheck`

## T2. Export

- [x] T2.1 Example tests for `toDinnerfile` from the design's outline: `SUNDAY_ROAST`
  character for character against `SUNDAY_ROAST_DINNERFILE`; the kitchen and serve lines at
  lines 7 and 8; `WORST_CASE` against `WORST_CASE_DINNERFILE`; a hand-shuffled plan; a dish
  with no steps; a dish `dinner`; a plan with a cycle; the exact issues for a step id `a b`,
  `serve: '24:00'` and `kitchen.cooks: 0`.
  Files: `test/core/dinnerfile.test.ts`.
  Covers: R1.1–R1.9, R2.1, R3.1–R3.3, R4.1–R4.3, R5.2.
  Command: `npx vitest run --project examples test/core/dinnerfile.test.ts`
- [x] T2.2 Example tests that run GNU Make on `toDinnerfile` output (not on the fixtures
  directly): `make -n dinner` on `SUNDAY_ROAST` prints exactly `SUNDAY_ROAST_MAKE_DINNER`;
  `make -n gravy` exactly `SUNDAY_ROAST_MAKE_GRAVY`; `make -n` with no goal the same as
  `dinner`; `make -n dinner` on `WORST_CASE` exactly `WORST_CASE_MAKE_DINNER`; `make dinner`
  without `-n` on `WORST_CASE` exits 0 and leaves only `Dinnerfile` in the directory; `MEZZE`
  and `TIGHT_OVEN` pass the D2 checks.
  Files: `test/core/dinnerfile-make.test.ts`.
  Covers: R1.5, R3.5, R3.6, R4.2, R9.1, R9.2.
  Command: `npx vitest run --project examples test/core/dinnerfile-make.test.ts`
- [x] T2.3 Properties P-DF2 Make lines, P-DF6 echo, P-DF9 order-free and P-DF10 layout, with
  `fcParams()`.
  Files: `test/core/dinnerfile.pbt.ts`.
  Covers: R1.1–R1.9, R2.1–R2.3, R3.1–R3.4, R4.1–R4.3, R5.2, R5.3.
  Command: `npx vitest run --project props test/core/dinnerfile.pbt.ts`
- [x] T2.4 Properties D2 make agrees and P-DF7 dish target, with `fcMakeParams()` and one
  `makeDir()` per file.
  Files: `test/core/dinnerfile-make.pbt.ts`.
  Covers: R3.5, R9.1, R9.2, N3.
  Command: `npx vitest run --project props test/core/dinnerfile-make.pbt.ts`
- [x] T2.5 Implement `toDinnerfile` (validation, layout, `enc`, `echoArg`, last steps) until
  T2.1 to T2.4 pass.
  Files: `src/core/dinnerfile.ts`.
  Covers: R1–R5, N1, N3.
  Command: `npx vitest run --project examples test/core/dinnerfile.test.ts test/core/dinnerfile-make.test.ts && npx vitest run --project props test/core/dinnerfile.pbt.ts test/core/dinnerfile-make.pbt.ts`

## T3. Import

- [x] T3.1 Example tests for accepted files: `SUNDAY_ROAST_DINNERFILE` gives
  `ok({ plan: canonicalPlan(SUNDAY_ROAST), options: {} })`; each tolerant variant of the
  design's outline, written by hand, gives the same; `# kitchen` and `# serve` give the
  options; `WORST_CASE_DINNERFILE` gives `canonicalPlan(WORST_CASE)` with the lone surrogate,
  tab, CR, NUL and trailing spaces intact.
  Files: `test/core/dinnerfile.test.ts`.
  Covers: R2.4, R5.4, R6.1–R6.7.
  Command: `npx vitest run --project examples test/core/dinnerfile.test.ts`
- [x] T3.2 Example tests for errors: for each code of the error table one firing example
  asserting the exact error list (every field, message included) and the non-firing
  neighbours of the design's outline; several errors in line order; no `target_without_step`
  after a bad `# step` value; no mismatch error when a line is broken (R7.13); `''` gives
  exactly `missing_plan`.
  Files: `test/core/dinnerfile.test.ts`.
  Covers: R7.1–R7.13.
  Command: `npx vitest run --project examples test/core/dinnerfile.test.ts`
- [x] T3.3 Properties D1 round trip, P-DF1 total, P-DF3 options, P-DF4 tolerant, P-DF5
  breaking and P-DF8 faults survive, with `fcParams()`.
  Files: `test/core/dinnerfile.pbt.ts`.
  Covers: R1.2, R5.1–R5.4, R6.1–R6.7, R7.1–R7.13, R8.1–R8.3, N2.
  Command: `npx vitest run --project props test/core/dinnerfile.pbt.ts`
- [x] T3.4 Implement `fromDinnerfile` (line reader, field scanner, attachment, duplicates,
  build, mismatch checks, error messages and order) until T3.1 to T3.3 pass, without
  recursion or nested-quantifier regular expressions.
  Files: `src/core/dinnerfile.ts`.
  Covers: R6–R8, N1, N2.
  Command: `npx vitest run --project examples test/core/dinnerfile.test.ts && npx vitest run --project props test/core/dinnerfile.pbt.ts`

## T4. Public surface and the whole suite

- [x] T4.1 Example test that every name in the design's `src/core/index.ts` section is
  exported from `src/core/index.js` (values with `typeof`, types with `expectTypeOf`); then
  add the exports, and add `dinnerfile: ['D']` to `CLAIMS`. Left unticked while scheduler
  T3.1 is unticked.
  Files: `test/core/index.test.ts`, `src/core/index.ts`, `test/meta/guarantee-claims.ts`.
  Covers: N4, D1 and D2 coverage in `test/meta/guarantees.test.ts`.
  Command: `npx vitest run --project examples test/core/index.test.ts test/meta/guarantees.test.ts`
- [x] T4.2 Run the wider suite and fix what it finds (never by weakening a check); check that
  no identifier, message or comment in the file says "task" or "job".
  Files: none expected.
  Covers: N1–N5.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check .`
