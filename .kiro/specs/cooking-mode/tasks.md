# Tasks: cooking-mode

Requirements and design: `requirements.md` and `design.md` in this folder. Rules for every task:
`testing.md`, `kiro-conduct.md`, and `ui.md` for every file under `src/web/` and `e2e/`.
Prerequisites: plan-ui done (store, `clock.ts`, `copy.ts`, `persist.ts`, `ConfirmInline`,
`LiveNotice`, `useNow`, `seedDinner`, `expectNoPageScroll`, `expectNoAxeViolations`), rebuild done
(`rebuild`, its oracles, `arbScheduled`, `H1_SCHEDULE`), and `recordings/` recorded by the user.
Without recordings the server refuses to start, so every e2e command fails; report that.

How each task is done: as plan-ui's tasks say (test first, stubs with the design's signatures so
the test fails on an assertion, smallest code, run again). A task is ticked only after its command
passed in the same session, with `ANTHROPIC_API_KEY` unset. Unit tests run in node, no DOM, with
`TZ=Europe/London` checked. A property counterexample becomes a named example test with its seed
before the fix. Every string goes into `src/web/copy.ts` as the design's tables give it.

## T1. Session state and transitions (pure)

- [x] T1.1 Example tests for the time mapping: `effectiveNow` (a fact later than `nowMs`, a clock
  set back), `progressOf` on `CM_C_FACTS` (prep done `[-110,-100)`, shred `[-100,-95)`, roast
  running `{ -100, 0 }`), `endsAtMs` with `extraMin 15` (19:20), and `CookStateSchema` (a fact for an
  unknown id fails, an undo slot holding a `CookState` fails, the JSON of a hand-built state passes).
  Add `AXIS_MS` and `CM_C_FACTS` to the fixtures with their expected values in comments.
  Files: `test/web/state/cook-session.test.ts`, `test/web/state/cook-slot.test.ts`,
  `test/support/fixtures.ts`, `src/web/state/cook-slot.ts`, `src/web/state/cook-session.ts` (stubs).
  Covers: CM4.1, CM5.2, CM7.1.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts test/web/state/cook-slot.test.ts`
- [x] T1.2 Implement the types, `CookStateSchema`, the thresholds and the time mapping until T1.1
  passes.
  Files: `src/web/state/cook-slot.ts`, `src/web/state/cook-session.ts`.
  Covers: CM4.1, CM5.2, CM7.1, N1.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts test/web/state/cook-slot.test.ts && npm run typecheck`
- [x] T1.3 Example tests for `canBegin`, `beginSession` and `start-now`: CM-a (countdown, `startMs`
  17:40, `start-now` moving `axisMs` and `plannedServingMs` to 19:20); CM-b (every interval,
  `servingMin 12`, the log entry's cause, `moved` in `(toStartMin, id)` order, `newWarnings` for
  `greens.toss` only: the roast ends when the rest starts, so it waits 0; corrected by hand-working CM-b); begin exactly at 17:40 makes no entry; Fri 19:30 gives
  `too_late`; `start-now` after a fact or after the start returns the state itself.
  Files: `test/web/state/cook-session.test.ts`, `src/web/state/cook-session.ts` (stubs).
  Covers: CM1.1–CM1.5.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts`
- [x] T1.4 Implement them until T1.3 passes.
  Files: `src/web/state/cook-session.ts`.
  Covers: CM1.1–CM1.5, CM5.3.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts && npm run typecheck`
- [x] T1.5 Example tests for `start`, `done`, `extra` and `behind`: CM-c step by step (no entry for
  the five on-plan taps; the +15 entry equal to RB-a's diff with the design's order and warnings);
  CM-d; CM-e at 2 and 3 minutes late, and a `done` 3 minutes early; an early start that moves the
  pinned step in `moved`; every invalid action of the design's error list returns the same object;
  `extraMin` capped at `REBUILD_LIMITS.extraMax`; the 21st entry drops the oldest.
  Files: `test/web/state/cook-session.test.ts`, `src/web/state/cook-session.ts` (stubs).
  Covers: CM3.1–CM3.3, CM3.7, CM5.1, CM5.3, CM5.5, CM5.7.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts`
- [x] T1.6 Implement the four actions, the rebuild call and log building until T1.5 passes.
  Files: `src/web/state/cook-session.ts`.
  Covers: CM3.1–CM3.3, CM3.7, CM5.1–CM5.3, CM5.5, CM5.7, CM5.8.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts && npm run typecheck`
- [x] T1.7 Example tests for `undo`, `tick`, `resume`, `alerts` and `reduceCook`: CM-h (deep-equal
  core at 18:30:05, no-op at 18:30:10); CM-g as changed by review Q4 (`overdueIds` empty at 19:09:45 and
  the rest and roast at 19:10:00; a tick returns the state itself; "I'm behind" at 19:10:00 gives the E3
  rebuild; a second tap logs nothing moved); a tick keeps the undo slot; `overdueIds` on a keeps step within its
  slack is empty; `resume` sets only `lastActiveMs`; `reduceCook` begin with `cook` set, stop, and
  an unchanged result returning the same state object.
  Files: `test/web/state/cook-session.test.ts`, `test/web/state/cook-slot.test.ts`,
  `src/web/state/cook-session.ts`, `src/web/state/cook-slot.ts` (stubs).
  Covers: CM3.4, CM5.1, CM5.8, CM7.3.
  Command: `npx vitest run --project examples test/web/state/cook-session.test.ts test/web/state/cook-slot.test.ts`
- [x] T1.8 Implement them until T1.7 passes; check that plan-ui's store tests still pass with the
  replaced `cook-slot.ts`.
  Files: `src/web/state/cook-session.ts`, `src/web/state/cook-slot.ts`.
  Covers: CM3.4, CM5.1, CM5.8, CM7.3, CM8.3.
  Command: `npx vitest run --project examples test/web/state && npm run typecheck && npm run lint`
- [x] T1.9 Test support: `arbCookBegin`, `arbCookIntents`, `cookActionFor` in `arbitraries.ts`;
  `replayCook` in `cook-replay.ts`; `oracleCookSections` and `oracleOverdue` in `oracles.ts`, with
  `test/meta/oracles.test.ts` cases giving CM-f's and CM-g's hand values and one wrong answer each
  on a hand-broken input.
  Files: `test/support/arbitraries.ts`, `test/support/cook-replay.ts`, `test/support/oracles.ts`,
  `test/support/fixtures.ts`, `test/meta/oracles.test.ts`.
  Covers: CM10.1.
  Command: `npx vitest run --project examples test/meta/oracles.test.ts && npm run typecheck`
- [x] T1.10 Properties P-CM1, P-CM2, P-CM6 and P-CM7 with `fcParams()`.
  Files: `test/web/state/cook-session.pbt.ts`.
  Covers: CM3.4, CM3.7, CM5.1, CM5.2, CM5.7, CM5.8, CM10.1.
  Command: `npx vitest run --project props test/web/state/cook-session.pbt.ts && npm run typecheck`

## T2. The view (pure)

- [x] T2.1 Example tests for `cookView`: CM-a before and after "Start now"; CM-c after the +15
  (running card, free lane `next`, dock null, undo until 18:30:10); CM-f field by field; CM-i at
  17:40 and 17:45; CM-j both endings; CM-k at 8 h 4 min and 7 h 59 min; a due `gravy.roux` with the
  roast running has `waitsFor ['Roast the chicken']`; the roast at 19:06 has `remainingMs -60000`
  and the dock `done chicken.roast`.
  Files: `test/web/state/cook-view.test.ts`, `src/web/state/cook-view.ts` (stubs).
  Covers: CM2.1–CM2.8, CM3.6, CM8.1.
  Command: `npx vitest run --project examples test/web/state/cook-view.test.ts`
- [x] T2.2 Implement `cookView` until T2.1 passes.
  Files: `src/web/state/cook-view.ts`.
  Covers: CM2.1–CM2.8, CM3.6, CM8.1, N1.
  Command: `npx vitest run --project examples test/web/state/cook-view.test.ts && npm run typecheck`
- [x] T2.3 Example tests, then implementation, for `focusAfter` (each row of the focus rule on
  CM-c and CM-i views), `finishedBetween` (roast end 19:05 in `(19:04:59, 19:05:00]`, not in
  `(19:05:00, 19:06]`) and `announcementFor` (CM-b, CM-c, CM-d, failed, undo, finished, none for an
  on-plan start).
  Files: `test/web/state/cook-view.test.ts`, `src/web/state/cook-view.ts`.
  Covers: CM4.2, CM5.6, CM9.3, CM9.4.
  Command: `npx vitest run --project examples test/web/state/cook-view.test.ts && npm run typecheck`
- [x] T2.4 Properties P-CM3, P-CM4 (also through plan-ui `toPersisted` and `loadState` with a fake
  storage) and P-CM5.
  Files: `test/web/state/cook-view.pbt.ts`.
  Covers: CM2.8, CM4.1, CM7.1, CM7.2, CM10.1.
  Command: `npx vitest run --project props test/web/state/cook-view.pbt.ts && npm run typecheck`

## T3. Copy and device ports

- [ ] T3.1 Example tests for the cooking copy: every log line, sentence and new-warning line of CM-b,
  CM-c, CM-d and CM-g; countdowns `10:00`, `69:00`, `+02:10`, and `00:01` for 500 ms; each
  announcement; the finished, stale, stop, too-late and alerts strings; plan-ui's copy checks run
  over the new strings.
  Files: `test/web/copy.test.ts`, `src/web/copy.ts` (stubs).
  Covers: CM5.3–CM5.6, CM9.4, N4.
  Command: `npx vitest run --project examples test/web/copy.test.ts`
- [ ] T3.2 Implement the copy until T3.1 passes.
  Files: `src/web/copy.ts`.
  Covers: CM5.3–CM5.6, CM9.4, N4.
  Command: `npx vitest run --project examples test/web/copy.test.ts && npm run typecheck`
- [ ] T3.3 Example tests, then implementation, for the device ports with fakes. `createWakeLock`:
  held, a second `acquire` makes no request, unsupported, refused, a sentinel `release` event gives
  `idle`, `release` calls the sentinel once. `createAlerts`: `enable` resumes one context, two
  oscillators at 880 Hz starting 0 and 0.25 s after `play`, the gain ramps, `vibrate([200, 100,
  200])`; no `AudioContext` gives `false` and a silent `play`; no `vibrate` is not an error.
  Files: `test/web/state/wake-lock.test.ts`, `test/web/state/alerts.test.ts`,
  `src/web/state/wake-lock.ts`, `src/web/state/alerts.ts`.
  Covers: CM4.3, CM4.4, CM6.1, CM6.2.
  Command: `npx vitest run --project examples test/web/state/wake-lock.test.ts test/web/state/alerts.test.ts && npm run typecheck`

## T4. The Cook screen

E2E: both projects, `test.use({ locale: 'en-GB', timezoneId: 'Europe/London' })`, `page.clock`
installed and paused, `seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30')` unless stated.

- [ ] T4.1 Register the screen: `SCREENS.cook`, `Cook.tsx` beginning a session from an effect,
  `CookHeader`, `CookCountdown`, `Countdown`, `cook.css`, `CookPortsProvider` and `useCookEffects`
  (tick only), `e2e/support.ts` helpers. E2E first: at 17:30 "Start cooking" opens `Right now` with
  `Cooking starts at 17:40`, `10:00`, the start-now sentence; `runFor(60_000)` shows `09:00`;
  "Start now" shows `Serve at 19:20`; at 17:52 a new session shows `Serve at 19:42`.
  Files: `src/web/app.tsx`, `src/web/main.tsx`, `src/web/screens/Cook.tsx`,
  `src/web/components/{CookHeader,CookCountdown,Countdown}.tsx`, `src/web/state/cook-hooks.ts`,
  `src/web/styles/cook.css`, `src/web/copy.ts`, `e2e/support.ts`, `e2e/cook-start.spec.ts`.
  Covers: CM1.1–CM1.4, CM2.1, CM4.1.
  Command: `npx playwright test e2e/cook-start.spec.ts && npm run typecheck && npm run lint`
- [ ] T4.2 `LaneCard`, `StartCard`, `ActionDock` with Start and Done. E2E first: at 17:40 the dock
  says `Season and truss the chicken` with `Start`; Start → `Done` focused; at 17:50 Done → the
  roast `Start, then leave it` card and `Shred the greens` in the dock; seeded `TWO_COOK_KITCHEN` at
  17:40 shows `Cook 1` and `Cook 2` cards.
  Files: `src/web/components/{LaneCard,StartCard,ActionDock}.tsx`, `src/web/screens/Cook.tsx`,
  `src/web/copy.ts`, `src/web/styles/cook.css`, `e2e/cook-roast.spec.ts`.
  Covers: CM2.2–CM2.4, CM3.1, CM3.5, CM3.6, CM9.3.
  Command: `npx playwright test e2e/cook-roast.spec.ts && npm run typecheck && npm run lint`
- [ ] T4.3 `RunningCard` and `ExtraTime`. E2E first: after starting the roast at 17:50 its card
  says `ready at 19:05` and `75:00`; `fastForward` to 19:05 shows `! Time is up` and the dock
  `Done`; `+5 min` is in a `Needs more time` group.
  Files: `src/web/components/{RunningCard,ExtraTime}.tsx`, `src/web/copy.ts`,
  `src/web/styles/cook.css`, `e2e/cook-roast.spec.ts`.
  Covers: CM2.5, CM3.1, CM4.1, CM4.2.
  Command: `npx playwright test e2e/cook-roast.spec.ts && npm run typecheck`
- [ ] T4.4 `UpNext` and `DishStrip`. E2E first: CM-f at 17:56: up next `Rest the chicken under foil`
  `in 1 h 9 min` `19:05`, then roux and simmer; dish chips as CM-f with words, no colour-only state.
  Files: `src/web/components/{UpNext,DishStrip}.tsx`, `src/web/copy.ts`, `e2e/cook-roast.spec.ts`.
  Covers: CM2.6, CM2.7, CM9.5.
  Command: `npx playwright test e2e/cook-roast.spec.ts && npm run typecheck`
- [ ] T4.5 `BuildLog` and `LogEntryView` with new warnings. E2E first: CM-c by taps, `+15 min` on
  the roast at 18:30 → the log's mono lines exactly as CM-c, `Serve at 19:45`, `Planned for 19:30`,
  the two warning sentences, the up-to-date toggle listing three `is up to date` lines, and the
  announcement in the live region.
  Files: `src/web/components/{BuildLog,LogEntryView}.tsx`, `src/web/copy.ts`,
  `src/web/styles/cook.css`, `e2e/cook-roast.spec.ts`.
  Covers: CM5.1, CM5.3–CM5.6.
  Command: `npx playwright test e2e/cook-roast.spec.ts && npm run typecheck`
- [ ] T4.6 "I'm behind", Undo, the blocked-start confirmation, late cards. E2E first: CM-d at
  17:53; CM-c then `Undo: +15 min on Roast the chicken` restores `Serve at 19:30` and is gone after
  `runFor(10_000)` without a tap; CM-g by `fastForward` to 19:10 shows `! Late by 5 min` on the roast and the rest and no log entry, then "I'm behind" shows the E3 log; starting `Make a
  roux in the roasting tin` while the roast runs asks first, `Not yet` changes nothing.
  Files: `src/web/components/ActionDock.tsx`, `src/web/components/LaneCard.tsx`,
  `src/web/state/cook-hooks.ts`, `src/web/copy.ts`, `e2e/cook-roast.spec.ts`.
  Covers: CM3.2–CM3.4, CM5.1, CM5.8.
  Command: `npx playwright test e2e/cook-roast.spec.ts && npm run typecheck && npm run lint`
- [ ] T4.7 Alerts: `AlertToggle`, time-up announcements and alerts in `useCookEffects`. E2E first
  with `fakeAudio`: the off copy; a tap turns it on and the fake sees a context resumed in the tap;
  at 19:05 `Time is up: Roast the chicken.` in the live region once, two oscillators, the vibrate
  pattern; after a reload the reload copy; no announcement on any second without an event.
  Files: `src/web/components/AlertToggle.tsx`, `src/web/state/cook-hooks.ts`, `src/web/copy.ts`,
  `e2e/support.ts`, `e2e/cook-device.spec.ts`.
  Covers: CM4.2–CM4.4, CM9.4.
  Command: `npx playwright test e2e/cook-device.spec.ts && npm run typecheck`
- [ ] T4.8 Wake lock: `WakeLockNote` and the lock in `useCookEffects`. E2E first with
  `fakeWakeLock`: `grant` → one request on entry, another after a hidden → visible change, a
  release on going to Plan; `refuse` and `none` → the note and no error text.
  Files: `src/web/components/WakeLockNote.tsx`, `src/web/state/cook-hooks.ts`, `src/web/copy.ts`,
  `e2e/support.ts`, `e2e/cook-device.spec.ts`.
  Covers: CM6.1, CM6.2.
  Command: `npx playwright test e2e/cook-device.spec.ts && npm run typecheck`
- [ ] T4.9 Persistence and the stale prompt: `CookStale`. E2E first: CM-c at 18:30, reload → the
  same log and `50:00`; a new page in the same context at 18:50 → `30:00` and no time-up replay; a
  stored session with `lastActiveMs` 9 h old → `Carry on with this dinner?`, Resume shows the view,
  Discard needs its second tap and opens Plan.
  Files: `src/web/components/CookStale.tsx`, `src/web/screens/Cook.tsx`, `src/web/copy.ts`,
  `e2e/cook-reload.spec.ts`.
  Covers: CM7.1–CM7.3.
  Command: `npx playwright test e2e/cook-reload.spec.ts && npm run typecheck`
- [ ] T4.10 Finishing and stopping: `CookFinished`, `StopCooking`. E2E first: H1 followed by taps to
  19:30 → `Dinner is served`, `Served at 19:30. Planned for 19:30: on time.`, the wake lock
  released; "Back to the plan" opens Plan; "Stop cooking" needs its second tap and opens Plan with
  `Start cooking` offered again.
  Files: `src/web/components/{CookFinished,StopCooking}.tsx`, `src/web/screens/Cook.tsx`,
  `src/web/copy.ts`, `e2e/cook-roast.spec.ts`, `e2e/cook-device.spec.ts`.
  Covers: CM8.1–CM8.3, CM6.1.
  Command: `npx playwright test e2e/cook-roast.spec.ts e2e/cook-device.spec.ts && npm run typecheck`
- [ ] T4.11 The whole sample. E2E: clock at 2026-11-11T09:00Z, Menu → `sunday-roast` → Plan →
  Start cooking → `cookUntilServed(page)` → `Planned for 13:30: on time.`; the build log reads
  `No rebuilds yet.` at every step.
  Files: `e2e/support.ts`, `e2e/cook-sample.spec.ts`.
  Covers: CM1.2, CM2.1–CM2.6, CM8.1, CM10.2.
  Command: `npx playwright test e2e/cook-sample.spec.ts`

## T5. Accessibility and the full pass

- [ ] T5.1 `e2e/cook-a11y.spec.ts`: axe with zero violations in light and dark on the states of the
  design's a11y row; every button at least 48×48 px and the primaries at least 64 px tall; the dock
  primary's top below two thirds of the 844 px viewport; focus after Start, Done and Undo as
  `focusAfter` says.
  Files: `e2e/cook-a11y.spec.ts`, fixes in `src/web/**`.
  Covers: CM3.5, CM3.6, CM9.1–CM9.3, CM10.3.
  Command: `npx playwright test e2e/cook-a11y.spec.ts && npm run check:contrast`
- [ ] T5.2 Zoom, landscape and motion in `e2e/cook-a11y.spec.ts`: CM-c at 195 px wide and at
  844×390 passes `expectNoPageScroll` with the dock visible without scrolling; the countdown is 56 px
  at 390 px; under `reducedMotion: 'reduce'` no element has a running transition.
  Files: `e2e/cook-a11y.spec.ts`, fixes in `src/web/styles/cook.css`.
  Covers: CM9.1, CM9.5.
  Command: `npx playwright test e2e/cook-a11y.spec.ts`
- [ ] T5.3 N3 on the phone project: a `+15 min` tap on the largest sample repaints the log within
  200 ms (`performance.now` in the page).
  Files: `e2e/perf.spec.ts`.
  Covers: N3.
  Command: `npx playwright test e2e/perf.spec.ts --project phone`
- [ ] T5.4 The whole suite. Report each runner's real counts.
  Files: none new.
  Covers: CM10.1–CM10.3, N2, N5.
  Command: `npm test && npm run test:props && npm run typecheck && npm run lint && npx prettier --check . && npm run check:contrast && npm run build && npm run test:e2e`
