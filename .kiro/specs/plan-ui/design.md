# Design: plan-ui

Requirements: `requirements.md` in this folder. Rules followed without restating them: `ui.md`,
`tech.md`, `structure.md`, `testing.md`, `product.md`, and the recipe-graph, scheduler (H1 to H3),
dinnerfile (`SUNDAY_ROAST_DINNERFILE`, `arbServeTime`), recipe-reader and rebuild ("The axis and
`servingMin`") specs, whose types and functions are used by their exact names.

## Files

| file | holds |
| ---- | ----- |
| `src/web/main.tsx` | boot: `loadState`, `createStore`, `startEffects`, `render(<App/>)` |
| `src/web/app.tsx` | `App`, `SCREENS` (the screen table), `ErrorBoundary` use |
| `src/web/copy.ts` | `COPY` and the copy functions of the copy tables (every string, R10.3) |
| `src/web/state/store.ts` | state types, `Action`, `initialState`, `reduce`, `createStore`, selectors, `reachable` |
| `src/web/state/cook-slot.ts` | `CookState`, `CookAction`, `CookStateSchema`, `reduceCook`: placeholders cooking-mode replaces (decided here) |
| `src/web/state/plan-edit.ts` | pure plan edits, ids, orders (decided here) |
| `src/web/state/clock.ts` | the time mapping and formatting (rebuild design names this file) |
| `src/web/state/route.ts`, `persist.ts` | `parseHash`, `hashOf` (decided here); `PersistedStateSchema`, `toPersisted`, `loadState`, `saveState` |
| `src/web/state/api.ts`, `dinnerfile-import.ts` | response schemas, `fetchSamples`, `postParse`; `readDinnerfile` (decided here) |
| `src/web/state/share-link.ts` | `encodeShare`, `decodeShare`, `shareUrl`, limits |
| `src/web/state/schedule-view.ts` | `AxisSchedule`, `ScheduleView`, `scheduleView` (decided here) |
| `src/web/state/hooks.ts`, `effects.ts` | `StoreProvider`, `useAppState`, `useDispatch`, `useNow`; `startEffects(store, env)`: storage, hash, theme, fetches, share boot (both not pure) |
| `src/core/critical-path.ts` | `criticalPath(schedule)`: added in review, see "The critical path" |
| `src/web/components/timeline-layout.ts`, `plan-list-items.ts` | `layoutTimeline`; `planListGroups` (pure) |
| `src/web/components/*.tsx`, `screens/{Menu,Steps,Plan}.tsx` | the components table (`Cook.tsx` belongs to cooking-mode) |
| `src/web/styles/components.css` | component styles (decided here); `print.css` print layout |
| `test/web/**` | mirrors `src/web`: `*.test.ts`, `*.pbt.ts` (test plan) |
| `e2e/*.spec.ts`, `e2e/support.ts` | flows; `smoke.spec.ts` moves its heading check to the brand link |

Imports (no cycles): screens → components → `state/hooks.ts` → `state/store.ts` → `plan-edit.ts`,
`clock.ts`, `cook-slot.ts`, `api.ts` (types), `copy.ts` → `../../core/index.js`. `copy.ts` imports
only core types and `clock.ts`; `state/` never imports `components/`; only `main.tsx` imports
`effects.ts`.

## The store (`src/web/state/store.ts`)

```ts
export type Route = 'menu' | 'steps' | 'plan' | 'cook';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type PlanSource =
  | { kind: 'sample'; sampleId: string } | { kind: 'recipes' } | { kind: 'dinnerfile' } | { kind: 'share' };
/** atMs is the chosen serving time: minute 0 of the axis for the whole meal (never rebased). */
export interface Serving { time: ServeTime; atMs: number }
export interface Dinner { plan: Plan; source: PlanSource; kitchen: Kitchen; serving: Serving | null }
export interface DinnerLoad {
  plan: Plan; source: PlanSource; kitchen: Kitchen;
  serve: ServeTime | null;              // a fixed time (share, Dinnerfile), resolved by resolveServing
  suggested: ServeTime | null;          // a sample's servingTime, used by defaultServing
  route: 'steps' | 'plan'; notice: string | null;
}
export type SamplesState = { status: 'idle' | 'loading' | 'failed' } | { status: 'loaded'; samples: SampleItem[] };
export type ParseState = { status: 'idle' } | { status: 'busy'; requestId: number; startedAtMs: number }
  | { status: 'failed'; failure: ParseFailure };
export type ImportProblem = { kind: 'line'; line: number | null; message: string } | { kind: 'issue'; message: string };
export type ImportState = { status: 'idle' } | { status: 'failed'; heading: string; problems: ImportProblem[] };

export interface AppState {
  route: Route;
  theme: ThemeChoice;
  dinner: Dinner | null;          // the plan always passes PlanSchema (R4.4)
  recipeText: string;
  dinnerfileText: string;
  samples: SamplesState; parse: ParseState; import: ImportState; // not persisted
  pendingLoad: DinnerLoad | null; // waiting for "Replace" (R1.5, R8.6); not persisted
  notice: string | null;          // not persisted
  cook: CookState | null;         // owned by cooking-mode; always null in this spec
}
export const DEFAULT_KITCHEN: Kitchen = { burners: 4, ovens: 1, cooks: 1 }; // decided here
export function initialState(): AppState; // route 'menu', theme 'system', everything empty or idle

export interface Store { getState(): AppState; dispatch(a: Action): void; subscribe(f: () => void): () => void }
export function createStore(initial: AppState): Store; // calls reduce; notifies only when state !== previous
export function reduce(state: AppState, action: Action): AppState; // pure; returns `state` itself for a no-op
export type Action = PlanUiAction | CookAction;
```

`reduce` handles every `PlanUiAction` below and passes every other action to `reduceCook`
(`cook-slot.ts`, which here returns the state unchanged). Cooking-mode replaces the three
aliases and `reduceCook` in `cook-slot.ts`, adds `SCREENS.cook`, and touches nothing else (R9.9).

```ts
// cook-slot.ts, as shipped by this spec
export type CookState = never;
export type CookAction = never;
export const CookStateSchema = z.never();
export function reduceCook<S>(state: S, _action: CookAction): S { return state; }
```

`nowMs` travels in actions so that `reduce` reads no clock (N4).

| action | effect (all other fields unchanged) |
| ------ | ----------------------------------- |
| `navigate {route}` | `route` = `route` if `reachable`, else the nearest reachable earlier route; `notice` null |
| `theme/set {theme}` | `theme` |
| `samples/loading`, `samples/loaded {samples}`, `samples/failed` | `samples` |
| `recipe-text/set {text}`, `dinnerfile-text/set {text}` | the text; `parse` or `import` back to idle |
| `parse/start {requestId, nowMs}` | `parse` busy |
| `parse/done {requestId, plan, nowMs}` | ignored unless busy with that id; then `dinner/load` with source `recipes`, `DEFAULT_KITCHEN`, route `steps`; `parse` idle |
| `parse/failed {requestId, failure}` | ignored unless busy with that id; `parse` failed |
| `parse/cancel` | `parse` idle |
| `import/failed {heading, problems}` | `import` failed |
| `dinner/load {load, nowMs}` | if `dinner` is null: apply; else `pendingLoad = load` |
| `dinner/replace {nowMs}` | apply `pendingLoad`; `cook` null; `pendingLoad` null |
| `dinner/keep` | `pendingLoad` null |
| `dish/add {name}`, `dish/rename {index, name}`, `dish/remove {index}` | `plan-edit.ts`; `notice` from its result |
| `step/add {dishIndex}`, `step/update {index, patch}`, `step/remove {index}` | the same |
| `kitchen/set {kitchen}` | `dinner.kitchen` (only if it passes `parseKitchen`) |
| `serving/set-time {time, nowMs}` | `serving = { time, atMs: resolveServing(time, nowMs) }` |
| `serving/set-instant {atMs}` | `serving = { time: toServeTime(atMs), atMs }` |
| `plan/enter {nowMs}` | if `serving` is null: `defaultServing(nowMs, span, null)`; then `navigate plan` |
| `notice/set {text}`, `notice/clear` | `notice` |
| `start-over` | `initialState()` with the current `theme` and `samples` |

"Apply" a load: `dinner = { plan, source, kitchen, serving }` where `serving` is
`resolveServing(serve)` when `serve` is set, else `defaultServing(nowMs, span, suggested)` when
the route is `plan`, else null; `span` is `spanMin` of `schedule(plan, kitchen)` when `ok`, else
`longestChainMinutes(plan)` when `ok`, else 0. Then the route, `notice = load.notice`,
`recipeText` cleared for source `recipes`, `dinnerfileText` cleared for `dinnerfile`, `import`
idle (R2.8). While `cook !== null` the `dish/*`, `step/*`, `kitchen/*` and `serving/*`
actions are no-ops (R4.12).

Selectors (one-entry memo keyed by object identity; `dinner.plan` and `dinner.kitchen` are
replaced, never mutated):

```ts
export function selectCheck(state: AppState): PlanCheck | null;      // validatePlan(dinner.plan)
export function selectSchedule(state: AppState): Result<Schedule, ScheduleError> | null;
export type Reachability = Record<Route, { ok: true } | { ok: false; reason: string }>;
export function reachable(state: AppState, cookRegistered: boolean): Reachability;
```

| route | reachable when | reason shown when not |
| ----- | -------------- | --------------------- |
| menu | always | |
| steps | `dinner !== null` | `Pick a dinner first` |
| plan | `dinner !== null` and `selectCheck` has no error | `Pick a dinner first` / `Fix the errors in Steps first` |
| cook | `cookRegistered` and `selectSchedule` is `ok` | `Make the plan first` / `Cooking mode is not available yet` |

## Plan edits (`src/web/state/plan-edit.ts`)

```ts
export type StepPatch = Partial<Pick<Step, 'title' | 'minutes' | 'appliance' | 'handsOn' | 'dish' | 'holdMin' | 'after'>>;
export type EditResult<E> = Result<{ plan: Plan; focus: number | null; notice: string | null }, E>;
export const NEW_STEP = { title: 'New step', minutes: 10, appliance: 'none', handsOn: true, after: [], holdMin: null } as const;
export const DEFAULT_HOLD_MIN = 10; // when "Keeps" is unchecked (decided here)
export function slugify(name: string): string;
export function uniqueDishId(plan: Plan, base: string): string;
export function nextStepId(plan: Plan, dishId: string): string;
export function stepOrder(plan: Plan): number[];                 // indices, R4.1
export function waitingOn(plan: Plan, stepId: string): Set<string>; // ids that wait for stepId, transitively
export function dependentsOf(plan: Plan, ids: readonly string[]): number[]; // steps outside ids listing one in after
export function addDish(plan: Plan, name: string): EditResult<'too_many_dishes' | 'too_many_steps' | 'invalid_name'>;
export function renameDish(plan: Plan, index: number, name: string): EditResult<'invalid_name'>;
export function removeDish(plan: Plan, index: number): EditResult<'last_dish' | 'last_step'>;
export function addStep(plan: Plan, dishIndex: number): EditResult<'too_many_steps'>;
export function updateStep(plan: Plan, index: number, patch: StepPatch): EditResult<'invalid_step'>;
export function removeStep(plan: Plan, index: number): EditResult<'last_step'>;
```

- `slugify`: NFKD, drop `\p{M}`, lowercase, runs of characters outside `[a-z0-9]` to `-`, trim
  `-`, cut to 40 and trim `-` again; empty gives `dish`. `"Crème brûlée"` → `creme-brulee`,
  `"  Pan gravy!! "` → `pan-gravy`, `"汁"` → `dish`.
- `uniqueDishId`: `base`, else `base-2`, `base-3`, …, cutting `base` so the id stays ≤ 40.
- `nextStepId`: `<dishId>.step-<n>`, smallest `n >= 1` not used by any step of the plan.
- `addDish` appends the dish and one `NEW_STEP` for it; `focus` is the new step's index.
- `removeStep` / `removeDish` remove the steps, then remove each removed id from every remaining
  `after`, unless a remaining step still has that id (a duplicate). `notice` is
  `COPY.removedStep` / `COPY.removedDish` with the titles of the steps whose `after` changed.
- `updateStep` re-checks the step with `StepSchema` and returns `invalid_step` instead of a
  plan that fails it; removing `after` entries is always allowed.
- `stepOrder`: positions of `topologicalOrder(plan)` when `ok` (first occurrence per id, then
  duplicates in plan order), else plan order.

## Time (`src/web/state/clock.ts`)

All local-time work uses the runtime's time zone through `Date` local methods; formatting uses
`Intl.DateTimeFormat(locale)` with `locale` undefined meaning the user's (ui.md). Minutes are
real minutes: `clockAt` adds milliseconds, so a plan across a DST change stays physically right.

```ts
export const MINUTE_MS = 60_000;
export interface Clock { nowMs(): number }
export const systemClock: Clock;                                  // Date.now(); used only by effects and useNow
export function clockAt(chosenMs: number, minute: number): number; // chosenMs + minute * MINUTE_MS
export function minuteAt(chosenMs: number, nowMs: number): number; // Math.floor((nowMs - chosenMs) / MINUTE_MS)
export function resolveServing(time: ServeTime, nowMs: number): number;
export function defaultServing(nowMs: number, spanMin: number, suggested: ServeTime | null): Serving;
export function earliestServing(nowMs: number, spanMin: number): number;
export function toServeTime(ms: number): ServeTime;                // local "HH:MM"
export function quarterFloor(chosenMs: number, minute: number): number; // largest m <= minute on a local quarter hour; quarterCeil alike
export function sameLocalDate(a: number, b: number): boolean;
export function formatClock(ms: number, locale?: string): string;   // { timeStyle: 'short' }: "19:30", "7:30 PM"
export function formatWeekday(ms: number, locale?: string): string; // { weekday: 'short' }: "Wed"
export function formatDay(ms: number, nowMs: number, locale?: string): string | null; // null today, "tomorrow", "yesterday", else "Fri 13 Nov"
export function formatDuration(minutes: number): string;          // "1 min", "45 min", "1 h", "1 h 50 min"
```

- `resolveServing`: candidates `new Date(y, m, d + k, hh, mm)` for `k = -1..2` from the local
  date of `nowMs`; the earliest candidate `>= nowMs - 4 h` (R5.3). A time in a spring-forward gap
  becomes what `Date` makes of it (01:30 → 02:30).
- `defaultServing`: `need = ceilMinute(nowMs) + (spanMin + 15) min`; the suggested time today if
  `>= need`; else the first local `:00` or `:30` at or after `need` (R1.4).
- `earliestServing`: `ceilMinute(nowMs) + spanMin` min, rounded up to a local multiple of 5 min.
- The serving shown is `clockAt(serving.atMs, view.servingMin)`; the start
  `clockAt(serving.atMs, view.startMin)`; `now` on the axis is `minuteAt(serving.atMs, nowMs)`.
  Nothing here assumes `servingMin === 0`.

Hand-worked (`TZ=Europe/London`, `locale 'en-GB'`; 2026-11-11 is a Wednesday, GMT):

| call | result |
| ---- | ------ |
| `resolveServing('19:30', Wed 18:00)` | Wed 19:30 |
| `resolveServing('14:00', Wed 18:00)` / `('13:59', …)` / `('00:30', …)` | Wed 14:00 / Thu 13:59 / Thu 00:30 |
| `resolveServing('02:30', Sat 2026-10-24 20:00 BST)` | Sun 2026-10-25 02:30 GMT (`02:30Z`) |
| `formatClock(clockAt(that, -110))` | `01:40` (00:40Z is still BST; wall-clock subtraction would say 00:40) |
| `defaultServing(Wed 10:00, 110, '13:30')` / `(Wed 12:00, 110, '13:30')` | Wed 13:30 / Wed 14:30 |
| `defaultServing(Wed 22:50, 110, null)` / `(Wed 18:00:20, 110, null)` | Thu 01:00 / Wed 20:30 |
| `earliestServing(Wed 17:41:10, 110)` | Wed 19:35 |
| `formatDuration(1 / 60 / 75 / 110 / 1440)` | `1 min` / `1 h` / `1 h 15 min` / `1 h 50 min` / `24 h` |
| `formatClock(Wed 19:30, 'en-US')` | `7:30 PM` (tests replace U+202F and U+00A0 with a space) |
| `formatDay(Thu 00:30, Wed 18:00)` / `(Wed 19:30, Wed 18:00)` | `tomorrow` / `null` |

## Routes (`src/web/state/route.ts`)

```ts
export type HashTarget =
  | { kind: 'none' } | { kind: 'route'; route: Route } | { kind: 'share'; version: number; payload: string } | { kind: 'unknown' };
export function parseHash(hash: string): HashTarget; // '', '#', '#/' → none; '#/plan' → route; '#/share/1.<b64url>' → share
export function hashOf(route: Route): string;         // '#/' + route
```

Share pattern `^#/share/([0-9]{1,3})\.([A-Za-z0-9_-]{1,65536})$`. On boot (`effects.ts`): a share
target is decoded (R8.5) and replaced by `#/plan` or `#/menu` with `history.replaceState`; a
route target is dispatched as `navigate`; `none` uses the stored route. A state route change sets
`location.hash` (a history entry); `hashchange` dispatches `navigate`; when `navigate` lands on
another route than asked, the hash is replaced (R9.3).

## Persistence (`src/web/state/persist.ts`)

```ts
export const STATE_KEY = 'make-dinner:state';
export const PersistedStateSchema = z.strictObject({
  version: z.literal(1), route: z.enum(['menu', 'steps', 'plan', 'cook']), theme: z.enum(['system', 'light', 'dark']),
  dinner: z.strictObject({
    plan: z.unknown(), // validatePlan must give a plan
    source: PlanSourceSchema, kitchen: KitchenSchema,
    serving: z.strictObject({ time: ServeTimeSchema, atMs: z.int() }).nullable(),
  }).nullable(),
  recipeText: z.string().max(200_000), dinnerfileText: z.string().max(1_048_576), cook: CookStateSchema.nullable(),
});
export function toPersisted(state: AppState): z.input<typeof PersistedStateSchema>;
export function loadState(storage: Pick<Storage, 'getItem'>, cookRegistered: boolean): { state: AppState; notice: string | null };
export function saveState(storage: Pick<Storage, 'setItem'>, state: AppState): boolean; // false on a throw
```

`loadState`: missing key → `initialState()`, no notice; `getItem` throws, JSON fails, the schema
fails, or `validatePlan` gives `plan: null` → `initialState()` with `COPY.savedUnreadable`. The
stored route then goes through `reachable(state, cookRegistered)`.
`effects.ts` saves after every state change whose persisted part changed (compared by identity of
the six fields), and shows `COPY.saveFailed` once per page load (R9.6).

## API (`src/web/state/api.ts`)

```ts
export const SampleItemSchema = z.object({          // z.object: extra server fields are dropped (decided here)
  id: DishIdSchema, title: z.string().min(1).max(80), blurb: z.string().min(1).max(160),
  dishes: z.array(z.string().min(1).max(80)).min(1).max(12),
  kitchen: KitchenSchema, servingTime: ServeTimeSchema, text: z.string(),
  plan: PlanSchema, issues: z.array(IssueSchema),
});
export const SamplesResponseSchema = z.object({ samples: z.array(SampleItemSchema).min(1).max(12) });
export const ParseResponseSchema = z.object({ plan: PlanSchema, issues: z.array(IssueSchema), source: z.enum(['recording', 'model']) });
export const ApiErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type SampleItem = z.infer<typeof SampleItemSchema>;
export type ParseFailure =
  | { kind: 'bad_request' | 'input_too_long' | 'model_unavailable' | 'model_refused' | 'model_output_invalid' | 'internal' | 'network' }
  | { kind: 'rate_limited' | 'daily_cap_reached'; retryAtMs: number | null } | { kind: 'unexpected'; status: number };
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export function fetchSamples(fetchFn: FetchLike): Promise<Result<SampleItem[], 'network' | 'unexpected'>>;
export function postParse(fetchFn: FetchLike, text: string, signal: AbortSignal, nowMs: number):
  Promise<Result<Plan, ParseFailure> | { ok: false; error: { kind: 'cancelled' } }>;
```

`postParse` maps a non-2xx body that passes `ApiErrorBodySchema` by `code` (the ten codes of
`tech.md`; `not_found` and `invalid_plan` give `unexpected`); `Retry-After` as a whole number of
seconds `>= 0` gives `retryAtMs = nowMs + s × 1000`, anything else `null`. A thrown `fetch` gives
`network`, an `AbortError` `cancelled`, a 200 failing the schema `unexpected`. The response's
`issues` are not used: the store recomputes them with `validatePlan` (one source of truth).

## Dinnerfile import (`src/web/state/dinnerfile-import.ts`)

```ts
export const DINNERFILE_FILE_MAX = 1_048_576;
export function readDinnerfile(text: string): Result<Omit<DinnerLoad, 'route'> & { route: 'steps' | 'plan' },
  { heading: string; problems: ImportProblem[] }>;
```

`fromDinnerfile` errors → heading `COPY.dinnerfileUnreadable`, one `line` problem per error with
its `message` (which starts with the line, dinnerfile R7.10). `validatePlan` with `plan: null` →
`COPY.dinnerfileInvalid` and one `issue` problem per issue. Else source `dinnerfile`, kitchen
from `parseKitchen(options.kitchen)` or `DEFAULT_KITCHEN` with `COPY.kitchenLineIgnored`,
`serve = options.serve ?? null`, route `plan` when `hasErrors` is false, else `steps`.

## Share link (`src/web/state/share-link.ts`)

```ts
export const SHARE_VERSION = 1;
export const SHARE_URL_MAX = 8_000;          // RFC 9110 §4.1 recommends supporting 8,000-octet URIs
export const SHARE_PAYLOAD_MAX = 65_536, SHARE_INFLATED_MAX = 262_144; // accepted on load; inflated bytes (deflate bomb)
export interface SharedDinner { plan: Plan; kitchen: Kitchen; serve: ServeTime }
export type ShareDecodeError =
  | { kind: 'bad_format' } | { kind: 'unknown_version'; version: number } | { kind: 'too_large' }
  | { kind: 'invalid_plan'; issues: Issue[] };
export function encodeShare(d: SharedDinner): Promise<Result<string, 'invalid_plan'>>; // "1.<b64url>"
export function decodeShare(version: number, payload: string): Promise<Result<SharedDinner, ShareDecodeError>>;
export function shareUrl(base: string, encoded: string): string; // base = origin + pathname; + '#/share/' + encoded
export function shareBody(plan: Plan, kitchen: Kitchen, serve: ServeTime): unknown[]; // the version 1 body, exported for tests
```

Version 1 body, built from `canonicalPlan(plan)` (decided here):

```
[ title, [[dishId, name], ...],
  [[stepId, dishIndex, title, minutes, appliance (0 burner, 1 oven, 2 none), handsOn (0|1),
    [afterIndex, ...], holdMin (int or null), detail?], ...],
  [burners, ovens, cooks], "HH:MM" ]
```

`JSON.stringify` → UTF-8 → `CompressionStream('deflate-raw')` → base64url without padding
(`btoa` with `+/` → `-_`). Indices point into the canonical arrays, so ids are written once.
`encodeShare` returns `invalid_plan` when the plan has an error issue (an `after` entry without a
step has no index). `decodeShare` stops at the first failure: version not 1 → `unknown_version`;
payload over the max → `too_large`; base64url, inflate (`DecompressionStream`, aborted past
`SHARE_INFLATED_MAX` → `too_large`), `TextDecoder` with `fatal`, `JSON.parse`, the zod tuple
schema (array bounds from `LIMITS`, indices in range) → `bad_format`; build the plan;
`validatePlan` with `plan: null` or any error → `invalid_plan`; `parseKitchen` or
`ServeTimeSchema` → `bad_format`. Never throws or rejects (P-UI2).

Sizes, measured in the spec session with Node's raw deflate on generated plans (payload, then plain
JSON + deflate for comparison): 40 steps, 5 dishes, no detail 1,427 (1,828); with 120-character
details 2,768 (3,230); 80 steps, 12 dishes, 120-character details 5,203 (5,938); 80 steps with
120-character titles and 1,000-character details 13,618 (14,183). `recordings/` does not exist yet;
the largest sample (Halloween, 5 dishes, 2 KB of text) is expected near 2,800, and T7.1 measures
every sample and asserts it is under 8,000. Beyond
`SHARE_URL_MAX` the share panel shows `COPY.shareTooLong` and no link (R8.4). The link is
computed when the Plan screen's dinner changes (an effect), so the tap on "Share link" copies a
ready string within the user gesture (Safari's clipboard rule).

## The schedule view (`src/web/state/schedule-view.ts`)

```ts
export type AxisSchedule = Schedule & { servingMin?: number }; // a RebuiltSchedule is assignable
export interface ScheduleView {
  plan: Plan; steps: readonly ScheduledStep[]; warnings: readonly HoldExceededIssue[];
  servingMin: number;   // 0 for a schedule output
  startMin: number;     // min startMin
  spanMin: number;      // servingMin - startMin
  criticalPath: ReadonlySet<string>; // core criticalPath(s): the only steps marked critical on screen
  stepById: ReadonlyMap<string, Step>; dishName: ReadonlyMap<string, string>;
}
export function scheduleView(s: AxisSchedule): ScheduleView;
```

`scheduleView` calls core `criticalPath` once and keeps the ids in `criticalPath`; nothing else in
`src/web` decides what is critical.

## The critical path (`src/core/critical-path.ts`, added in review, 2026-11-11)

"Slack 0" is not a useful mark: a just-in-time schedule gives every hot step slack 0 (14 of 17
steps of the Sunday roast). The word and the mark go to the chain that fixes how early dinner must
start.

```ts
export type CriticalPathInput = Pick<Schedule, 'plan' | 'steps' | 'kitchen'> & { servingMin?: number };
export function criticalPath(schedule: CriticalPathInput): string[]; // ids in start order; [] if nothing ends at servingMin
```

- Start: among the steps with `endMin === servingMin` (`servingMin` is 0 when absent) the one with
  the longest `minutes`, then the smallest id (`compareIds`).
- Binder of a step `s`: a step `b` with `b.endMin === s.startMin` that is a prerequisite of `s`
  (`s.after`), or holds a lane `s` uses (same resource, same number) on a resource that is full at
  minute `s.startMin` (as many steps in that resource then as the kitchen has units). Among
  candidates: prerequisites first, then the longer `minutes`, then the smaller id. The walk stops
  when `s` has no binder; the result is reversed into start order.
- Why "full": delaying `b` by a minute then puts one more step into a full resource, so `b` has
  slack 0. Without it a lane shared by luck (two ovens, one used) was taken as binding; the first
  draft did that and P-UI7 found it (seed -1350807787, example test CP8).
- Hand-worked on H1: carve `[-5,0)` is the only step ending at 0. Ending at -5: `chicken.rest` (a
  prerequisite) and `greens.toss` (holds cook 1, which carve uses); the prerequisite wins. rest
  starts at -25: `chicken.roast` ends there; roast starts at -100: `chicken.prep` ends there; prep
  starts at -110: nothing ends there. Chain: `chicken.prep`, `chicken.roast`, `chicken.rest`,
  `chicken.carve`, 110 minutes, the span.
- With a gap (prep moved to `[-112,-102)`): roast starts at -100, nothing ends there; chain: roast,
  rest, carve. `TWO_CHOPS` with one cook: `b.chop [-20,-10)` binds `a.chop [-10,0)` through
  cook 1. `HANDS_FREE` with `BIG_KITCHEN`: `jelly.set` (120) over `stock.simmer` (60).
- P-UI7 (`test/core/critical-path.pbt.ts`): over `arbPlanAndKitchen()` with `schedule`, the chain is
  contiguous (each start is the previous end), ends at serving, has no repeats, every step in it has
  slack 0, and it is empty exactly when no step ends at serving.
- On screen: `▲` and "On the critical path" for these steps only (timeline bars and plan list).
  Any other step shows `Can slip <duration>` when its slack is above 0 and nothing when it is 0.
  `critical` in the schedule data stays slack 0 (G8).

## Timeline layout (`src/web/components/timeline-layout.ts`)

```ts
export const PX_PER_MIN = 6;          // a step of 8 minutes is a 48 px target (decided here)
export const LABEL_MIN_PX = 56;       // shorter bars carry no label
export type RowKind = 'cook' | 'burner' | 'oven' | 'hands-free';
export type BarFill = 'oven' | 'burner' | 'plain';
export interface TimelineBar {
  stepId: string; title: string; leftPx: number; widthPx: number;
  fill: BarFill; dashed: boolean; showLabel: boolean; critical: boolean; // ▲ drawn only for steps on the critical path
}
export interface TimelineRow { key: string; kind: RowKind; lane: number; label: string; bars: TimelineBar[] }
export interface TimelineTick { minute: number; leftPx: number; label: string }
export interface TimelineLayout {
  originMin: number; endMin: number; widthPx: number;
  rows: TimelineRow[]; ticks: TimelineTick[]; serveLeftPx: number; serveLabel: string;
}
export function layoutTimeline(view: ScheduleView, chosenMs: number, locale?: string): TimelineLayout;
```

- `originMin = quarterFloor(chosenMs, view.startMin)`, `endMin = quarterCeil(chosenMs,
  view.servingMin)`, `x(t) = (t - originMin) × 6`, `widthPx = x(endMin)`.
- Rows: for each resource in the order cook, burner, oven, each lane number used by some step,
  ascending, label `Cook n` / `Burner n` / `Oven n`; then hands-free rows. A bar per (step, lane
  it holds), in start then id order. Hands-free rows: steps with `appliance 'none'` and
  `!handsOn`, in (start, id) order, each into the lowest row whose last bar ends at or before its
  start (fewest rows for intervals in start order). Labels `Hands-free` or `Hands-free n`.
- Bar: `fill` from the step's appliance (`none` → `plain`), `dashed = !handsOn`,
  `showLabel = widthPx >= 56`, `critical = view.criticalPath.has(id)`.
- Ticks at every quarter-hour minute from `originMin` to `endMin`; label `formatClock`, prefixed
  with `formatWeekday` at local midnight. `serveLabel = 'Serve ' + formatClock(clockAt(chosenMs, servingMin))`.

Hand-worked H1 (`SUNDAY_ROAST` × `HOME_KITCHEN`, chosen serving Wed 2026-11-11 19:30 London):
`originMin −120` (17:40 floors to 17:30), `endMin 0`, `widthPx 720`; nine ticks `17:30` to
`19:30` at 0, 90, …, 720; serve line at 720, `Serve 19:30`.

| row | bars as `stepId left/width fill dashed label critical` |
| --- | ----------------------------------------------------- |
| Cook 1 | `chicken.prep 60/60 plain – yes ▲`, `greens.shred 120/30 plain – – –`, `gravy.roux 600/12 burner – – –`, `gravy.strain 672/12 plain – – –`, `greens.toss 684/6 plain – – –`, `chicken.carve 690/30 plain – – ▲` |
| Burner 1 | `gravy.roux 600/12 burner – – –`, `gravy.simmer 612/60 burner dashed yes –` |
| Burner 2 | `greens.boil 660/24 burner dashed – –` |
| Oven 1 | `chicken.roast 120/450 oven dashed yes ▲` |
| Hands-free | `chicken.rest 570/120 plain dashed yes ▲` |

Only `chicken.prep`, `chicken.roast`, `chicken.rest` and `chicken.carve` are on the critical path
(hand-worked above), so only their bars carry `▲`; the roux, simmer, boil, strain and toss bars
have slack 0 and none. With serving Thu 00:30 the same plan
gives ticks `22:30` … `23:45`, `Thu 00:00`, `00:15`, `00:30`.

## Plan list items (`src/web/components/plan-list-items.ts`)

```ts
export type ItemStatus = { kind: 'critical' } | { kind: 'slack'; minutes: number } | { kind: 'none' };
export interface PlanListItem {
  stepId: string; range: string; title: string; detail: string | null; dishName: string;
  lanes: string; duration: string; status: ItemStatus; warning: string | null;
}
export interface PlanListGroup { minute: number; heading: string; items: PlanListItem[] }
export function planListGroups(view: ScheduleView, chosenMs: number, locale?: string): PlanListGroup[];
```

Items in (start, `compareIds`) order, grouped by start minute. `range` = `start–end` clock times
(en dash). `lanes`: the appliance lane then the cook lane, `, `-joined, or `Hands-free` when the
step holds none. `warning` = `COPY.listWait(waitMin, holdMin)` for a step with a `hold_exceeded`
warning. Headings get the weekday prefix when `!sameLocalDate(start, serving)` (R7.4). The
component appends a final group `<serving time>` with the item `Serve`.

H1 at Wed 19:30 (titles and dish names from the fixture):

| heading | range | title | dish | lanes | duration | status |
| ------- | ----- | ----- | ---- | ----- | -------- | ------ |
| 17:40 | 17:40–17:50 | Season and truss the chicken | Roast chicken | Cook 1 | 10 min | ▲ On the critical path |
| 17:50 | 17:50–19:05 | Roast the chicken | Roast chicken | Oven 1 | 1 h 15 min | ▲ On the critical path |
| 17:50 | 17:50–17:55 | Shred the greens | Spring greens | Cook 1 | 5 min | Can slip 1 h 15 min |
| 19:05 | 19:05–19:25 | Rest the chicken under foil | Roast chicken | Hands-free | 20 min | ▲ On the critical path |
| 19:10 | 19:10–19:12 | Make a roux in the roasting tin | Gravy | Burner 1, Cook 1 | 2 min |  |
| 19:12 | 19:12–19:22 | Add stock and let the gravy thicken | Gravy | Burner 1 | 10 min |  |
| 19:20 | 19:20–19:24 | Cook the greens in salted water | Spring greens | Burner 2 | 4 min |  |
| 19:22 | 19:22–19:24 | Strain the gravy into a jug | Gravy | Cook 1 | 2 min |  |
| 19:24 | 19:24–19:25 | Toss the greens with butter | Spring greens | Cook 1 | 1 min |  |
| 19:25 | 19:25–19:30 | Carve the chicken | Roast chicken | Cook 1 | 5 min | ▲ On the critical path |

The status cell is empty for a step with slack 0 off the critical path.

H3 (`TIGHT_OVEN`): `Roast the potatoes` carries `! Warning: waits 40 min and can wait 10 min`.
Serving Thu 00:30: headings `Wed 22:40`, `Wed 22:50`, `Thu 00:05`, … (R7.4).

## Components

| component | file | reads | dispatches / does |
| --------- | ---- | ----- | ----------------- |
| `App` | `app.tsx` | `route`, `reachable`, `notice` | renders Header, FlowNav, LiveNotice, the screen in `SCREENS[route]`; focuses the `<h1>` on route change; sets `document.title` |
| `ErrorBoundary`, `LiveNotice` | `components/<name>.tsx` | `notice` | catches render throws (R10.2); the one `aria-live="polite"` region |
| `Header`, `ThemeSwitch`, `StartOver` | `components/<name>.tsx` | `theme` | brand link `#/menu`; `<select>` "Theme" → `theme/set`; "Start over" via `ConfirmInline` → `start-over` |
| `ConfirmInline` | `components/ConfirmInline.tsx` | | every second tap: text, confirm and cancel buttons; focus moves to it, back on cancel |
| `FlowNav` | `components/FlowNav.tsx` | `reachable`, `route` | `<nav aria-label="Dinner"><ol>`: links, `aria-current="step"`, unreachable as text + reason |
| `Menu` | `screens/Menu.tsx` | `pendingLoad` | `ConfirmInline` for a pending load, `SampleList`, `RecipePaste`, `DinnerfilePaste` |
| `SampleList` | `components/SampleList.tsx` | `samples` | a card per sample with "Plan this dinner" → `dinner/load`; retry |
| `RecipePaste` | `components/RecipePaste.tsx` | `recipeText`, `parse` | counter (`normaliseRecipeText`), "Read recipes", busy, error |
| `DinnerfilePaste` | `components/DinnerfilePaste.tsx` | `dinnerfileText`, `import` | text area, file picker, "Open Dinnerfile", problems with "Show line n" |
| `Steps` | `screens/Steps.tsx` | `dinner`, `selectCheck` | `IssueList` as summary, a `DishSection` per dish, "Add a dish", "Make the plan" → `plan/enter` |
| `IssueList` | `components/IssueList.tsx` | | issues with `!`, "Error"/"Warning", message; summary links to `#issue-<n>` anchors |
| `DishSection`, `StepCard` | `components/<name>.tsx` | | dish name, rename, remove, its issues, steps, "Add a step"; step summary, its issues, "Edit", "Remove step" |
| `StepEditor` | `components/StepEditor.tsx` | | local field text and errors; dispatches `step/update` only with values passing `StepSchema` |
| `PrerequisiteChecklist` | `components/PrerequisiteChecklist.tsx` | | `<fieldset>` "Waits for": same dish, then other dishes; disabled options from `waitingOn` |
| `Plan` | `screens/Plan.tsx` | `dinner`, `selectSchedule`, `useNow(systemClock, 30_000)` | `KitchenControls`, `ServingTime`, then by result: summary, past note, warnings, timeline, list, export; or `MissingAppliance` / invalid message |
| `KitchenControls`, `Stepper` | `components/<name>.tsx` | `dinner.kitchen` | three `Stepper`s (`role="group"`, label, "−", `<output>`, "+") → `kitchen/set` |
| `ServingTime` | `components/ServingTime.tsx` | `dinner.serving` | `<input type="time">` → `serving/set-time`; day suffix from `formatDay` |
| `PlanSummary` | `components/PlanSummary.tsx` | view, now | start, serve, span; past note + "Serve at" → `serving/set-instant` |
| `WarningList`, `MissingAppliance` | `components/<name>.tsx` | view; issues | `COPY.holdWarning` per warning; per appliance: text, steps, add button, "Change the steps" |
| `Timeline` | `components/Timeline.tsx` | layout | skip link, `aria-hidden` rows of `div`s, one delegated click handler → focus `#step-<id>` |
| `PlanList` | `components/PlanList.tsx` | groups | `<section id="plan-list">`, `<h3>` per group, `<ol>` of `<li id="step-<id>" tabindex="-1">` |
| `ExportBar` | `components/ExportBar.tsx` | | "Dinnerfile", "Share link" (`aria-expanded` panels), "Print" (`window.print()`) |
| `DinnerfilePanel`, `SharePanel` | `components/<name>.tsx` | text; link | `<pre>`, "Copy", "Download" (Blob, `a[download=Dinnerfile]`), make line; read-only `<input>`, "Copy link" or too-long copy |

The Plan screen also renders a `<pre class="print-only">` with the Dinnerfile (R8.8).
`SCREENS: Record<Route, ComponentType | null>` = `{ menu: Menu, steps: Steps, plan: Plan, cook: null }`;
`reachable(state, SCREENS.cook !== null)`. When `SCREENS.cook` is set, `ExportBar` also shows a
"Start cooking" link to `#/cook`; with this spec alone it never appears.

Styles (`components.css`): rows `3rem` tall, lane labels in a `position: sticky; left: 0` column of
`7rem`, the scroller `overflow-x: auto; max-width: 100%`. Fills: burner `--color-ink` with `--color-bg` text, critical burner `--color-accent`
with `--color-on-accent`; oven a hatch (`repeating-linear-gradient(135deg, var(--color-ink-muted)
0 2px, transparent 2px 8px)`, hard stops: a pattern, not a shaded gradient; decided here) with
the label on a `--color-surface` chip; plain `--color-raised`; outline 2 px `--color-border`,
`dashed` when hands-free, `--color-accent` 3 px when critical. Every text pair is one that
`check:contrast` covers. `print.css`: `@media print` hides `.no-print` (header, nav, controls,
timeline, panels), shows `.print-only`, sets `color: #000; background: #fff` on everything, no
shadows, `break-inside: avoid` per list group.

## Copy (`src/web/copy.ts`)

Durations by `formatDuration`, times by `formatClock`; `<x>` marks an argument.

### Headings, buttons and labels

| where | text |
| ----- | ---- |
| document titles | `Menu · Make Dinner`, `Steps · Make Dinner`, `Plan · Make Dinner` |
| header | brand `Make Dinner`; `Theme` with `System`, `Light`, `Dark`; `Start over` → `Start over? This removes your dinner from this device.` `Yes, start over` / `Cancel` |
| nav | `Menu`, `Steps`, `Plan`, `Cook`; unreachable suffix (visible): reasons of the reachability table |
| Menu | h1 `Pick a dinner`; intro `Pick a sample dinner, paste your own recipes, or open a Dinnerfile.`; h2 `Sample dinners`, `Your own recipes`, `A Dinnerfile` |
| sample card | title (h3), blurb, `Dishes: <names joined by ", ">`, button `Plan this dinner` |
| replace | `Replace your current dinner, <title>?` `Replace it` / `Keep my dinner` |
| recipes | label `Recipe text`; hint `Paste the recipes for every dish of one dinner.`; counter `<n> of 12,000 characters`; button `Read recipes`; busy `Reading your recipes. This can take up to a minute. <s> s`, `Cancel` |
| Dinnerfile | label `Dinnerfile text`; button `Open Dinnerfile`; file label `Open a Dinnerfile from this device`; `Show line <n>` |
| Steps | h1 `Check the steps`; intro `<title>. Fix any errors, then make the plan.`; summary h2 `Issues`; dish h2 = dish name; `Rename dish`, `Dish name`, `Save name`, `Remove dish`, `Add a step`, `Add a dish`, `Add dish`; button `Make the plan` |
| step summary | id (mono), `<duration>`, `Burner` / `Oven` / `No appliance`, `Hands-on` / `Hands-free`, `Keeps` / `Can wait <duration>`, `Waits for: <titles>` or `Waits for nothing`; `Edit`, `Done editing`, `Remove step` |
| step editor | `Title`, `Minutes`, `Appliance` (`Burner`, `Oven`, `No appliance`), `Hands-on (needs a cook the whole time)`, `Dish`, `Keeps (can wait as long as needed)`, `Can wait up to (minutes)`, fieldset `Waits for`, option suffixes `(already waits for this step)`, `(not a step in this plan)`, `(this step)` |
| Plan | h1 = plan title; h2 `Kitchen`, `Timeline`, `Plan list`, `Warnings`, `Take the plan with you`; `Burners`, `Ovens`, `Cooks`, `Fewer <x>` / `More <x>` (button names), `Serving time` |
| summary | `Start at <time>`, `Serve at <time>` (+ ` <day>`), `Takes <duration>` |
| timeline | `Skip to the plan list`; row labels; `Serve <time>` |
| list | `▲ On the critical path`, `Can slip <duration>` (nothing at slack 0), final item `Serve` |
| export | `Dinnerfile`, `Share link`, `Print`; `Copy`, `Download`, `Copy link`, `Link to this dinner` |
| make line | `Run make -n -f Dinnerfile dinner to see GNU Make print the steps in an order that works.` |

### Messages

| state | text |
| ----- | ---- |
| text empty | `Paste at least one recipe.` |
| text too long | `The recipe text is over 12,000 characters. Shorten it or split it into two dinners.` |
| `bad_request` | `The recipe reader could not read this request. Reload the page and try again.` |
| `input_too_long` | as text too long |
| `rate_limited` | `You have read several recipes in a short time. Try again after <time>.` (`Try again in a few minutes.` without `Retry-After`) + `Meanwhile, sample dinners and Dinnerfiles still work.` |
| `daily_cap_reached` | `The recipe reader has reached its limit for today. It starts again at <time>. Use a sample dinner or open a Dinnerfile instead.` (`…starts again tomorrow…` without `Retry-After`) |
| `model_unavailable` | `The recipe reader is not available on this server right now. Use a sample dinner or open a Dinnerfile instead.` |
| `model_refused` | `The recipe reader declined to read this text. Check that it is a recipe, or use a sample dinner.` |
| `model_output_invalid` | `The recipe reader returned steps this app cannot use. Try again, or paste fewer dishes at a time.` |
| `internal`, `unexpected` | `Something went wrong on the server. Try again, or use a sample dinner or a Dinnerfile.` |
| `network` | `The server could not be reached. Check your connection and try again. Sample dinners you have opened and Dinnerfiles work offline.` |
| cancelled | notice `Stopped reading the recipes.` |
| Dinnerfile errors | heading `This Dinnerfile could not be read. Fix these lines and open it again.` |
| Dinnerfile invalid plan | heading `This Dinnerfile was read, but its plan is not valid:` |
| file too large / unreadable | `This file is over 1 MB, so it is not a Dinnerfile from this app.` / `This file could not be read. Paste its text instead.` |
| kitchen line ignored | notice `The kitchen line in the Dinnerfile is not valid, so the usual kitchen is used: 4 burners, 1 oven, 1 cook.` |
| issue summary | `<e> error(s) and <w> warning(s).` + `Fix the errors to make the plan.` when `e > 0`; none: `No issues.` |
| make blocked | `Fix <e> error(s) to make the plan.` |
| field errors | `Give the step a title.` / `Enter whole minutes from 1 to 480.` / `Enter whole minutes from 0 to 480.` / `Give the dish a name.` |
| limits | `A plan can have at most 12 dishes.` / `A plan can have at most 80 steps.` / `A plan needs at least one step.` / `A plan needs at least one dish.` |
| remove step | confirm `Remove “<title>”?` + ` <n> step(s) wait for it: <titles>. They will no longer wait for it.`; `Remove step` / `Keep step`; notice `Removed “<title>”.` + ` <titles> no longer wait for it.` (`waits` for one step) |
| remove dish | confirm `Remove the dish <name> and its <n> step(s)?` + dependents sentence as above; `Remove dish` / `Keep dish`; notice `Removed the dish <name>.` |
| hold warning | `<dish>: “<title>” will be ready <wait> before serving and can wait only <hold>. More ovens, burners or cooks may help.`; non-terminal: `…before “<latest user's title>” starts…` |
| list warning | `! Warning: waits <wait> and can wait <hold>` |
| no warnings | `No warnings. Every result is used within the time it can wait.` |
| past start | `This dinner needs <span>. Earliest serving time <time>.` + button `Serve at <time>` |
| missing appliance | `This plan needs an oven and the kitchen has none. These steps use it: <titles>.` (burner: `a burner`); `Add an oven` / `Add a burner`, `Change the steps` |
| invalid plan on Plan | `This plan has errors, so it cannot be scheduled. Fix them in Steps.` + link `Go to steps` |
| cooking started | `Cooking has started, so the plan cannot be changed here.` |
| samples loading / failed | `Loading the sample dinners.` (`aria-busy`) / `The sample dinners could not be loaded. Check your connection and try again.` + `Try again` |
| share too long | `This plan is too long for a link (<n> characters; the limit is 8,000). Share the Dinnerfile instead.` |
| share bad / too large | `This share link is damaged or incomplete, so it could not be opened. Ask for the link again, or open a Dinnerfile.` |
| share version | `This share link was made by a newer version of Make Dinner and cannot be opened here.` |
| share invalid plan / opened | `This share link holds a plan with errors, so it could not be opened.` / notice `Opened a shared dinner.` |
| copied / failed | `Copied the Dinnerfile.` / `Copied a link to this dinner. The plan is in the link itself; nothing is stored on the server.` / `Could not copy. The text is selected; copy it with your device's copy command.` |
| stored state unreadable / not saved | `Your saved dinner could not be read, so the app started fresh.` / `This browser did not let the app save your dinner, so a reload will lose it.` |
| error boundary | h1 `Something went wrong`; `Something went wrong in the app. Your dinner is saved on this device. Reload the page to try again.` `Reload` / `Start over` |

Plural forms (`step(s)`, `error(s)`) are written out by the copy functions: `1 step`, `2 steps`.

## Test plan

Unit tests run under `npm test` (node, no DOM; `TZ` set in `beforeAll` and checked with
`getTimezoneOffset()` so no test passes in the wrong zone). Properties use `fcParams()`.

| file | checks |
| ---- | ------ |
| `test/web/state/clock.test.ts` | every row of the clock table; `quarterFloor`/`Ceil` on and off a quarter; `minuteAt` floors negatives; `Asia/Kathmandu` (+5:45) ticks on local quarters |
| `test/web/state/clock.pbt.ts` | P-UI5: `minuteAt(c, clockAt(c, t)) === t`; `resolveServing` result `>= now - 4 h`, `<= now + 21 h`, and `toServeTime` of it equals the input outside DST gaps (London) |
| `test/web/state/store.test.ts` | each action row; no-op returns the same object; stale `requestId` ignored; cooking guard (a test-local state with `cook` cast through `unknown`); reachability table; `dinner/load` serving rules with the clock table's instants; `start-over` keeps theme |
| `test/web/state/plan-edit.test.ts` | slugify examples; id generation with collisions; remove with dependents on `SUNDAY_ROAST` (`chicken.roast`: `chicken.rest`, `gravy.roux` lose it); duplicates kept; limits; `waitingOn('chicken.prep')` = roast, rest, carve, roux, simmer, strain; `stepOrder` with a cycle |
| `test/web/state/plan-edit.pbt.ts` | P-UI6: over `arbPlan()`, `removeStep`/`removeDish` give plans passing `PlanSchema` with no new `unknown_dependency`, other fields untouched; `addStep`/`addDish` ids match their patterns and are unique |
| `test/web/state/route.test.ts`, `persist.test.ts` | each hash form; each load failure and notice; `toPersisted` → `loadState` gives the persisted fields back |
| `test/web/state/api.test.ts`, `dinnerfile-import.test.ts` | fake `fetch`: samples ok, bad JSON, schema failure, network; parse 200, each code, `Retry-After` `120`, `0`, `abc`, missing; 200 with a bad body; abort. `SUNDAY_ROAST_DINNERFILE` → route `plan`; with a cycle edit → `steps`; an `unsupported_line` file → line problems; a bad kitchen line → notice |
| `test/web/state/share-link.test.ts` | the version 1 body of a two-step plan written out by hand; each decode error with a crafted payload (version 2, bad base64, deflate of 300 KB zeros, JSON with an index out of range, a cycle); each recorded sample (`recordings/*.json` through `validatePlan`) under 8,000, its length in a comment |
| `test/web/state/share-link.pbt.ts` | P-UI1 round trip over `arbPlanAndKitchen()` × `arbServeTime()`; P-UI2 decode is total over strings and single-byte mutations of real payloads |
| `test/web/components/timeline-layout.test.ts` (+ `.pbt.ts`) | H1 table, midnight ticks, two overlapping rests → two `Hands-free n` rows; P-UI3: bars never overlap in a row, each step on exactly its lanes or one hands-free row, hands-free row count = peak overlap by an oracle loop over minutes, `leftPx`/`widthPx` by the formula |
| `test/core/critical-path.test.ts` (+ `.pbt.ts`) | the chains above, tie-breaks, a gap, a rebuilt-shaped input, CP8; P-UI7 |
| `test/web/components/plan-list-items.test.ts` (+ `.pbt.ts`) | H1 and H3 tables, midnight headings; P-UI4: every step once, (start, id) order, group minutes strictly increasing |
| `test/web/copy.test.ts` | every `COPY` string and copy-function output on sample arguments: no `!` except the warning mark, no `task`/`job`, no emoji, sentence case for headings and buttons, no `ANTHROPIC` |

E2E (`e2e/`, both projects; `test.use({ locale: 'en-GB', timezoneId: 'Europe/London' })`;
`page.clock.install({ time: '2026-11-11T17:00:00Z' })` unless stated). `e2e/support.ts` has
`seedDinner(page, plan, kitchen, serve)` (writes a persisted state with `addInitScript`),
`fakeParse(page, status, body, headers?)`, `expectNoAxeViolations(page)` and
`expectNoPageScroll(page)` (`scrollWidth <= clientWidth` on the root). Hand-known plans come from
`test/support/fixtures.ts`.

| spec | flows |
| ---- | ----- |
| `menu.spec.ts` | five sample titles in order; "Plan this dinner" on the first opens Plan in one tap with the h1 from `GET /api/samples`; samples request aborted → failure copy, "Try again" lists them |
| `paste.spec.ts` | counter `0 of 12,000`; 12,001 characters disables with the copy; success → Steps with `SUNDAY_ROAST`; each code of the messages table with its exact copy, `rate_limited` with `Retry-After: 120` → `Try again after 17:02`; abort → network copy; delayed route → busy copy, `5 s` after `runFor(5000)`, Cancel |
| `dinnerfile.spec.ts` | `SUNDAY_ROAST_DINNERFILE` with `# kitchen burners=4 ovens=1 cooks=1` and `# serve 19:30` added → Plan, `Start at 17:40`; a file with a `$(X)` line → its error, "Show line n" selects it; `setInputFiles` upload |
| `steps.spec.ts` | seeded `SUNDAY_ROAST`: minutes of `Roast the chicken` 75 → 85, Make the plan → `Start at 17:30`, `Takes 2 h`; remove it → confirmation names two steps, notice; seeded plan with an unknown prerequisite → summary, error beside the step, button disabled, unchecking enables it; add a dish |
| `plan.spec.ts` | seeded H1 at 19:30: list as the H1 table; burners 4 → 1 → roux `19:08–19:10`; ovens 1 → 0 → missing-appliance copy naming `Roast the chicken`, "Add an oven" restores; clock 17:41 → past note `Earliest serving time 19:35`, button sets it; serving `00:30` → `Serve at 00:30 tomorrow`; tap the Oven 1 bar → list item focused; `expectNoPageScroll` while the timeline scrolls |
| `share.spec.ts` | link from seeded H1 → new context, same clock → Plan, list text equal; damaged link → Menu with copy; link while another dinner is stored → replace prompt |
| `export.spec.ts` | seeded H1: the panel text and the `Dinnerfile` download both equal `SUNDAY_ROAST_DINNERFILE` with the `# kitchen` and `# serve 19:30` lines; Copy notice; `emulateMedia({ media: 'print' })`: visible exactly the h1, summary, plan list and Dinnerfile `pre`, header, nav, controls and timeline hidden, `color` `rgb(0, 0, 0)` on `rgb(255, 255, 255)` |
| `shell.spec.ts` | nav states per screen; reload keeps route and plan; Back/Forward; `#/plan` with no dinner → Menu; Start over needs two taps; theme Dark on a light system sets `data-theme` and `--color-bg` |
| `a11y.spec.ts` | light and dark: Menu, Menu with an error, Steps with an editor open and issues, Plan, Plan with each panel open, missing appliance; 200% zoom (`deviceScaleFactor` unchanged, CSS `zoom` via viewport 195 px wide) with `expectNoPageScroll` |
| `perf.spec.ts` | N2 on the phone project: sample tap to timeline visible < 1 s; stepper tap to list update < 200 ms (`performance.now` in the page) |

## Review notes (by hand, 2026-11-11)

- Q1: superseded the same day. "No slack" and the rule "slack 0 and a hold" are gone: the mark and
  "On the critical path" go to core's `criticalPath` only; other steps read "Can slip <duration>" or
  nothing (see "The critical path").
- Q2: the share link carries plan, kitchen and serving time only, as designed here. The line in
  the rebuild design that mentions the share link concerns only persisted cook sessions.
- Q3: short bars stay tappable; the plan list is the compliant alternative.
- Q4: hard-stop `repeating-linear-gradient` for the oven hatch is a pattern, not a gradient in
  the sense `ui.md` bans.
- Q5: recordings are made by hand with the real key before the e2e tasks.
- Q6: one sentence for "no key" and "model down" is enough.
- Q7: add a tiny blocking `public/theme.js` (not inline, so a strict CSP still holds) that sets
  `data-theme` from localStorage before first paint; fold it into the shell task.
- Needs from cooking-mode (found by that spec): `persist.ts` drops only an unreadable cook
  session, never the whole state; `LiveNotice` re-announces a repeated message; while a cook
  session exists the Plan screen says "You are cooking this dinner" with a link back to it and
  shows the session's current schedule; opening `#/cook` with no session shows the Plan screen.

