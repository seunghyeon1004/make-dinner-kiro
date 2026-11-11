# Design: rebuild

Requirements: `requirements.md` in this folder. Rules followed without restating them:
`tech.md`, `structure.md`, `testing.md`, `scheduler-guarantees.md`, the recipe-graph design and
the scheduler design (types, timeline, passes, oracles, generators, fixtures, `fcParams`, the
60 s property timeout, the guarantee coverage check).

## Files

New: `src/core/rebuild.ts`, `src/core/passes/forward-repair.ts`, `src/core/passes/re-align.ts`,
`test/core/rebuild.test.ts`, `test/core/rebuild.pbt.ts`. Added to: `schema.ts`, `timeline.ts`,
`passes/lanes.ts`, `passes/readout.ts`, `index.ts` (N2) in `src/core`, and `test/support/{oracles,
arbitraries,fixtures}.ts`, `test/meta/guarantee-claims.ts`. Imports (no cycles): `rebuild.ts` →
`passes/*`, `sanity.ts`, `graph.ts` → `timeline.ts` → `schema.ts`; passes never import each other.

## Types (`src/core/schema.ts`)

```ts
export const AXIS_MIN = -(LIMITS.stepsMax * LIMITS.minutesMax); // the scheduler's -38400, now exported
export const REBUILD_LIMITS = { servingMax: 1440, extraMax: 1440 } as const; // a day (decided here)
const minute = z.int().min(AXIS_MIN).max(REBUILD_LIMITS.servingMax);
const length = z.int().min(0).max(REBUILD_LIMITS.servingMax - AXIS_MIN);

export const ProgressEntrySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('done'), startMin: minute, endMin: minute }),
  z.strictObject({ state: z.literal('running'), startMin: minute,
    extraMin: z.int().min(0).max(REBUILD_LIMITS.extraMax) }),
]);
export const ProgressSchema = z.record(z.string(), ProgressEntrySchema); // absent = pending
export const RebuiltStepSchema = ScheduledStepSchema.extend({
  startMin: minute, endMin: minute, slackMin: length, waitMin: length.nullable(),
});
export const RebuiltScheduleSchema = ScheduleSchema.extend({
  servingMin: z.int().min(0).max(REBUILD_LIMITS.servingMax).default(0),
  steps: z.array(RebuiltStepSchema).min(1).max(LIMITS.stepsMax),
  spanMin: length,
}).refine((s) => s.steps.every((t) => t.startMin <= t.endMin && t.endMin <= s.servingMin));
export const StepMoveSchema = z.strictObject({ stepId: StepIdSchema, fromStartMin: minute, toStartMin: minute });
export const RebuildDiffSchema = z.strictObject({
  moved: z.array(StepMoveSchema), unchanged: z.array(StepIdSchema),
  servingShiftMin: z.int().min(0).max(REBUILD_LIMITS.servingMax),
});
export const RebuiltSchema = z.strictObject({ schedule: RebuiltScheduleSchema, diff: RebuildDiffSchema });
// types by z.infer: ProgressEntry, Progress, RebuiltStep, RebuiltSchedule, StepMove, RebuildDiff, Rebuilt
```

`.extend` keeps the strict objects strict. A `schedule` output parses as a `RebuiltSchedule`
with `servingMin` 0. `spanMin` may be 0 (one step done in no time).

### The axis and `servingMin` (decided here)

Minute 0 stays the serving clock time the cook chose, for the whole meal; `servingMin` is where
serving is now. Consumers that assumed "serving is minute 0": `src/web/state/clock.ts` keeps
`clock(t) = chosenServing + t`, never rebased (`now` = whole minutes since `chosenServing`), and
shows serving as `clock(servingMin)`; the timeline and plan list draw the axis and serving mark to
`servingMin`; the readout measures terminal deadlines and waits to it (RQ8); persistence and the
share link store and parse `RebuiltSchedule` (never `ScheduleSchema`, which rejects ends after 0;
old values get 0); the next rebuild reads `S_prev = servingMin`; MCP `rebuild_plan` returns
`Rebuilt`. Unaffected: the Dinnerfile (plan only), `schedule` and the G oracles.

### `RebuildError` (`src/core/rebuild.ts`)

```ts
export type RebuildError = // issues: validatePlan errors ('plan') or checkKitchen errors ('kitchen'), else []
  | { kind: 'invalid_schedule'; reason: 'shape' | 'plan' | 'kitchen' | 'step_ids'; issues: Issue[] }
  | { kind: 'invalid_now' } | { kind: 'invalid_progress' }
  | { kind: 'unknown_step' | 'done_ends_before_start' | 'done_after_now' | 'running_starts_after_now'; stepId: string }
  | { kind: 'serving_out_of_range'; servingMin: number };
export function rebuild(schedule: Schedule | RebuiltSchedule, progress: Progress, now: number):
  Result<Rebuilt, RebuildError>;
```

**What is an error, and why.** Only inputs that are malformed or contradict `now`: a fact from the
future (done after now, running from after now) or a negative duration cannot have happened, so
the UI that sent it is wrong. Everything a cook can really do is accepted: a step done before its
prerequisite, two pinned steps on one oven, early or late starts, early finishes, overruns, a done
step untapped (pending again). The rebuild plans around them (RQ2).

## Notation and `src/core/timeline.ts` (added)

`P = canonicalPlan(schedule.plan)`, `cap = capacityOf(kitchen)`, `prev(s)` = input `startMin`,
`prevLanes(s)` = input lanes, `m(s)` = minutes, `pinned` = ids in `progress`, `start`/`end` the
current interval of `s`, `succP(s)` = pending successors, `deadline(s) = min(S', start(u) for u
in succP(s))`, `TOTAL` = sum of all `m(s)`.

```ts
export interface Interval { startMin: number; endMin: number }
/** A timeline holding every step's resources over [max(startMin, fromMin), endMin). */
export function timelineFrom(plan: Plan, cap: Capacity, intervals: ReadonlyMap<string, Interval>, fromMin: number): Timeline;
```

Pending steps start `>= now` and only minutes `>= now` are searched, so clipping pinned steps at
`now` changes no answer and keeps over-capacity history out of the counts.

## The algorithm (`rebuild`)

1. **Checks**, first failure returned: `RebuiltScheduleSchema.safeParse(schedule)` (`shape`);
   `validatePlan(plan)` errors (`plan`); `checkKitchen` errors (`kitchen`); step ids equal the
   plan's, once each (`step_ids`); `Number.isInteger(now)` and `AXIS_MIN <= now <= 1440`
   (`invalid_now`); `ProgressSchema.safeParse` (`invalid_progress`); progress keys in
   `compareIds` order, first not in the plan (`unknown_step`); then per pinned id in id order:
   done `endMin < startMin`, done `endMin > now`, running `startMin > now`. Schema parsing and
   `validatePlan` never throw (S1), so RQ1.3 needs no `try`.
2. **Pinned intervals**: done `[startMin, endMin)`; running `[startMin, max(startMin + m + extraMin, now))`.
3. **Forward repair** gives every interval; `S' = max(S_prev, max end(s))`; `S' > 1440` →
   `serving_out_of_range`. Then **re-align** iff `S' > S_prev`.
4. **Lanes**, **readout**, assembly in `P.steps` order; `spanMin = S' - min start`; `chainMin` from
   `longestChainMinutes(P)` (an `err` is a bug and throws). **Diff**: per id, `prev(s) !==
   start(s)` → `moved`, else `unchanged`; `servingShiftMin = S' - S_prev`.

### Forward repair (`passes/forward-repair.ts`)

```ts
export function forwardRepair(plan: Plan, cap: Capacity, prevStarts: ReadonlyMap<string, number>, pinned: ReadonlyMap<string, Interval>, nowMin: number): Map<string, Interval>;
```

```
I = copy of pinned; tl = timelineFrom(plan, cap, pinned, now)
H = max(now, max end over pinned, max prev over pending)
repeat (number of pending steps) times:
  s = among unplaced pending steps whose pending prerequisites are all placed, the smallest (prev(s), id)
  lower = max(prev(s), now, max(end(p) for p in after(s)))          // pinned or placed
  st = earliestFit(tl, resourcesOf(s), m(s), lower, H + TOTAL); I[s] = [st, st + m(s)); tl.add
```

A ready step always exists (acyclic plan). By induction every placed end is `<= H +` the minutes
placed so far, so no start exceeds `H + TOTAL`; passing it is a bug and throws.

**Prerequisite pushed later (checked).** Plain prev-start order places `s` before its pending
prerequisite `p` iff `prev(s) < prev(p)`. If the input satisfies G2 on `p → s`, `prev(s) >=
prev(p) + m(p) > prev(p)`, so `p` comes first and `s` sees `p`'s new end. The input breaks G2 on a
pending pair only after an untap (a step pinned out of order is pending again); then plain order
fails (C4, E8). The ready rule removes that case and equals plain order otherwise.

### Re-align (`passes/re-align.ts`)

```ts
export function reAlign(plan: Plan, cap: Capacity, intervals: ReadonlyMap<string, Interval>, pinned: ReadonlySet<string>, nowMin: number, servingMin: number): Map<string, Interval>;
```

```
order = pending hot steps by end descending, then id (fixed before the loop)
tl = timelineFrom(plan, cap, intervals, now)
for s in order: tl.remove(s); e = latestFit(tl, resourcesOf(s), m(s), deadline(s), start(s)); I[s] = [e - m, e); tl.add
```

`floorMin = start(s)` bounds the window start: the old window fits and its end is `<=
deadline(s)` (G2 after forward repair, `end <= S'` by step 3), so `e >= old end` and the floor is
never reached. A hot pending prerequisite `p` of `s` ends `<= start(s) < end(s)`, so `s` moves
first and `p` sees its new start. Keeps successors do not move.

### Lanes (`passes/lanes.ts`, added)

```ts
export function assignRebuildLanes(plan: Plan, cap: Capacity, intervals: ReadonlyMap<string, Interval>, prevLanes: ReadonlyMap<string, StepLanes>): Map<string, StepLanes>;
```

Steps in `(startMin, id)` order. For each resource `r` of `s`: `busy` = lanes of `r` of assigned
`u` with `start(u) < end(s)` and `start(s) < end(u)`. Candidates: `prevLanes(s)[r]` if in
`1..cap[r]`; prerequisites using `r`, end descending then id; the smallest lane not in `busy`.
If all are busy: `prevLanes(s)[r]` if in range, else 1 (RQ7.2). A pending step starts `>= now`
at a fitting minute, so fewer than `cap[r]` assigned steps overlap its start: it always finds a
free lane. So a lane is shared only when the later-starting of two overlapping steps is pinned and
`usage(r)` at its start exceeds `cap[r]`, and then every step active there is pinned.

### Readout (`passes/readout.ts`, added)

```ts
export function rebuildReadout(plan: Plan, cap: Capacity, intervals: ReadonlyMap<string, Interval>, pinned: ReadonlySet<string>, nowMin: number, servingMin: number): Readout;
```

- Slack (pending): `timelineFrom(..., now)` without `s`, `limit = deadline(s) - end(s)`, then the
  scheduler's per-minute loop; pinned 0. `critical` (set in `rebuild.ts`): pending `slackMin === 0`.
- Wait: keeps `null`; terminal `S' - end(s)`; else `max(0, min(start(u) for u in succ(s)) - end(s))`
  over all successors, pinned or pending: the first user (the clamp matters only when that
  successor started before `s` ended, i.e. out of order).
- Warnings: one `hold_exceeded` per step with `waitMin > holdMin`, `holdExceededMessage(id,
  succ(s) empty, waitMin, holdMin)`, `sortIssues`.

## The repeatability invariant

Every rebuilt `R` from `(S, p, n)` satisfies: **I1** it passes `RebuiltScheduleSchema` and step
1's schedule checks; **I2** each pinned interval is step 2's interval of `(p, n)`; **I3** each
pending step starts `>= n`, after every prerequisite's end, and its window fits against all other
intervals clipped at `n`; **I4** `servingMin = max(S_prev, max end in R)` (re-align runs only when
`S'` is the latest end after forward repair, and moves ends later, to at most `S'`); **I5** its
lanes are a fixed point of the lane rule with `prevLanes` = its own lanes.

On `(R, p, n)`: by I3 every lower bound is the step's own start and its window fits, so forward
repair returns `R`'s intervals; by I4 `S'' = R.servingMin` and re-align does not run; by I5 the
lanes repeat; the readout is a function of intervals, `n` and `S''`: P-RB1. For a later `n'` with
the cook following `R`, pinned intervals clipped at `n'` are a subset of `R`'s use and every
pending start is `>= n'`: P-RB2. A `schedule` output satisfies I1 to I5 with `servingMin` 0: R4.

## Why the guarantees hold (checked against the algorithm)

- **R1.** G1 from `now`: every placement fits against a timeline holding every other interval
  from `now`, which bounds use at each minute `>= now` by capacity *provided pinned steps alone are
  within it there* (C2). G2 for pending successors: forward repair's lower bound, re-align's
  deadline and order. G3: pending windows last `m(s)`, pinned are step 2's, `end <= S'` (C3).
- **R2.** Pinned intervals are copied from step 2; lower bounds are `>= now`; re-align moves later.
- **R3.** Forward repair's lower bound is `>= prev(s)`; re-align returns `e >= old end`, so,
  checked together, re-align cannot undo R3: its floor is the forward-repair start.
- **R4.** Under its premise each pinned interval is the planned one (`max(planned end, now)` is the
  planned end), each lower bound is the prev start (G2, `prev >= now`), and the planned windows
  fit (a subset of a G1-valid schedule): nothing moves, `S' = 0`, no re-align, `moved = []`.
- **R5.** `S' = max(S_prev, max end)` is `>= 0` and set by forward repair alone. With `S_prev = 0`
  and every edge in order (`end(p) <= start(s)`), the latest end is a terminal end (follow
  successors): R5's wording. Over repeated rebuilds `max(0, …)` lets serving move earlier than
  `S_prev` (C1); `S_prev` prevents it.
- **R6.** The diff compares final and input starts; `servingShiftMin = S' - S_prev` (`S'` here).

Cost (N1): forward repair is `n` `earliestFit` calls of at most `H + TOTAL - lower` minutes × 2
plus `O(n²)` readiness, ≈ 6.4 M reads; re-align as scheduler pass 3; slack ≈ 6.4 M; ≈ 20 M in all.

## Hand-worked rebuilds

Start: `H1_SCHEDULE` (scheduler H1, `SUNDAY_ROAST` × `HOME_KITCHEN`, `servingMin` 0). State d/r/p =
done/running/pending; `fr` = start after forward repair where re-align moved it. Lanes equal H1's
in RB-a to RB-c (B: roux 1, simmer 1, boil 2; O: roast 1; C: every hands-on step 1). Tests assert
every column, lanes, warnings, `servingMin`, `spanMin`, `chainMin` (110) and the diff.

### RB-a. Roast needs 15 more minutes, `now = -60`

Progress: `chicken.prep` done `[-110,-100)`, `greens.shred` done `[-100,-95)`, `chicken.roast`
running `{ startMin: -100, extraMin: 15 }` → `[-100,-10)`. Forward repair in ready order: rest
`[-10,10)`, roux `[-10,-8)`, simmer `[-8,2)`, boil stays `[-10,-6)`, strain `[2,4)`, toss stays
`[-6,-5)`, carve `[10,15)`. `S' = 15` (carve). Re-align, order carve, rest, strain, simmer, toss,
boil, roux: carve and rest stay; strain to `[8,10)` (cook busy with carve from 10); simmer to
`[-2,8)`; toss to `[7,8)` (cook busy from 8); boil to `[3,7)`; roux to `[-4,-2)`.

| step | state | start | end | slack | critical | wait | fr |
| ---- | ----- | ----- | --- | ----- | -------- | ---- | -- |
| chicken.carve | p | 10 | 15 | 0 | yes | 0 | |
| chicken.prep | d | -110 | -100 | 0 | no | null | |
| chicken.rest | p | -10 | 10 | 0 | yes | 0 | |
| chicken.roast | r | -100 | -10 | 0 | no | 0 | |
| gravy.roux | p | -4 | -2 | 0 | yes | 0 | -10 |
| gravy.simmer | p | -2 | 8 | 0 | yes | 0 | -8 |
| gravy.strain | p | 8 | 10 | 0 | yes | 5 | 2 |
| greens.boil | p | 3 | 7 | 0 | yes | 0 | -10 |
| greens.shred | d | -100 | -95 | 0 | no | null | |
| greens.toss | p | 7 | 8 | 0 | yes | 7 | -6 |

`servingMin 15`, `spanMin 125`. One warning: `greens.toss` wait 7 hold 5, `Step greens.toss will be ready 7 minutes before serving and can wait only 5 minutes. More ovens, burners or cooks may help.`
Diff: moved `chicken.carve -5→10`, `chicken.rest -25→-10`, `gravy.roux -20→-4`,
`gravy.simmer -18→-2`, `gravy.strain -8→8`, `greens.boil -10→3`, `greens.toss -6→7`; unchanged
`chicken.prep`, `chicken.roast`, `greens.shred`; `servingShiftMin 15`. No keeps step is pending at
−60 (prep and shred are done), so "the prep stays" shows as the two done rows.

### RB-b. The cook is 8 minutes behind on `gravy.roux`, `now = -12`

Progress: prep and shred done at H1 times, `chicken.roast` done `[-100,-25)`, `chicken.rest`
running `{ -25, 0 }` → `[-25,-5)`; roux (planned −20) not started. Forward repair: roux
`[-12,-10)`, simmer `[-10,0)`, boil stays, strain `[0,2)`, toss and carve stay. `S' = 2`.
Re-align (order strain, carve, simmer, toss, boil, roux) moves nothing: each step is held by a
successor or by the cook.

| step | state | start | end | slack | critical | wait |
| ---- | ----- | ----- | --- | ----- | -------- | ---- |
| chicken.carve | p | -5 | 0 | 0 | yes | 2 |
| chicken.prep | d | -110 | -100 | 0 | no | null |
| chicken.rest | r | -25 | -5 | 0 | no | 0 |
| chicken.roast | d | -100 | -25 | 0 | no | 0 |
| gravy.roux | p | -12 | -10 | 0 | yes | 0 |
| gravy.simmer | p | -10 | 0 | 0 | yes | 0 |
| gravy.strain | p | 0 | 2 | 0 | yes | 0 |
| greens.boil | p | -10 | -6 | 0 | yes | 0 |
| greens.shred | d | -100 | -95 | 0 | no | null |
| greens.toss | p | -6 | -5 | 0 | yes | 7 |

`servingMin 2`, `spanMin 112`. One warning: `greens.toss` wait 7 hold 5. `chicken.roast` waits 0:
`chicken.rest` starts at −25 as it ends, whatever the late roux does (measured to the roux, the
latest user, it read 13 and warned; before 2026-11-11). Moved `gravy.roux -20→-12`, `gravy.simmer -18→-10`,
`gravy.strain -8→0`; 7 unchanged; shift 2. At −10 `gravy.simmer` (id before `greens.boil`) is
assigned first and keeps burner 1; boil keeps burner 2.

**RB-b2** (behind on a step with slack, `now = -92`): prep done, roast running `{ -100, 0 }`, shred
not started. Only shred moves, to `[-92,-87)`, slack 67 (a delay of 68 reaches `gravy.roux` on
the cook at −20); `S' = 0`, no re-align, no warnings; other rows as H1 but pinned rows slack 0 not
critical; moved `greens.shred -100→-92`, shift 0.

### RB-c. No slip (R4), `now = -60`

Progress: prep, shred done as H1; roast running `{ -100, 0 }` → `[-100,-25)`. Starts, ends, lanes
and waits equal H1; pinned rows `chicken.prep`, `chicken.roast`, `greens.shred` have slack 0 (shred
was 75) and are not critical. `servingMin 0`, `spanMin 110`, warnings `[]`, moved `[]`, all 10 ids
unchanged, shift 0; re-align does not run.

### Situations (`SUNDAY_ROAST` unless named; "as H1" = done at the H1 interval)

| id | progress, now | expected |
| -- | ------------- | -------- |
| E1 finished early | prep, shred as H1; roast done `[-100,-35)`; now −35 | nothing moves (R3), `S'` 0; roast wait 10 > 5 warned (rest starts at −25) |
| E2 started early | prep done `[-110,-102)`; roast running `{ -102, 0 }`; now −100 | roast `[-102,-27)`; moved only `chicken.roast -100→-102`; roast wait 2 (rest starts at −25), within its hold, no warning; `S'` 0 |
| E3 overrun, no taps | prep, shred as H1; roast running `{ -100, 0 }`; now −20 | roast `[-100,-20)` (ends now); rest `[-20,0)`, carve `[0,5)`, `S'` 5; re-align: toss −1, strain −3, boil −5, simmer −13, roux −15; no warnings |
| E4 done long | prep as H1; shred done `[-100,-88)`; roast running `{ -100, 0 }`; now −88 | nothing moves, `S'` 0, no warnings |
| E5 all done late | all as H1 but carve done `[-5,3)`; now 3 | nothing planned; `S'` 3, shift 3; all slack 0 not critical; strain wait 9; toss wait 8 warned |
| E5′ all done early | all as H1 but carve done `[-5,-2)`; now −2 | `S'` 0 (R5, C5); carve wait 2; no warnings |
| E6 out of order | all as H1 but boil absent, carve running `{ -5, 0 }`; now −2 | boil `[-2,2)` B2, wait 0 (clamped); `S'` 2 (C3); toss wait 7 warned; moved `greens.boil -10→-2` |
| E7 one oven, two pans | `TIGHT_OVEN` from `H3_SCHEDULE`: peel, assemble as H3; potatoes.roast running `{ -85, 0 }`; pie.bake running `{ -60, 0 }`; now −50 | `ok`; both oven lane 1 (RQ7.2); `S'` 0; moved `pie.bake -40→-60`; warnings bake 20 > 10, roast 40 > 10 (C2) |
| E8 untap | input: E6's output; progress: E6's minus `greens.toss`; now 0 | boil `[0,4)`, toss `[4,5)` (ready order), `S'` 5, shift 3 (C4) |

Errors (from `H1_SCHEDULE`, now −60 unless named): `{ 'chicken.fry': done }` → `unknown_step`;
shred done `[-95,-100)` → `done_ends_before_start`; shred done `[-100,-50)` → `done_after_now`;
roast running from −50 → `running_starts_after_now`; now `-60.5`, `NaN`, `1441` → `invalid_now`;
shred `{ state: 'done', startMin: -100 }` → `invalid_progress`; a step with `endMin 1` and no
`servingMin` → `invalid_schedule` `shape`; a self-dependency → `plan`; `burners: 0` → `kitchen`
with the 3 `missing_appliance` issues; one step removed → `step_ids`; now 1440 with nothing done →
`serving_out_of_range` `servingMin 1550`; `rebuild(null, 42, 'x')` → `invalid_schedule` `shape`.

## Test support

**Oracles** (`test/support/oracles.ts`, added), from `scheduler-guarantees.md` and this design's
rules, plain loops over minutes and steps, types and schemas only. `Iv = Record<string,
{ startMin; endMin }>`; `Ctx = (plan, kitchen, progress, now)`:

```ts
oraclePinnedIntervals(plan, progress, now): Iv
oracleRebuildViolations(...Ctx, steps: RebuiltStep[], servingMin): string[] // R1: G1 t >= now, G2 pending succ, G3
oraclePendingOverfull(...Ctx, steps): string[]            // a pending step active where use > cap
oracleForwardRepair(...Ctx, prevStarts: Starts): Iv       // ready rule, every start tried upward
oracleRebuildWaits(plan, iv, servingMin): Record<string, number | null>
oracleRebuildHoldExceeded(plan, iv, servingMin): { stepId; waitMin; holdMin }[]
oracleRebuildSlack(...Ctx, iv, servingMin, stepId): number          // by trial, d = 1, 2, ...
oracleRebuildLaneViolations(plan, kitchen, iv, pinned: string[], steps): string[]
```

**Generators** (`test/support/arbitraries.ts`, added):

```ts
arbScheduled(opts?: Omit<PlanOpts, 'appliances'>): fc.Arbitrary<Schedule> // arbPlanAndKitchen through schedule; err throws
arbNow(s: Schedule | RebuiltSchedule): fc.Arbitrary<number> // [min start - 10, servingMin + 30], 1/3 on a start or end
interface RunOpts { outOfOrder?: boolean; overCapacity?: boolean; base?: { progress: Progress; now: number } }
arbProgress(s: Schedule | RebuiltSchedule, opts?: RunOpts): fc.Arbitrary<{ progress: Progress; now: number }>
followPlan(s: Schedule | RebuiltSchedule, base: Progress, now: number): Progress  // pure
arbOnPlan(s: Schedule): fc.Arbitrary<{ progress: Progress; now: number }>  // arbNow, then followPlan(s, {}, now)
```

`arbProgress` simulates a real run. Per step (id order) it draws `startShift` in −10..15
(negative: early), `durDelta` in −5..20 (actual duration `max(0, m + durDelta)`), `taps` from
`{0,0,0,5,10,15,20,30}`, and with `outOfOrder` an `ignoresAfter` flag (probability 1/5). It
repeatedly takes the ready step (prerequisites simulated or ignored) with the smallest `(planned
start + startShift, id)` and starts it at the earliest minute `>=` that, after its prerequisites'
actual ends unless ignored, where its resources are free for its actual duration (not checked with
`overCapacity`). `now`: `arbNow` (weight 6), the last actual end (1: all done), the first planned
start − 1 (1), capped at 1440. Cut: actual start `> now` → pending; actual end `<= now` → done;
else running `{ start, extraMin: taps }` (an overrun without taps when `start + m < now`). With
`base`: base facts stay, base running steps keep their start with `extraMin >=` the base's, other
steps start `>= base.now`, `now = base.now + 0..90`. A capacity-respecting run has pinned use at
`t >= now` at most the use at `now`, so `<= cap`: that is why R1 is testable as worded.
`followPlan`: a step pending in `base` whose planned start is `< now` becomes done at its planned
interval if it ends `<= now`, else running `{ start, 0 }`; a base running step whose interval
ends `<= now` becomes done at it; the rest is kept.

**Fixtures** (`test/support/fixtures.ts`, added): `H1_SCHEDULE` and `H3_SCHEDULE`, `Schedule`
literals written by hand from the scheduler tables; the progress objects of RB-a, RB-b, RB-b2,
RB-c and E1 to E8 (`RB_A_PROGRESS`, ...), each with its expected rebuild in a comment.

## Correctness properties

In `test/core/rebuild.pbt.ts`, `fcParams()`, 60 s per test. "Run" = `arbScheduled()` (both
sizes) then `arbProgress(s)`; "in-order" = no options. Every property also accepts
`err serving_out_of_range` when `oracleForwardRepair`'s latest end is `> 1440`, and nothing else.

| id | statement | validates | generator |
| -- | --------- | --------- | --------- |
| R1 valid | `ok`; `oracleRebuildViolations` is `[]` | RQ10.1, RQ4, RQ6 | in-order run, and with `outOfOrder` |
| R2 pinned | done keep start and end; running keep start, end `max(start + m + extra, now)`; every pending start `>= now` | RQ2.2, RQ3.3 | run, both options |
| R3 never earlier | every pending start `>=` its prev start | RQ4.2, RQ6.3 | run, both options |
| R4 no slip | starts equal the input's, `servingMin 0`, `moved []`, `servingShiftMin 0` | RQ6.2, RQ4.2 | `arbScheduled`, `arbOnPlan` |
| R5 serving time | `servingMin === max(0, latest end of oracleForwardRepair) === max(0, max endMin)`; in-order runs: also `=== max(0, latest terminal end)` | RQ5.1 | run, both options |
| R6 honest diff | `moved` = exactly the ids whose start changed, with input and output starts; `unchanged` the rest; both sorted; `servingShiftMin === servingMin` | RQ9.1, RQ9.2 | run, both options |
| R7 re-aligned | when `servingShiftMin > 0`, for every pending step with `holdMin !== null`, `oracleLatestPosition` (given the serving minute and the pinned intervals) equals its start | RQ6.1, RQ6.3 | run, both options and `overCapacity` |
| P-RB1 idempotent | `rebuild(R.schedule, p, n)` deep-equals `R` but for a diff of `moved []`, all unchanged, shift 0 | RQ9.3 | run |
| P-RB2 no slip twice | `n' = n + 0..90`: `rebuild(R.schedule, followPlan(R.schedule, p, n'), n')` keeps every start and `servingMin`; `moved []` | RQ9.3 | run |
| P-RB3 slips twice | `(p2, n2) = arbProgress(R.schedule, { base: { p, n } })`: R1 to R3 against `R`; `servingMin === max(R.servingMin, max end) >= R.servingMin`; diff against `R`; shift `S'' - S'` | RQ5.1, RQ9.2, RQ10.1 | run, then base run |
| P-RB4 reality first | `ok` for every fact; `oraclePendingOverfull` is `[]`; G2 for pending successors; ends `<= servingMin` | RQ2.1, RQ7.2, RQ10.1 | run with `overCapacity` and `outOfOrder` |
| P-RB5 lanes | `oracleRebuildLaneViolations` is `[]` (fields per G6, in range, shares only as allowed); a step whose input lane is free at its start keeps it | RQ7 | run, both options |
| P-RB6 readout | pending `slackMin === oracleRebuildSlack`, `critical === (slackMin === 0)`; pinned 0, `false`; waits and warnings equal the oracles; `spanMin`, `chainMin` | RQ8, RQ3.3 | run |
| P-RB7 errors | one case built per error kind gives that `err`; any `fc.anything()` triple never throws; arguments equal deep copies taken before | RQ1 | as stated |
| P-RB8 order-free | permuting `progress` keys, `schedule.steps` and the plan's arrays gives deep-equal results | RQ1.3 | run |
| P-RB9 schema | `RebuiltSchema.parse` of the JSON round trip strictly deep-equals the result | RQ3, RQ9.3 | run |

Example tests (`test/core/rebuild.test.ts`): RB-a, RB-b, RB-b2, RB-c, E1 to E8 exactly, every
error case, RB-a's output rebuilt with its own progress and now, and the forward-repair and
re-align intermediate starts of RB-a, RB-b, E8. `test/meta/oracles.test.ts`: each rebuild oracle
gives the hand values on RB-a, RB-b, E7, and one violation each on hand-made broken rebuilds (a
pending step before `now`, one before its running prerequisite's expected end, an end after
`servingMin`). `CLAIMS` gains `rebuild: ['R']`; coverage then needs R1 to R6.

## Conflicts found

**C1. R4, R5, R6 assume the previous schedule serves at minute 0.** RB-a's output
(`servingMin 15`, carve `[10,15)`), then the roast done at −10 as planned, `now = -10`: nothing
slipped, yet R3 keeps carve at `[10,15)`, so R4's "`S' = 0`" is false, R6's "`servingShift = S'`"
reports 15 again, and R5's `max(0, …)` would let serving move earlier than 15 (the brief: never
earlier). Resolution: 0 read as `S_prev` (RQ5.1, RQ9.2); R properties use `schedule` inputs, where
both readings agree; P-RB2, P-RB3 check the `S_prev` form. Proposed steering wording: R4 "`S' =
S_prev`", R5 "`S' = max(S_prev, …)`", R6 "`servingShift = S' - S_prev`".

**C2. R1's capacity cannot hold when pinned steps exceed it after `now`.** E7: both oven steps
run at −50 in one oven, use 2 over `[-50,-40)` whatever the rebuild does. Resolution: R1 is proved
as worded on capacity-respecting runs; P-RB4 proves "no pending step is active where use exceeds
capacity" for any facts. Proposed steering addition: "G1 holds at every `t >= now` where pinned
steps alone are within capacity; no pending step is placed where they are not."

**C3. R5's "latest terminal end" can precede a pending step's end.** E6: toss done before boil
ran; boil planned `[-2,2)`; the latest terminal end is 0, so R5 gives `S' = 0` and R1's "every end
`<= S'`" fails. Resolution: the latest end of any step (RQ5.1), equal to R5's when every edge is in
order; the R5 property asserts both.

**C4. Prev-start order breaks precedence after an untap.** E8: in E6's output toss starts at −6
(done out of order), boil at −2; untapping toss makes both pending. Prev-start order places toss
first with boil's stale end 2 → `[2,3)`, then boil is pushed to `[0,4)`. Resolution: the ready
rule (RQ4.1), equal to prev-start order whenever the input satisfies G2 among pending steps.

**C5. "All done: serving is when the last terminal step ended" vs R5's "never `< 0`".** E5′: all
done by −2 gives `S' = 0`, not −2. This spec follows R5 and reports the waits; the request's
wording holds when the last end is `>= S_prev`.

## Review notes (by hand, 2026-11-11)

C1 to C5 accepted as resolved above. `scheduler-guarantees.md` now carries the proposed wording
for R1, R4, R5 and R6. The session that wrote this spec lost its final message (the transcript
ends after the last tool call), so there is no reply-level list of decisions; the "(decided
here)" marks in the three files are the record.
