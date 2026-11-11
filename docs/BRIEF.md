# Make Dinner: project brief

Written by hand before any Kiro session. It is the input Kiro's steering files and specs
are derived from. Where a steering file or spec disagrees with this brief, the steering
file or spec wins once it has been reviewed, and this file is updated.

## One line

A build system stitched onto a kitchen: paste the recipes for several dishes and get one
schedule in which every dish lands hot at the same time.

## The problem

Cooking one dish from a recipe is easy. Cooking four at once is a scheduling problem that
recipes do not solve: each one is written as if you had the whole stove, the whole oven and
both hands to yourself. People solve it in their heads, badly, while something burns. The
usual result is that the potatoes are done twenty minutes before the roast.

Build systems solved this exact problem decades ago: targets, prerequisites, a dependency
graph, a `-j` limit on parallel jobs, incremental rebuilds when one input changes.

## The chimera

Three technologies that do not belong together, each doing a real job:

1. **A language model** reads messy recipe prose into a structured step graph. That is all
   it does. Its output is checked against a schema and against sanity rules, and the person
   can correct every step before anything is scheduled.
2. **Build-system machinery** does the planning, deterministically and with no model calls:
   a dependency graph, resource-constrained parallel scheduling (burners, ovens and cooks
   are the kitchen's `-j`), backward scheduling from the serving time, slack and critical
   steps, and incremental rebuilds when something slips.
3. **A kitchen timer app** for a phone propped on the counter: a Gantt-style timeline per
   resource and a "what to do right now" cooking mode with timers, usable with wet hands.

The seam is visible and honest. Every plan can be exported as a `Dinnerfile`: a real
Makefile that GNU Make accepts (`make -n -f Dinnerfile dinner` prints the steps in a valid
order) and that the app can read back without the model.

## Who it is for

A home cook making two to six dishes for one sitting: a Sunday roast, a holiday dinner, a
dinner party. Not a restaurant. One to three cooks, a normal domestic stove and oven.

## Domain model

Times are whole minutes. The scheduler works on a relative axis where the planned serving
time is minute 0 and everything before it is negative; the UI maps that to clock times.

```ts
type Appliance = 'burner' | 'oven' | 'none';

interface Step {
  id: string; // unique in the plan, a slug: "chicken.roast"
  dish: string; // id of the dish it belongs to
  title: string; // short imperative: "Roast the chicken"
  detail?: string; // optional longer instruction
  minutes: number; // whole minutes, 1..480
  appliance: Appliance; // needs one burner, one oven, or neither, for its whole duration
  handsOn: boolean; // true: needs one cook for its whole duration. false: runs by itself
  after: string[]; // ids of steps that must be finished before this one starts
  holdMin: number | null; // how long the result can wait before the step that uses it
  // starts (or, for a dish's last step, before serving). null means it keeps: chopped
  // onions, a made dressing, a cold dessert.
}

interface Dish {
  id: string;
  name: string;
}

interface Plan {
  title: string;
  dishes: Dish[];
  steps: Step[];
}

interface Kitchen {
  burners: number; // 0..8
  ovens: number; // 0..4
  cooks: number; // 1..6
}
```

The kinds of step this gives:

| appliance | handsOn | example                    |
| --------- | ------- | -------------------------- |
| burner    | true    | sear, stir a risotto       |
| burner    | false   | simmer a stock             |
| oven      | false   | roast                      |
| none      | true    | chop, plate                |
| none      | false   | rest the meat, chill, rise |

A step with no successors is a dish's **terminal** step. Its `holdMin` is how long the
finished dish can wait for the table.

## Sanity rules (deterministic, applied to model output and to hand edits alike)

Errors (the plan cannot be scheduled until fixed): unknown step id in `after`; a step
depending on itself; a dependency cycle (report the cycle path); duplicate ids; a step whose
dish does not exist; a dish with no steps; minutes outside 1..480; an empty plan; more than
12 dishes or 80 steps; a step needing an appliance the kitchen has none of (this one depends
on the kitchen settings, so it is checked at scheduling time).

Warnings (shown, schedulable): the title or detail mentions the oven or a burner verb
(roast, bake, simmer, boil, fry, sear, sauté) but `appliance` is `none`; a hands-on step
longer than 45 minutes; a hands-free step with no appliance shorter than 2 minutes.

## The scheduler

Resource-constrained project scheduling is NP-hard. The scheduler does not claim an optimal
plan. It claims a **valid** one and states exactly what valid means.

### Algorithm

1. **Backward pass** (serial schedule generation on the reversed graph). A step is eligible
   once all its successors are placed. Terminal steps go first, shortest `holdMin` first
   (`null` last). After that, eligible steps are taken latest-deadline first (deadline = the
   earliest start among its successors), ties by id. Each step is placed as late as
   possible: the latest end time that is at or before its deadline (0 for terminal steps)
   at which its appliance and, if hands-on, a cook are free for its whole duration.
2. **Prep-forward pass.** Let T0 be the earliest start after pass 1. Every step whose
   result keeps (`holdMin === null`) is moved, in dependency order, to the earliest start
   at or after T0 and after its prerequisites end where its resources are free, everything
   else staying fixed. This is mise en place: chopping happens first, not at the last
   second, and it gives those steps slack.
3. **Right-justify pass.** Every step whose result does not keep is moved, latest end
   first, as late as its deadline and resources allow, everything else staying fixed. This
   takes back the room freed by pass 2 so hot food waits as little as possible.
4. **Lanes.** Each placed step gets a numbered unit of each resource it uses (burner 1..n,
   oven 1..n, cook 1..n), preferring the unit its direct prerequisite used.
5. **Readout.** For every step: slack (how many minutes it can start later with everything
   else fixed and nothing broken) and whether it is critical (slack 0). For every step with
   a finite `holdMin`: how long its result actually waits. Waits longer than `holdMin` are
   reported as warnings, never hidden.

### Guarantees (each one a fast-check property over generated plans and kitchens)

- G1 capacity: at every minute, the number of steps using burners, ovens and cooks is at
  most the kitchen's count of each.
- G2 precedence: no step starts before every step in its `after` has ended.
- G3 completeness: every step is scheduled exactly once, for exactly its `minutes`, on
  whole-minute boundaries, and nothing ends after minute 0.
- G4 landing: with unlimited resources every terminal step whose result does not keep ends
  exactly at minute 0. With
  limited resources every terminal step whose result does not keep ends no earlier than
  minus the sum of the other terminal steps' minutes. Every wait longer than its `holdMin` appears in the warnings,
  and every warning is true (checked against an independent recomputation).
- G5 overlap: a hands-free step never occupies a cook. The total span is never longer than
  the sum of all step minutes, and never shorter than the longest dependency chain.
- G6 lanes: no two overlapping steps share a unit, and unit numbers stay within the
  kitchen's counts.
- G7 determinism: the same input gives the same output, and the output does not depend on
  the order of `steps` or `dishes` in the input.
- G8 slack is honest: delaying any single step by its reported slack keeps G1 to G3 true,
  and delaying it by one minute more breaks one of them (or pushes past minute 0).

### Rebuild (the incremental build)

In cooking mode the clock is real. Steps are done (with their actual times), running, or
pending. When something slips ("the roast needs 15 more minutes", or the cook is simply
behind), the plan is rebuilt:

1. Done and running steps are pinned at their actual times. A running step that has
   overrun and is not marked done is assumed to end now.
2. **Forward repair.** Pending steps, in order of their previous start, are placed at the
   earliest time at or after max(previous start, now, prerequisites' ends) where resources
   are free. Steps the slip does not touch stay exactly where they were.
3. The new serving time is the later of the old one and the last terminal step's end.
4. **Re-align.** Pending steps whose result does not keep are right-justified toward the
   new serving time, so the other hot dishes are held back to land with the late one.
5. The result carries a diff: which steps moved, from when to when, which are unchanged
   (`make` would say "is up to date"), and how far the serving time moved.

Rebuild guarantees (also properties): R1 the result satisfies G1 to G3 against the new
serving time; R2 pinned steps keep their times and no pending step starts before now; R3 no
step moves earlier than it was; R4 a rebuild with no slip changes nothing; R5 the serving
time never moves earlier, and moves later only as far as forward repair requires; R6 the
diff lists exactly the steps whose start changed.

## The model's job, and its limits

`POST /api/parse` takes recipe text for one or more dishes and returns a `Plan` plus the
list of issues from the sanity rules. One call to Claude (`claude-opus-5-5`, structured
output against the schema). The model never schedules, never sees the kitchen settings and
is never called by the scheduler, the rebuild, the export or the cooking mode.

- Recorded parses: every built-in sample recipe has a parse recorded from a real model call
  and committed. A request whose normalised text matches a sample is answered from the
  recording, before any limit is consumed and without a key. Tests use the recordings.
- Per-IP rate limit and a hard daily cap on model calls, both configurable by environment.
- No key, cap reached, model error or refusal: a clear message, and the samples and the
  Dinnerfile import still work.
- Input limits: at most 12,000 characters. Recipe text is data, not instructions: the
  prompt says so, and whatever the model returns still has to pass the schema and the
  sanity rules.

## The product, end to end

1. **Menu.** Pick a built-in sample dinner (at least four, one of them a Halloween dinner
   party) or paste your own recipes, or paste a Dinnerfile. No login.
2. **Steps.** The parsed steps per dish, each editable: title, minutes, appliance, hands-on,
   prerequisites, hold. Issues from the sanity rules are shown next to the step they concern.
3. **Plan.** Kitchen settings (burners, ovens, cooks) and the serving time. A timeline with
   one row per resource unit, critical steps marked, slack shown, warnings listed. The same
   plan as an ordered text list, which is the accessible alternative and the print layout.
   Export: Dinnerfile (copy or download), share link (the plan lives in the URL, no server
   storage), print.
4. **Cook.** "Right now" cards in large type: what to do, what is running with a countdown,
   what is next and when. Big targets, one-handed. The screen stays awake where the browser
   allows. "Done", "Started", "Needs more time" (+5, +10, +15) and "I'm behind" trigger a
   rebuild and show what moved. State survives a reload.

The scheduler runs in the browser from the same TypeScript the tests cover, so the plan and
the rebuild work offline once the page has loaded.

## Design direction

Kitchen meets terminal. Warm paper and cast-iron tones, one saturated accent, a monospace
face for times, targets and the Dinnerfile, a readable humanist face for instructions. It
has to be legible at arm's length on a phone standing on a counter: large type, 48 px
minimum targets, no hover-only affordances. Nothing is told by colour alone (critical steps
get a mark and a word; resource kinds get a pattern or label). Reduced motion is respected.
Light and dark both work. One light Halloween touch: the sample Halloween menu.

## Engineering constraints

- Node 22, TypeScript strict, ES modules. Server: Hono. Front end: Preact, bundled by
  esbuild into `public/assets/`. No database, no accounts, no analytics.
- `src/core/` is pure and isomorphic: no Node APIs, no DOM, no clock, no randomness. The
  server, the browser bundle, the MCP server and the tests all import it.
- Validation with zod. Tests with vitest; properties with fast-check; end-to-end and
  accessibility checks with Playwright and axe.
- Deploys on Render's free plan from a Dockerfile; `GET /api/health`.
- The API key stays on the server. It is never logged, never sent to the browser.
- English throughout. MIT licence.
