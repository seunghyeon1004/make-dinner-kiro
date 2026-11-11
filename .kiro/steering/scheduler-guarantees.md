---
inclusion: always
---

# Scheduler guarantees

These are the product's promise. Each id below is proved by at least one fast-check property
whose test title starts with the id (`it('G2 precedence: ...')`). An implementation change may
never weaken, delete, skip or narrow a property, its generator or its oracle to make it pass.
A failing property means the scheduler is wrong. If the guarantee itself is wrong, stop and
report; do not edit it. Ids are stable: never renumber, only append.

Scheduling, rebuild, Dinnerfile export/import and cooking mode never call a model. They live
in `src/core` (cooking mode calls `rebuild` from core) and have no network access at all.

## Notation

- Valid input: a `Plan` and `Kitchen` that pass the schema and every sanity error rule,
  including "the kitchen has the appliance each step needs".
- `start(s)`, `end(s) = start(s) + minutes(s)`: integers on the axis where serving is minute 0.
  A step is active at minute `t` when `start(s) <= t < end(s)`.
- `succ(s)`: steps listing `s` in `after`. Terminal: `succ(s)` is empty.
- `wait(s)` for finite `holdMin`: terminal: `0 - end(s)`; otherwise
  `max(start(u) for u in succ(s)) - end(s)` (latest user, decided here).
- `span = 0 - min(start(s))`. `chain` = the largest sum of `minutes` along any dependency path.
- Oracle: an independent recomputation in `test/support/oracles.ts`, never imported from `src/`.

## Schedule guarantees: `schedule(plan, kitchen)` on valid input returns `ok`

- **G1 capacity.** For every minute `t`: active steps with `appliance = 'burner'` <= `burners`;
  with `'oven'` <= `ovens`; with `handsOn = true` <= `cooks`.
- **G2 precedence.** For every step `s` and every `p` in `after(s)`: `start(s) >= end(p)`.
- **G3 completeness.** Every input step appears exactly once in the output, no other step
  appears, `end - start = minutes`, both are integers, and `end(s) <= 0` for every `s`.
- **G4 landing.**
  - G4.1 With unlimited resources (counts >= the number of steps needing each), every terminal
    step with `holdMin !== null` has `end = 0`. The kitchen schema caps the counts at 8, 4 and
    6, so this speaks only about plans small enough to have such a kitchen (conflict C1 found
    by the scheduler spec; wording added by hand).
  - G4.2 With any kitchen, every terminal step with `holdMin !== null` has
    `end >= -(sum of minutes of all other terminal steps)`.
  - G4.3 Every step with `wait > holdMin` has exactly one `hold_exceeded` warning carrying
    its id, wait and hold; every `hold_exceeded` warning matches the oracle.
- **G5 overlap.**
  - G5.1 A step with `handsOn = false` has no cook lane and is never counted against `cooks`.
  - G5.2 `span <= sum of minutes of all steps`.
  - G5.3 `span >= chain`.
- **G6 lanes.** Each step has a lane for its appliance (none for `'none'`) and a cook lane iff
  `handsOn`. Lane numbers are in `1..count` of that resource. Two steps active in the same
  minute never share a lane of the same resource.
- **G7 determinism.**
  - G7.1 Two calls on the same input give deep-equal output.
  - G7.2 Permuting `steps`, `dishes`, and any `after` list (decided here) gives deep-equal
    output. Output step arrays are sorted by step id (decided here).
- **G8 slack is honest.** `slack(s)` is the largest `k >= 0` such that delaying `s` alone by
  every `d` in `1..k` (lanes ignored, all else fixed) keeps G1 to G3 true. Property: delaying
  by `slack(s)` keeps G1 to G3 true; delaying by `slack(s) + 1` breaks at least one of them
  (an end after minute 0 breaks G3). `critical(s)` iff `slack(s) = 0`. Holds are not part of slack.

- **G9 as late as possible.** Every step whose result does not keep sits at its latest valid
  position: with everything else fixed, no delay `d >= 1` up to its deadline keeps G1 to G3
  true. (Added by hand on 2026-11-11: the scheduler implementation session ran a mutation
  check, removed the right-justify pass, and no property failed. This is the property that
  pass exists to make true.)

## Algorithm note (reviewed by hand, 2026-11-11)

Kiro's first draft resolved a conflict between the brief's prep-forward pass and G4.1 by never
moving terminal steps. That keeps a made-ahead dish (hummus, a dressing, a cold dessert) at the
last minute, competing for the cook with the hot dishes. Resolution chosen instead: prep-forward
moves every step whose result keeps, terminal or not, and G4.1 and G4.2 speak only about
terminal steps whose result does not keep. Right-justify moves only steps whose result does not
keep.

## Rebuild guarantees: `rebuild(schedule, progress, now)`

Inputs (decided here): the previous schedule; `progress` per step: `done {startMin, endMin}`,
`running {startMin, extraMin}`, or pending (absent); `now` an integer on the previous axis.
A running step's expected end is `max(startMin + minutes + extraMin, now)`. Output: new starts
on the same axis, the new serving minute `S' >= 0`, and a diff.

- **R1 valid.** Against serving minute `S'`: G1 holds at every minute `t >= now` where the
  pinned steps alone are within capacity, and no pending step is placed in a minute where they
  are not; G2 holds for every edge whose successor is pending; G3 holds with pending steps
  lasting exactly `minutes`, pinned steps keeping their actual or expected times, and every end
  `<= S'`.
- **R2 pinned.** Done and running steps keep their start (done steps also their end). Every
  pending step has `start >= now`.
- **R3 never earlier.** Every pending step's new start `>=` its previous start. (Pinned steps
  are covered by R2: a cook may start a step early, and its actual start is kept; decided here.)
- **R4 no slip, no change.** If every done step ran exactly as planned, every running step
  started as planned with `extraMin = 0` and planned end `>= now`, and every pending step's
  planned start `>= now`, then every start is unchanged, `S' = S_prev` and the diff lists no
  moves.
- **R5 serving time.** `S' = max(S_prev, latest end of any step after forward repair)`; it
  never moves earlier. `S_prev` is the previous schedule's serving minute (0 for a schedule
  that has never been rebuilt).
- **R6 honest diff.** `moved` lists exactly the steps whose start changed, each with correct
  `from` and `to`; `unchanged` lists exactly the rest; `servingShift = S' - S_prev`.

Wording of R1, R4, R5 and R6 changed by hand on 2026-11-11 after the rebuild spec found, with
counterexamples, that the first wording was false for a second rebuild (its C1), for pinned
steps that already exceed capacity (C2) and for steps done out of order (C3). See
`.kiro/specs/rebuild/design.md`, "Conflicts found".

## Other properties (decided here)

- **S1 total.** `parsePlan` and `validatePlan` on any JSON value return issues or a plan; they
  never throw. (`checkPlan` takes a typed `Plan`; reworded by hand after the recipe-graph spec.)
- **S2 sound.** Every sanity error rule fires on a plan built to break it, and no error fires
  on output of the valid-plan generator.
- **D1 round trip.** `fromDinnerfile(toDinnerfile(plan))` deep-equals `plan` (canonical order).
- **D2 make agrees.** For sample and generated plans, `make -n -f Dinnerfile dinner` prints
  every step once, in an order satisfying G2. Requires GNU Make; it fails, not skips, without it.
