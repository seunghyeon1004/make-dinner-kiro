# Tasks: plan-ui

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every task:
`testing.md`, `kiro-conduct.md`, and `ui.md` for every file under `src/web/` and `e2e/`.
Prerequisites: recipe-graph and scheduler done; dinnerfile T1 to T4 ticked (`ServeTimeSchema`,
`toDinnerfile`, `fromDinnerfile`, `arbServeTime`, `SUNDAY_ROAST_DINNERFILE`); recipe-reader done;
`recordings/` recorded by the user with `npm run record`. Without recordings the server refuses to
start, so every e2e command fails; report that instead of working around it.

How each task is done (`testing.md`, "Order of work"): write the test named in the task; if the
module does not exist, add it with the design's exported signatures and placeholder bodies of the
right type, so the test fails on an assertion, not on a missing import; run the task's command and
see that assertion fail; write the smallest code that passes; run it again. For a UI task the e2e
test is written first and fails on its first missing element.

A task is ticked only after its command passed in the same session. Commands run with
`ANTHROPIC_API_KEY` unset. Unit tests run in node with no DOM; files that set `TZ` check it took
effect. A counterexample from a property becomes a named example test in the matching
`*.test.ts` with its seed in a comment before the fix. E2E commands run both projects; each one
builds the app through Playwright's `webServer`. Every string goes into `src/web/copy.ts` as the
design's copy tables give it, in the task that first shows it.

## T1. Time, store and shell

- [x] T1.1 Example tests for `clock.ts`: every row of the design's clock table under
  `TZ=Europe/London` (including the 2026-10-25 DST row and `en-US` with U+202F and U+00A0 replaced
  by spaces), `quarterFloor`/`quarterCeil` on and off a quarter hour, `minuteAt` on negative
  differences, quarter hours in `Asia/Kathmandu` (+5:45), `formatDay` for yesterday and a date two
  days away.
  Files: `test/web/state/clock.test.ts`, `src/web/state/clock.ts` (stubs).
  Covers: R1.4, R5.3, R5.5, R6.3, R6.4, R7.4.
  Command: `npx vitest run --project examples test/web/state/clock.test.ts`
- [x] T1.2 Implement `clock.ts` until T1.1 passes; add property P-UI5 with `fcParams()`.
  Files: `src/web/state/clock.ts`, `test/web/state/clock.pbt.ts`.
  Covers: R1.4, R5.3, R5.5, N4.
  Command: `npx vitest run --project examples test/web/state/clock.test.ts && npx vitest run --project props test/web/state/clock.pbt.ts && npm run typecheck`
- [x] T1.3 Example tests for the store core: `initialState`; `navigate` with every row of the
  reachability table (state built by hand with `SUNDAY_ROAST`, with a plan carrying an
  `unknown_dependency`, with `cookRegistered` true and false); `theme/set`; `notice/*`;
  `start-over` keeps `theme` and `samples`; a no-op returns the same object; `createStore`
  notifies once per change and never for a no-op; an action outside `PlanUiAction` reaches
  `reduceCook` and changes nothing.
  Files: `test/web/state/store.test.ts`, `src/web/state/store.ts`, `src/web/state/cook-slot.ts` (stubs).
  Covers: R9.2, R9.3, R9.7, R9.9.
  Command: `npx vitest run --project examples test/web/state/store.test.ts`
- [x] T1.4 Implement the store core, `reachable`, `selectCheck` and `cook-slot.ts` until T1.3
  passes.
  Files: `src/web/state/store.ts`, `src/web/state/cook-slot.ts`.
  Covers: R9.2, R9.3, R9.7, R9.9, N4.
  Command: `npx vitest run --project examples test/web/state/store.test.ts && npm run typecheck && npm run lint`
- [x] T1.5 Example tests, then implementation, for `route.ts` (every hash form of the design,
  including a share hash at the length limit and one character over) and `persist.ts` (missing
  key, `getItem` throwing, bad JSON, schema failure, a plan failing `validatePlan`, each with its
  notice; `toPersisted` then `loadState` gives the persisted fields back; a stored `cook` route
  without a cook screen comes back as `plan`; `saveState` returns false when `setItem` throws).
  Files: `test/web/state/route.test.ts`, `test/web/state/persist.test.ts`,
  `src/web/state/route.ts`, `src/web/state/persist.ts`.
  Covers: R8.5, R9.3, R9.5, R9.6.
  Command: `npx vitest run --project examples test/web/state/route.test.ts test/web/state/persist.test.ts && npm run typecheck`
- [x] T1.6 Shell, part 1: `hooks.ts`, `effects.ts` (persistence, hash sync, theme), `main.tsx`,
  `app.tsx` with `SCREENS` (Menu, Steps and Plan show only their `<h1>` for now), `FlowNav`,
  `LiveNotice`, `ErrorBoundary` (no automated check: a render throw cannot be forced without a
  test-only hook, decided here), `components.css`. E2E first: `#/plan` with no dinner lands on
  Menu with the hash replaced; nav shows Menu current and the other three unreachable with their
  reasons; document title; focus on the `<h1>`; Back and Forward. Move the smoke test's heading
  check to the brand link and the Menu `<h1>` ("Pick a dinner"); its colour and axe checks stay.
  Files: `src/web/main.tsx`, `src/web/app.tsx`, `src/web/copy.ts`, `src/web/state/hooks.ts`,
  `src/web/state/effects.ts`, `src/web/components/{FlowNav,LiveNotice,ErrorBoundary}.tsx`,
  `src/web/styles/components.css`, `e2e/shell.spec.ts`, `e2e/smoke.spec.ts`, `e2e/support.ts`.
  Covers: R9.2, R9.3, R9.4, R9.5, R10.2.
  Command: `npx playwright test e2e/smoke.spec.ts e2e/shell.spec.ts && npm run typecheck && npm run lint`
- [x] T1.7 Shell, part 2: `Header`, `ThemeSwitch`, `StartOver`, `ConfirmInline`. E2E first:
  theme Dark under a light system sets `data-theme="dark"` and `--color-bg` `rgb(26, 24, 22)`,
  survives a reload, System removes the attribute; "Start over" needs the second tap, Cancel
  returns focus; header targets at least 48×48 px.
  Files: `src/web/components/{Header,ThemeSwitch,StartOver,ConfirmInline}.tsx`, `src/web/app.tsx`,
  `src/web/copy.ts`, `src/web/styles/components.css`, `e2e/shell.spec.ts`.
  Covers: R9.1, R9.7, N1.
  Command: `npx playwright test e2e/shell.spec.ts && npm run typecheck && npm run lint`

## T2. Menu with samples

- [x] T2.1 Example tests, then implementation, for `SamplesResponseSchema`, `SampleItemSchema`
  and `fetchSamples` with a fake `fetch`: a body built from `test/support/fixtures.ts` passes,
  an extra field is dropped, a missing `plan` fails, bad JSON and a 500 give `unexpected`, a
  throw gives `network`.
  Files: `test/web/state/api.test.ts`, `src/web/state/api.ts`.
  Covers: R1.1, R1.2.
  Command: `npx vitest run --project examples test/web/state/api.test.ts && npm run typecheck`
- [x] T2.2 Example tests, then implementation, for `samples/*`, `dinner/load`, `dinner/replace`
  and `dinner/keep`: a sample load of `SUNDAY_ROAST` × `HOME_KITCHEN` (span 110) with `'13:30'`
  at Wed 10:00 and at Wed 12:00 gives the clock table's serving instants and route `plan`; a load
  while a dinner exists sets `pendingLoad` and changes nothing else; replace applies it and clears
  `cook`; keep drops it; a `serve` time is resolved with `resolveServing`.
  Files: `test/web/state/store.test.ts`, `src/web/state/store.ts`.
  Covers: R1.3, R1.4, R1.5, R8.5, R8.6.
  Command: `npx vitest run --project examples test/web/state/store.test.ts && npm run typecheck`
- [x] T2.3 Menu screen with `SampleList`, the samples fetch in `effects.ts` and the replace
  prompt. E2E first: five titles in the order of `GET /api/samples`, each with blurb and
  `Dishes: …`; "Plan this dinner" on the first opens Plan in one tap with the `<h1>` equal to the
  response's plan title; the request aborted by `page.route` shows the failure copy and "Try
  again" lists the samples; a second sample asks `Replace your current dinner, <title>?`; after
  the samples load, choosing one and opening Plan makes no request (`page.on('request')`).
  Files: `src/web/screens/Menu.tsx`, `src/web/components/SampleList.tsx`,
  `src/web/state/effects.ts`, `src/web/copy.ts`, `src/web/styles/components.css`, `e2e/menu.spec.ts`.
  Covers: R1.1, R1.2, R1.3, R1.5, R9.8, R10.1.
  Command: `npx playwright test e2e/menu.spec.ts && npm run typecheck && npm run lint`

## T3. Plan screen with the plan list

- [x] T3.1 Example tests for `scheduleView`, `stepMark` (critical with a hold, critical that keeps,
  slack > 0) and `planListGroups`: the design's H1 table at Wed 19:30, the H3 warning text, the
  midnight headings at Thu 00:30, a `RebuiltSchedule`-shaped input with `servingMin: 15` built by
  hand (serving and `spanMin` from it); the copy functions `listWait` and `formatDuration` uses.
  Files: `test/web/components/plan-list-items.test.ts`, `src/web/state/schedule-view.ts`,
  `src/web/components/plan-list-items.ts`, `src/web/copy.ts` (stubs).
  Covers: R6.6, R7.1, R7.2, R7.3, R7.4.
  Command: `npx vitest run --project examples test/web/components/plan-list-items.test.ts`
- [x] T3.2 Implement them until T3.1 passes; add property P-UI4 over `arbPlanAndKitchen()` with
  `schedule`.
  Files: `src/web/state/schedule-view.ts`, `src/web/components/plan-list-items.ts`,
  `src/web/copy.ts`, `test/web/components/plan-list-items.pbt.ts`.
  Covers: R6.6, R7.1–R7.4.
  Command: `npx vitest run --project examples test/web/components/plan-list-items.test.ts && npx vitest run --project props test/web/components/plan-list-items.pbt.ts && npm run typecheck`
- [x] T3.3 Example tests, then implementation, for `kitchen/set` (a value failing `parseKitchen`
  ignored), `serving/set-time`, `serving/set-instant`, `plan/enter` (fills a null serving, keeps a
  set one), and `selectSchedule` (the same result object for the same plan and kitchen, a new one
  after `kitchen/set`, none recomputed by `serving/*`).
  Files: `test/web/state/store.test.ts`, `src/web/state/store.ts`.
  Covers: R4.11, R5.2, R5.3.
  Command: `npx vitest run --project examples test/web/state/store.test.ts && npm run typecheck`
- [x] T3.4 Plan screen: `KitchenControls`, `Stepper`, `ServingTime`, `PlanSummary`,
  `WarningList`, `PlanList`, `MissingAppliance`, the invalid-plan message; `seedDinner` in
  `e2e/support.ts`. E2E first, seeded H1 at 19:30: `Start at 17:40`, `Serve at 19:30`, `Takes 1 h
  50 min`, the list equal to the design's H1 table; burners 4 → 1 → `Make a roux in the roasting
  tin` at `19:08–19:10`; ovens 1 → 0 → the missing-appliance copy naming `Roast the chicken` and
  no list, "Add an oven" restores it; serving `00:30` → `Serve at 00:30 tomorrow`; seeded
  `TIGHT_OVEN` shows its hold warning sentence; a seeded plan with an error shows the
  invalid-plan message and `Go to steps`.
  Files: `src/web/screens/Plan.tsx`, `src/web/components/{KitchenControls,Stepper,ServingTime,PlanSummary,WarningList,PlanList,MissingAppliance}.tsx`,
  `src/web/copy.ts`, `src/web/styles/components.css`, `e2e/support.ts`, `e2e/plan.spec.ts`.
  Covers: R5.1, R5.2, R5.4, R5.6, R5.7, R5.8, R7.1–R7.4, R10.1.
  Command: `npx playwright test e2e/plan.spec.ts && npm run typecheck && npm run lint`
- [x] T3.5 The past-start note with `useNow(systemClock, 30_000)`. E2E first: clock at 17:41
  with seeded H1 at 19:30 shows `This dinner needs 1 h 50 min. Earliest serving time 19:35.`;
  "Serve at 19:35" sets it and the note goes; at 17:39:30 there is no note and after
  `runFor(60_000)` there is.
  Files: `src/web/state/hooks.ts`, `src/web/components/PlanSummary.tsx`, `src/web/copy.ts`,
  `e2e/plan.spec.ts`.
  Covers: R5.5.
  Command: `npx playwright test e2e/plan.spec.ts && npm run typecheck`

## T4. Timeline

- [x] T4.1 Example tests for `layoutTimeline`: the design's H1 table (origin, end, width, ticks,
  serve line, every bar), the midnight ticks, `HANDS_FREE`-style two overlapping hands-free steps
  giving `Hands-free 1` and `Hands-free 2`, a 9-minute bar (54 px, label) and an 8-minute bar
  (48 px, no label), a serving minute of 15 from a hand-built rebuilt schedule.
  Files: `test/web/components/timeline-layout.test.ts`, `src/web/components/timeline-layout.ts` (stubs).
  Covers: R6.1–R6.6.
  Command: `npx vitest run --project examples test/web/components/timeline-layout.test.ts`
- [x] T4.2 Implement `layoutTimeline` until T4.1 passes; add property P-UI3 with an oracle loop
  over minutes in the test file.
  Files: `src/web/components/timeline-layout.ts`, `test/web/components/timeline-layout.pbt.ts`.
  Covers: R6.1–R6.6.
  Command: `npx vitest run --project examples test/web/components/timeline-layout.test.ts && npx vitest run --project props test/web/components/timeline-layout.pbt.ts && npm run typecheck`
- [x] T4.3 `Timeline.tsx` and its styles. E2E first, seeded H1: rows `Cook 1`, `Burner 1`,
  `Burner 2`, `Oven 1`, `Hands-free` in that order; the timeline has `aria-hidden="true"` and no
  focusable descendant; "Skip to the plan list" moves focus to the list; tapping the Oven 1 bar
  focuses the `Roast the chicken` item; on the phone the timeline scrolls (`scrollWidth >
  clientWidth`) while `expectNoPageScroll` passes, and the lane labels stay visible after
  scrolling.
  Files: `src/web/components/Timeline.tsx`, `src/web/screens/Plan.tsx`,
  `src/web/styles/components.css`, `src/web/copy.ts`, `e2e/plan.spec.ts`.
  Covers: R6.1, R6.5–R6.9.
  Command: `npx playwright test e2e/plan.spec.ts && npm run typecheck && npm run lint && npm run check:contrast`

## T5. Steps editor

- [ ] T5.1 Example tests for `plan-edit.ts`: the `slugify` examples, `uniqueDishId` and
  `nextStepId` with collisions and the 40-character cut, `stepOrder` on `SUNDAY_ROAST` and on a
  plan with a cycle, `waitingOn('chicken.prep')`, `removeStep('chicken.roast')` on `SUNDAY_ROAST`
  (`chicken.rest` and `gravy.roux` lose it, the notice names both), a duplicate id kept in
  `after`, removing a dish, every limit error, `updateStep` rejecting a blank title.
  Files: `test/web/state/plan-edit.test.ts`, `src/web/state/plan-edit.ts` (stubs).
  Covers: R4.1, R4.5–R4.8.
  Command: `npx vitest run --project examples test/web/state/plan-edit.test.ts`
- [ ] T5.2 Implement `plan-edit.ts` until T5.1 passes; add property P-UI6 over `arbPlan()`.
  Files: `src/web/state/plan-edit.ts`, `src/web/copy.ts`, `test/web/state/plan-edit.pbt.ts`.
  Covers: R4.1, R4.4–R4.8.
  Command: `npx vitest run --project examples test/web/state/plan-edit.test.ts && npx vitest run --project props test/web/state/plan-edit.pbt.ts && npm run typecheck`
- [ ] T5.3 Example tests, then implementation, for `dish/*` and `step/*` in the reducer (notice
  set from the edit result, an `err` changes nothing) and the cooking guard (a state whose `cook`
  is set through `unknown` makes every edit, kitchen and serving action a no-op).
  Files: `test/web/state/store.test.ts`, `src/web/state/store.ts`.
  Covers: R4.6, R4.7, R4.12.
  Command: `npx vitest run --project examples test/web/state/store.test.ts && npm run typecheck`
- [ ] T5.4 Steps screen: `DishSection`, `StepCard` summaries, `IssueList` beside steps, at the top
  of dishes and as the summary, "Make the plan". E2E first: seeded `SUNDAY_ROAST` shows three
  dish sections with steps in dependency order and `No issues.`; seeded with `gravy.roux` waiting
  for `chicken.rost` shows `1 error and 0 warnings.`, the issue beside `gravy.roux` with `!`
  `Error`, a working summary link, the button disabled with `Fix 1 error to make the plan.`;
  "Make the plan" on the valid plan opens Plan.
  Files: `src/web/screens/Steps.tsx`, `src/web/components/{DishSection,StepCard,IssueList}.tsx`,
  `src/web/copy.ts`, `src/web/styles/components.css`, `e2e/steps.spec.ts`.
  Covers: R4.1, R4.2, R4.9, R4.10, R4.11.
  Command: `npx playwright test e2e/steps.spec.ts && npm run typecheck && npm run lint`
- [ ] T5.5 `StepEditor` and `PrerequisiteChecklist`. E2E first: minutes of `Roast the chicken`
  75 → 85, then "Make the plan" → `Start at 17:30` and `Takes 2 h`; minutes `0` shows `Enter whole
  minutes from 1 to 480.` and the plan is unchanged; unchecking "Keeps" shows `Can wait up to
  (minutes)` with 10; in the `gravy.roux` editor `Roast the chicken` is checked and `Strain the
  gravy into a jug` is disabled with `(already waits for this step)`; the unknown `chicken.rost`
  appears checked with `(not a step in this plan)` and unchecking it enables "Make the plan".
  Files: `src/web/components/{StepEditor,PrerequisiteChecklist}.tsx`, `src/web/copy.ts`,
  `src/web/styles/components.css`, `e2e/steps.spec.ts`.
  Covers: R4.2–R4.5, R4.10.
  Command: `npx playwright test e2e/steps.spec.ts && npm run typecheck && npm run lint`
- [ ] T5.6 Add and remove: "Add a step", "Add a dish" (name first), rename, remove with
  `ConfirmInline`. E2E first: removing `Roast the chicken` asks with the two dependent titles,
  "Keep step" changes nothing, "Remove step" announces the notice in the live region; adding a
  dish `Crème brûlée` creates section `Crème brûlée` with a `New step` whose id is
  `creme-brulee.step-1`; the last step's "Remove step" is disabled with its reason.
  Files: `src/web/components/{DishSection,StepCard}.tsx`, `src/web/screens/Steps.tsx`,
  `src/web/copy.ts`, `e2e/steps.spec.ts`.
  Covers: R4.6, R4.7, R4.8, R9.4.
  Command: `npx playwright test e2e/steps.spec.ts && npm run typecheck && npm run lint`

## T6. Paste recipes and import a Dinnerfile

- [ ] T6.1 Example tests, then implementation, for `postParse` with a fake `fetch`: 200 with
  `SUNDAY_ROAST`; every code of `tech.md` to its `ParseFailure` (`not_found`, `invalid_plan` and
  an unknown code to `unexpected`); `Retry-After` `120`, `0`, `abc` and absent; a 200 failing the
  schema; a throw; an abort gives `cancelled`; the request body and content type.
  Files: `test/web/state/api.test.ts`, `src/web/state/api.ts`.
  Covers: R2.3, R2.5–R2.7.
  Command: `npx vitest run --project examples test/web/state/api.test.ts && npm run typecheck`
- [ ] T6.2 Example tests, then implementation, for `recipe-text/set`, `parse/start`,
  `parse/done` (route `steps`, `DEFAULT_KITCHEN`, no serving, `recipeText` cleared), a stale
  `requestId` ignored, `parse/failed`, `parse/cancel`.
  Files: `test/web/state/store.test.ts`, `src/web/state/store.ts`.
  Covers: R2.4, R2.5, R2.8.
  Command: `npx vitest run --project examples test/web/state/store.test.ts && npm run typecheck`
- [ ] T6.3 `RecipePaste` and the parse request in `effects.ts` (one `AbortController`). E2E
  first with `fakeParse`: counter `0 of 12,000` and its update; 12,001 characters disable the
  button with the copy; empty text disables it with `Paste at least one recipe.`; success opens
  Steps with `SUNDAY_ROAST`; each code of the design's messages table shows its exact copy,
  `rate_limited` with `Retry-After: 120` at 17:00 says `Try again after 17:02`; an aborted route
  shows the network copy; a delayed route shows the busy copy and `5 s` after `runFor(5000)`,
  "Cancel" stops it with the notice; the text survives a reload.
  Files: `src/web/components/RecipePaste.tsx`, `src/web/screens/Menu.tsx`,
  `src/web/state/effects.ts`, `src/web/copy.ts`, `e2e/paste.spec.ts`.
  Covers: R2.1–R2.8, R10.1, R11.2.
  Command: `npx playwright test e2e/paste.spec.ts && npm run typecheck && npm run lint`
- [ ] T6.4 Example tests, then implementation, for `readDinnerfile`: `SUNDAY_ROAST_DINNERFILE`
  gives route `plan`, `DEFAULT_KITCHEN` and no serve; with `# kitchen burners=4 ovens=1 cooks=1`
  and `# serve 19:30` they come through; with `# kitchen burners=9 ovens=1 cooks=1` the default
  kitchen and the notice; a cycle edit gives route `steps`; a `$(X)` line gives one `line`
  problem with the dinnerfile message; `minutes=0` gives the invalid-plan heading and issue.
  Files: `test/web/state/dinnerfile-import.test.ts`, `src/web/state/dinnerfile-import.ts`.
  Covers: R3.2–R3.5.
  Command: `npx vitest run --project examples test/web/state/dinnerfile-import.test.ts && npm run typecheck`
- [ ] T6.5 `DinnerfilePaste`. E2E first: pasting `SUNDAY_ROAST_DINNERFILE` with the two lines
  added opens Plan with `Start at 17:40`; a file with a `$(X)` line lists its error and "Show
  line n" selects exactly that line (`selectionStart`, `selectionEnd`); `setInputFiles` with the
  same text opens it; a 1 MB + 1 byte file shows the too-large copy; the text survives a reload.
  Files: `src/web/components/DinnerfilePaste.tsx`, `src/web/screens/Menu.tsx`,
  `src/web/copy.ts`, `e2e/dinnerfile.spec.ts`.
  Covers: R3.1–R3.5, R2.8.
  Command: `npx playwright test e2e/dinnerfile.spec.ts && npm run typecheck && npm run lint`

## T7. Export, share and print

- [ ] T7.1 Example tests for `share-link.ts`: the version 1 body of a two-step, one-dish plan
  written out by hand (before compression, through an exported-for-test `shareBody`, decided
  here); decode errors from crafted payloads (version 2, a `*` character, bad base64, deflate of
  300 KB of zeros, JSON with an index out of range, a cycle, a bad serve time); `encodeShare` on
  a plan with an error; each recorded sample under `SHARE_URL_MAX` with `http://127.0.0.1:65535/`
  as base, its length written in a comment.
  Files: `test/web/state/share-link.test.ts`, `src/web/state/share-link.ts` (stubs).
  Covers: R8.3–R8.6.
  Command: `npx vitest run --project examples test/web/state/share-link.test.ts`
- [ ] T7.2 Implement `share-link.ts` until T7.1 passes; add properties P-UI1 (round trip) and
  P-UI2 (decode total) with `fcParams()`.
  Files: `src/web/state/share-link.ts`, `test/web/state/share-link.pbt.ts`.
  Covers: R8.3–R8.6, R8.9.
  Command: `npx vitest run --project examples test/web/state/share-link.test.ts && npx vitest run --project props test/web/state/share-link.pbt.ts && npm run typecheck`
- [ ] T7.3 Opening a share link: boot decoding in `effects.ts`, hash replacement, the replace
  prompt. E2E first: a link made in a test from seeded H1 opens, in a new context with the same
  clock, the Plan screen with list text equal to the source page's; a link with one payload
  character changed opens Menu with the damaged-link copy and leaves the stored dinner; a version
  `2.` link shows the version copy; a link while a dinner is stored asks before replacing.
  Files: `src/web/state/effects.ts`, `src/web/screens/Menu.tsx`, `src/web/copy.ts`,
  `e2e/share.spec.ts`.
  Covers: R8.5, R8.6, R9.3.
  Command: `npx playwright test e2e/share.spec.ts && npm run typecheck && npm run lint`
- [ ] T7.4 `ExportBar` and `DinnerfilePanel`. E2E first, seeded H1: "Dinnerfile" sets
  `aria-expanded="true"` and the `<pre>` text equals `SUNDAY_ROAST_DINNERFILE` with the `# kitchen`
  and `# serve 19:30` lines; "Download" gives a file named `Dinnerfile` with the same text; "Copy"
  with clipboard permission shows the copied notice, without it the copy-failed copy and the text
  selected; the make line is shown.
  Files: `src/web/components/{ExportBar,DinnerfilePanel}.tsx`, `src/web/screens/Plan.tsx`,
  `src/web/copy.ts`, `e2e/export.spec.ts`.
  Covers: R8.1, R8.2, R8.7.
  Command: `npx playwright test e2e/export.spec.ts && npm run typecheck && npm run lint`
- [ ] T7.5 `SharePanel`, link computed by an effect when the dinner changes. E2E first: "Share
  link" fills `Link to this dinner` with a URL starting `<baseURL>/#/share/1.` and shows the copied
  notice; a seeded 80-step plan with 1,000-character details shows the too-long copy with its
  length and no link.
  Files: `src/web/components/SharePanel.tsx`, `src/web/components/ExportBar.tsx`,
  `src/web/copy.ts`, `e2e/share.spec.ts`.
  Covers: R8.3, R8.4, R8.7.
  Command: `npx playwright test e2e/share.spec.ts && npm run typecheck && npm run lint`
- [ ] T7.6 `print.css` and the print-only Dinnerfile. E2E first: under
  `emulateMedia({ media: 'print' })` exactly the `<h1>`, summary, plan list and Dinnerfile `<pre>`
  are visible; header, nav, controls, timeline and panels are hidden; text is `rgb(0, 0, 0)` on
  `rgb(255, 255, 255)` in both colour schemes.
  Files: `src/web/styles/print.css`, `src/web/main.tsx`, `src/web/screens/Plan.tsx`,
  `e2e/export.spec.ts`.
  Covers: R8.8.
  Command: `npx playwright test e2e/export.spec.ts && npm run typecheck`

## T8. Polish and the full pass

- [ ] T8.1 `test/web/copy.test.ts`: every `COPY` string and every copy-function result on fixed
  arguments has no `!` other than the warning mark, no exclamation-only sentences, no `task` or
  `job`, no emoji, sentence-case headings and buttons, no `ANTHROPIC`; plurals for 1 and 2. Fix
  any string that fails by changing the string, never the check.
  Files: `test/web/copy.test.ts`, `src/web/copy.ts`.
  Covers: R10.3, N5, N6.
  Command: `npx vitest run --project examples test/web/copy.test.ts`
- [ ] T8.2 `e2e/a11y.spec.ts`: axe with zero violations, light and dark, on Menu, Menu with a
  parse error and with Dinnerfile errors, Steps with an editor open and an error, Plan, Plan with
  each panel open, missing appliance; every visible button and input at least 48×48 px.
  Files: `e2e/a11y.spec.ts`, fixes in `src/web/**`.
  Covers: R11.3, N1.
  Command: `npx playwright test e2e/a11y.spec.ts && npm run check:contrast`
- [ ] T8.3 Zoom and motion in `e2e/a11y.spec.ts`: each screen at a 195 px wide viewport (390 px
  at 200%) passes `expectNoPageScroll`; under `reducedMotion: 'reduce'` no element has a running
  transition.
  Files: `e2e/a11y.spec.ts`, fixes in `src/web/styles/*.css`.
  Covers: R6.9, N1.
  Command: `npx playwright test e2e/a11y.spec.ts`
- [ ] T8.4 `e2e/perf.spec.ts` on the phone project: the largest sample's timeline is visible
  within 1 s of the tap; a stepper tap updates the list within 200 ms.
  Files: `e2e/perf.spec.ts`.
  Covers: N2.
  Command: `npx playwright test e2e/perf.spec.ts --project phone`
- [ ] T8.5 The whole suite: unit, properties, typecheck, lint, format, contrast, the build with its
  forbidden-marker check, all e2e. Report each runner's real counts.
  Files: none new.
  Covers: R11.1–R11.3, N3, N5.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check . && npm run check:contrast && npm run build && npm run test:e2e`
