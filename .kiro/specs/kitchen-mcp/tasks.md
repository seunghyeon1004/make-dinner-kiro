# Tasks: kitchen-mcp

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every
task: `testing.md`, `kiro-conduct.md`. Prerequisites: every task of the recipe-graph, scheduler,
rebuild and dinnerfile specs is ticked (true today). T3.2, the by-hand part of T3.3 and T4.2 also
need `samples/index.json` and `src/server/parse/recordings.ts` (recipe-reader spec) and the
recordings, which only the user can make with `npm run record` (design, F4).

How each task is done (`testing.md`): write the test; if the module is missing, add it with the
design's signatures and placeholder bodies so the test fails on an assertion; see it fail; write
the smallest code that passes; run it again. "Tests, then implement" means both, in that order.
Tick only after the task's command passed in the same session, with `ANTHROPIC_API_KEY` unset;
never start `npm run mcp` from an agent session (the stdio test starts and stops its own server).

## T1. Text and samples (pure)

- [ ] T1.1 Example tests for `src/mcp/text.ts`: the plan list of `H1_SCHEDULE` equals the design's
  13 lines; for `H3_SCHEDULE` the `potatoes.roast` line ends with `, waits <w> min (hold <h> min)`
  and a `Warning:` line carries its message (H3 table values); the RB-a rebuilt schedule gives the
  serving, `Moved:`, `done` and `running` lines; the other tools' summaries on hand-written inputs.
  Files: `test/mcp/text.test.ts`, `src/mcp/text.ts` (stubs).
  Covers: KM5.1, KM5.2.
  Command: `npx vitest run --project examples test/mcp/text.test.ts`
- [ ] T1.2 Implement `text.ts` until T1.1 passes.
  Files: `src/mcp/text.ts`.
  Covers: KM5.1, KM5.2.
  Command: `npx vitest run --project examples test/mcp/text.test.ts && npm run typecheck`
- [ ] T1.3 Example tests for `src/mcp/samples.ts` with `memorySamples`: index order; `getSample`
  returns the entry, `SUNDAY_ROAST` as plan and its issues (SHA-256 computed in the test with
  `node:crypto`); each problem in the design's order gives its code and exact line;
  `fileSampleSource` on a temp directory reads, gives `null` when missing, refuses `../x` and `A`.
  Files: `test/mcp/samples.test.ts`, `test/support/mcp.ts`, `src/mcp/samples.ts` (stubs).
  Covers: KM2.6, KM4.1, KM4.2.
  Command: `npx vitest run --project examples test/mcp/samples.test.ts`
- [ ] T1.4 Implement `samples.ts` (schemas as in design F4) until T1.3 passes.
  Files: `src/mcp/samples.ts`.
  Covers: KM4.1, KM4.2.
  Command: `npx vitest run --project examples test/mcp/samples.test.ts && npm run typecheck`

## T2. Tools over the in-memory transport

- [ ] T2.1 Add `connectInProcess` to `test/support/mcp.ts`. Tests: `tools/list` has exactly the
  seven names, each with a description, the three annotations, the design's required input keys
  and an output schema; `check_plan` on `SUNDAY_ROAST`, on a plan with an unknown dependency
  (code, step id) and on `42` (not valid, the parse issue); `schedule_plan(SUNDAY_ROAST,
  HOME_KITCHEN)` deep-equals `H1_SCHEDULE` with the design's text and JSON blocks;
  `missing_appliance` with `BURNER_ONLY_KITCHEN`; `invalid_plan` on a cycle; 9 burners and tool
  `nope` give `isError`; two equal calls give deep-equal results.
  Files: `test/support/mcp.ts`, `test/mcp/tools.test.ts`, `src/mcp/server.ts`, `src/mcp/tools.ts` (stubs).
  Covers: KM1.1, KM1.3, KM2.1, KM2.2, KM3.1, KM3.3, KM6.1.
  Command: `npx vitest run --project examples test/mcp/tools.test.ts`
- [ ] T2.2 Implement `createKitchenServer`, `toCallToolResult`, `guarded` and the `check_plan` and
  `schedule_plan` handlers until T2.1 passes.
  Files: `src/mcp/server.ts`, `src/mcp/tools.ts`.
  Covers: KM1.1–KM1.3, KM2.1, KM2.2, KM3.1.
  Command: `npx vitest run --project examples test/mcp/tools.test.ts && npm run typecheck`
- [ ] T2.3 Tests, then implement: `rebuild_plan(H1_SCHEDULE, RB_A_PROGRESS, RB_A_NOW)` gives RB-a's
  hand-worked diff, serving minute and text; its output is accepted back; each reachable rebuild
  error (`invalid_schedule` reason `step_ids`, `invalid_now`, `unknown_step`,
  `done_ends_before_start`, `done_after_now`, `running_starts_after_now`, `serving_out_of_range`)
  has its exact message and details.
  Files: `test/mcp/tools.test.ts`, `src/mcp/tools.ts`.
  Covers: KM2.3, KM3.1, KM5.1.
  Command: `npx vitest run --project examples test/mcp/tools.test.ts -t rebuild_plan`
- [ ] T2.4 Tests, then implement: `export_dinnerfile(SUNDAY_ROAST)` gives `SUNDAY_ROAST_DINNERFILE`,
  and with `options` the dinnerfile design's `# kitchen` and `# serve` lines; importing it gives
  `canonicalPlan(SUNDAY_ROAST)`; without its `# plan` line, `invalid_dinnerfile` with `missing_plan`
  and line `null`; one broken line gives that line number; a sanity error is a success with the
  error issue; a plan failing the schema gives `invalid_plan`.
  Files: `test/mcp/tools.test.ts`, `src/mcp/tools.ts`.
  Covers: KM2.4, KM2.5, KM3.1.
  Command: `npx vitest run --project examples test/mcp/tools.test.ts -t dinnerfile`
- [ ] T2.5 Tests, then implement: `list_samples` and `get_sample` over the transport with
  `memorySamples` (success, `samples_unavailable`, `not_found`, `sample_unavailable`); `internal`
  from a throwing source: fixed message, no stack frame or absolute path in any block, the log fake
  received the stack; arguments of 20,001 elements are rejected with `isError`.
  Files: `test/mcp/tools.test.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`.
  Covers: KM2.6, KM3.1, KM3.2, KM4.2, KM6.1.
  Command: `npx vitest run --project examples test/mcp/tools.test.ts && npm run typecheck`

## T3. Entry point, lint and registration

- [ ] T3.1 Add the design's lint rules to the `src/mcp/**` block. ESLint API test (`lintText`,
  `filePath: 'src/mcp/probe.ts'`): `fetch('x')`, `process.env.X`, `import { writeFileSync } from
  'node:fs'`, `import 'node:child_process'` each report the expected rule; `readFileSync` does not.
  Files: `eslint.config.js`, `test/mcp/lint.test.ts`.
  Covers: KM6.1.
  Command: `npx vitest run --project examples test/mcp/lint.test.ts && npm run lint`
- [ ] T3.2 Write `src/mcp/index.ts` and the `mcp` script; `stdio.test.ts` as in the design; a
  parity test that the copied schemas in `samples.ts` and those of `src/server/parse/recordings.ts`
  accept and reject the same values on the recipe-reader fixtures (needs the prerequisites above).
  Files: `src/mcp/index.ts`, `package.json`, `test/mcp/stdio.test.ts`, `test/mcp/samples.test.ts`.
  Covers: KM6.1, KM6.2, KM8.1.
  Command: `npx vitest run --project examples test/mcp/stdio.test.ts test/mcp/samples.test.ts && npm run build && test -f dist/mcp/index.js`
- [ ] T3.3 Write `.kiro/settings/mcp.json`; `config.test.ts` asserts its command, args, the `mcp`
  script and `autoApprove` (sorted, equal to the `tools/list` names). By hand (the user): Kiro's MCP
  panel shows `make-dinner` with seven tools (Q2); "schedule the Sunday roast with one burner"
  calls `get_sample` and `schedule_plan`.
  Files: `.kiro/settings/mcp.json`, `test/mcp/config.test.ts`.
  Covers: KM6.2.
  Command: `npx vitest run --project examples test/mcp/config.test.ts`

## T4. The taster

- [ ] T4.1 Check the agent config fields against the Kiro docs (Q3), then write `taster.json` with
  the design's prompt; `config.test.ts` asserts `tools` is exactly `["read", "@make-dinner"]`, the
  deny rules, and that the prompt names K1 to K3 and the three checks.
  Files: `.kiro/agents/taster.json`, `test/mcp/config.test.ts`.
  Covers: KM7.1, KM7.2.
  Command: `npx vitest run --project examples test/mcp/config.test.ts`
- [ ] T4.2 (user) Write `docs/kiro-evidence/prompts/<nn>-taster-sunday-roast.md`, run the design's
  command, and read the transcript: `get_sample` once, `schedule_plan` at least twice, no write or
  shell tool, every quoted line present in a tool result.
  Files: `docs/kiro-evidence/taster-sunday-roast.txt` (written by the script).
  Covers: KM7.2.
  Command: `grep -c "schedule_plan" docs/kiro-evidence/taster-sunday-roast.txt`

## T5. README and the whole suite

- [ ] T5.1 Write the design's README section; `config.test.ts` asserts it names `dist/mcp/index.js`,
  `npm run build` and all seven tools.
  Files: `README.md`, `test/mcp/config.test.ts`.
  Covers: KM6.3.
  Command: `npx vitest run --project examples test/mcp/config.test.ts && npx prettier --check README.md`
- [ ] T5.2 Run the wider suite and fix what it finds, never by weakening a check; confirm nothing in
  `src/mcp` computes a start, slack, lane or issue itself (N1).
  Files: none expected.
  Covers: KM1.2, N1.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check . && npm run build`
