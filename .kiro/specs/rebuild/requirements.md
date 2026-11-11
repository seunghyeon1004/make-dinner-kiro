# Requirements: rebuild

## Why

During cooking the clock is real and things slip. `rebuild(schedule, progress, now)` is the
incremental build: done and running steps are pinned at what really happened, and only the
pending steps that have to move are moved. Cooking mode, the plan screen and the MCP
`rebuild_plan` tool read its output, and the cook may slip again, so the output of one rebuild
must be valid input to the next. The promises are R1 to R6 in `scheduler-guarantees.md`.

## Scope

In `src/core`: `rebuild.ts`, `passes/forward-repair.ts`, `passes/re-align.ts`, and additions to
`passes/lanes.ts`, `passes/readout.ts`, `timeline.ts`, `schema.ts`; in `test/`: oracles,
generators, fixtures, examples, R1 to R6 and P-RB properties, the `rebuild: ['R']` claim. It
redefines nothing from the recipe-graph and scheduler specs (written `scheduler R7.1`).
Requirement ids are `RQn.m` (decided here) so they cannot be confused with guarantees R1 to R6.

Terms (glossary in `product.md`): **pinned** = done or running in `progress`; **pending** =
absent from it; **prev start** = the step's `startMin` in the input schedule; `S_prev` = the
input's serving minute (0 for a `schedule` output); `S'` = the new one; "hot", "keeps" as in
the scheduler spec.

## Requirements

### RQ1. Entry point and input checks

**User story:** As cooking mode and the MCP server, I want one function that checks what it
is given, so that a corrupted stored schedule or a UI bug gives a typed error, never a throw.

- RQ1.1 THE SYSTEM SHALL export `rebuild(schedule, progress, now): Result<Rebuilt, RebuildError>`
  from `src/core/rebuild.ts` and `src/core/index.ts`, accepting a `Schedule` or a `RebuiltSchedule`.
- RQ1.2 THE SYSTEM SHALL run the design's checks in order and return the first failure alone:
  `invalid_schedule` (shape, plan, kitchen, step ids); `invalid_now` (`now` not an integer in
  `AXIS_MIN..REBUILD_LIMITS.servingMax`); `invalid_progress`; `unknown_step` (smallest unknown
  id); then per pinned id `done_ends_before_start`, `done_after_now` (done `endMin > now`),
  `running_starts_after_now`; last `serving_out_of_range`.
- RQ1.3 WHEN `rebuild` receives any values at all, THE SYSTEM SHALL return `ok` or `err`, SHALL
  NOT throw, SHALL NOT change its arguments, and SHALL NOT depend on the order of `progress`
  keys or of the input's arrays.

### RQ2. The cook's facts

**User story:** As a cook, I want the app to believe what I did, so that it plans the rest of
dinner around reality instead of arguing with me.

- RQ2.1 THE SYSTEM SHALL NOT return an error because pinned steps break precedence (a step
  done before its prerequisite) or capacity (two pinned steps on one oven), in the past or
  after `now` (decided here: the cook is always right about what already happened).
- RQ2.2 THE SYSTEM SHALL give a done step the interval `[startMin, endMin)`, which may be
  shorter or longer than `minutes` or empty, and a running step
  `[startMin, max(startMin + minutes + extraMin, now))`: extra minutes extend it, and an
  overrun without them ends at `now`.
- RQ2.3 WHEN a pending step has a prerequisite that is pending, running or done, in any order,
  THE SYSTEM SHALL plan it to start at or after that prerequisite's new, expected or actual end.
- RQ2.4 WHEN a pending step has only pinned successors, THE SYSTEM SHALL still plan it and SHALL
  NOT constrain it by those successors' starts.

### RQ3. Types and the axis

**User story:** As every consumer of a schedule, I want a rebuilt schedule in the same shape and
on the same axis as the original, so that clock times never shift under the cook.

- RQ3.1 THE SYSTEM SHALL define in `src/core/schema.ts`, as in the design: `REBUILD_LIMITS`,
  the exported `AXIS_MIN`, `ProgressEntrySchema`, `ProgressSchema`, `RebuiltStepSchema`,
  `RebuiltScheduleSchema`, `StepMoveSchema`, `RebuildDiffSchema`, `RebuiltSchema`, and their
  `z.infer` types; `ScheduleSchema` and `ScheduledStepSchema` stay unchanged.
- RQ3.2 THE SYSTEM SHALL keep minute 0 at the originally planned serving time across every
  rebuild and carry the serving minute as `servingMin`, default 0, so every `Schedule` parses
  as a `RebuiltSchedule`.
- RQ3.3 THE SYSTEM SHALL give pinned steps their RQ2.2 intervals and pending steps exactly
  `minutes`; `spanMin = servingMin - min(startMin)`, `chainMin = longestChainMinutes(plan)`,
  `plan = canonicalPlan` of the input plan.

### RQ4. Forward repair

- RQ4.1 THE SYSTEM SHALL place pending steps one at a time; a pending step is ready when every
  pending prerequisite is placed; among ready steps it SHALL take the smallest prev start, then
  the smallest id (decided here; the same as prev-start order whenever the input satisfies G2
  among pending steps, C4).
- RQ4.2 THE SYSTEM SHALL place it at the earliest start at or after `max(prev start, now, end of
  every prerequisite)` at which each resource it uses has a free unit in every minute, counting
  pinned steps from `now` on and the pending steps already placed. So a step the cook is behind
  on starts at or after `now`, and no step starts before its prev start.

### RQ5. The serving minute

- RQ5.1 THE SYSTEM SHALL set `S' = max(S_prev, latest endMin of any step after forward repair)`
  (C1, C3, C5), also when every step is done and nothing is planned.
- RQ5.2 IF `S' > REBUILD_LIMITS.servingMax`, THEN THE SYSTEM SHALL return
  `serving_out_of_range` with `servingMin = S'`.

### RQ6. Re-align

- RQ6.1 WHEN `S' > S_prev`, THE SYSTEM SHALL move every pending hot step, ordered by end after
  forward repair, latest first, ties by smallest id, to the latest end at or before
  `min(S', starts of its pending successors)` at which its resources are free.
- RQ6.2 WHEN `S' === S_prev`, THE SYSTEM SHALL NOT re-align (decided here: steps the slip does
  not touch stay exactly where they were, and R4 needs it).
- RQ6.3 THE SYSTEM SHALL NOT move pinned or keeps steps in re-align, nor any step earlier.

### RQ7. Lanes

- RQ7.1 THE SYSTEM SHALL give each step a lane for each resource it uses, in `1..count`,
  preferring its lane in the input schedule, then its prerequisites' lanes (latest end first,
  ties by id), then the smallest free lane; a lane is free if no overlapping step already
  assigned holds it.
- RQ7.2 WHEN no lane is free (only for a pinned step whose resource is over capacity at its
  start), THE SYSTEM SHALL give it its input lane if in range, else lane 1, without an error.

### RQ8. Readout against `S'`

- RQ8.1 THE SYSTEM SHALL set a pending step's `slackMin` to the largest `k >= 0` such that
  delaying it alone by every `d` in `1..k` keeps it fitting from `now` on, before every pending
  successor's start and ending at or before `S'`; `critical = slackMin === 0`.
- RQ8.2 THE SYSTEM SHALL set `slackMin = 0` and `critical = false` for pinned steps (decided here).
- RQ8.3 THE SYSTEM SHALL compute `waitMin` from the final intervals: keeps `null`; terminal
  `S' - end`; otherwise `max(0, latest successor start - end)`.
- RQ8.4 THE SYSTEM SHALL report one `hold_exceeded` warning per step, pinned or pending, with
  `waitMin > holdMin`, worded by `holdExceededMessage`, in `sortIssues` order, and no other.

### RQ9. Diff and repeatability

- RQ9.1 THE SYSTEM SHALL list in `moved`, sorted by id, exactly the steps whose `startMin`
  differs from their prev start, pinned steps started early or late included, with
  `fromStartMin` and `toStartMin`, and every other id in `unchanged`, sorted.
- RQ9.2 THE SYSTEM SHALL set `servingShiftMin = S' - S_prev`.
- RQ9.3 THE SYSTEM SHALL return a `RebuiltSchedule` that `rebuild` accepts as input; called on
  it with the same `progress` and `now`, `rebuild` SHALL return the same schedule and an empty
  diff (P-RB1); WHEN the cook follows it exactly up to a later `now`, no start changes and
  `servingMin` stays (P-RB2).

### RQ10. Guarantees

- RQ10.1 WHEN the input is a `schedule` output and the run respects the kitchen's capacity, THE
  SYSTEM SHALL satisfy R1 to R6 as worded in `scheduler-guarantees.md`; for any valid input, the
  forms with `S_prev` in place of 0 and the pinned-capacity reading of C2 (P-RB properties).

### RQ11. Test support

- RQ11.1 `test/support/` SHALL add the rebuild oracles (types and schemas only from `src/core`),
  `arbScheduled`, `arbNow`, `arbProgress`, `followPlan`, `arbOnPlan` (no generator narrowed), and
  the fixtures `H1_SCHEDULE`, `H3_SCHEDULE` and the progress objects, each with its expected
  rebuild in a comment, as in the design.
- RQ11.2 THE SYSTEM SHALL have one property per R1 to R6, titled with the id and a space, and the
  P-RB properties; `CLAIMS` SHALL gain `rebuild: ['R']`; example tests SHALL reproduce exactly
  every hand-worked rebuild of the design.

## Non-functional requirements

- N1 Purity, termination and cost as in `tech.md` and scheduler N1 to N3. N2 Public surface:
  `rebuild`, `RebuildError`, the new schemas and types via `src/core/index.ts`. N3 No optimality
  claim; glossary words only.

## Out of scope

Cooking-mode UI, timers, persistence and the MCP wrapper (later specs read RQ3); pulling steps
earlier when something finishes early (R3 forbids it); re-running the backward pass mid-cook.
