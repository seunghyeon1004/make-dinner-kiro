# Design: scheduler

Requirements: `requirements.md` in this folder. Rules this design follows without restating
them: `tech.md`, `structure.md`, `testing.md`, `scheduler-guarantees.md`, `product.md`, and the
recipe-graph design (types, graph helpers, canonical form, generators, fixtures, `fcParams`).

## Files

| file | holds |
| ---- | ----- |
| `src/core/schema.ts` | adds `StepLanesSchema`, `ScheduledStepSchema`, `ScheduleSchema`, their types, the `hold_exceeded` issue variant |
| `src/core/timeline.ts` | `Resource`, `RESOURCES`, `Capacity`, `capacityOf`, `resourcesOf`, `Timeline`, `createTimeline`, `latestFit`, `earliestFit` |
| `src/core/passes/backward.ts` | `backwardPass` |
| `src/core/passes/prep-forward.ts` | `prepForwardPass` |
| `src/core/passes/right-justify.ts` | `rightJustifyPass` |
| `src/core/passes/lanes.ts` | `assignLanes` |
| `src/core/passes/readout.ts` | `readout`, `holdExceededMessage` |
| `src/core/schedule.ts` | `schedule`, `ScheduleError` |
| `src/core/index.ts` | adds the public names (N4) |
| `test/support/oracles.ts` | adds the scheduler oracles |
| `test/support/arbitraries.ts` | adds `arbUnlimitedKitchen`, `arbUnlimitedPair`, `arbHandsFreePair` |
| `test/support/fixtures.ts` | adds `PREP_AHEAD`, the corner-case plans and the kitchens below |
| `test/meta/guarantee-claims.ts` | `CLAIMS` (decided here) |
| `test/meta/guarantees.test.ts` | the coverage check |

Import direction inside core (no cycles): `schedule.ts` → `passes/*` → `timeline.ts`,
`graph.ts`, `sanity.ts` (readout uses `sortIssues`) → `schema.ts`. Passes never import each
other or `schedule.ts`.

## Types (`src/core/schema.ts`)

```ts
const AXIS_MIN = -(LIMITS.stepsMax * LIMITS.minutesMax); // -38400 (decided here)

export const StepLanesSchema = z.strictObject({
  burner: z.int().min(1).max(LIMITS.burnersMax).nullable(),
  oven: z.int().min(1).max(LIMITS.ovensMax).nullable(),
  cook: z.int().min(1).max(LIMITS.cooksMax).nullable(),
});
export const ScheduledStepSchema = z.strictObject({
  id: StepIdSchema,
  startMin: z.int().min(AXIS_MIN).max(-1),
  endMin: z.int().min(AXIS_MIN + 1).max(0),
  lanes: StepLanesSchema,
  slackMin: z.int().min(0).max(-AXIS_MIN),
  critical: z.boolean(),
  waitMin: z.int().min(0).max(-AXIS_MIN).nullable(),
});
export const ScheduleSchema = z.strictObject({
  plan: PlanSchema,
  kitchen: KitchenSchema,
  steps: z.array(ScheduledStepSchema).min(1).max(LIMITS.stepsMax),
  spanMin: z.int().min(1).max(-AXIS_MIN),
  chainMin: z.int().min(1).max(-AXIS_MIN),
  warnings: z.array(HoldExceededIssueSchema),
});
export type StepLanes = z.infer<typeof StepLanesSchema>;
export type ScheduledStep = z.infer<typeof ScheduledStepSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type HoldExceededIssue = Extract<Issue, { code: 'hold_exceeded' }>;
```

The schema checks shape and bounds only. G1 to G8 are properties of `schedule`, not of the
schema (a stored schedule is re-derived by calling `schedule` on its `plan` and `kitchen`).

### The `hold_exceeded` issue

Appended as the last row of the recipe-graph issue table and of `WARNING_CODES`:

| code | sev | extra fields | fires when (source) |
| ---- | --- | ------------ | ------------------- |
| `hold_exceeded` | warning | `stepId`, `waitMin: int >= 1`, `holdMin: int >= 0` | `waitMin > holdMin` (`readout`) |

Messages (decided here; ids and numbers only, recipe-graph R7.2), with `n minute(s)` written
`1 minute` / `n minutes`:

- terminal: `Step potatoes.roast will be ready 40 minutes before serving and can wait only 10 minutes. More ovens, burners or cooks may help.`
- otherwise: `Step b.x will be ready 7 minutes before the step that uses it and can wait only 5 minutes. More ovens, burners or cooks may help.`

`sortIssues` needs no change: there is at most one `hold_exceeded` per `stepId`.

### `ScheduleError` (`src/core/schedule.ts`)

```ts
export type ScheduleError =
  | { kind: 'invalid_plan'; issues: Issue[] }       // errors only, sortIssues order
  | { kind: 'invalid_kitchen'; issues: Issue[] }    // from parseKitchen
  | { kind: 'missing_appliance'; issues: Issue[] }; // from checkKitchen
```

Checks run in that order and the first failure is returned alone (decided here).

## `src/core/timeline.ts`

```ts
export type Resource = 'burner' | 'oven' | 'cook';
export const RESOURCES: readonly Resource[] = ['burner', 'oven', 'cook'];
export type Capacity = Readonly<Record<Resource, number>>;
export function capacityOf(kitchen: Kitchen): Capacity;          // burners, ovens, cooks
/** In RESOURCES order: the appliance (unless 'none'), then 'cook' iff handsOn. */
export function resourcesOf(step: Pick<Step, 'appliance' | 'handsOn'>): Resource[];

export interface Timeline {
  usage(r: Resource, minute: number): number;
  add(rs: readonly Resource[], startMin: number, endMin: number): void;
  remove(rs: readonly Resource[], startMin: number, endMin: number): void;
  /** Largest t in [startMin, endMin) with usage(r, t) + 1 > cap(r) for some r in rs; else null. */
  lastFull(rs: readonly Resource[], startMin: number, endMin: number): number | null;
  /** Smallest such t; else null. */
  firstFull(rs: readonly Resource[], startMin: number, endMin: number): number | null;
}
export function createTimeline(capacity: Capacity): Timeline;

/** Latest end e <= upper such that [e - minutes, e) fits; throws below floorMin (a bug). */
export function latestFit(tl: Timeline, rs: readonly Resource[], minutes: number, upper: number, floorMin: number): number;
/** Earliest start s >= lower such that [s, s + minutes) fits; throws above ceilMin (a bug). */
export function earliestFit(tl: Timeline, rs: readonly Resource[], minutes: number, lower: number, ceilMin: number): number;
```

Storage: one `Map<number, number>` per resource, minute to count; missing means 0. The
timeline is local mutable state inside one call; nothing outside sees it.

`latestFit`: `e = upper`; loop: `t = lastFull(rs, e - minutes, e)`; if `null` return `e`;
else `e = t` (every window containing minute `t` fails, and `[t - minutes, t)` is the latest
window that excludes it). If `e - minutes < floorMin`, throw. `earliestFit` mirrors it:
`s = lower`; on a full minute `t`, `s = t + 1`; throw if `s > ceilMin`. The jump gives the same
answer as trying every candidate one by one (the lemma in its comment); it is the only
shortcut in this spec. With `rs = []` both return the first candidate.

## Notation used below

`P` is the canonical, validated plan (`schedule` computes it once). `succ` = `successors(P)`;
`after(s)` = the canonical `after` list; `start`/`end` are the current maps; `m(s)` =
`minutes`; `keeps(s)` = `holdMin === null`; `cap` = `capacityOf(kitchen)`;
`TOTAL` = sum of all `m(s)`. `deadline(s) = 0` if `succ(s)` is empty, else
`min(start(u) for u in succ(s))`. Every pass takes `(P, cap, starts)` and returns a new
`Map<string, number>` of start minutes in id order; none mutates its input.

## Pass 1: backward (`passes/backward.ts`)

```ts
export function backwardPass(plan: Plan, cap: Capacity): Map<string, number>;
```

```
placed = empty map; tl = createTimeline(cap)
eligible = terminalSteps(P)
repeat n times:
  s = the eligible step with the smallest key, keys compared in this order:
        1. -deadline(s)                      (latest deadline first)
        2. succ(s) empty ? (holdMin ?? 481) : 0   (terminal: shortest hold first, keeps last)
        3. id by compareIds
  e = latestFit(tl, resourcesOf(s), m(s), deadline(s), -TOTAL)
  placed[s] = e - m(s); tl.add(...)
  remove s from eligible
  for p in after(s): if every u in succ(p) is placed, add p to eligible
```

Terminal steps all have deadline 0 and every other deadline is `<= -1` (a successor starts
`<= -1`), so all terminal steps are placed first, which is the brief's order.
Key 2 compares only terminal steps in practice (decided here: the brief applies the hold order
to terminal steps only).

## Pass 2: prep-forward (`passes/prep-forward.ts`)

```ts
export function prepForwardPass(plan: Plan, cap: Capacity, starts: ReadonlyMap<string, number>): Map<string, number>;
```

```
T0 = min(starts); tl = timeline of all steps at starts
for s in topologicalOrder(P) with keeps(s):
  tl.remove(s); lower = max(T0, max(end(p) for p in after(s)))   // max over none = T0
  start[s] = earliestFit(tl, resourcesOf(s), m(s), lower, start[s]); tl.add(s)
```

The current start is always a fitting candidate (the timeline satisfies G1 before every move
and the window was the step's own), and `lower <= start[s]` (prerequisites only moved
earlier, `T0` is the minimum), so the search ends at or before `start[s]`: the step never
moves later and never earlier than `T0`.

## Pass 3: right-justify (`passes/right-justify.ts`)

```ts
export function rightJustifyPass(plan: Plan, cap: Capacity, starts: ReadonlyMap<string, number>): Map<string, number>;
```

```
order = steps with !keeps(s), sorted by end (from starts) descending, then id
tl = timeline of all steps at starts
for s in order:
  tl.remove(s); d = deadline(s) using current starts
  e = latestFit(tl, resourcesOf(s), m(s), d, end[s]); start[s] = e - m(s); tl.add(s)
```

The order is fixed before the loop; it equals picking the latest current end each time,
because only the step being processed moves.

**Why right-justify cannot break precedence or capacity.** Capacity: every placement is checked
against the timeline holding every other step. Successors: the new end is `<= deadline(s)`,
the earliest current successor start. Prerequisites: the old end is `<= d` (G2 held before) and
its window fits, so `latestFit` returns `e >= old end`; the step only moves later, away from
its prerequisites. Order: a hot prerequisite `p` of a hot `s` has `end(p) <= start(s) < end(s)`,
so `s` is processed first and `p` sees `s`'s new start. A keeps successor does not move in this
pass. G3: `d <= 0`.

## Pass 4: lanes (`passes/lanes.ts`)

```ts
export function assignLanes(plan: Plan, cap: Capacity, starts: ReadonlyMap<string, number>): Map<string, StepLanes>;
```

Steps in order of `(start ascending, id)`. For each resource `r` of `s`: `busy` = lanes of `r`
held by already-assigned steps `u` with `end(u) > start(s)` (they started no later, so they
overlap `s` exactly when this holds). Candidates: the prerequisites in `after(s)` that use
`r`, sorted by `end` descending then id; the first whose lane is not in `busy` wins.
Otherwise the smallest `L` in `1..cap[r]` not in `busy`. None free is a bug (G1 says at most
`cap[r]` steps use `r` at minute `start(s)`) and throws. This is greedy interval colouring in
start order, which never needs more lanes than the peak use; so R6.1 and R9.3 hold.

## Pass 5: readout (`passes/readout.ts`)

```ts
export interface Readout {
  slackMin: Map<string, number>;
  waitMin: Map<string, number | null>;
  warnings: HoldExceededIssue[];
}
export function readout(plan: Plan, cap: Capacity, starts: ReadonlyMap<string, number>): Readout;
export function holdExceededMessage(stepId: string, terminal: boolean, waitMin: number, holdMin: number): string;
```

- **Slack**, per step `s`: remove `s` from the full timeline; `limit = deadline(s) - end(s)`
  (precedence and G3 together); for `d = 1..limit`: if any `r` of `s` has
  `usage(r, end(s) + d - 1) + 1 > cap[r]`, slack is `d - 1`, stop; if the loop finishes, slack
  is `limit`; re-add `s`. Checking one new minute per `d` is exact: the window for `d` is
  `[start + d, end + d)`; its minutes before `end(s)` lie in the original window (fit), the
  rest were checked at `1..d`. Delaying `s` cannot break G2 for its prerequisites or anything
  about other steps, so these are the only conditions. Holds and lanes are ignored (G8).
- `critical = slackMin === 0`.
- **Wait**: `null` if keeps; terminal: `-end(s)`; else `max(start(u) for u in succ(s)) - end(s)`.
  Never negative because G2 and G3 hold.
- **Warnings**: one `hold_exceeded` per step with `waitMin > holdMin`, then `sortIssues`.

## `schedule` (`src/core/schedule.ts`)

1. `validatePlan(plan)`, then `parseKitchen(kitchen)`, then `checkKitchen`; the first failure
   is returned as a `ScheduleError`. These never throw on any value (S1, recipe-graph R2.8),
   so R1.6 needs no `try` (decided here).
2. `P = canonicalPlan(checked.plan)`, `K = parsed kitchen`, `cap = capacityOf(K)`.
3. `s1 = backwardPass(P, cap)`, `s2 = prepForwardPass(P, cap, s1)`,
   `s3 = rightJustifyPass(P, cap, s2)`, `lanes = assignLanes(P, cap, s3)`,
   `r = readout(P, cap, s3)`.
4. Build `steps` in `P.steps` order (already id order), `spanMin = -min(start)`,
   `chainMin` from `longestChainMinutes(P)` (an `err` here is a bug and throws).

## Design notes on the corner cases

- **Zero-capacity resource no step needs.** `checkKitchen` passes; the resource never appears
  in any `resourcesOf`, so the timeline never consults it and no lane of it is given.
- **A single step.** Terminal, deadline 0, nothing in the way: it ends at 0. If it keeps,
  `T0` is its own start, so prep-forward leaves it. Delay 1 ends after 0: slack 0, critical.
- **All steps hands-free.** `resourcesOf` never yields `cook`, so the cook count is never read
  by any pass (G5.1, R9.2).
- **More cooks than steps.** Nothing ever conflicts on cooks; lanes are the smallest free ones.
- **480-minute steps.** Minutes stay integers between `-38400` and 0; no floating point; see
  the cost section for the search bound.
- **Prerequisite in another dish.** Dishes are labels; only `after` edges matter (`gravy.roux`
  after `chicken.roast` in `SUNDAY_ROAST`).
- **Several successors.** Deadline: the earliest successor start (needed for G2). Wait: the
  latest (the result is not used up until its last user starts). `chicken.roast` below.
- **A keeps step after a hot step.** Prep-forward puts it at or after the hot step's end, often
  right at it. Then right-justify cannot move the hot step later than the keeps step's new
  start, so it can lose room it might have taken. It never makes the hot step's wait longer
  than after pass 1 (the hot step and its other successors do not move in pass 2), and the
  wait is reported honestly. Accepted (valid, not optimal).
- **A keeps step that is terminal.** Placed in pass 1 after every hot terminal step (keeps
  last), moved to the front by pass 2 like hummus in `MEZZE`. No wait, no `hold_exceeded`,
  outside G4.1 and G4.2 (the reviewed algorithm note).
- **Packed prep shows as critical.** Prep-forward packs keeps steps back to back for one cook,
  so delaying one alone by a minute collides with the next: slack 0, "Critical" (hummus and
  `salad.chop` in `MEZZE`). That is what G8 defines; see the open questions in the reply.
- **Termination.** Pass 1 places one step per iteration and an eligible step always exists in
  an acyclic graph (a step all of whose successors are placed). Each search is bounded:
  `latestFit` by `-TOTAL` (below the earliest busy minute everything is free, and every needed
  resource has `cap >= 1` because `checkKitchen` and `KitchenSchema` passed), `earliestFit` by
  the current start, right-justify by the current end, slack by `limit`. Without the input
  checks a kitchen with `cooks: 0` would make `latestFit` search forever; that is why
  `schedule` re-checks (R1.2 to R1.4) and why the bounds throw instead of looping.
- **Order independence (G7.2).** `schedule` works only on `canonicalPlan`, every choice above
  has a total key ending in the id (ids are unique once `checkPlan` passed), the graph helpers
  are order-free (recipe-graph R3.9), and the error issues are sorted (recipe-graph R7.4).

## Why the guarantees hold (checked against the algorithm)

- **G1**: every placement in passes 1 to 3 goes through `latestFit`/`earliestFit` against a
  timeline holding all other placed steps.
- **G2**: pass 1 ends each step by its deadline, and its prerequisites are placed later with
  deadlines `<=` its start; pass 2 and 3 as argued above.
- **G3**: each step is placed once per pass with its exact minutes; deadlines are `<= 0`.
- **G4.1**: with unlimited resources nothing conflicts, so pass 1 ends every terminal step at
  0; pass 2 does not move hot steps; pass 3 cannot pass 0.
- **G4.2**: *No idle minute below a placed step in pass 1.* Suppose minute `a < 0` is idle
  while a step `s` ends at `a`. At `s`'s placement `a` was idle too (pass 1 never removes), and
  the window ending at `a + 1` drops `s`'s first minute and adds minute `a`, so it fit; the
  search starts at the deadline and goes down, so `a + 1 > deadline`, so the deadline is `a`:
  either `a = 0` or a successor starts at `a`, making `a` busy. Contradiction. So when a hot
  terminal step is placed, the steps placed so far (only terminal steps, by key 1) cover a
  contiguous block `[-X, 0)` with `X <=` the sum of their minutes, and the window ending at
  `-X` is free. Hence `end >= -X >= -(sum of the other terminal steps' minutes)`. Pass 2 does
  not move it; pass 3 only moves it later.
- **G4.3**: the readout applies the definition to the final starts.
- **G5.1**: `resourcesOf` gives `cook` iff `handsOn`.
- **G5.2**: by the lemma above, after pass 1 every minute in `[T0, 0)` is busy, so
  `-T0 <= TOTAL`; pass 2 keeps every start `>= T0`, pass 3 only moves steps later, so the final
  span is `<= -T0`.
- **G5.3**: any schedule satisfying G2 and G3 has span `>=` chain.
- **G6**: greedy interval colouring, above.
- **G7**: canonical input, total keys, no clock or randomness.
- **G8**: the readout computes the definition directly.
