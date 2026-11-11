---
inclusion: always
---

# Testing

## Order of work

1. Write the test first. Run it and see it fail, for the reason you expect (an assertion,
   not a typo or a missing import). If it passes before the code exists, the test is wrong.
2. Write the smallest code that makes it pass. Run it again.
3. Run the wider suite the change can affect (`npm test`, `npm run test:props`, and
   `npm run typecheck` at least) before calling the work done.

## A test must be able to fail

- Never mock, stub or spy on the unit under test. Fakes are allowed only for its
  collaborators across a boundary: the Anthropic client, the clock, storage, the network.
- Never assert on a value the test itself constructed. Comparing an output with an object the
  test built and handed in only proves it was passed through; it cannot catch a wrong result.
  The expected value comes from the requirement, a hand-worked example, or an oracle.
  (Round-trip properties such as D1 are the exception, because the round trip is the contract.)
- Oracles in `test/support/oracles.ts` are written independently of `src/`: brute force over
  minutes, plain loops, no imports from `src/core` other than types and schemas.
- No snapshot tests for scheduler output (decided here). Assert the specific fields that matter.
- Each example test names the requirement or rule it checks in its title.
- Assertions are exact. No `toBeTruthy` on objects, no `toBeDefined` as the only check, no
  `expect.anything()` where the value is known.
- No `.skip`, `.only`, `.todo`, `it.fails`, `xit` or commented-out tests left in the tree.
  Lint rejects them (`vitest/no-disabled-tests`, `vitest/no-focused-tests`) (decided here).

## Example tests (`*.test.ts`)

- Live in `test/` mirroring `src/`: `src/core/sanity.ts` → `test/core/sanity.test.ts`.
- Hand-written plans live in `test/support/fixtures.ts`, each with a comment giving the
  expected schedule worked out by hand.
- Every sanity rule has a firing and a non-firing example. Every API error code has a test
  through `app.request()` asserting status and the exact `{ error: { code } }`.
- Server tests build the app with `createApp(deps)` and inject a fake model client, a fake
  clock and in-memory limit counters. No test opens a socket or reaches the internet.

## Property tests (`*.pbt.ts`)

- Use fast-check. Every guarantee id in `scheduler-guarantees.md` has at least one property,
  and the property title starts with that id: `it('G6 lanes: overlapping steps never share a unit', ...)`.
  `test/meta/guarantees.test.ts` reads that file and fails if any id has no property.
- Generators live in `test/support/arbitraries.ts` and only there (decided names):
  - `arbKitchen()` within schema bounds; `arbUnlimitedKitchen(plan)` for G4.1.
  - `arbPlan(opts)`: valid by construction (acyclic, ids unique, every dish has steps, every
    step's appliance present in the paired kitchen). Default sizes 1 to 6 dishes, 1 to 30
    steps; a `large` option reaches the limits of 12 dishes and 80 steps.
  - `arbPlanAndKitchen()`: a valid pair. `arbBrokenPlan(rule)`: breaks exactly one rule.
  - `arbProgress(schedule)` and `arbNow(schedule)` for rebuild properties.
- Generators may be extended to cover more cases. They may never be narrowed to avoid a
  failing case.
- Run count: `numRuns: 200` per property by default, overridable with `FC_NUM_RUNS`; never
  lowered in code to make a run pass (decided here).
- A counterexample found by a property becomes a named example test in the matching
  `*.test.ts` with its seed in a comment, before the fix (decided here).
- Properties are pure and deterministic: no clock, no randomness outside fast-check.

## Recorded model output (`recordings/`)

- Every sample in `samples/` has a recording made from a real model call by `npm run record`.
- Recordings are never hand-edited, reformatted or "fixed". If one no longer passes the
  schema or sanity rules, report it; re-recording needs the user's key and approval.
- Tests use recordings through the fake model client. `npm test` and `npm run test:e2e` run
  with `ANTHROPIC_API_KEY` unset.
- A test asserts each recording parses, passes the schema, and has no sanity errors.

## End-to-end (`e2e/`)

- Playwright against `npm run build && npm start`, key unset, phone viewport 390×844 and a
  desktop viewport (decided here), light and dark colour schemes.
- Each screen (menu, steps, plan, cook) runs an axe check with tags `wcag2a`, `wcag2aa`,
  `wcag21aa`; zero violations is the pass condition.
- Cooking mode tests control the clock with `page.clock`; no real waiting.

## Reporting

- Report only test runs you actually executed in this session, with the command and the real
  counts printed by the runner (passed, failed, skipped). Never estimate or round.
- If a run was not executed, say so. If it failed, show the failing test names and the
  first assertion message. "Should pass" is not a result.
