# Requirements: plan-ui

## Why

Open the URL, tap a sample, see a schedule in which every dish lands at once; then paste your own
recipes, correct them, set kitchen and serving time, and take the plan away. Schedules are computed
in the browser by `src/core`; the server is asked only for `GET /api/samples` and `POST /api/parse`.

## Scope

In `src/web` (`tech.md`, `structure.md`, `ui.md`): the shell (header, flow navigation, theme, "Start
over", fragment routing, persistence), the Menu, Steps and Plan screens, timeline, plan list, export,
and the shared store that `cooking-mode` extends. In `test/web/` and `e2e/`: the tests of R11.

Terms: the `product.md` glossary; "valid plan": `validatePlan` gives a plan and no error; "clock
time": local, by `Intl.DateTimeFormat` in the user's locale; "chosen serving time": minute 0 of the
axis for the whole meal (rebuild design, "The axis and `servingMin`"); "notice": a line in the
`aria-live="polite"` region; "the design": `design.md` here, whose tables hold the exact copy.

Prerequisites: recipe-graph, scheduler, dinnerfile T1 to T4 and recipe-reader done, and
`recordings/` recorded by the user (`npm run record`); without them the server does not start
(recipe-reader R2.3) and no e2e runs.

## Requirements

### R1. Samples: a schedule fast

**User story:** As a first-time visitor, I want to tap a sample dinner and see its plan at once.

- R1.1 WHEN the Menu opens, THE SYSTEM SHALL request `GET /api/samples` once per page load and list
  every sample in response order with title, blurb and dish names.
- R1.2 IF the response fails the design's `SamplesResponseSchema` or the request fails, THEN THE
  SYSTEM SHALL show the samples error state with "Try again".
- R1.3 WHEN the cook chooses a sample, THE SYSTEM SHALL load its `plan` and `kitchen`, choose the
  serving time by R1.4 and open the Plan screen, with no other request, also with the key unset.
- R1.4 THE SYSTEM SHALL default the serving time to the sample's `servingTime` today when that is at
  least span + 15 minutes after now, else to the first `:00` or `:30` that is (decided here).
- R1.5 WHEN a dinner is already loaded and the cook chooses a sample, THE SYSTEM SHALL ask for a
  second tap before replacing it.

### R2. Paste recipes

**User story:** As a cook, I want editable steps from my recipes, and plain words when that fails.

- R2.1 THE SYSTEM SHALL provide a labelled text area and a counter of the text's length after
  `normaliseRecipeText`, in code points, against 12,000.
- R2.2 WHILE the normalised text is empty or over 12,000 characters, THE SYSTEM SHALL disable
  "Read recipes" and say why.
- R2.3 WHEN the cook taps "Read recipes", THE SYSTEM SHALL send `POST /api/parse` with
  `{ "text": <text as typed> }` as `application/json`.
- R2.4 WHILE the request is in flight, THE SYSTEM SHALL say what is happening, that it can take up
  to a minute, and the seconds elapsed, disable the text area and the button, and offer "Cancel",
  which aborts the request.
- R2.5 WHEN the response is 200 and passes `ParseResponseSchema`, THE SYSTEM SHALL load its plan
  with the default kitchen and no serving time, and open the Steps screen.
- R2.6 IF the response is an error with a code of `tech.md`'s list, THEN THE SYSTEM SHALL show the
  design's sentence for it (what happened, what to do next; for `rate_limited` and
  `daily_cap_reached` the clock time from `Retry-After` when valid) and keep the text.
- R2.7 IF the request fails without a response or the response matches neither R2.5 nor R2.6, THEN
  THE SYSTEM SHALL show the design's network or unexpected-response sentence.
- R2.8 THE SYSTEM SHALL keep the recipe and Dinnerfile texts across reloads until a dinner is loaded
  from that text or the cook starts over.

### R3. Dinnerfile import

**User story:** As a cook with a Dinnerfile, I want my plan back, or the lines that are wrong.

- R3.1 THE SYSTEM SHALL provide a labelled monospace text area, "Open Dinnerfile", and a file picker
  that puts a chosen file of at most 1 MB into the text area and opens it (bound decided here).
- R3.2 WHEN the cook opens a Dinnerfile, THE SYSTEM SHALL read it with `fromDinnerfile` in the
  browser, with no request.
- R3.3 IF `fromDinnerfile` returns errors, THEN THE SYSTEM SHALL list every message under the text
  area in the order returned, each with "Show line n", which selects that line.
- R3.4 IF `validatePlan` on the imported plan gives `plan: null`, THEN THE SYSTEM SHALL list its
  issue messages under the text area.
- R3.5 WHEN import gives a plan, THE SYSTEM SHALL use the `# kitchen` line if it passes
  `parseKitchen` (else the default kitchen and a notice) and the `# serve` time if present, and open
  the Plan screen for a valid plan, else the Steps screen.

### R4. Steps screen

**User story:** As a cook, I want to correct the steps, and see which break which rule, first.

- R4.1 THE SYSTEM SHALL show a section per dish in plan order and in it the dish's steps in the
  order of `topologicalOrder(plan)`, or in plan order when that returns a cycle error.
- R4.2 THE SYSTEM SHALL show each step as a summary (title, id, minutes, appliance, hands-on, hold,
  prerequisites by title) with "Edit"; at most one step editor is open at a time.
- R4.3 THE SYSTEM SHALL let the cook edit title, minutes, appliance, hands-on, dish, hold (a "Keeps"
  checkbox plus whole minutes 0 to 480) and prerequisites (a checklist of the other steps, same
  dish first, then the other dishes in plan order).
- R4.4 IF a field value would fail `StepSchema`, THEN THE SYSTEM SHALL show the field's error, keep
  the typed value and leave the plan unchanged, so the stored plan always passes `PlanSchema`.
- R4.5 THE SYSTEM SHALL disable each option that already waits, directly or not, for the step being
  edited, and show checked every `after` id that is not a step or is the step itself.
- R4.6 THE SYSTEM SHALL let the cook add a step, add a dish (named first, with one new step), rename
  a dish (ids never change), and remove a step or a dish with its steps after a second tap.
- R4.7 WHEN removed steps are listed in other steps' `after`, THE SYSTEM SHALL remove them from those
  lists and say so in the confirmation and in a notice (decided here).
- R4.8 THE SYSTEM SHALL prevent removing the last step or dish and adding past 12 dishes or 80
  steps, saying why, and give new dishes and steps unique pattern-valid ids (`slugify`, `nextStepId`).
- R4.9 THE SYSTEM SHALL run `validatePlan` on every change and show each issue beside every step it
  names (`stepId`, or every step of a `cycle` path), dish issues at the top of their dish, and all
  issues in a summary at the top with a link to each; errors marked `!` "Error", warnings `!`
  "Warning", never by colour alone.
- R4.10 WHILE the plan has an error, THE SYSTEM SHALL disable "Make the plan" and say how many errors
  to fix; warnings SHALL NOT block it.
- R4.11 WHEN the cook taps "Make the plan", THE SYSTEM SHALL open the Plan screen and, if no serving
  time is chosen, choose one by R1.4 without a suggested time.
- R4.12 WHILE cooking has started (`cook` is not null), THE SYSTEM SHALL show the steps read-only
  and disable the kitchen and serving controls.

### R5. Plan screen

**User story:** As a cook, I want to set my kitchen and serving time and see when to start.

- R5.1 THE SYSTEM SHALL show steppers for burners (0 to 8), ovens (0 to 4) and cooks (1 to 6) with
  "−" and "+" disabled at the bounds, and a serving time input.
- R5.2 WHEN the kitchen changes, THE SYSTEM SHALL recompute `schedule(plan, kitchen)` in the browser
  before the next paint; a serving time change SHALL NOT recompute it.
- R5.3 WHEN the cook enters a serving time, THE SYSTEM SHALL resolve it to the first instant at that
  local clock time at or after 4 hours before now (decided here).
- R5.4 WHEN `schedule` returns `ok`, THE SYSTEM SHALL show start time, serving time (with the day
  when not today), span, warnings, timeline and plan list.
- R5.5 WHEN the start is before the current minute, THE SYSTEM SHALL show "This dinner needs <span>.
  Earliest serving time <time>." and "Serve at <time>", which sets it; the time is now + span
  rounded up to 5 minutes, re-checked at least every 30 seconds from the injected clock.
- R5.6 THE SYSTEM SHALL show each `hold_exceeded` warning naming the dish, step title, wait and hold.
- R5.7 IF `schedule` returns `missing_appliance`, THEN THE SYSTEM SHALL say per appliance which steps
  need it, offer "Add an oven" or "Add a burner" and "Change the steps", keep the kitchen and serving
  controls usable, and show no timeline or list.
- R5.8 IF `schedule` returns `invalid_plan`, THEN THE SYSTEM SHALL say so with a link to Steps.

### R6. Timeline

**User story:** As a cook glancing at the counter, I want a row per burner, oven and cook.

- R6.1 THE SYSTEM SHALL draw a row per lane number in use, ordered Cook 1..n, Burner 1..n, Oven 1..n,
  labelled in text ("Cook 1", "Burner 2"); a step is drawn on every lane it holds.
- R6.2 THE SYSTEM SHALL put steps with no appliance that are not hands-on into the fewest
  non-overlapping "Hands-free" rows (filled by start, then id), labelled "Hands-free" if there is
  one, else "Hands-free 1..n".
- R6.3 THE SYSTEM SHALL map minute `t` to `(t − originMin) × 6` px, `originMin` being the earliest
  start rounded down to a quarter hour of clock time, and end the axis at `servingMin` rounded up to
  a quarter hour (scale decided here).
- R6.4 THE SYSTEM SHALL label every quarter hour in clock time and draw a serve line at `servingMin`
  labelled "Serve <time>".
- R6.5 THE SYSTEM SHALL style bars: oven hatched, burner solid, no appliance plain, dashed outline
  when not hands-on; the title as label on bars of at least 56 px, cut with an ellipsis.
- R6.6 THE SYSTEM SHALL mark "Critical" with `▲` only a step with `critical` true and `holdMin` not
  `null`; a critical step whose result keeps SHALL read "No slack" (decided in review).
- R6.7 THE SYSTEM SHALL mark the timeline `aria-hidden="true"`, with nothing focusable in it, and
  precede it with a visible "Skip to the plan list" link.
- R6.8 WHEN the cook taps a bar, THE SYSTEM SHALL scroll that step's plan list item into view and
  focus it.
- R6.9 THE SYSTEM SHALL scroll horizontally only inside the timeline, keep lane labels in view, and
  never scroll the page horizontally, at 390 px wide and at 200% zoom.

### R7. Plan list

**User story:** As a cook who reads, prints or uses a screen reader, I want the plan as text.

- R7.1 THE SYSTEM SHALL list every step once, ordered by start then id, under a heading per distinct
  start clock time, ending with the serving time, as headings and `<ol>` items always in the DOM,
  each item focusable by script (`tabindex="-1"`).
- R7.2 THE SYSTEM SHALL give each item its time range, title, dish name, lanes ("Oven 1, Cook 1" or
  "Hands-free"), duration, one of "▲ Critical", "No slack" or "Slack <duration>" (R6.6), and the
  `detail` when present.
- R7.3 THE SYSTEM SHALL add `!`, "Warning", the wait and the hold to an item with `hold_exceeded`.
- R7.4 WHEN start and serving fall on different local dates, THE SYSTEM SHALL prefix every heading
  with the short weekday.

### R8. Export, share and print

**User story:** As a cook, I want to keep my plan, run it through Make, send it, or print it.

- R8.1 THE SYSTEM SHALL offer "Dinnerfile", "Share link" and "Print" when `schedule` returns `ok`.
- R8.2 WHEN the cook taps "Dinnerfile", THE SYSTEM SHALL open a panel with `toDinnerfile(plan,
  { kitchen, serve })` in monospace, "Copy", "Download" (a `text/plain` file named `Dinnerfile`)
  and the line on `make -n -f Dinnerfile dinner`.
- R8.3 WHEN the cook taps "Share link", THE SYSTEM SHALL copy a URL with fragment `#/share/` plus the
  design's version 1 payload of plan, kitchen and serving time, and show it in a read-only field.
- R8.4 IF the URL would exceed 8,000 characters, THEN THE SYSTEM SHALL offer no link and point to the
  Dinnerfile (bound decided here).
- R8.5 WHEN the page opens with a share fragment, THE SYSTEM SHALL decode it in the browser, check it
  with the design's schema, `validatePlan` (no error), `parseKitchen` and `ServeTimeSchema`, load
  it with the serving time resolved by R5.3, and open the Plan screen.
- R8.6 IF a share fragment fails, THEN THE SYSTEM SHALL open the Menu with the design's message for
  the failure and change nothing stored; WHEN one arrives while a dinner is loaded, ask first.
- R8.7 WHEN a clipboard write fails, THE SYSTEM SHALL say so and select the text for copying by hand.
- R8.8 WHEN printed, THE SYSTEM SHALL show only the plan title, serving and start times, plan list
  and Dinnerfile text, black on white.
- R8.9 THE SYSTEM SHALL satisfy `decodeShare(encodeShare(d))` = `{ plan: canonicalPlan(d.plan),
  kitchen, serve }` for every valid plan, kitchen and serving time (P-UI1).

### R9. Shell, navigation and persistence

**User story:** As a cook, I want to see where I am and find my dinner as I left it after a reload.

- R9.1 THE SYSTEM SHALL show on every screen a header with "Make Dinner" (a link to the Menu), a
  theme switch (System, Light, Dark: stored, and set as `data-theme` on the root except for System)
  and "Start over".
- R9.2 THE SYSTEM SHALL show the flow Menu, Steps, Plan, Cook as navigation: the current item with
  `aria-current="step"`, reachable items as links, unreachable ones as text with the design's reason.
- R9.3 THE SYSTEM SHALL route by fragment (`#/menu`, `#/steps`, `#/plan`, `#/cook`) with working
  Back and Forward, replacing an unreachable or unknown fragment by the nearest reachable earlier one.
- R9.4 THE SYSTEM SHALL give each screen one `<h1>`, a document title "<screen> · Make Dinner", and
  move focus to the `<h1>` on a screen change; notices go to one `aria-live="polite"` region.
- R9.5 THE SYSTEM SHALL store the design's persisted state in localStorage after every change and
  restore it on load after `PersistedStateSchema` and `validatePlan`.
- R9.6 IF the stored state is unreadable or fails its checks, THEN THE SYSTEM SHALL start fresh with
  the design's notice; IF storing fails, THEN show the design's notice once per page load.
- R9.7 WHEN the cook confirms "Start over", THE SYSTEM SHALL clear the dinner, the pasted texts and
  the `cook` slice, keep the theme, and open the Menu.
- R9.8 THE SYSTEM SHALL make no request after the samples have loaded except `POST /api/parse`.
- R9.9 THE SYSTEM SHALL let `cooking-mode` add its screen by filling `SCREENS.cook` and replacing the
  placeholders in `cook-slot.ts`, without changing this spec's types or reducers.

### R10. Error and empty states

- R10.1 THE SYSTEM SHALL show, word for word, the design's copy for every state in its tables.
- R10.2 IF rendering throws, THEN THE SYSTEM SHALL show the design's error boundary with "Reload" and
  "Start over", logging the error to the console only.
- R10.3 THE SYSTEM SHALL keep every string in `src/web/copy.ts`, follow `ui.md`'s copy rules, and
  never show raw model output, a stack trace or server internals.

### R11. Tests

- R11.1 THE SYSTEM SHALL have the design's unit tests (`npm test`) and properties P-UI1 to P-UI6
  (`npm run test:props`) for the pure modules.
- R11.2 THE SYSTEM SHALL have the design's e2e flows on both projects with a fixed clock, locale
  `en-GB` and time zone `Europe/London`, faking `POST /api/parse` with `page.route`.
- R11.3 THE SYSTEM SHALL pass axe (`wcag2a`, `wcag2aa`, `wcag21aa`) with zero violations on Menu,
  Steps and Plan, panels open, in light and dark.

## Non-functional requirements

- N1 Accessibility as in `ui.md`. N2 Speed: on the phone project the largest sample's timeline shows
  within 1 s of the tap, and a kitchen change repaints within 200 ms.
- N3 `src/web` imports core only via `src/core/index.js`; no new dependency (decided here). N4 Pure
  modules (`state/*.ts` but `hooks.ts`, `effects.ts`; `components/*.ts`; `copy.ts`) use no DOM and no
  `Date.now()`. N5 No `ANTHROPIC` or `sk-ant-` in `src/web`. N6 Glossary words only. N7 No server
  storage of plans: the share link lives in the fragment, which browsers do not send.

## Needs from other specs

- recipe-reader: shared response schemas are its open question; until they move to core,
  `src/web/state/api.ts` defines them from its R3.2 and design (`SampleItem`, `ParseResponse`).
  `model_unavailable` covers "no key" and "model down", so the UI shows one sentence for both.
  Its `ServingTimeSchema` duplicates core's `ServeTimeSchema`; the UI uses core's.
- rebuild design, "The axis and `servingMin`": says the share link stores a `RebuiltSchedule`; this
  share link carries plan, kitchen and serving time only, as asked. That line needs a hand edit.
- steering: `product.md` line 87 and `ui.md` lines 63 and 67 define "Critical" as slack 0; R6.6
  narrows the word. Both need a hand edit.
- cooking-mode: owns the `cook` slice, its actions, the Cook screen, "Start cooking" and stopping.

## Out of scope

Cooking mode; a service worker; syncing tabs; editing `detail` or ids; undo; drag and drop; timeline
zoom; mapping a Dinnerfile's `validatePlan` issues back to lines; translations.
