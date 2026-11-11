# Requirements: cooking-mode

## Why

The phone stands on the counter and the cook has wet hands. The Cook screen says what to do right
now, counts down what is running, and, when something slips, rebuilds the rest of dinner in the
browser with core `rebuild` and shows what moved, like a build log. It is item 4 of "The product,
end to end" in `docs/BRIEF.md`.

## Scope

In `src/web`: the `cook` slice that plan-ui reserved (`cook-slot.ts`: `CookState`, `CookAction`,
`CookStateSchema`, `reduceCook`), the pure session transitions and view selector, the wake-lock and
alert wrappers, the Cook screen and its components, its copy and styles. In `test/` and `e2e/`: the
tests of CM10. It extends plan-ui's store, clock, copy, persistence and components and changes none
of plan-ui's types or reducers (plan-ui R9.9). Requirement ids are `CMn.m` (decided here).

Terms: the `product.md` glossary; **cook session** = the `cook` slice; **fact** = a recorded real
start or end of a step (a timestamp in ms); **due** = pending with its planned start at or before
now; **axis instant** = the session's minute 0 (rebuild design, "The axis and `servingMin`");
**the design** = `design.md` here, whose tables hold the thresholds and the exact copy.

Prerequisites: plan-ui done (store, `clock.ts`, `copy.ts`, `persist.ts`, `ConfirmInline`,
`LiveNotice`, `seedDinner`), rebuild done, `recordings/` recorded by the user.

## Requirements

### CM1. Starting

**User story:** As a cook, I want to start cooking against the real clock and see at once whether
dinner will be on time.

- CM1.1 WHEN the cook opens the Cook screen from "Start cooking" and no cook session exists, THE
  SYSTEM SHALL begin one against the Plan screen's current schedule, its chosen serving time as the
  axis instant, and the current time.
- CM1.2 WHILE no fact is recorded and the scheduled start is after now, THE SYSTEM SHALL count down
  to the start, name the first steps, and offer "Start now".
- CM1.3 WHEN the cook taps "Start now", THE SYSTEM SHALL move the axis instant earlier by the whole
  minutes until the start, so every step and the serving time move earlier by that amount, and say
  beforehand in one sentence the new serving time and by how much it moves.
- CM1.4 WHEN a session begins after the scheduled start, THE SYSTEM SHALL rebuild with no facts at
  once and show the true serving time and the build log before any action.
- CM1.5 IF that rebuild returns `invalid_now` or `serving_out_of_range`, THEN THE SYSTEM SHALL not
  begin a session and SHALL show the design's message with a link to the Plan screen.

### CM2. The "right now" view

**User story:** As a cook glancing from across the kitchen, I want to see the step to do, what is
running, and what comes next.

- CM2.1 THE SYSTEM SHALL show, top to bottom: the current clock time and the serving time (with the
  planned one when it differs); "Do now"; "Running"; "Up next"; the dish strip; the build log.
- CM2.2 THE SYSTEM SHALL show in "Do now" one card per cook lane of the kitchen; each card shows that
  lane's running hands-on step, else its earliest due hands-on step, else what is next for that
  lane; further running or due steps of the lane are listed in the same card (decided here).
- CM2.3 THE SYSTEM SHALL show each step on a card with its title (large), detail, dish name,
  duration, its due or end clock time and its action; a due step whose prerequisites are not all
  done SHALL say which.
- CM2.4 THE SYSTEM SHALL show due hands-free steps that are not started as "Start, then leave it"
  cards in "Do now", after the lane cards (decided here).
- CM2.5 THE SYSTEM SHALL show in "Running" every hands-free step in progress with a countdown and
  the clock time it finishes, and once finished, that its time is up.
- CM2.6 THE SYSTEM SHALL show in "Up next" the three pending steps that are not due with the
  earliest planned starts, each with "in <duration>" and its clock time.
- CM2.7 THE SYSTEM SHALL show in the dish strip every dish with its steps done out of its steps and
  one state word from the design.
- CM2.8 THE SYSTEM SHALL derive every section from the schedule, the facts and now by one pure
  selector, and SHALL never show a done step as due, running or next.

- CM2.9 THE SYSTEM SHALL show a step that is late by the design's rule (a running step 5 minutes
  past its planned end, a pending step 5 minutes, or its slack if larger, past its planned start) as
  late on its card ("Late by <duration>"), and SHALL emphasise "I'm behind" while any step is late
  (added for design review Q4).

### CM3. Actions

**User story:** As a cook with wet hands, I want few, big buttons that believe what I tell them.

- CM3.1 THE SYSTEM SHALL offer "Start" on a pending step (recording the actual start), "Done" on a
  running step (recording the actual end), and "Needs more time" with "+5 min", "+10 min" and
  "+15 min" on a running step.
- CM3.2 THE SYSTEM SHALL offer "I'm behind" while cooking, which rebuilds from now.
- CM3.3 WHEN the cook taps "Start" on a step whose prerequisites are not all done, THE SYSTEM SHALL
  ask for a second tap naming those steps, and then record the start.
- CM3.4 WHEN an action that changes the session is taken, THE SYSTEM SHALL offer "Undo" naming it
  for 10 seconds (decided here), and undo SHALL restore the session's state before that action.
- CM3.5 THE SYSTEM SHALL make every Cook-screen target at least 48×48 px with 8 px between targets,
  and "Start", "Done", "+5 min", "+10 min", "+15 min", "I'm behind" and "Start now" at least 64 px
  tall.
- CM3.6 THE SYSTEM SHALL place the first "Do now" card's action, "I'm behind" and "Undo" in a dock
  in the bottom third of the screen (decided here).
- CM3.7 IF an action names a step that is not in the state it needs, or comes after the undo window,
  THEN THE SYSTEM SHALL ignore it.

### CM4. Timers and alerts

**User story:** As a cook who walked away, I want the right time on return and a signal when a
timer ends.

- CM4.1 THE SYSTEM SHALL compute every countdown from the recorded start, the step's minutes plus
  extra minutes, and the clock, never from counted ticks, so a sleeping tab or a reload shows the
  right time.
- CM4.2 WHEN a hands-free step's time is up, THE SYSTEM SHALL change its card to the time-up state
  and make one polite announcement for all steps whose time came up since the last check.
- CM4.3 WHERE the cook has turned alerts on, THE SYSTEM SHALL also play a short chime made with Web
  Audio (no asset file) and vibrate where `navigator.vibrate` exists.
- CM4.4 THE SYSTEM SHALL keep alerts off until the cook turns them on with a tap, and SHALL explain
  next to the toggle what it does, that the browser needs the tap, and, after a reload, that one
  more tap is needed.

### CM5. Slips and rebuilds

**User story:** As a cook who is late, I want the app to replan the rest and tell me what moved.

- CM5.1 THE SYSTEM SHALL call core `rebuild` in the browser WHEN a step starts or ends more than the
  design's slip threshold from its planned time, WHEN extra minutes are added, WHEN the cook taps
  "I'm behind". Nothing rebuilds by itself: a late step is only shown late (CM2.9; design review Q4).
- CM5.2 THE SYSTEM SHALL map facts to `Progress` and now to the axis by the design's time mapping,
  so that no reachable session makes `rebuild` return `done_after_now`, `running_starts_after_now`
  or `done_ends_before_start`.
- CM5.3 WHEN a rebuild returns `ok`, THE SYSTEM SHALL add a build log entry in monospace: a line
  naming the cause, one line per moved step (`<step-id> <from> -> <to>`), a count of steps that did
  not move, and the serving time if it changed; or "Everything is on time" when nothing moved.
- CM5.4 THE SYSTEM SHALL list the unchanged steps, each "is up to date", one tap away.
- CM5.5 WHEN a rebuild adds `hold_exceeded` warnings that the previous schedule did not have, THE
  SYSTEM SHALL show each with its dish named (plan-ui `COPY.holdWarning`).
- CM5.6 WHEN a rebuild completes, THE SYSTEM SHALL announce politely how many steps moved and the
  serving time.
- CM5.7 IF a rebuild returns an error, THEN THE SYSTEM SHALL keep the previous schedule and the
  facts, log the failure with the design's sentence, and SHALL NOT throw.
- CM5.8 THE SYSTEM SHALL keep the schedule from before each action so that "Undo" restores it.

### CM6. Screen wake lock

- CM6.1 WHEN the Cook screen opens, THE SYSTEM SHALL request a screen wake lock; WHEN the document
  becomes visible again without one, request it again; WHEN the screen closes or dinner is served,
  release it.
- CM6.2 IF wake lock is unsupported or refused, THEN THE SYSTEM SHALL show the design's one-line
  note, which says the screen may sleep and names the device setting, and SHALL NOT show an error.

### CM7. Persistence

- CM7.1 THE SYSTEM SHALL store the whole cook session (schedule, facts with real timestamps, build
  log, undo, alert choice) through plan-ui's persistence after every change.
- CM7.2 WHEN the page loads with a stored session, THE SYSTEM SHALL resume it against the clock,
  showing the same view as before the reload at the same instant.
- CM7.3 IF the stored session's last action is more than 8 hours old (decided here), THEN THE SYSTEM
  SHALL ask whether to resume or discard it before showing it.

### CM8. Finishing

- CM8.1 WHEN every terminal step is done, THE SYSTEM SHALL show the end state: when dinner was served
  against when it was planned, in words, and release the wake lock.
- CM8.2 THE SYSTEM SHALL offer "Start over" (plan-ui's, with its second tap) and "Back to the plan".
- CM8.3 THE SYSTEM SHALL offer "Stop cooking" while cooking, after a second tap, which ends the
  session and opens the Plan screen.

### CM9. Accessibility and legibility

- CM9.1 THE SYSTEM SHALL use `ui.md`'s cooking-mode sizes: step titles 32 px, countdowns 56 px
  monospace with tabular numbers, nothing below 16 px.
- CM9.2 THE SYSTEM SHALL use one `<h1>`, a heading per section and per card, and real `<button>`s.
- CM9.3 WHEN an action changes the view, THE SYSTEM SHALL move focus by the design's focus rule and
  never to the top of the page.
- CM9.4 THE SYSTEM SHALL announce only the design's events in plan-ui's polite live region and
  SHALL NOT announce countdown ticks.
- CM9.5 THE SYSTEM SHALL tell state by words and marks, not colour alone; remove motion under
  `prefers-reduced-motion: reduce`; and work without horizontal page scrolling at 390×844, at 200%
  zoom, and in landscape at 844×390.

### CM10. Tests

- CM10.1 THE SYSTEM SHALL have the design's example tests and properties P-CM1 to P-CM7 for the pure
  modules (`npm test`, `npm run test:props`).
- CM10.2 THE SYSTEM SHALL have the design's e2e flows on the phone and desktop projects with
  `page.clock`, locale `en-GB`, time zone `Europe/London`, and a faked wake lock and audio.
- CM10.3 THE SYSTEM SHALL pass axe (`wcag2a`, `wcag2aa`, `wcag21aa`) with zero violations on every
  Cook-screen state of the design, in light and dark.

## Non-functional requirements

- N1 Pure modules (`cook-slot.ts`, `cook-session.ts`, `cook-view.ts`, copy) read no clock and touch
  no DOM: now arrives in actions and arguments. N2 Core only via `src/core/index.js`; no new
  dependency. N3 A rebuild after a tap repaints within 200 ms on the phone project for the largest
  sample. N4 Glossary words only; `ui.md` copy rules. N5 No network request from the Cook screen.

## Needs from other specs

- plan-ui `persist.ts`: a stored `cook` that fails `CookStateSchema` resets the whole state. Asked:
  drop only the `cook` slice (and route `cook` → `plan`) with this spec's notice.
- plan-ui `LiveNotice`: two equal announcements in a row (two "Time is up" for the same title) must
  both be read. Asked: re-announce when `notice/set` repeats a text.
- plan-ui Plan screen while cooking: it shows the original schedule and serving time, not the
  session's rebuilt one or a "Start now" shift. Asked: a note "You are cooking this dinner." with a
  link to the Cook screen; showing the rebuilt schedule there is a later change.
- plan-ui `app.tsx`, `main.tsx`: this spec sets `SCREENS.cook`, imports `cook.css` and provides the
  ports: its only edits to plan-ui files besides `cook-slot.ts` and `copy.ts`.
- steering `ui.md` names the primary actions "Done" and "Started"; this spec uses "Start", as asked.

## Out of scope

Sync between devices or tabs; alarms with the page closed; a service worker; voice control; editing
steps while cooking; pulling steps earlier after an early finish (R3); choosing a later serving time.
