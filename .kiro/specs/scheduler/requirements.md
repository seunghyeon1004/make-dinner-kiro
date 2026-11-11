# Requirements: scheduler

## Why

`schedule(plan, kitchen)` is the product's promise: one valid schedule in which every dish
whose result does not keep lands at serving time, stated in checkable terms (G1 to G8 in
`scheduler-guarantees.md`). The plan screen, cooking mode, the rebuild, the Dinnerfile and the
MCP server all read its output, so its type, its errors and its tie-breaking are fixed here.

## Scope

In `src/core` (pure, see `tech.md` and `structure.md`):

- `src/core/schedule.ts`: `schedule(plan, kitchen)`, which validates its inputs and runs the passes.
- `src/core/passes/`: `backward.ts`, `prep-forward.ts`, `right-justify.ts`, `lanes.ts`, `readout.ts`.
- `src/core/timeline.ts`: resource usage per minute, shared by the passes.
- `src/core/schema.ts` (extended): `StepLanesSchema`, `ScheduledStepSchema`, `ScheduleSchema`
  and the `hold_exceeded` issue variant.

In `test/`: scheduler oracles in `test/support/oracles.ts`, new generators and fixtures, one
property per guarantee id G1 to G8 (each sub-id its own), hand-worked example tests, and
`test/meta/guarantees.test.ts`.

This spec builds on the recipe-graph spec and does not redefine anything from it: `Plan`,
`Kitchen`, `Issue`, `LIMITS`, `compareIds`, `canonicalPlan`, `successors`, `terminalSteps`,
`topologicalOrder`, `longestChainMinutes`, `validatePlan`, `parseKitchen`, `checkKitchen`,
`sortIssues`, the generators and the fixtures. Requirement ids below are local to this spec;
references to the other spec are written `recipe-graph R8.1`. Terms are the glossary in
`product.md`. "Keeps" means `holdMin === null`; "hot" means `holdMin !== null` (decided here,
as shorthand in this spec only; code uses `keeps`).

## Requirements

### R1. Entry point and input checks

**User story:** As every caller of the scheduler (the web app, the rebuild, the MCP server), I
want one function that checks its own inputs, so that a bad plan or kitchen from any source
gives a clear error and never a wrong schedule or a hang.

- R1.1 THE SYSTEM SHALL export `schedule(plan: Plan, kitchen: Kitchen): Result<Schedule, ScheduleError>`
  from `src/core/schedule.ts` and from `src/core/index.ts`.
- R1.2 WHEN `schedule` is called, THE SYSTEM SHALL run `validatePlan(plan)` itself, whatever
  the caller already checked; IF it reports any error, THEN THE SYSTEM SHALL return
  `err({ kind: 'invalid_plan', issues })` with exactly the error issues, in `sortIssues` order.
- R1.3 IF the plan has no error AND `parseKitchen(kitchen)` fails, THEN THE SYSTEM SHALL return
  `err({ kind: 'invalid_kitchen', issues })` with its issues.
- R1.4 IF plan and kitchen pass AND `checkKitchen(plan, kitchen)` reports any error, THEN THE
  SYSTEM SHALL return `err({ kind: 'missing_appliance', issues })` with those issues.
- R1.5 WHEN the plan has only warnings, THE SYSTEM SHALL schedule it; plan warnings do not
  appear in the schedule (decided here: `Schedule.warnings` holds scheduler findings only).
- R1.6 WHEN `schedule` receives any values at all (including values that do not match the
  TypeScript types), THE SYSTEM SHALL return `ok` or `err` and SHALL NOT throw (decided here).
- R1.7 THE SYSTEM SHALL NOT change its `plan` or `kitchen` arguments.
- R1.8 WHEN a resource has count 0 and no step needs it, THE SYSTEM SHALL schedule the plan
  and give no step a lane of that resource.

### R2. The schedule

**User story:** As the plan screen, cooking mode and the rebuild, I want one exact schedule
type, so that I can show, persist and rebuild it without recomputing anything.

- R2.1 THE SYSTEM SHALL define `StepLanesSchema`, `ScheduledStepSchema` and `ScheduleSchema`
  in `src/core/schema.ts`, with types `StepLanes`, `ScheduledStep` and `Schedule` inferred by
  `z.infer`, fields and bounds as in the design.
- R2.2 THE SYSTEM SHALL give each scheduled step `id`, `startMin`, `endMin`, `lanes`,
  `slackMin`, `critical` and `waitMin`, and the schedule `plan`, `kitchen`, `steps`, `spanMin`,
  `chainMin` and `warnings`.
- R2.3 THE SYSTEM SHALL set `Schedule.plan` to `canonicalPlan` of the validated plan and
  `Schedule.kitchen` to the validated kitchen (the `plan` field decided here: the rebuild takes
  only the schedule and needs each step's minutes, resources and prerequisites).
- R2.4 THE SYSTEM SHALL list exactly one scheduled step per plan step, sorted by id with
  `compareIds` (G7.2).
- R2.5 THE SYSTEM SHALL set `spanMin = -min(startMin)` and `chainMin = longestChainMinutes(plan)`.
- R2.6 THE SYSTEM SHALL set `lanes.burner` to a number iff the step's appliance is `burner`,
  `lanes.oven` iff it is `oven`, and `lanes.cook` iff `handsOn`; otherwise `null`.
- R2.7 THE SYSTEM SHALL set `waitMin` to `null` for a step whose result keeps and to its wait
  (`scheduler-guarantees.md`, Notation) otherwise (decided here).
- R2.8 THE SYSTEM SHALL add the warning code `hold_exceeded` to `IssueSchema` with `stepId`,
  `waitMin` and `holdMin`, appended after the recipe-graph codes, with the message in the design.

### R3. Backward pass

**User story:** As a cook, I want every hot dish placed as close to serving as the kitchen
allows, so that food waits as little as possible.

- R3.1 THE SYSTEM SHALL place steps one at a time; a step is eligible once every successor is
  placed, so the terminal steps are eligible first.
- R3.2 THE SYSTEM SHALL give a terminal step the deadline 0 and any other step the deadline
  `min(startMin(u))` over its successors `u` (the earliest successor defines the deadline).
- R3.3 WHEN choosing the next eligible step, THE SYSTEM SHALL take the latest deadline; among
  equal deadlines of terminal steps, the smallest `holdMin` with `null` last; then the
  smallest id.
- R3.4 THE SYSTEM SHALL place the chosen step at the latest end at or before its deadline at
  which each resource it uses has a free unit in every minute of its duration.
- R3.5 THE SYSTEM SHALL count a step against one burner, one oven or nothing by its appliance,
  plus one cook iff `handsOn`, for its whole duration.
- R3.6 THE SYSTEM SHALL treat a prerequisite in another dish exactly like one in the same
  dish: dishes play no part in scheduling.

### R4. Prep-forward pass

**User story:** As a cook, I want mise en place done first, so that it is out of the way and
gives me room later.

- R4.1 THE SYSTEM SHALL let `T0` be the earliest start after the backward pass.
- R4.2 THE SYSTEM SHALL move every step whose result keeps, terminal or not, in
  `topologicalOrder`, to the earliest start at or after both `T0` and the latest end of its
  prerequisites at which its resources are free, every other step staying where it is.
- R4.3 THE SYSTEM SHALL NOT move any step whose result does not keep in this pass, and SHALL
  never move a step later in it.

### R5. Right-justify pass

**User story:** As a cook, I want hot food to take back the room the prep freed, so that it
waits less.

- R5.1 THE SYSTEM SHALL move every step whose result does not keep, ordered by `endMin` after
  the prep-forward pass, latest first, ties by smallest id, to the latest end at or before its
  current deadline (R3.2, with the successors' current starts) at which its resources are free.
- R5.2 THE SYSTEM SHALL NOT move any step whose result keeps in this pass, and SHALL never move
  a step earlier in it.

### R6. Lanes

**User story:** As a cook reading the timeline, I want each step on a numbered burner, oven and
cook, and a pan to stay on its burner, so that I know where things are.

- R6.1 THE SYSTEM SHALL give each step a lane number in `1..count` of each resource it uses,
  never the lane of another step of that resource active in the same minute.
- R6.2 WHEN one of the step's prerequisites using the same resource holds a lane that is free
  for the step, THE SYSTEM SHALL use it, preferring the prerequisite that ended last, ties by
  smallest id; otherwise the smallest free lane.

### R7. Readout

**User story:** As a cook, I want to see how much room each step has, which steps are critical
and which hot results wait too long, so that I know where a slip hurts.

- R7.1 THE SYSTEM SHALL set `slackMin` to the largest `k >= 0` such that delaying the step
  alone by every `d` in `1..k` keeps G1 to G3 true, lanes ignored and holds not considered (G8).
- R7.2 THE SYSTEM SHALL set `critical` to `slackMin === 0`.
- R7.3 WHEN a step's `waitMin > holdMin`, THE SYSTEM SHALL put exactly one `hold_exceeded`
  warning for it in `Schedule.warnings`, with its id, wait and hold; it SHALL put no other
  warning there; the list SHALL be in `sortIssues` order.
- R7.4 WHEN a step has several successors, THE SYSTEM SHALL measure its wait to the latest
  successor start (the result waits until its last use; `scheduler-guarantees.md`, Notation),
  while its deadline comes from the earliest (R3.2).

### R8. Guarantees

**User story:** As the product, I want every promise in `scheduler-guarantees.md` true for
every valid plan and kitchen, so that the schedule can be trusted.

- R8.1 WHEN `schedule` gets valid input, THE SYSTEM SHALL return `ok` and satisfy G1, G2, G3,
  G4.1, G4.2, G4.3, G5.1, G5.2, G5.3, G6, G7.1, G7.2 and G8 as worded in
  `scheduler-guarantees.md`.
- R8.2 THE SYSTEM SHALL satisfy G1, G2 and G3 after each pass, not only at the end (decided
  here, so a failing property points at the pass that broke it).
- R8.3 WHEN `schedule` is called on any permutation of `steps`, `dishes` and each `after`
  list, THE SYSTEM SHALL return deep-equal results, errors included.

### R9. Corner cases

- R9.1 WHEN the plan has one step, THE SYSTEM SHALL end it at minute 0, with `spanMin =
  chainMin = minutes`, `slackMin = 0` and `critical = true`, whether or not its result keeps.
- R9.2 WHEN every step is hands-free, THE SYSTEM SHALL give no step a cook lane, and the cook
  count SHALL NOT change any start or lane.
- R9.3 WHEN there are more cooks (or burners, ovens) than steps using them, THE SYSTEM SHALL
  still use the smallest free lane numbers, so lane numbers never exceed the number of steps
  using that resource at once.
- R9.4 WHEN steps last 480 minutes and the plan has 80 of them, THE SYSTEM SHALL schedule it
  with integer minutes down to `-38400` and finish within the default vitest timeout.
- R9.5 WHEN a step whose result keeps has a prerequisite whose result does not keep, THE SYSTEM
  SHALL start it no earlier than that prerequisite's end, and measure the prerequisite's wait
  against it like any other successor.
- R9.6 WHEN a step whose result keeps is terminal, THE SYSTEM SHALL move it in the prep-forward
  pass like any other keeps step, give it `waitMin = null`, and never report `hold_exceeded`
  for it.
- R9.7 WHEN two eligible steps tie on every key, THE SYSTEM SHALL break the tie by id, so no
  choice depends on input order or on `Map` or `Set` iteration of unsorted data.

### R10. Test support

- R10.1 `test/support/oracles.ts` SHALL add independent checkers for capacity per minute,
  precedence, completeness, waits and `hold_exceeded`, lanes, and slack by trial, importing
  from `src/core` only types and schemas and nothing from `schedule.ts`, `passes/` or
  `timeline.ts`.
- R10.2 `test/support/arbitraries.ts` SHALL add `arbUnlimitedKitchen(plan)`,
  `arbUnlimitedPair()` and `arbHandsFreePair()` as in the design, without narrowing any
  existing generator.
- R10.3 `test/support/fixtures.ts` SHALL add the plans and kitchens listed in the design, each
  with its hand-worked expected schedule in a comment.
- R10.4 THE SYSTEM SHALL have, for each of G1, G2, G3, G4.1, G4.2, G4.3, G5.1, G5.2, G5.3, G6,
  G7.1, G7.2 and G8, its own fast-check property whose title starts with that id and a space.
- R10.5 `test/meta/guarantees.test.ts` SHALL read `scheduler-guarantees.md` and fail if any id
  of a claimed family has no property, as defined in the design, in a way later specs extend
  by adding claims and cannot weaken by removing them.
- R10.6 THE SYSTEM SHALL reproduce exactly every hand-worked schedule in the design (start,
  end, lanes, slack, wait, warnings, span, chain) in example tests.

## Non-functional requirements

- N1 Purity: everything in this spec follows the `src/core` rules in `tech.md`; the scheduler
  never calls a model, reads a clock, uses randomness or does I/O.
- N2 Termination: every loop has a bound fixed before it starts; reaching the bound is a bug
  and throws (`tech.md`: a throw from core means a bug). No recursion.
- N3 Cost: on 80 steps of 480 minutes `schedule` does at most a few million minute checks
  (worst case stated in the design); the obvious loop is preferred to a clever one.
- N4 Public surface: other packages reach `schedule`, the schedule schemas and types and
  `ScheduleError` through `src/core/index.ts` only; passes and timeline are internal.
- N5 No optimality claim: no identifier, message or comment calls a schedule optimal or
  shortest.
- N6 Glossary: identifiers, codes and messages use the glossary words in `product.md`.

## Out of scope

- Rebuild (`rebuild.ts`, R1 to R6), Dinnerfile, the UI, the MCP tool wrappers.
- Choosing the serving clock time: the axis stays relative, minute 0 is serving.
- Better-than-valid schedules (search, local improvement, swapping terminal order).
- Plan warnings in `Schedule.warnings` (R1.5).
