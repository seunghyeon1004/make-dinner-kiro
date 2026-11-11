# Tasks: recipe-reader

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every
task: `testing.md`, `tech.md`, `kiro-conduct.md`.

Prerequisite: recipe-graph tasks T1 to T8 are ticked (`validatePlan`, `checkKitchen`,
`normaliseRecipeText`, `PlanSchema`, `KitchenSchema` and `DishIdSchema` exported from
`src/core/index.ts`). Do not start T1.2 before that.

How each task is done (from `testing.md`, "Order of work"):

1. Write the test named in the task.
2. If the module does not exist yet, add it with the exported signatures from `design.md`
   and bodies that return a placeholder of the right type (`err([])`, `{ ok: true }`,
   `''`, a route that answers nothing), so the test compiles and fails on an assertion,
   not on a missing import or a type error.
3. Run the task's command and see the expected assertion fail.
4. Write the smallest code that makes it pass. Run the command again.

A task is ticked only after its command passed in the same session. Commands run with
`ANTHROPIC_API_KEY` unset. Single-file runs use `npx vitest run --project <examples|props>
<file>`. No task calls the real model; only the user runs `npm run record` (T6.3).

Recordings: until T6.3 there is nothing in `recordings/`. Every test before T6.4 uses the
hand-made fixture in `test/fixtures/not-a-recording/` (T1.2), loaded by `fixtureLibrary()`.
T6.4 adds the tests on the real recordings. From T5.2 until T6.3, `npm start` and the e2e
run stop with the startup message, by design (R2.3).

## T1. Environment and test support

- [ ] T1.1 Example tests for `PARSE_TIMEOUT_MS` (default 60,000; 1,000 and 600,000
  accepted; 999, 600,001 and `abc` rejected, message names the variable, not the value)
  and `PARSE_RATE_PER_IP` (100 accepted, 101 rejected); then add both to `env.ts` and
  `PARSE_TIMEOUT_MS` to `.env.example`.
  Files: `test/server/env.test.ts`, `src/server/env.ts`, `.env.example`.
  Covers: R14.1–R14.3.
  Command: `npx vitest run --project examples test/server/env.test.ts`
- [ ] T1.2 Write `test/fixtures/not-a-recording/` exactly as the design gives it: index,
  `tiny-roast.md`, `tiny-salad.md`, the two recordings with `model:
  "hand-made-not-a-recording"`, and `README.md` with the hand-worked issues and the command
  that computed each `textSha256` (`normaliseRecipeText` from core, SHA-256 from
  `node:crypto`). Add an example test that each fixture `raw` gives exactly the
  hand-worked issues from `validatePlan` and `[]` from `checkKitchen` with its kitchen.
  Files: `test/fixtures/not-a-recording/**`, `test/server/parse/fixtures.test.ts`.
  Covers: R15.1.
  Command: `npx vitest run --project examples test/server/parse/fixtures.test.ts`
- [ ] T1.3 Example tests for the new fakes (`fakeClock` advances and sets; `fakeModelClient`
  returns replies in order, throws an `Error` reply, throws past the last reply and records
  calls; `fakeAnthropicFetch` returns statuses and headers, rejects for `networkError`,
  rejects with an `AbortError` when a `hang` request is aborted, and records requests);
  then add them and `anthropicMessage`.
  Files: `test/meta/fakes.test.ts`, `test/support/fakes.ts`.
  Covers: R15.2.
  Command: `npx vitest run --project examples test/meta/fakes.test.ts`

## T2. Sample index and library

- [ ] T2.1 Example tests for `recordings.ts`: the fixture loads with the hand-worked fields;
  one in-memory `LibrarySource` per row of the problem table giving exactly that line;
  several problems give every line in the design's order; `raw` key absent is a problem;
  `findByText` hits on the normalised text and misses on a one-character change;
  `formatStartupFailure`, `buildRecording` and `serialiseRecording` give the exact text.
  Files: `test/server/parse/recordings.test.ts`, `src/server/parse/recordings.ts` (stub).
  Covers: R2.1–R2.7, R12.1 (file shape).
  Command: `npx vitest run --project examples test/server/parse/recordings.test.ts`
- [ ] T2.2 Implement the schemas, `sha256Hex`, `readLibrarySource`, `buildSampleTexts`,
  `buildSampleLibrary`, `loadSampleLibrary`, `formatStartupFailure`, `buildRecording` and
  `serialiseRecording` until T2.1 passes.
  Files: `src/server/parse/recordings.ts`.
  Covers: R2.1–R2.7.
  Command: `npx vitest run --project examples test/server/parse/recordings.test.ts && npm run typecheck`
- [ ] T2.3 Example test on the real `samples/`: `index.json` passes `SampleIndexSchema`,
  lists exactly the five ids of R1.3 in the design's order, equal to the `.md` stems, and
  `buildSampleTexts` on the real directory is `ok`. Then write `samples/index.json` exactly
  as in the design. Do not touch any `.md` file.
  Files: `test/server/parse/sample-index.test.ts`, `samples/index.json`.
  Covers: R1.1–R1.4, R2.5.
  Command: `npx vitest run --project examples test/server/parse/sample-index.test.ts && git diff --exit-code -- 'samples/*.md'`

## T3. Limits

- [ ] T3.1 Example tests for `createRateLimiter`: the boundaries in the design outline
  (`limit 2, window 10 s`: Retry-After 8 at 2,000 ms, 1 at 9,999 ms, passes at 10,000 ms);
  independent clients; `maxClients 1` refusal with the time until the first client frees;
  `check` leaves `size()` unchanged; `record` prunes dead timestamps.
  Files: `test/server/parse/limits.test.ts`, `src/server/parse/limits.ts` (stub).
  Covers: R6.1–R6.3, R6.8.
  Command: `npx vitest run --project examples test/server/parse/limits.test.ts`
- [ ] T3.2 Property P-RR1 rate window, with `arbLimiterRun` and `oracleMaxInWindow`.
  Files: `test/server/parse/limits.pbt.ts`, `test/support/arbitraries.ts`,
  `test/support/oracles.ts`.
  Covers: R6.1–R6.3, R6.8, N2.
  Command: `npx vitest run --project props test/server/parse/limits.pbt.ts`
- [ ] T3.3 Example tests for `createDailyCap`: cap 2 passes two, refuses the third with
  Retry-After 1 at 23:59:59.500 UTC and 43,200 at 12:00:00 UTC, passes at 00:00:00.000 UTC;
  `usedToday` before and after midnight; a clock stepping back across midnight does not
  reset the count.
  Files: `test/server/parse/limits.test.ts`.
  Covers: R7.1, R7.4.
  Command: `npx vitest run --project examples test/server/parse/limits.test.ts`
- [ ] T3.4 Property P-RR2 daily cap, with `arbCapRun` and `oracleUtcDay`.
  Files: `test/server/parse/limits.pbt.ts`, `test/support/arbitraries.ts`,
  `test/support/oracles.ts`.
  Covers: R7.1, R7.4.
  Command: `npx vitest run --project props test/server/parse/limits.pbt.ts`
- [ ] T3.5 Example tests for `clientKey` (every case in the design outline) and property
  P-RR4 client key, with `arbIpAddress` and `arbForwardedFor`.
  Files: `test/server/parse/limits.test.ts`, `test/server/parse/limits.pbt.ts`,
  `test/support/arbitraries.ts`.
  Covers: R6.5–R6.7.
  Command: `npx vitest run --project examples test/server/parse/limits.test.ts && npx vitest run --project props test/server/parse/limits.pbt.ts`
- [ ] T3.6 Implement `limits.ts` (`systemClock`, constants, `countChars`, the limiter, the
  cap, `clientKey`) until T3.1 to T3.5 pass.
  Files: `src/server/parse/limits.ts`.
  Covers: R6.1–R6.8, R7.1, R7.4, N2.
  Command: `npx vitest run --project examples test/server/parse/limits.test.ts && npx vitest run --project props test/server/parse/limits.pbt.ts`

## T4. Prompt and model client

- [ ] T4.1 Example tests for `prompt.ts` (`SYSTEM_PROMPT` equals the marked block in
  `design.md`, read by the test; at least 2,000 characters; `buildUserMessage` exact output
  for one text; tag variants replaced) and property P-RR3 delimited, with
  `arbTagInjectedText`.
  Files: `test/server/parse/prompt.test.ts`, `test/server/parse/prompt.pbt.ts`,
  `test/support/arbitraries.ts`, `src/server/parse/prompt.ts` (stub).
  Covers: R11.1–R11.3.
  Command: `npx vitest run --project examples test/server/parse/prompt.test.ts && npx vitest run --project props test/server/parse/prompt.pbt.ts`
- [ ] T4.2 Implement `SYSTEM_PROMPT` (copied verbatim from the design) and
  `buildUserMessage` until T4.1 passes.
  Files: `src/server/parse/prompt.ts`.
  Covers: R11.1–R11.3.
  Command: `npx vitest run --project examples test/server/parse/prompt.test.ts && npx vitest run --project props test/server/parse/prompt.pbt.ts`
- [ ] T4.3 Example tests for `createAnthropicModelClient` through `fakeAnthropicFetch`, as
  listed in the design outline: request body, every `stop_reason` case, text-block
  selection past thinking blocks, non-JSON text, every row of the SDK error table, one
  retry on 529, the auth log line, the fake key absent from every log call and result, and
  the wire-schema facts.
  Files: `test/server/parse/anthropic-client.test.ts`,
  `src/server/parse/anthropic-client.ts` (stub).
  Covers: R9.1–R9.10, R13.3.
  Command: `npx vitest run --project examples test/server/parse/anthropic-client.test.ts`
- [ ] T4.4 Implement `MODEL_ID`, `PLAN_OUTPUT_FORMAT` and `createAnthropicModelClient`
  (`messages.create`, not `messages.parse`; see the design) until T4.3 passes.
  Files: `src/server/parse/anthropic-client.ts`.
  Covers: R9.1–R9.10, R13.3, N4.
  Command: `npx vitest run --project examples test/server/parse/anthropic-client.test.ts && npm run typecheck && npm run lint`

## T5. Routes and startup

- [ ] T5.1 Add `test/support/server.ts`; move `health.test.ts` and `static.test.ts` to
  `makeTestApp`; write `GET /api/samples` tests (two fixture items in order with every
  field exact, no limit consumed, no model client).
  Files: `test/support/server.ts`, `test/server/health.test.ts`,
  `test/server/static.test.ts`, `test/server/routes/samples.test.ts`,
  `src/server/routes/samples.ts` (stub), `src/server/routes/parse.ts` (stub).
  Covers: R3.1–R3.3.
  Command: `npx vitest run --project examples test/server/routes/samples.test.ts`
- [ ] T5.2 Implement `createSamplesRoute`; extend `AppDeps` and register both routes in
  `app.ts`; wire `index.ts` (library or exit 1 with `formatStartupFailure`, clock,
  limiter, cap, client only with a key). From here `npm start` refuses to start until
  T6.3.
  Files: `src/server/routes/samples.ts`, `src/server/app.ts`, `src/server/index.ts`.
  Covers: R2.6, R3.1–R3.3, R9.1.
  Command: `npx vitest run --project examples test/server && npm run typecheck`
- [ ] T5.3 `POST /api/parse` tests for input and every error code: one test per row of the
  messages table asserting status and exact body; 12,000 versus 12,001 characters;
  trailing spaces that normalisation removes; 65,537-byte body; content types with and
  without `charset`; `GET /api/parse` is `not_found`.
  Files: `test/server/routes/parse.test.ts`.
  Covers: R4.1–R4.6, R8.2, R10.2–R10.5.
  Command: `npx vitest run --project examples test/server/routes/parse.test.ts`
- [ ] T5.4 `POST /api/parse` tests for the order of checks and consumption: a fixture text
  served with the limiter exhausted, the cap reached and no key; rate-limited requests do
  not consume the cap; capped and keyless requests consume nothing; `Retry-After` values
  through the route with the fake clock; `cap + 3` concurrent requests make exactly `cap`
  model calls; `TRUST_PROXY` on and off with `X-Forwarded-For`; a plan with sanity errors
  is a 200; log lines (info line fields, no recipe text above debug, no model output, no
  address).
  Files: `test/server/routes/parse.test.ts`.
  Covers: R5.1, R5.2, R6.4–R6.6, R7.2–R7.4, R8.1–R8.3, R10.1, R10.3, R13.1, R13.2.
  Command: `npx vitest run --project examples test/server/routes/parse.test.ts`
- [ ] T5.5 Property P-RR5 recorded match, with `arbPerturbedText`.
  Files: `test/server/routes/parse.pbt.ts`, `test/support/arbitraries.ts`.
  Covers: R5.1, R5.2, R8.1.
  Command: `npx vitest run --project props test/server/routes/parse.pbt.ts`
- [ ] T5.6 Implement `createParseRoute` in the order of the design table until T5.3 to
  T5.5 pass.
  Files: `src/server/routes/parse.ts`.
  Covers: R4–R8, R10, R13.1, R13.2.
  Command: `npx vitest run --project examples test/server && npx vitest run --project props test/server && npm run typecheck && npm run lint`

## T6. Recording

- [ ] T6.1 Example tests for `runRecord` with temporary copies of the fixture directories
  and `fakeModelClient`: the exact `tiny-roast.json` content (fixed `now`); a model error
  and a schema-failing `raw` write nothing for that sample, print the exact lines and
  return 1; an unknown id returns 1 before any call; `ids` limits the samples; no output
  line contains recipe text or `raw`.
  Files: `test/scripts/record.test.ts`, `scripts/record.ts` (stub).
  Covers: R12.1–R12.4.
  Command: `npx vitest run --project examples test/scripts/record.test.ts`
- [ ] T6.2 Implement `runRecord` and the CLI (key check, real client, exit code) until T6.1
  passes.
  Files: `scripts/record.ts`.
  Covers: R12.1–R12.5.
  Command: `npx vitest run --project examples test/scripts/record.test.ts && npm run typecheck`
- [ ] T6.3 User task, not for an agent session: with `ANTHROPIC_API_KEY` set, run
  `npm run record` (five model calls), read the printed summary, review the five
  `recordings/*.json` plans in the app or by eye, and commit them. Re-run single samples
  with `npm run record -- <id>` if needed. The user ticks this task.
  Files: `recordings/*.json` (written by the script only).
  Covers: R12.1, `testing.md` "Recorded model output".
  Command: `npm run record`
- [ ] T6.4 Tests on the real recordings, as listed in the design outline
  (`test/server/recordings.test.ts`): shape, model id, hash, no sanity or kitchen errors,
  dish count against `index.json`, `loadSampleLibrary` on the real directories, and each
  recording replayed through `fakeModelClient` and `POST /api/parse`. If one fails, report
  it; never edit a recording.
  Files: `test/server/recordings.test.ts`.
  Covers: R2.3, R2.4, R10.1, R10.3, `testing.md` "A test asserts each recording parses".
  Command: `npx vitest run --project examples test/server/recordings.test.ts`

## T7. The whole suite

- [ ] T7.1 Run the wider suite, the build and the e2e smoke test against the built app with
  the real recordings, and fix what they find (never by weakening a check).
  Files: none expected.
  Covers: N1–N5.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check . && npm run build && npm run test:e2e`
