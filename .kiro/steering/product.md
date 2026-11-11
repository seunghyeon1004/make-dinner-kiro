---
inclusion: always
---

# Product: Make Dinner

A build system stitched onto a kitchen. The cook pastes the recipes for several dishes and
gets one schedule in which every dish lands hot at the same time. Source of truth for intent:
`docs/BRIEF.md`. The scheduler's promises are in `scheduler-guarantees.md`.

## Who it is for

A home cook making 2 to 6 dishes for one sitting (Sunday roast, holiday dinner, dinner
party). One to three cooks, a normal domestic stove and oven. Not a restaurant tool. The
domain model allows up to 12 dishes, 80 steps, 8 burners, 4 ovens and 6 cooks.

## The three stitched technologies

1. **Language model (Claude, `claude-opus-5-5`).** Reads recipe prose into a `Plan`: dishes
   and a step graph. One call per `POST /api/parse`, structured output against the zod schema.
   - May: extract steps, minutes, appliance, hands-on, prerequisites, hold.
   - May not: schedule, see kitchen settings or serving time, be called by the scheduler,
     rebuild, Dinnerfile export/import, cooking mode or the MCP server. Its output is never
     trusted: it passes the schema and the sanity rules, and the cook can edit every step.
2. **Build-system machinery (`src/core`).** Deterministic planning with no model calls:
   dependency graph, resource-constrained scheduling (burners, ovens, cooks are the
   kitchen's `-j`), backward scheduling from minute 0, slack, critical steps, rebuilds.
   - May: anything pure and deterministic.
   - May not: claim optimality, read the clock, use randomness, do I/O, hide a broken hold.
3. **Kitchen timer app (`src/web`).** A phone propped on the counter: a timeline per lane
   and a "right now" cooking mode with timers, usable with wet hands, offline once loaded.
   - May: show, edit, time, trigger rebuilds, store state in the URL and localStorage.
   - May not: compute a schedule any other way than by calling `src/core`; send plans to
     the server except for parsing; hold the API key.

The seam is visible: every plan exports as a **Dinnerfile** that GNU Make accepts
(`make -n -f Dinnerfile dinner` prints the steps in a valid order) and that the app reads
back without the model.

## End-to-end flow

1. **Menu.** Pick a built-in sample dinner (at least four, one a Halloween dinner party),
   paste recipes, or paste a Dinnerfile. No login.
2. **Steps.** Parsed steps per dish, each editable (title, minutes, appliance, hands-on,
   prerequisites, hold). Sanity issues appear next to the step they concern. Errors block
   scheduling; warnings do not.
3. **Plan.** Kitchen settings and serving time. Timeline with one row per lane, critical
   steps marked, slack shown, warnings listed. The same plan as an ordered text list (the
   accessible alternative and the print layout). Export: Dinnerfile (copy, download), share
   link (plan in the URL fragment, no server storage), print.
4. **Cook.** "Right now" cards: what to do, what is running with a countdown, what is next
   and when. "Done", "Started", "Needs more time" (+5, +10, +15) and "I'm behind" trigger a
   rebuild and show what moved. Screen kept awake where the browser allows (Wake Lock).
   State survives a reload.

## The Dinnerfile (decided here)

- One target per step, named by step id; prerequisites are its `after` list.
- The recipe line is `@echo '<quoted title>' # <step-id>`; step fields, including the title
  and detail as JSON strings, live in a `# step ...` comment line directly above the target.
  The exact grammar and escaping are in the dinnerfile spec, which found that the simpler
  format first written here could not round-trip every title or keep `make -n` from running
  `$(MAKE)` (updated by hand after that spec's conflicts C2 and C3).
- Dishes are declared as `# dish <id> "<name>"`, the title as `# plan "<title>"`.
- A `dinner` target depends on every terminal step; all targets are `.PHONY`.
- Import parses only these comments and targets; it goes through the same schema and
  sanity rules as model output.

## Out of scope

Accounts, login, server-side storage of plans, databases, analytics, payments, shopping
lists, nutrition, recipe search or discovery, unit conversion, multi-device sync, push
notifications, restaurant or commercial kitchens, optimal (as opposed to valid) schedules,
languages other than English. Halloween appears only as one sample menu.

## Glossary (use these words, and only these, for these things)

- **Step**: one unit of work with an id, minutes, appliance, hands-on flag, prerequisites
  (`after`) and hold. Never "task" or "job" in product copy or code.
- **Dish**: a named group of steps that is served. Every step belongs to exactly one dish.
- **Terminal step**: a step that no other step lists in `after`; the last step of a dish.
- **Hold** (`holdMin`): minutes a step's result can wait before the step that uses it starts
  (for a terminal step: before serving). `null` means the result **keeps**.
- **Wait**: the minutes a result actually waits. A wait longer than its hold is a warning.
- **Slack**: minutes a step can start later, everything else fixed, without breaking
  capacity, precedence or completeness.
- **Critical**: in the schedule data, a step with slack 0. On screen the mark and the word
  "Critical" are reserved for slack 0 on a step whose result does not keep; a step whose result
  keeps and has slack 0 reads "No slack" (prep steps are packed together and could move as a
  block; decided in the plan-ui review, 2026-11-11).
- **Lane**: one numbered unit of a resource (Burner 2, Oven 1, Cook 1). Timeline rows are lanes.
- **Kitchen**: counts of burners, ovens and cooks.
- **Serving time**: minute 0 on the scheduler's axis; earlier minutes are negative.
- **Schedule**: a plan with a start minute and lanes for every step, plus slack and warnings.
- **Rebuild**: recomputing the schedule during cooking after a slip, pinning done and
  running steps, with a diff of what moved.
- **Pinned**: a done or running step whose times a rebuild may not change.
- **Dinnerfile**: the Makefile export of a plan, readable back without the model.
- **Issue**: a sanity-rule finding, either an error or a warning.
