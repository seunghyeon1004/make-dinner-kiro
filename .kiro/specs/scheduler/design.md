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

## Cost (N3)

`n <= 80`, `TOTAL <= 80 × 480 = 38400`, a step uses at most 2 resources.

- `latestFit`/`earliestFit`: each minute between the first candidate and the answer is read
  at most once per resource (a jump to `t` skips every minute already read), so one call reads
  at most `TOTAL + 480` minutes × 2 resources ≈ 78,000 reads.
- Passes 1 to 3: `n` searches each, ≈ 6.2 M reads per pass in the worst case. Choosing the next
  eligible step and computing deadlines is O(n + e) per step, O(n²) = 6,400 per pass.
- Readout: slack reads at most `limit <= 38400` minutes × 2 per step, ≈ 6.1 M; waits O(n + e).
- Lanes: O(n²).
- Worst case for one `schedule` call: about 25 M map reads. `LONG_DAY` (below) comes close to the
  pass-1 bound. Without the jump, a search could read `TOTAL × 480` minutes per step (≈ 1.5 G for
  the whole plan), which is why the jump is kept; it is the only shortcut.

## Hand-worked schedules

Each table below is the exact expected output; example tests assert every column, the warnings,
`spanMin` and `chainMin`. Lanes: `B` burner, `O` oven, `C` cook; `-` is `null`. "Pass 1 start"
is shown where a later pass moved the step. Fixture definitions for `SUNDAY_ROAST`, `MEZZE` and
`TIGHT_OVEN` are in the recipe-graph design.

New kitchens in `test/support/fixtures.ts` (decided here):
`ONE_BURNER_KITCHEN { burners: 1, ovens: 1, cooks: 1 }`,
`NO_BURNER_KITCHEN { burners: 0, ovens: 1, cooks: 1 }`,
`BURNER_ONLY_KITCHEN { burners: 1, ovens: 0, cooks: 1 }`,
`BARE_KITCHEN { burners: 0, ovens: 0, cooks: 1 }`,
`BIG_KITCHEN { burners: 8, ovens: 4, cooks: 6 }`.

### H1. `SUNDAY_ROAST` × `HOME_KITCHEN` (4 burners, 1 oven, 1 cook)

Pass 1, in placement order (key: deadline, then hold for terminal steps, then id):
carve (terminal, hold 5) `[-5,0)`; toss (hold 5, `chicken.carve` < `greens.toss`) cook busy, `[-6,-5)`;
strain (hold 15) `[-8,-6)`; then eligible rest (deadline −5), boil (−6), simmer (−8):
rest `[-25,-5)`; boil `[-10,-6)`, making shred eligible (−10); simmer `[-18,-8)` (2 burners
in use at −10, −9), making roux eligible (−18); shred `[-15,-10)`; roux `[-20,-18)`, making
roast eligible with deadline `min(-25, -20) = -25`; roast `[-100,-25)`; prep `[-110,-100)`.
`T0 = -110`. Pass 2 (topological order, keeps steps prep, shred): prep stays; shred moves to the
first cook gap at or after −110, `[-100,-95)`. Pass 3 order: carve, chicken.rest, greens.toss,
gravy.strain, greens.boil, gravy.simmer, gravy.roux, chicken.roast; none moves (each is held by a
successor or by the cook).

| step | start | end | B | O | C | slack | critical | wait | pass 1 start |
| ---- | ----- | --- | - | - | - | ----- | -------- | ---- | ------------ |
| chicken.carve | -5 | 0 | - | - | 1 | 0 | yes | 0 | |
| chicken.prep | -110 | -100 | - | - | 1 | 0 | yes | null | |
| chicken.rest | -25 | -5 | - | - | - | 0 | yes | 0 | |
| chicken.roast | -100 | -25 | - | 1 | - | 0 | yes | 5 | |
| gravy.roux | -20 | -18 | 1 | - | 1 | 0 | yes | 0 | |
| gravy.simmer | -18 | -8 | 1 | - | - | 0 | yes | 0 | |
| gravy.strain | -8 | -6 | - | - | 1 | 0 | yes | 6 | |
| greens.boil | -10 | -6 | 2 | - | - | 0 | yes | 0 | |
| greens.shred | -100 | -95 | - | - | 1 | 75 | no | null | -15 |
| greens.toss | -6 | -5 | - | - | 1 | 0 | yes | 5 | |

`spanMin 110`, `chainMin 110`, warnings `[]`. `chicken.roast` has two successors: its deadline
comes from `chicken.rest` (−25), its wait from `gravy.roux` (−20 − (−25) = 5, not over its hold
of 5). `greens.boil` takes burner 2 because `gravy.simmer` holds burner 1 at −10;
`gravy.simmer` keeps the burner of `gravy.roux`. Slack of `greens.shred`: delays 1..75 keep its
window clear of `gravy.roux` at −20; 76 collides.

### H2. `SUNDAY_ROAST` × `ONE_BURNER_KITCHEN` (1 burner, 1 oven, 1 cook)

Pass 1 differs from H1 at simmer: with boil on the only burner over `[-10,-6)`, the latest
fitting end at or before −8 is −10, so simmer is `[-20,-10)`; roux then has deadline −20 and goes
to `[-22,-20)`; roast's deadline is `min(-25, -22) = -25`. Pass 2 moves shred from −15 to −100.
Pass 3 moves nothing (simmer still cannot end later than −10 with boil on the burner).

| step | start | end | B | O | C | slack | critical | wait | pass 1 start |
| ---- | ----- | --- | - | - | - | ----- | -------- | ---- | ------------ |
| chicken.carve | -5 | 0 | - | - | 1 | 0 | yes | 0 | |
| chicken.prep | -110 | -100 | - | - | 1 | 0 | yes | null | |
| chicken.rest | -25 | -5 | - | - | - | 0 | yes | 0 | |
| chicken.roast | -100 | -25 | - | 1 | - | 0 | yes | 3 | |
| gravy.roux | -22 | -20 | 1 | - | 1 | 0 | yes | 0 | |
| gravy.simmer | -20 | -10 | 1 | - | - | 0 | yes | 2 | |
| gravy.strain | -8 | -6 | - | - | 1 | 0 | yes | 6 | |
| greens.boil | -10 | -6 | 1 | - | - | 0 | yes | 0 | |
| greens.shred | -100 | -95 | - | - | 1 | 73 | no | null | -15 |
| greens.toss | -6 | -5 | - | - | 1 | 0 | yes | 5 | |

`spanMin 110`, `chainMin 110`, warnings `[]`. Slack of `gravy.simmer` is 0 because a 1-minute
delay puts it on the burner with `greens.boil` at −10.

### H3. `TIGHT_OVEN` × `HOME_KITCHEN`

Pass 1: pie.bake and potatoes.roast tie on hold 10, `pie.bake` first: `[-40,0)`; roast `[-85,-40)`;
assemble `[-55,-40)`; peel `[-95,-85)`. `T0 = -95`. Pass 2: assemble moves to `[-85,-70)` (peel holds
the cook until −85); peel stays. Pass 3: nothing moves (one oven).

| step | start | end | B | O | C | slack | critical | wait | pass 1 start |
| ---- | ----- | --- | - | - | - | ----- | -------- | ---- | ------------ |
| pie.assemble | -85 | -70 | - | - | 1 | 30 | no | null | -55 |
| pie.bake | -40 | 0 | - | 1 | - | 0 | yes | 0 | |
| potatoes.peel | -95 | -85 | - | - | 1 | 0 | yes | null | |
| potatoes.roast | -85 | -40 | - | 1 | - | 0 | yes | 40 | |

`spanMin 95`, `chainMin 55`, warnings: one `hold_exceeded` for `potatoes.roast`, `waitMin 40`,
`holdMin 10`, message `Step potatoes.roast will be ready 40 minutes before serving and can wait only 10 minutes. More ovens, burners or cooks may help.`
G4.2 is tight here: −40 >= −(40).

### H4. `MEZZE` × `HOME_KITCHEN`

Pass 1: salad.toss (hold 5) `[-2,0)`; flatbread.cook (hold 10) `[-14,-2)`; hummus.blend (keeps, last)
`[-24,-14)`; salad.chop and salad.dressing (deadline −2) `[-34,-24)`, `[-39,-34)`; flatbread.rise
`[-74,-14)`; flatbread.mix `[-84,-74)`. `T0 = -84`. Pass 2 in topological order: mix stays; hummus
(a keeps terminal step) moves to `[-74,-64)`; chop to `[-64,-54)`; dressing to `[-54,-49)`. Pass 3:
nothing moves.

| step | start | end | B | O | C | slack | critical | wait | pass 1 start |
| ---- | ----- | --- | - | - | - | ----- | -------- | ---- | ------------ |
| flatbread.cook | -14 | -2 | 1 | - | 1 | 0 | yes | 2 | |
| flatbread.mix | -84 | -74 | - | - | 1 | 0 | yes | null | |
| flatbread.rise | -74 | -14 | - | - | - | 0 | yes | 0 | |
| hummus.blend | -74 | -64 | - | - | 1 | 0 | yes | null | -24 |
| salad.chop | -64 | -54 | - | - | 1 | 0 | yes | null | -34 |
| salad.dressing | -54 | -49 | - | - | 1 | 35 | no | null | -39 |
| salad.toss | -2 | 0 | - | - | 1 | 0 | yes | 0 | |

`spanMin 84`, `chainMin 82`, warnings `[]`. `salad.toss` keeps cook 1 from `salad.dressing`,
the prerequisite that ended last.

### H5. `PREP_AHEAD` × `NO_BURNER_KITCHEN` (right-justify at work)

New fixture `PREP_AHEAD` ("Bread, jelly and salad", decided here), dishes `bread`, `jelly`, `salad`:

| id | min | appliance | handsOn | after | hold | title |
| -- | --- | --------- | ------- | ----- | ---- | ----- |
| bread.shape | 5 | none | true | | 2 | Shape the flatbreads |
| bread.bake | 8 | oven | false | bread.shape | 15 | Bake the flatbreads |
| jelly.set | 60 | none | false | | null | Leave the jelly to set |
| salad.chop | 10 | none | true | | null | Chop the salad |
| salad.toss | 2 | none | true | salad.chop | 5 | Toss the salad |

Pass 1: toss (hold 5) `[-2,0)`; bake (hold 15) `[-8,0)`; jelly.set (keeps, last) `[-60,0)`; chop
(deadline −2) `[-12,-2)`; shape (deadline −8, cook busy until −12) `[-17,-12)`. `T0 = -60`. Pass 2
(order bread.shape, bread.bake, jelly.set, salad.chop, salad.toss; keeps: jelly.set, salad.chop):
jelly.set stays; chop moves to `[-60,-50)`. Pass 3 order bread.bake, salad.toss, bread.shape: shape
takes the freed cook time and moves to `[-13,-8)`, so its wait drops from 4 (over its hold of 2) to 0.

| step | start | end | B | O | C | slack | critical | wait | pass 1 start |
| ---- | ----- | --- | - | - | - | ----- | -------- | ---- | ------------ |
| bread.bake | -8 | 0 | - | 1 | - | 0 | yes | 0 | |
| bread.shape | -13 | -8 | - | - | 1 | 0 | yes | 0 | -17 |
| jelly.set | -60 | 0 | - | - | - | 0 | yes | null | |
| salad.chop | -60 | -50 | - | - | 1 | 37 | no | null | -12 |
| salad.toss | -2 | 0 | - | - | 1 | 0 | yes | 0 | |

`spanMin 60`, `chainMin 60`, warnings `[]`. The kitchen has 0 burners and no step needs one
(R1.8): no burner lanes.

### H6. Corner-case fixtures (decided here)

| fixture | steps (min, appliance, handsOn, after, hold) | kitchen | expected |
| ------- | ------------------------------------------- | ------- | -------- |
| `SOLO_BURNER` | `solo.sear` 30 burner true, hold 5 | `BURNER_ONLY_KITCHEN` | `[-30,0)`, B1 C1, slack 0, critical, wait 0; span 30, chain 30; no warnings |
| `SOLO_KEEPS` | `solo.chill` 30 none false, keeps | `BURNER_ONLY_KITCHEN` | `[-30,0)`, no lanes, slack 0, critical, wait null; span 30, chain 30 |
| `HANDS_FREE` | `stock.simmer` 60 burner false, hold 30; `jelly.set` 120 none false, keeps | `BURNER_ONLY_KITCHEN` and the same with `cooks: 6` | simmer `[-60,0)` B1; set `[-120,0)`; both slack 0; waits 0 and null; span 120, chain 120; the two results differ only in `kitchen` (R9.2) |
| `TWO_CHOPS` | `a.chop`, `b.chop`: 10 none true, hold 5 | `BARE_KITCHEN` | a `[-10,0)` C1 wait 0; b `[-20,-10)` C1 wait 10; both slack 0; span 20, chain 10; one `hold_exceeded` for `b.chop` (10 > 5); G4.2 tight |
| `TWO_CHOPS` | same | `BIG_KITCHEN` | both `[-10,0)`, a C1, b C2 (R9.3); waits 0; span 10; no warnings |
| `LONG_DAY` | dish `feast`, `feast.s01`..`feast.s80`: 480 none true, no `after`, hold 0 | `BARE_KITCHEN` | `feast.sNN` at `[-480·N, -480·(N-1))`, C1, slack 0, wait `480·(N-1)`; span 38400, chain 480; 79 `hold_exceeded` (s02..s80); finishes inside the default 5 s test timeout (R9.4) |
| `COLD_SAUCE` | `sauce.reduce` 10 burner false, hold 5; `sauce.whisk` 5 none true, after reduce, keeps; `fish.fry` 8 burner true, hold 2 | `BURNER_ONLY_KITCHEN` | fry `[-8,0)` B1 C1; whisk `[-13,-8)` C1 wait null; reduce `[-23,-13)` B1 wait 0; all slack 0; span 23, chain 15; no warnings (R9.5: the keeps step starts at its hot prerequisite's end) |

`LONG_DAY` gives 80 `long_hands_on` plan warnings; they do not block (R1.5). Titles of all new
`none` steps avoid the `appliance_mismatch` words.

## Test support

### Oracles (`test/support/oracles.ts`, added)

Written from `scheduler-guarantees.md`, not from this design's passes; plain loops over every
minute and every step; imports only types and schemas from `src/core/schema.js`.
`Starts = Record<string, number>`.

```ts
export function oracleCapacityViolations(plan: Plan, kitchen: Kitchen, starts: Starts):
  { minute: number; resource: 'burner' | 'oven' | 'cook'; count: number; limit: number }[];
export function oraclePrecedenceViolations(plan: Plan, starts: Starts): { stepId: string; prereq: string }[];
export function oracleCompletenessViolations(plan: Plan, steps: readonly ScheduledStep[]): string[];
export function oracleValid(plan: Plan, kitchen: Kitchen, starts: Starts): boolean; // G1–G3, ends <= 0
export function oracleWaits(plan: Plan, starts: Starts): Record<string, number | null>;
export function oracleHoldExceeded(plan: Plan, starts: Starts): { stepId: string; waitMin: number; holdMin: number }[];
export function oracleLaneViolations(plan: Plan, kitchen: Kitchen, steps: readonly ScheduledStep[]): string[];
export function oracleSlack(plan: Plan, kitchen: Kitchen, starts: Starts, stepId: string): number;
export function startsOf(steps: readonly ScheduledStep[]): Starts;
```

- Capacity: for every minute from the earliest start to the latest end, count active steps per
  resource by scanning all steps.
- Completeness: ids equal the plan's ids as multisets, `end - start === minutes`, integers,
  `end <= 0`.
- Lanes: for each step, the lane fields are present exactly per G6 and in range; for every pair
  of steps that overlap and share a lane of a resource, a violation.
- Slack: for `d = 1, 2, ...`, build delayed starts and test the delayed step's window minute by
  minute against per-minute counts of all other steps (computed once per step), plus `end + d <= 0`
  and every successor start `>= end + d`; return the last `d` that passed. Bounded by `-end`.
  Cost O(slack × minutes) per step, fine at default sizes.

### Generators (`test/support/arbitraries.ts`, added)

```ts
/** Counts >= the steps needing each resource; only for plans with at most 8 burner, 4 oven and
 *  6 hands-on steps (see C1). Each count drawn from needed..LIMITS max. */
export function arbUnlimitedKitchen(plan: Plan): fc.Arbitrary<Kitchen>;
/** arbPlan() mapped by fitUnlimited, then arbUnlimitedKitchen. */
export function arbUnlimitedPair(): fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }>;
/** arbPlanAndKitchen() with every step's handsOn set to false. */
export function arbHandsFreePair(): fc.Arbitrary<{ plan: Plan; kitchen: Kitchen }>;
```

`fitUnlimited(plan)`, in step-id order: after the 6th hands-on step, set `handsOn = false`; after
the 8th burner step and the 4th oven step, set `appliance = 'none'`. The result is still valid
(only fields that no error rule reads change; warnings may appear). No existing generator changes.

## Correctness properties

All use `fcParams()` (recipe-graph design) and live in `test/core/schedule.pbt.ts` (G ids) and
`test/core/passes.pbt.ts` (P-SC ids). Titles start with the id and a space. Scheduler property
files set a per-test timeout of 60 s through vitest's `it(title, fn, 60_000)` (decided here; it
changes no run count or input). "Both sizes" means `arbPlanAndKitchen()` and
`arbPlanAndKitchen({ large: true })`.

| id | statement | validates | generator |
| -- | --------- | --------- | --------- |
| G1 capacity | `schedule` is `ok`; `oracleCapacityViolations` is `[]` | R8.1, R3.4 | both sizes |
| G2 precedence | `oraclePrecedenceViolations` is `[]` | R8.1 | both sizes |
| G3 completeness | `oracleCompletenessViolations` is `[]`; steps sorted by id | R8.1, R2.4 | both sizes |
| G4.1 landing unlimited | every terminal step with `holdMin !== null` has `endMin === 0` | R8.1 | `arbUnlimitedPair()` |
| G4.2 landing bound | every terminal hot step has `endMin >= -(sum of minutes of the other terminal steps)` | R8.1 | both sizes |
| G4.3 holds reported | `warnings` as `(stepId, waitMin, holdMin)` equals `oracleHoldExceeded`; each `waitMin` equals `oracleWaits` (null iff keeps); every warning passes `IssueSchema` | R2.7, R7.3, R7.4 | both sizes |
| G5.1 hands-free | every step with `handsOn = false` has `lanes.cook === null`; on hands-free plans, `schedule(p, k)` and `schedule(p, { ...k, cooks: c })` differ only in `kitchen` for any `c` in 1..6 | R2.6, R9.2 | both sizes, `arbHandsFreePair()` |
| G5.2 span bound | `spanMin === -min(startMin)` and `<= sum of minutes` | R2.5 | both sizes |
| G5.3 chain bound | `chainMin === oracleLongestChain(plan)` and `spanMin >= chainMin` | R2.5 | both sizes |
| G6 lanes | `oracleLaneViolations` is `[]` | R6.1 | both sizes |
| G7.1 same input | two calls deep-equal; the arguments equal deep copies taken before the call | R1.7 | `arbPlanAndKitchen()` |
| G7.2 order-free | `schedule(arbShuffledPlan(p), k)` deep-equals `schedule(p, k)`; also for `arbBrokenPlan` inputs (equal `err`) | R8.3 | `arbPlanAndKitchen()`, graph-rule `arbBrokenPlan` cases |
| G8 slack | for every step: `oracleValid` with the step delayed by `slackMin` is true, by `slackMin + 1` false; `slackMin === oracleSlack`; `critical === (slackMin === 0)` | R7.1, R7.2 | `arbPlanAndKitchen()` |
| G9 as late as possible | for every step with `holdMin !== null`: `oracleLatestPosition` (every delay `1..deadline - end`, resources of the new minutes free) equals its current `startMin` | G9 (steering) | `arbPlanAndKitchen()`, both sizes |
| P-SC1 errors | for each rule in `ERROR_CODES`, `schedule` on `arbBrokenPlan(rule)` is `err` with kind `missing_appliance` iff the rule is `missing_appliance`, else `invalid_plan`, and its issues equal the error issues of `validatePlan` (+ `checkKitchen`) | R1.2, R1.4 | `arbBrokenPlan` |
| P-SC2 total | `schedule(fc.jsonValue() or arbPlanLikeValue(), fc.jsonValue() or arbKitchen())` never throws; invalid kitchens give `invalid_kitchen` when the plan is valid | R1.3, R1.6 | as stated |
| P-SC3 passes | after each of passes 1, 2, 3: `oracleValid`; pass 2 moves only keeps steps, never later, never before `T0`; pass 3 moves only hot steps, never earlier | R4.2, R4.3, R5.1, R5.2, R8.2 | both sizes |
| P-SC4 schema | `ScheduleSchema.parse(JSON.parse(JSON.stringify(s)))` strictly deep-equals `s`; `s.plan` equals `canonicalPlan(input)` | R2.1, R2.3 | `arbPlanAndKitchen()` |
| P-SC5 lane preference | for each step and resource: if, among its prerequisites using that resource sorted by end descending then id, one has a lane held by no other step active at the step's start, the step has the first such lane | R6.2 | both sizes |

G8 note: the steering property checks only `slack` and `slack + 1`; the definition says every
`d` in `1..k`. The `oracleSlack` equality checks the definition (see C2).

## Example tests (outline)

- `test/core/schedule.test.ts`: H1 to H6 exactly (all columns, warnings, span, chain); each
  `ScheduleError` kind once (`SUNDAY_ROAST` with a self-dependency → `invalid_plan` with the one
  `self_dependency` issue; `HOME_KITCHEN` with `cooks: 0` → `invalid_kitchen`; `SUNDAY_ROAST` with
  `burners: 0` → `missing_appliance` with the three recipe-graph issues); a plan with only
  warnings schedules; `schedule` on `null`, `{}` and `42` returns `invalid_plan`.
- `test/core/timeline.test.ts`: `resourcesOf` for all six appliance/handsOn pairs; `lastFull`,
  `firstFull`, `latestFit`, `earliestFit` on hand-made timelines (a jump over a busy block, a
  zero-length resource list, the floor throw).
- `test/core/passes.test.ts`: the "pass 1 start" columns of H1 to H5 from `backwardPass`; the
  pass 2 and pass 3 intermediate starts written in H1 to H5; `assignLanes` and `readout` on the
  H1 starts.
- `test/meta/oracles.test.ts` (added): each new oracle on the H1 and H3 tables gives the
  hand-worked slack, waits and warnings; hand-made broken schedules (two oven steps overlapping,
  a step starting before its prerequisite ends, a missing step, two overlapping steps on cook 1)
  each give exactly the expected violation.

## `test/meta/guarantees.test.ts`

`test/meta/guarantee-claims.ts`:

```ts
/** Guarantee families each spec proves. Later specs add an entry; none is removed. */
export const CLAIMS: Readonly<Record<string, readonly ('G' | 'R' | 'S' | 'D')[]>> = {
  'recipe-graph': ['S'],
  scheduler: ['G'],
};
```

The test, all as text, no imports from `src/`:

1. **Ids.** Read `.kiro/steering/scheduler-guarantees.md`; ids are the first capture of
   `^\s*-\s+(?:\*\*)?([A-Z][0-9]+(?:\.[0-9]+)*)(?=[\s.*])` per line. A parser check asserts the
   result contains G1, G2, G3, G4, G4.1, G4.2, G4.3, G5, G5.1, G5.2, G5.3, G6, G7, G7.1, G7.2,
   G8, R1 to R6, S1, S2, D1, D2 (a superset check, so appending ids never breaks it). The family
   is the leading letter. A parent is an id that another id extends by `.`.
2. **Titles.** Read every `test/**/*.pbt.ts` (`readdirSync` with `recursive: true`) and collect
   the first argument of each `it(` or `test(` call: a quoted or template literal, cut at its
   closing quote or at the first `${`. Guarantee properties use plain `it`/`test`, never
   `it.each` (decided here).
3. **Required families** = the families in `CLAIMS` ∪ the family of every known id that begins a
   title. So deleting a claim does not stop the check while the properties exist, and deleting
   properties is forbidden by `scheduler-guarantees.md`.
4. **Coverage.** For each required family, each leaf id needs a title equal to the id or
   starting with the id and a space; a parent is covered iff all its children are. The failure
   message lists the uncovered ids.
5. **No unknown ids.** A title starting with `[A-Z][0-9]+(\.[0-9]+)*` and a space must start with a
   known id (catches `G9 ...` or `G4.4 ...` typos). `P-RG3` and `P-SC1` do not match.
6. **Claims are real.** Every key of `CLAIMS` has `.kiro/specs/<key>/requirements.md`, and every
   family in it has at least one id in the steering file.

How later specs extend it: the rebuild spec adds `rebuild: ['R']` and its R1 to R6 properties;
the Dinnerfile spec adds `dinnerfile: ['D']`. A family is claimed whole, so a guarantee appended
later to a claimed family (say G9) fails the test until its property exists. Nothing in the test
lets a spec claim part of a family or exempt an id.

## Conflicts found

**C1. G4.1's premise cannot be met for larger plans.** G4.1 needs counts `>=` the number of steps
needing each resource, but `KitchenSchema` caps them at 8 burners, 4 ovens and 6 cooks, and
`schedule` re-checks the kitchen (R1.3). Counterexample: `arbPlan` gives a plan with 7 hands-on
steps; no valid `Kitchen` has `cooks >= 7`, so `schedule` returns `invalid_kitchen` for the
"unlimited" kitchen and G4.1 says nothing about that plan. The algorithm is not wrong (with
unlimited capacity pass 1 ends every terminal step at 0, see above); the guarantee is vacuous
there. Proposed resolution: keep G4.1's text and prove it on `arbUnlimitedPair()`, whose plans
fit the bounds; optionally reword the steering to say "(such a kitchen exists only for plans with
at most 8 burner, 4 oven and 6 hands-on steps)". Needs the user's decision; this spec does not
edit the steering file.

**C2. The G8 property is weaker than the G8 definition.** The definition takes the largest `k`
such that every delay in `1..k` keeps G1 to G3; the stated property checks only `k` and `k + 1`.
Counterexample to the property's strength: one cook, step `s` at `[-20,-19)`, another hands-on
step at `[-17,-16)`, `s` terminal. Delays 1 and 2 fit, 3 collides, 4 to 19 fit again, 20 ends after
0. True slack is 2; an implementation reporting 19 passes the endpoint check (19 fits, 20 breaks
G3) yet is wrong. Not a conflict with this algorithm, which computes the definition. Resolution
(in this spec): G8 also asserts `slackMin === oracleSlack`, which is the definition. No steering
change needed.

No other conflict: the "Why the guarantees hold" section checks G1 to G8 against the passes as
described.
