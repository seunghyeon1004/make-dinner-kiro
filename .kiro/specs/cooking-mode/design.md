# Design: cooking-mode

Requirements: `requirements.md` in this folder. Rules followed without restating them: `ui.md`,
`tech.md`, `structure.md`, `testing.md`, `product.md`, the rebuild spec (`rebuild`, `Progress`,
`RebuiltSchedule`, `Rebuilt`, the diff, RB-a, E3, the oracles and `arbScheduled`), the scheduler
spec (`Schedule`, H1) and the plan-ui spec (store, `clock.ts`, `copy.ts`, `persist.ts`, `useNow`,
`ConfirmInline`, `LiveNotice`, `seedDinner`, e2e conventions), whose names are used exactly.

## Files

| file | holds |
| ---- | ----- |
| `src/web/state/cook-slot.ts` | replaces plan-ui's placeholders: `CookState`, `CookAction`, `CookStateSchema`, `reduceCook` |
| `src/web/state/cook-session.ts` | pure: thresholds, time mapping, `canBegin`, `beginSession`, `applyCook`, log building, `overdueIds` |
| `src/web/state/cook-view.ts` | pure: `cookView`, `focusAfter`, `finishedBetween`, `announcementFor` |
| `src/web/state/wake-lock.ts`, `alerts.ts` | `createWakeLock`, `createAlerts`: browser wrappers behind small ports |
| `src/web/state/cook-hooks.ts` | `CookPortsProvider`, `useCookEffects`: ticks, alerts, wake lock, announcements (not pure) |
| `src/web/screens/Cook.tsx`, `src/web/components/Cook*.tsx` | the screen and the components table |
| `src/web/copy.ts` (added), `src/web/styles/cook.css` (decided here) | the copy tables; Cook-screen styles |
| `src/web/app.tsx`, `main.tsx` (edited) | `SCREENS.cook = Cook`; `cook.css` import; `CookPortsProvider` with the real ports |

Imports: `cook-slot.ts` → `cook-session.ts` → `clock.ts`, `../../core/index.js`; `cook-view.ts` →
`cook-session.ts`; `copy.ts` → `cook-view.ts` types. `cook-slot.ts` never imports `store.ts`.

## Thresholds (`cook-session.ts`, decided here)

| name | value | meaning |
| ---- | ----- | ------- |
| `SLIP_MIN` | 2 | a start or end more than 2 min from the schedule's rebuilds; within it the fact is only recorded |
| `OVERDUE_MIN` | 5 | a running step 5 min past its scheduled end, or a pending step 5 min (or its slack, if larger) past its start, triggers a rebuild |
| `UNDO_MS` | 10 000 | "Undo" is offered for 10 s after an action |
| `STALE_MS` | 8 h | a session whose last action is older asks to resume or discard |
| `UP_NEXT_COUNT` | 3 | items in "Up next" |
| `LOG_MAX` | 20 | build log entries kept, oldest dropped |
| `TICK_MS` | 15 000 | `cook/tick` interval; also sent on `visibilitychange` to visible |
| `EXTRA_CHOICES` | 5, 10, 15 | "Needs more time" |

Why: 2 min absorbs tapping a little early or late without a log entry per tap; the pending rule
uses slack so a prep step with an hour of slack (`greens.shred`, 75) does not rebuild every 5 min
while the cook ignores it, and a rebuild is never needed for a delay within slack (G8). 8 h covers
prep started in the afternoon for the evening.

## State (`cook-slot.ts`)

```ts
export type StepFact =
  | { state: 'running'; startedAtMs: number; extraMin: number }
  | { state: 'done'; startedAtMs: number; endedAtMs: number };
export type LogCause =
  | { kind: 'begin-late'; byMin: number } | { kind: 'start' | 'done'; stepId: string; byMin: number } // + late, - early
  | { kind: 'extra'; stepId: string; minutes: 5 | 10 | 15 } | { kind: 'behind' }
  | { kind: 'overdue'; stepIds: string[] };                         // sorted by compareIds
export type LogResult =
  | { ok: true; moved: StepMove[]; unchanged: string[]; servingFromMin: number; servingToMin: number;
      newWarnings: HoldExceededIssue[] }                             // moved sorted by (toStartMin, id)
  | { ok: false; error: RebuildError['kind'] };
export interface LogEntry { atMs: number; cause: LogCause; result: LogResult }
export interface CookCore {
  axisMs: number;            // minute 0 of the session; never rebased after the first fact
  plannedServingMs: number;  // clockAt(axisMs, 0) when cooking began (after "Start now")
  beganAtMs: number;
  schedule: RebuiltSchedule;
  facts: Record<string, StepFact>;
  log: LogEntry[];           // oldest first, at most LOG_MAX
}
export type UndoLabel = { kind: 'start' | 'done'; stepId: string } | { kind: 'extra'; stepId: string; minutes: number }
  | { kind: 'behind' } | { kind: 'start-now' };
export interface CookState {
  version: 1; core: CookCore; lastActiveMs: number; alertsWanted: boolean;
  undo: { label: UndoLabel; untilMs: number; before: CookCore } | null;
}
export type CookAction =
  | { type: 'cook/begin'; schedule: Schedule | RebuiltSchedule; axisMs: number; nowMs: number }
  | { type: 'cook/start-now' | 'cook/behind' | 'cook/undo' | 'cook/tick' | 'cook/resume'; nowMs: number }
  | { type: 'cook/start' | 'cook/done'; stepId: string; nowMs: number }
  | { type: 'cook/extra'; stepId: string; minutes: 5 | 10 | 15; nowMs: number }
  | { type: 'cook/alerts'; wanted: boolean } | { type: 'cook/stop' };
export const CookStateSchema: z.ZodType<CookState>;  // strict objects; refine: fact and log ids are schedule ids
export function reduceCook<S extends { cook: CookState | null }>(state: S, action: CookAction): S;
```

The undo slot holds a `CookCore`, not a `CookState`, so slots never nest (decided here).
`CookStateSchema` uses `RebuiltScheduleSchema`, `StepMoveSchema`, `HoldExceededIssueSchema`, ms as
`z.int().min(0)`, `extraMin` as `REBUILD_LIMITS.extraMax`. `reduceCook`: `cook/begin` when `cook`
is null and `beginSession` is `ok` sets it, else no-op; `cook/stop` sets `cook` null; every other
action with `cook` set calls `applyCook`; a result identical to the input returns `state` itself.
The generic bound lets `reduceCook` stay free of `AppState` (plan-ui calls it as `reduceCook(state,
action)`; its placeholder signature `<S>` is replaced, R9.9).

## Time mapping (`cook-session.ts`)

Minute 0 is `core.axisMs` for the whole session; `servingMin` says where serving is now (rebuild
design). Instants become axis minutes with plan-ui's `minuteAt(axisMs, ms)` (floor) and minutes
become instants with `clockAt(axisMs, m)`. Shown: serving `clockAt(axisMs, schedule.servingMin)`,
a pending step's start `clockAt(axisMs, startMin)`, a running step's end
`startedAtMs + (minutes + extraMin) × MINUTE_MS`.

```ts
export function effectiveNow(core: CookCore, nowMs: number): number;  // max(nowMs, beganAtMs, every fact timestamp)
export function progressOf(core: CookCore): Progress;
// done → { startMin: minuteAt(start), endMin: minuteAt(end) }; running → { startMin: minuteAt(start), extraMin }
export function endsAtMs(step: Step, fact: Extract<StepFact, { state: 'running' }>): number;
```

Every action uses `t = effectiveNow(core, nowMs)` for the facts it records and `minuteAt(axisMs, t)`
as the rebuild's `now`. `minuteAt` is monotone and every fact timestamp is `<= t`, so `startMin <=
endMin <= now` and `startMin <= now` for every entry: the three `rebuild` fact errors cannot occur
(CM5.2). A device clock set backwards is absorbed by `effectiveNow`. "Start now" is the only
rebase, allowed only before the first fact.

## Transitions (`cook-session.ts`)

```ts
export type BeginError = { kind: 'too_late' } | { kind: 'invalid_schedule' };
export function canBegin(schedule: Schedule | RebuiltSchedule, axisMs: number, nowMs: number): Result<null, BeginError>;
export function beginSession(schedule: Schedule | RebuiltSchedule, axisMs: number, nowMs: number): Result<CookState, BeginError>;
export function applyCook(state: CookState, action: Exclude<CookAction, { type: 'cook/begin' | 'cook/stop' }>): CookState;
export function overdueIds(core: CookCore, nowMs: number): string[];
```

`beginSession`: `startMin = min startMin`; `core = { axisMs, plannedServingMs: clockAt(axisMs,
servingMin), beganAtMs: nowMs, schedule, facts: {}, log: [] }`. If `minuteAt(axisMs, nowMs) >
startMin`, rebuild with `{}` and log cause `begin-late` (`byMin` = the difference); `invalid_now` or
`serving_out_of_range` → `too_late`; any other error → `invalid_schedule` (a bug). `lastActiveMs =
nowMs`, `alertsWanted false`, `undo null`. `canBegin` runs the same checks.

`applyCook`, with `t = effectiveNow`, `n = minuteAt(axisMs, t)`, `sched(s)` the step's current
schedule entry. "Undoable" actions set `undo = { label, untilMs: t + UNDO_MS, before: old core }`
and `lastActiveMs = t`.

| action | valid when | facts | rebuild when | undo label |
| ------ | ---------- | ----- | ------------ | ---------- |
| `start-now` | no fact, no log entry, `t < startMs` | none; `d = round((startMs - t) / MINUTE_MS)`, at least 1; `axisMs -= d` min, `plannedServingMs` alike | never | `start-now` |
| `start {s}` | `s` pending | `running { t, extraMin 0 }` | `abs(n - sched(s).startMin) > SLIP_MIN`, cause `start` | `start` |
| `done {s}` | `s` running | `done { startedAtMs, t }` | `abs(n - sched(s).endMin) > SLIP_MIN`, cause `done` | `done` |
| `extra {s, m}` | `s` running | `extraMin += m` (capped at `extraMax`) | always, cause `extra` | `extra` |
| `behind` | phase cooking | none | always, cause `behind` | `behind` |
| `undo` | `undo` set, `t < untilMs` | `core = undo.before` | never | slot cleared |
| `tick` | phase cooking | none | `overdueIds(core, t)` non-empty, cause `overdue` | slot kept |
| `resume` | always | none | never | `lastActiveMs = t` only |
| `alerts {wanted}` | always | none | never | `alertsWanted` only |

An invalid action returns `state` itself (CM3.7). `byMin` is `n - sched(s).startMin` (or `endMin`).
`overdueIds`: running `s` with `n >= sched(s).endMin + OVERDUE_MIN`, and pending `s` with `n >=
sched(s).startMin + max(OVERDUE_MIN, sched(s).slackMin)`. After the rebuild a pending step starts
`>= n` and a running overrun ends at `n`, so a second tick at the same `n` finds nothing (P-CM6).

**Rebuild and log.** `r = rebuild(core.schedule, progressOf(core'), n)`. `ok`: `schedule =
r.value.schedule`; entry `{ atMs: t, cause, result: { ok: true, moved: diff.moved` sorted by
`(toStartMin, stepId)`, `unchanged: diff.unchanged, servingFromMin: old servingMin, servingToMin:
new servingMin, newWarnings` = new warnings whose `stepId` the old schedule did not warn, or warned
with a smaller `waitMin` `}`. `err`: schedule kept, `{ ok: false, error: kind }`. Entries beyond
`LOG_MAX` drop from the front. `moved` lists pinned steps too (rebuild RQ9.1): a step started 3 min
late shows its real start.

## The view (`cook-view.ts`)

```ts
export type Phase = 'countdown' | 'cooking' | 'finished' | 'stale';
export interface CardStep {
  stepId: string; title: string; detail: string | null; dishName: string; minutes: number; handsOn: boolean;
  plannedStartMs: number;
  state: 'due' | 'running'; startedAtMs: number | null; endsAtMs: number | null; // running only
  remainingMs: number | null;        // endsAtMs - nowMs, negative when over
  waitsFor: string[];                // titles of prerequisites not done, in plan order (due only)
}
export interface LaneCard { cookLane: number; current: CardStep | null; also: CardStep[]; next: { title: string; startMs: number } | null }
export interface UpNextItem { stepId: string; title: string; dishName: string; startMs: number; inMin: number }
export interface DishState { dishId: string; name: string; done: number; total: number;
  state: { kind: 'done' } | { kind: 'cooking' } | { kind: 'due' } | { kind: 'next'; startMs: number } }
export interface CookView {
  phase: Phase; nowMs: number; servingMs: number; plannedServingMs: number; startMs: number;
  lanes: LaneCard[]; toStart: CardStep[]; running: CardStep[]; upNext: UpNextItem[]; dishes: DishState[];
  dock: { stepId: string; action: 'start' | 'done' } | null;
  undo: { label: UndoLabel; untilMs: number } | null;
  finished: { servedMs: number; plannedMs: number } | null;
  log: LogEntry[];                   // newest first
}
export function cookView(state: CookState, nowMs: number): CookView;
```

Rules (`s` over plan steps, `startMs(s) = clockAt(axisMs, sched(s).startMin)`):

- `phase`: `finished` when every terminal step is done; else `stale` when `nowMs - lastActiveMs >
  STALE_MS`; else `countdown` when there is no fact and `nowMs < startMs` (the earliest start);
  else `cooking`. Phase is derived, never stored, so the countdown ends by itself at the start.
- Due: pending and `startMs(s) <= nowMs`. Running: a `running` fact.
- `lanes`: one per cook lane `1..kitchen.cooks`. Candidates: hands-on steps with
  `sched(s).lanes.cook` equal to the lane that are running (by `startedAtMs`, id) then due (by
  `startMs`, id). `current` = the first, `also` = the rest, `next` = the earliest pending, not due,
  hands-on step of the lane, when `current` is null.
- `toStart`: due hands-free steps, by (`startMs`, id). `running`: running hands-free steps, by
  (`endsAtMs`, id). `upNext`: pending, not due, by (`startMs`, id), first `UP_NEXT_COUNT`; `inMin =
  ceil((startMs - nowMs) / MINUTE_MS)`.
- `dishes` in plan order: `done` when all its steps are done; `cooking` when one runs; `due` when
  one is due; else `next` with its earliest pending start.
- `dock`: lane 1's `current` (`start` if due, `done` if running); else the first `running` card
  whose `remainingMs <= 0` (`done`); else null. The dock's step is not also given a button in its
  card. `undo` only while `nowMs < untilMs`.
- `finished.servedMs` = the latest `endedAtMs` of a terminal step; `plannedMs = plannedServingMs`.

```ts
export type FocusTarget = { kind: 'action'; stepId: string; action: 'start' | 'done' } | { kind: 'heading'; id: string } | null;
export function focusAfter(action: CookAction, before: CookView, after: CookView): FocusTarget;
export function finishedBetween(state: CookState, fromMs: number, toMs: number): string[]; // hands-free running, endsAtMs in (fromMs, toMs]
export type Announcement = string | null;
export function announcementFor(before: CookState | null, after: CookState | null, label?: UndoLabel): Announcement; // copy below
```

Focus rule (CM9.3): `start s` → `s`'s Done button; `done s` → heading of the card now holding the
lane (or the next `toStart`/`running` card), else the section's `<h2>`; `extra` and `behind` →
`null` (focus stays on the pressed button); `undo` → the restored step's primary button, else
`h2#do-now`; `start-now` → the first lane card's heading; `tick`, `alerts`, `resume` → `null`.

## Ports and effects

```ts
export type WakeLockStatus = 'idle' | 'held' | 'unsupported' | 'refused';
export interface WakeLockPort { acquire(): Promise<WakeLockStatus>; release(): Promise<void>; status(): WakeLockStatus }
export function createWakeLock(nav: { wakeLock?: { request(type: 'screen'): Promise<SentinelLike> } }): WakeLockPort;
export interface AlertPort { enable(): Promise<boolean>; ready(): boolean; play(): void } // enable() only in a click handler
export function createAlerts(win: { AudioContext?: new () => AudioContextLike; navigator: { vibrate?: (p: number[]) => boolean } }): AlertPort;
```

- `createWakeLock`: no `nav.wakeLock` → `unsupported`; a rejected request → `refused`; a sentinel's
  `release` event sets `idle`. `acquire` while `held` does nothing.
- `createAlerts`: `enable` creates and `resume()`s one `AudioContext` in the gesture; `play` sounds
  two 880 Hz sine beeps of 150 ms, 100 ms apart, gain 0.2 with 10 ms ramps, and calls
  `vibrate([200, 100, 200])` when present. No context → `enable` gives `false`; play is silent.
- `useCookEffects(store, ports, clock)` while the Cook screen is mounted: `acquire` on mount and on
  `visibilitychange` to visible when `status() !== 'held'`, `release` on unmount and when the phase
  becomes `finished`; `cook/tick` every `TICK_MS` and on visible; every second (the `useNow(clock,
  1000)` render) `finishedBetween(state, lastCheckedMs, nowMs)` → one announcement and, when
  `alertsWanted && ready()`, `play()`; on each state change `announcementFor` → `notice/set`.
  `lastCheckedMs` starts at mount time, so a reload never replays old alarms.

## Screen and components

`Cook.tsx` reads `cook`, `selectSchedule`, `dinner.serving` and `useNow(systemClock, 1000)`. With
`cook` null: `canBegin` → `err too_late` shows the too-late copy; else it dispatches `cook/begin`
once from an effect (CM1.1). Then by phase: `countdown` → `CookCountdown`, `UpNext`; `stale` →
`CookStale`; `finished` → `CookFinished`, `BuildLog`; `cooking` → the order of CM2.1. Header and
`FlowNav` stay (plan-ui). After each dispatch the screen applies `focusAfter` on the next render.

| component | shows |
| --------- | ----- |
| `CookHeader` | clock (mono 2rem), serving, planned serving when different |
| `CookCountdown` | starts-at heading, `Countdown`, first steps, start-now sentence and button |
| `Countdown` | `role="timer"`, mono 3.5rem tabular; `aria-live` off; label from copy |
| `LaneCard`, `StartCard`, `RunningCard` | `<section>` with `<h3 id="card-<stepId>" tabindex="-1">`; meta; waits-for; buttons |
| `ExtraTime` | `<fieldset>` legend "Needs more time", three 64 px buttons |
| `UpNext`, `DishStrip` | `<ol>` of items with `<time datetime>`; `<ul aria-label="Dishes">` of chips |
| `BuildLog`, `LogEntryView` | mono `<ol>`; each move line has its words for screen readers; "up to date" toggle (`aria-expanded`) |
| `ActionDock` | `position: sticky; bottom: 0`: dock step title, primary, "I'm behind", "Undo" |
| `AlertToggle`, `WakeLockNote` | `aria-pressed` button and explanation; the one-line note |
| `CookFinished`, `CookStale`, `StopCooking` | end state; resume/discard; stop with `ConfirmInline` |

Layout (`cook.css`): one column; content then the dock, so the dock's buttons sit in the bottom
third at 390×844. Card title `2rem`; countdown `font-size: min(3.5rem, 15vw)`, so it is 56 px at
any viewport of 374 CSS px or more and shrinks only at 200% zoom on a phone (decided here). Under
`(orientation: landscape) and (max-height: 32rem)` two columns: cards left, dock and "Up next"
right, the dock at the bottom of its column. Buttons full width, `min-height: 4rem`, 8 px gaps.
Marks: done `✓`, warning and overdue `!`, hands-free cards dashed border (plan-ui's style), all with
words. Reduced motion uses `--duration`; nothing animates.

## Copy (`src/web/copy.ts`, added)

Times by `formatClock`, durations by `formatDuration`; countdowns `mm:ss` from `ceil(ms / 1000)`
seconds with unbounded minutes (`69:00`), overrun `+02:10`; `<t>` a step title.

| where | text |
| ----- | ---- |
| document, h1 | `Cook · Make Dinner`; h1 `Right now` |
| header | `<clock>`; `Serve at <time>`; `Planned for <time>` when different |
| countdown | h2 `Cooking starts at <time>`; timer label `Time until cooking starts`; `First: <t> (<dish>)` (two at most, `; `-joined); `Start now to serve at <time>, <d> earlier.`; button `Start now` |
| sections | h2 `Do now`, `Running`, `Up next`, `Dishes`, `Build log`, `Sound and screen` |
| lane card | label `Cook <n>` (several cooks only); h3 `<t>`; detail; `<dish> · <duration> · due <time>` / `· due since <time>` / `· done at <time>`; `! Waits for <titles, “” each>, not done yet.`; timer label `Time left`; free: h3 `Nothing to do now`, `Next: <t> at <time>, in <d>.` / `Nothing more for this cook.`; also-due heading `Also due` |
| start card | label `Start, then leave it`; h3 `<t>`; `<dish> · <duration> · due <time>` |
| running card | h3 `<t>`; `<dish> · ready at <time>`; timer label `Time left`; up: `! Time is up` |
| buttons | `Start`, `Done`, `+5 min`, `+10 min`, `+15 min` (names add ` for <t>` hidden), legend `Needs more time`, `I'm behind`, `Undo: started <t>` / `Undo: done <t>` / `Undo: +<m> min on <t>` / `Undo: I'm behind` / `Undo: start now` |
| blocked start | `<t> waits for <titles>, not done yet. Start it anyway?` `Start anyway` / `Not yet` |
| up next | `<t>` · `<dish>` · `in <d>` · `<time>`; none: `Nothing else is planned.` |
| dish chip | `<name>: <done> of <total> done` + `✓ Done` / `Cooking` / `Due now` / `Next at <time>` |
| log | empty `No rebuilds yet.`; `Earlier rebuilds (<n>)`; toggle `Show the <n> step(s) that are up to date` / `Hide the steps that are up to date` |
| alerts | button `Sound and vibration`, state `Off` / `On`; off: `Turn on to hear a chime and feel a buzz when a timer ends. The browser allows sound only after you tap here.`; on: `A chime and a buzz play when a timer ends. Silent mode may still mute them.`; after reload: `Sound was on before the page reloaded. Tap once to turn it on again.`; no vibrate: + ` This device cannot vibrate.` |
| wake lock note | `The screen may turn off while you cook. To keep it on, set Auto-Lock or Screen timeout to a longer time in your device settings.` |
| finished | h2 `Dinner is served`; `Served at <time>. Planned for <time>: on time.` / `: <d> later.` / `: <d> earlier.`; `Back to the plan`, `Start over` (plan-ui's) |
| stale | h2 `Carry on with this dinner?`; `You started cooking <plan title> on <weekday> at <time>, more than 8 hours ago.`; `Resume`, `Discard` → `Discard the recorded times?` `Yes, discard` / `Cancel` |
| stop | `Stop cooking` → `Stop cooking? The times you recorded will be cleared.` `Yes, stop cooking` / `Keep cooking` |
| too late | `This plan was for <time> <day>, too long ago to cook against. Choose a new serving time on the Plan screen.` + link `Go to the plan` |
| stored session bad | notice `Your cooking session could not be read, so it was cleared. Your dinner is still here.` |

Build log lines (mono, visible; each also carries the sentence for screen readers in a
visually-hidden span, `ui.md` "Gravy moved from 18:40 to 18:55", with the mono text `aria-hidden`):

| line | mono text | sentence |
| ---- | --------- | -------- |
| cause | `<atTime> rebuild: started <d> late` / `<id> started <d> late` (`early`) / `<id> done <d> late` (`early`) / `<id> needs <m> more min` / `I'm behind` / `overdue <ids, ", ">` | `Rebuilt at <time>: …` the same words with titles |
| move | `<id> <from> -> <to>` | `<t> moved from <from> to <to>.` |
| unchanged | `<n> step(s) up to date` (omitted at 0) | same |
| serving | `serve <from> -> <to>` (only when changed) | `Serving moved from <from> to <to>.` |
| nothing | `Everything is on time` (no move, serving unchanged) | same |
| unchanged list | `<id> is up to date` | `<t> is up to date.` |
| failed | `rebuild failed: <error kind>` | `The plan could not be rebuilt, so it is unchanged. Carry on by the times shown and tap I'm behind to try again.` |

New warnings follow the entry as plan-ui `COPY.holdWarning` sentences, each with `!` and `Warning`.

Announcements (`announcementFor`, `finishedBetween`): rebuild `Plan rebuilt: <n> step(s) moved.
Serving is now <time>.` / `… Serving stays at <time>.` / `Plan rebuilt: everything is on time.`, each
+ ` <n> new warning(s).` when any; failed `The plan could not be rebuilt.`; time up `Time is up: <t>.`
(several: titles `, `-joined); start reached `Time to start: <t>.`; undo `Undone: <label words>.`;
finished `Everything is done. Dinner is served.` Nothing else is announced.

## Hand-worked sessions

`AXIS_MS` = Wed 2026-11-11 19:30 London (GMT, `19:30Z`); `H1_SCHEDULE`, `SUNDAY_ROAST`,
`HOME_KITCHEN`; times are clock times on that axis (minute `m` = 19:30 + `m`).

- **CM-a countdown, start now.** Begin 17:30:00: phase `countdown`, `startMs` 17:40, remaining
  `10:00`, copy `Start now to serve at 19:20, 10 min earlier.` `start-now` at 17:30:00: `axisMs`
  and `plannedServingMs` 19:20, schedule and log unchanged; phase `cooking`; lane 1 `current`
  `chicken.prep` due at 17:30; dock `start chicken.prep`.
- **CM-b begin 12 min late** (17:52:00, `n = -98`). Rebuild with `{}` (checked with core in the spec
  session): prep `[-98,-88)`, roast `[-88,-13)`, shred `[-88,-83)` slack 76, rest `[-13,7)`, roux
  `[-7,-5)`, simmer `[-5,5)`, boil `[0,4)`, toss `[4,5)`, strain `[5,7)`, carve `[7,12)`, `servingMin
  12`. Log: `17:52 rebuild: started 12 min late`; `chicken.prep 17:40 -> 17:52`, `chicken.roast
  17:50 -> 18:02`, `greens.shred 17:50 -> 18:02`, `chicken.rest 19:05 -> 19:17`, `gravy.roux 19:10
  -> 19:23`, `gravy.simmer 19:12 -> 19:25`, `greens.boil 19:20 -> 19:30`, `greens.toss 19:24 ->
  19:34`, `gravy.strain 19:22 -> 19:35`, `chicken.carve 19:25 -> 19:37`; `serve 19:30 -> 19:42`.
  New warnings `chicken.roast` (6 > 5), `greens.toss` (7 > 5). Announcement `Plan rebuilt: 10 steps
  moved. Serving is now 19:42. 2 new warnings.`
- **CM-c the roast needs 15 more minutes.** From CM-a's start without "Start now" (axis 19:30):
  start prep 17:40, done 17:50, start roast 17:50, start shred 17:50, done shred 17:55: no log entry
  (all on plan). `extra chicken.roast 15` at 18:30 (`n = -60`) gives RB-a. Log: `18:30 rebuild:
  chicken.roast needs 15 more min`; `chicken.rest 19:05 -> 19:20`, `gravy.roux 19:10 -> 19:26`,
  `gravy.simmer 19:12 -> 19:28`, `greens.boil 19:20 -> 19:33`, `greens.toss 19:24 -> 19:37`,
  `gravy.strain 19:22 -> 19:38`, `chicken.carve 19:25 -> 19:40`; `3 steps up to date`; `serve 19:30
  -> 19:45`. New warnings: `Roast chicken: “Roast the chicken” will be ready 6 min before “Make a
  roux in the roasting tin” starts and can wait only 5 min. More ovens, burners or cooks may help.`
  and `Spring greens: “Toss the greens with butter” will be ready 7 min before serving and can wait
  only 5 min. More ovens, burners or cooks may help.` Running card: roast ready at 19:20, `50:00`.
  Lane 1: `Nothing to do now`, `Next: Make a roux in the roasting tin at 19:26, in 56 min.` Dock:
  no primary; `Undo: +15 min on Roast the chicken` until 18:30:10.
- **CM-d I'm behind.** Prep done 17:40–17:50, roast started 17:50, shred not started; `behind` at
  17:53 (`n = -97`, checked with core): only shred moves, to `[-97,-92)`. Log `17:53 rebuild: I'm
  behind`, `greens.shred 17:50 -> 17:53`, `9 steps up to date`, no serve line. Announcement `Plan
  rebuilt: 1 step moved. Serving stays at 19:30.` Not overdue before: `-97 < -100 + max(5, 75)`.
- **CM-e thresholds.** Start roast at 17:52 (`byMin 2`): no entry, the schedule object unchanged;
  at 17:53 (`3`): one entry, cause `chicken.roast started 3 min late`, roast pinned at −97.
- **CM-f nothing due** (CM-c's facts without the +15, 17:56): lanes `[{ current: null, next: roux
  19:10 }]`, `toStart []`, running roast `69:00` to 19:05, up next rest 19:05 (`in 1 h 9 min`), roux
  19:10, simmer 19:12; dishes `Roast chicken: 1 of 4 done` cooking, `Gravy: 0 of 3 done` next at
  19:10, `Spring greens: 1 of 3 done` next at 19:20; dock null.
- **CM-g overdue.** CM-f untouched until a tick at 19:10:00 (`n = -20`): roast `-20 >= -25 + 5`,
  rest `-20 >= -25 + max(5, 0)`; the tick at 19:09:45 (`n = -21`) does nothing. The rebuild is E3:
  log `19:10 rebuild: overdue chicken.rest, chicken.roast`; `chicken.rest 19:05 -> 19:10`,
  `gravy.roux 19:10 -> 19:15`, `gravy.simmer 19:12 -> 19:17`, `greens.boil 19:20 -> 19:25`,
  `gravy.strain 19:22 -> 19:27`, `greens.toss 19:24 -> 19:29`, `chicken.carve 19:25 -> 19:30`; `3
  steps up to date`; `serve 19:30 -> 19:35`; no warnings. A second tick at 19:10:00 changes nothing.
- **CM-h undo.** After CM-c, `undo` at 18:30:05: `core` deep-equals the core before the +15 (H1
  schedule, roast `extraMin 0`, empty log); at 18:30:10 `undo` is a no-op and the view has no undo.
- **CM-i several cooks.** `schedule(SUNDAY_ROAST, TWO_COOK_KITCHEN)` (checked with core): prep
  `[-110,-100)` C1, shred `[-110,-105)` C2, strain `[-3,-1)` C2, toss `[-1,0)` C2, roux `[-15,-13)`
  C1, carve `[-5,0)` C1, rest `[-25,-5)`. At 17:40: lane 1 `current` prep, lane 2 `current` shred,
  up next roast 17:50, rest 19:05, roux 19:15. Shred done 17:45: at 17:45 lane 2 `next` strain 19:27.
- **CM-j finished.** H1 followed exactly to 19:30: phase `finished`, `Served at 19:30. Planned for
  19:30: on time.` Carve done 19:33 instead: `…: 3 min later.`
- **CM-k stale.** CM-f's state with `lastActiveMs` 17:56, now Thu 02:00 (8 h 4 min): `stale`; at
  Thu 01:55 (7 h 59 min): `cooking`.
- **Errors.** `beginSession` at Fri 2026-11-13 19:30 (`n = 2880 > 1440`): `too_late`; `start` on a
  done step, `done` on a pending one, an unknown id, `extra` with 7 minutes: the same state object.

## Test support

- `test/support/fixtures.ts` (added): `AXIS_MS`; `CM_C_FACTS`, `CM_D_FACTS`, `CM_F_FACTS` (ms
  timestamps), each with the expected log in a comment.
- `test/support/arbitraries.ts` (added): `arbCookBegin()` → `{ schedule: arbScheduled(), axisMs:
  AXIS_MS, beginMs }`, `beginMs` from 30 min before the first start to 30 min after (1/3 exactly on
  it); `arbCookIntents()` → up to 60 `{ advanceSec: 0..1800 (1/4 zero), kind: 'start' | 'done' |
  'extra' | 'behind' | 'undo' | 'tick' | 'start-now' | 'alerts', pick: nat, minutes: 5 | 10 | 15 }`;
  `cookActionFor(state, nowMs, intent)`: picks the `pick`-th pending or running id (by id) from the
  facts and schedule, never through `cookView`.
- `test/support/cook-replay.ts` (decided here): `replayCook(begin, intents)` → the trace of
  `{ action, before, after, nowMs }`, using `reduceCook`.
- `test/support/oracles.ts` (added, plain loops, types only): `oracleCookSections(schedule, facts,
  axisMs, nowMs)` → `{ due, running, upNext }` ids; `oracleOverdue(schedule, facts, axisMs, nowMs)`.

## Correctness properties

In `test/web/state/cook-session.pbt.ts` and `cook-view.pbt.ts`, `fcParams()`, 60 s per test, over
`arbCookBegin()` × `arbCookIntents()` replayed.

| id | statement | validates |
| -- | --------- | --------- |
| P-CM1 rebuild guarantees | for every logged `ok` rebuild in a trace, against the schedule and `progressOf` before it: R1 (`oracleRebuildViolations` `[]` when pinned steps alone fit capacity from `now`, else `oraclePendingOverfull` `[]`), R2 (pinned keep `progressOf` intervals; pending start `>= now`), R3 (pending start `>=` its previous start) | CM5.1, CM5.2 |
| P-CM2 undo | for every undoable action in a trace, `undo` within `UNDO_MS` gives `core` deep-equal to `before.core` and the same `alertsWanted`; after `UNDO_MS` it returns the state itself | CM3.4, CM5.8 |
| P-CM3 honest view | at every trace point and `now + 0..120 min`: no done step in `lanes`, `toStart`, `running`, `upNext`; due and running ids equal `oracleCookSections`, each once; `upNext` = the oracle's first three; `finished` iff every terminal step is done | CM2.2–CM2.8 |
| P-CM4 reload | `CookStateSchema.parse(JSON.parse(JSON.stringify(s)))` deep-equals `s`, and through plan-ui `toPersisted`/`loadState` the `cookView` at the same `now` deep-equals the original's | CM7.1, CM7.2 |
| P-CM5 clock | every running card's `remainingMs = startedAtMs + (minutes + extraMin) × 60 000 - now`; inserting `tick`s where `oracleOverdue` is empty changes no state | CM4.1 |
| P-CM6 triggers | an action adds a log entry iff the table's rebuild condition holds (thresholds by an independent `abs` check); a tick rebuilds iff `oracleOverdue` is non-empty; two ticks at one `now` give at most one entry | CM5.1 |
| P-CM7 total | `progressOf` passes `ProgressSchema`; no logged rebuild is `err` other than `serving_out_of_range`; `reduceCook` with `fc.anything()` ids, minutes and times never throws | CM3.7, CM5.2, CM5.7 |

## Test plan

Unit (`npm test`, node, `TZ=Europe/London` checked):

| file | checks |
| ---- | ------ |
| `test/web/state/cook-session.test.ts` | CM-a to CM-e, CM-g, CM-h, errors: every log field and entry; `effectiveNow` with a clock set back; `progressOf` on `CM_C_FACTS`; `LOG_MAX` drop |
| `test/web/state/cook-view.test.ts` | CM-a, CM-c, CM-f, CM-i to CM-k views field by field; a blocked due step's `waitsFor`; an overrun hands-free card (`remainingMs < 0`, dock `done`); `focusAfter` per row; `finishedBetween` bounds |
| `test/web/state/cook-slot.test.ts` | `reduceCook` begin/stop/no-op identity; `CookStateSchema` rejects a fact for an unknown id and a nested undo |
| `test/web/state/wake-lock.test.ts`, `alerts.test.ts` | fakes: held, unsupported, refused, sentinel release, acquire twice; enable without `AudioContext`, beep schedule (frequencies, times), vibrate pattern, no vibrate |
| `test/web/copy.test.ts` (added) | every line of CM-b, CM-c, CM-d, CM-g, each announcement, countdown `10:00`, `69:00`, `+02:10`; plan-ui's copy checks over the new strings |

E2E (both projects, `en-GB`, `Europe/London`; `page.clock.install({ time })` then `pauseAt`;
`seedDinner(page, SUNDAY_ROAST, HOME_KITCHEN, '19:30')` unless stated). `e2e/support.ts` gains
`fakeWakeLock(page, 'grant' | 'refuse' | 'none')` and `fakeAudio(page)` (init scripts recording
calls in `window.__cookFakes`) and `cookUntilServed(page)`: taps every visible `Start` and `Done`
whose time has come, else `fastForward`s to the earliest `<time datetime>` in Up next and Running.

| spec | flows |
| ---- | ----- |
| `cook-start.spec.ts` | 17:30 "Start cooking" → CM-a copy and `10:00`; `runFor(60_000)` → `09:00`; "Start now" → `Serve at 19:20`, prep card; at 17:52 → CM-b log lines and `Serve at 19:42` |
| `cook-roast.spec.ts` | CM-c by taps, then the CM-c log, warnings and running card; Undo restores `Serve at 19:30`, and after `runFor(10_000)` Undo is gone; CM-d; CM-g by `fastForward` to 19:10; blocked start asks before starting `Make a roux in the roasting tin` |
| `cook-sample.spec.ts` | Menu → `sunday-roast` sample → Plan → Start cooking at its countdown → `cookUntilServed` → `Planned for 13:30: on time.`; build log `No rebuilds yet.` throughout |
| `cook-reload.spec.ts` | CM-c at 18:30 then reload: same log, `50:00`; a new page in the same context at 18:50: `30:00`, no "Time is up" replay; stored `lastActiveMs` 9 h old → stale prompt, Resume, Discard confirm |
| `cook-device.spec.ts` | `grant`: one request on entry, one after a hidden → visible change, release on leaving to Plan and at `finished`; `refuse` and `none`: the note, no error; alerts: off copy, tap → on, `fakeAudio` sees a context created in the tap; roast time up at 19:05 → announcement in the live region, two oscillators, `vibrate([200,100,200])`; after reload the reload copy |
| `cook-a11y.spec.ts` | axe zero violations, light and dark: countdown, CM-c (log and up-to-date list open), CM-i (seeded `TWO_COOK_KITCHEN`), blocked confirm, finished, stale, too late, wake-lock note; every button at least 48×48 px, primaries at least 64 px tall, dock primary's top below 2/3 of 844; focus after Start, Done and Undo per `focusAfter`; 195 px wide and 844×390 landscape with `expectNoPageScroll`; `reducedMotion: 'reduce'` no running transition |

## Conflicts found

**C1. Countdown size at 200% zoom.** `ui.md` fixes the countdown at 56 px and requires 200% zoom
without horizontal scrolling. A 390 px phone at 200% is 195 CSS px, and `479:59` at 56 px mono is
about 200 px. Resolution: `min(3.5rem, 15vw)`, 56 px down to 374 CSS px; reported for a hand
decision.

**C2. "Started" and "Start".** `ui.md` names the primary actions "Done" and "Started"; the request
and the brief's "Started" differ. This spec uses "Start" as the request asks.

**C3. Build log lines and `ui.md`'s sentence.** The request asks for `gravy.roux 18:40 -> 18:55`;
`ui.md` asks for "Gravy moved from 18:40 to 18:55". Both are shown: the mono line visibly, the
sentence for screen readers and in the announcement count.

## Review notes (by hand, 2026-11-11)

- Q1: `min(3.5rem, 15vw)` for the countdown is accepted.
- Q2: the button is "Start"; `ui.md` and `product.md` now say so.
- Q3: mono build-log lines on screen, the `ui.md` sentence for screen readers: accepted.
- Q4, changed: **no automatic rebuild.** A cook who forgot to tap "Start" would see the serving
  time move for no reason. An overdue step is only *shown* as late on its card ("Late by 6 min")
  and in the dish strip, and "I'm behind" is emphasised; the rebuild happens when the cook acts
  (Start, Done, Needs more time, I'm behind). This replaces the last clause of the requirement
  that lists the rebuild triggers ("... and WHEN a step is overdue by the design's rule") and the
  15 s overdue *rebuild* check; the 15 s tick remains for display. CM-g becomes: at 19:10 the
  card reads late, nothing moves; tapping "I'm behind" gives the E3 rebuild. Adjust the affected
  requirement, example, property wording and tasks when implementing, and list what you changed.
- Q5: accepted; these go into the plan-ui implementation (its review notes list them).
- Q6: accepted.
- Q7: opening `#/cook` with no cook session shows the Plan screen; it never starts a session.

