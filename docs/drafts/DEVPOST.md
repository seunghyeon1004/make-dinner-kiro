# Make Dinner: Devpost submission text (draft)

**Category:** Frankenstein
**Tagline:** A build system stitched onto a kitchen: paste your recipes, get one schedule where every dish lands hot at the same time.
**Live app:** https://make-dinner-kiro.onrender.com (free server; the first load can take up to a minute)
**Code:** https://github.com/seunghyeon1004/make-dinner-kiro
**Built with:** Kiro, TypeScript, Node.js, Hono, Preact, esbuild, zod, fast-check, Vitest, Playwright, axe, GNU Make, Model Context Protocol, Anthropic Claude API, Docker, Render

## Inspiration

A recipe is written as if you had the whole stove, the whole oven and both hands to yourself. Cook four of them for one dinner and you are solving a scheduling problem in your head while something burns. The potatoes are done twenty minutes before the roast.

Build systems solved exactly this decades ago: targets, prerequisites, a limit on parallel jobs, incremental rebuilds when one input changes. So the chimera was obvious, and a little absurd: run dinner through `make`.

## What it does

Three parts that do not belong together, each doing a real job.

1. **A language model reads the recipes.** Paste the recipes for several dishes and Claude turns the prose into a step graph: how long each step takes, whether it needs a burner or the oven, whether it needs your hands or runs by itself, what it waits for, and how long its result can sit. That is all the model does. Its output is checked against a schema and sanity rules (cycles, impossible times, an oven step in a kitchen with no oven), and you can correct every step.
2. **Build-system machinery plans the dinner**, with no model call: a dependency graph, resource-constrained scheduling where burners, ovens and cooks are the kitchen's `-j`, backward scheduling from the serving time, slack, the critical path, and incremental rebuilds.
3. **A kitchen timer app** shows the plan as a timeline per burner, oven and cook, and as a plain list, and has a cooking mode for a phone standing on the counter: what to do right now, countdowns for what is running, what comes next.

The seam is visible. Every plan exports as a **Dinnerfile**, a real Makefile. `make -n -f Dinnerfile dinner` prints the steps in an order that works, and the app reads the file back without the model.

When the roast needs fifteen more minutes, tap "+15 min". The plan is rebuilt like an incremental build: what already happened is kept, only the affected steps move, the other hot dishes are held back to land with the late one, and a build log shows each move ("gravy.roux 1:07 PM -> 1:23 PM", "5 steps up to date", "serve 1:30 PM -> 1:45 PM").

A visitor gets a schedule in one tap from five built-in dinners (one is a Halloween dinner party), with no login and no model: each sample's reading was recorded from a real model call.

### What the scheduler promises

Resource-constrained scheduling is NP-hard, so it does not promise the best plan. It promises a valid one and states what valid means, as 20 named guarantees, each a fast-check property checked against an oracle that shares no code with the scheduler:

- no burner, oven or cook is ever over capacity;
- no step starts before the steps it waits for have ended;
- hot dishes end at serving time when the kitchen allows it, and every result that waits longer than it can hold is reported, never hidden;
- hands-free steps never occupy a cook;
- the slack shown for a step is exact;
- a rebuild never moves a step earlier, changes nothing when nothing slipped, and reports exactly what moved;
- a Dinnerfile round-trips exactly, and GNU Make agrees with the order.

## How we built it

TypeScript throughout. `src/core` is pure and has no I/O, no clock and no randomness, so the same code runs in the browser (the plan recomputes instantly and works offline once loaded), on the server, in the tests and in an MCP server. The server is Hono; it serves the page and one model-calling route with a per-client rate limit, a daily cap and recorded answers for the samples. The front end is Preact bundled by esbuild, plain CSS, system fonts.

The numbers on the final commit: 2,097 example tests, 106 property tests and 352 end-to-end tests (phone and desktop, light and dark, an axe accessibility check on every screen).

## How Kiro was used

Kiro built this, driven from the Kiro CLI (3.2.0, V3 engine). Every session's transcript is in the repo under `docs/kiro-evidence/`, rendered from the CLI's event stream, so each shell command appears with its exit code and real output. `.kiro/README.md` is the honest record, including where Kiro failed and what was done by hand.

### Steering

One session turned a hand-written brief into seven steering files before any code. The one that mattered most was not about style: `scheduler-guarantees.md` states the product's promises as numbered guarantees and says that no implementation change may weaken a property to make it pass. Every later session loaded it. When Kiro hit a requirement that disagreed with the code, it stopped and asked instead of bending the test, because `kiro-conduct.md` told it to.

### Spec-driven development, and how it compared with vibe coding

Eight features went through Kiro's spec mode: requirements in EARS form, a design with exact signatures and schedules worked out by hand, then test-first tasks that each name the command that proves them. 230 of 230 tasks are ticked.

Each spec prompt asked Kiro to check the guarantees against the algorithm and report conflicts with a counterexample. That is where the workflow paid for itself:

- The scheduler spec found that one guarantee was empty for larger plans and that another's test was weaker than its definition.
- The rebuild spec found five conflicts, each with a counterexample, including that three guarantees were false for a second rebuild.
- The Dinnerfile spec ran scratch Makefiles against the real GNU Make and found that `make -n` will execute a recipe line containing `$(MAKE)`; the export's escaping comes from that measurement.

Only the project scaffold and the agent and hook setup were vibe-coded (one prompt each, no spec). That was fine for tooling. For the scheduler it would not have been: the conflicts above were found on paper, before a line of scheduling code existed, and the hand-worked tables became the example tests.

### Custom agents

- **sous-chef**, the builder, implemented every task. Its write and shell permissions keep it out of steering, evidence and recordings, and deny commits. It ran a mutation check on its own work, removed a scheduling pass, saw no property fail, and reported it. That gap became guarantee G9.
- **expediter**, the checker, re-verified all 38 ticked scheduler tasks, confirmed the oracles import no scheduling code, and unticked nothing. It may untick but never tick.
- **taster**, read-only, can only call the project's MCP server. It schedules a sample under three kitchens and reports what a cook would mind, separating scheduler facts from its own reading of the recipe.

### Hooks

The builder's hooks are the "run the property tests on save" automation: after every file write, typecheck, and the scheduler's property tests when core files changed; the full suites and lint when the agent stops. Each firing is logged (`docs/kiro-evidence/hook-fires.log`, 294 lines). A workspace file-save hook runs the same script. The stop hook is why two sessions ended with an honest red: a coverage test that demands a property for every guarantee stayed failing until the properties existed.

### MCP

The scheduler is deterministic code, so we exposed it as an MCP server with seven read-only tools (`check_plan`, `schedule_plan`, `rebuild_plan`, `export_dinnerfile`, `import_dinnerfile`, `list_samples`, `get_sample`), registered in `.kiro/settings/mcp.json`. Kiro then answered "what happens to the Sunday roast with one burner and one oven" by calling the real scheduler: 115 minutes with no warnings became 155 minutes with two. The first attempt failed in an instructive way (Kiro's MCP client dropped empty lists and nulls from the plan object), so the tools also accept a JSON string.

## Challenges we ran into

- **The first definition of "waiting" was wrong.** On the first real recipe, the roast feeds both "rest" and the gravy two minutes later, and the plan warned that the roast was waiting. The definition changed to "until its first user starts", and Kiro carried the change through specs, oracles and hand-worked tables.
- **"Critical" was on 14 of 17 steps.** A just-in-time schedule gives every hot step zero slack. We replaced the mark with a real critical path.
- **Shrinking crashed.** The first property-test generators made fast-check run out of memory on a failing case. Kiro found it, and the generators were rewritten so a failure prints a small counterexample.
- **Cost.** A spec session cost 33 to 70 credits and the whole build about 1,100, so the last features were built in small, strictly ordered sessions.
- **A mistake of our own:** a clean-up command overwrote transcript files while sessions were writing. Two were rebuilt from saved event streams; one lost its final message. The evidence folder says which.

## Accomplishments that we're proud of

- The Dinnerfile is not a metaphor: GNU Make runs it, a test spawns the real `make`, and the round trip is a property.
- 20 guarantees stated in plain words, each proved by a property against an independent oracle.
- The app is useful with the model switched off, and says plainly what it does not do.

## What we learned

Specs with numbered guarantees make AI output checkable, and asking the agent to attack its own design before coding finds real errors cheaply. Hooks turn "the agent says it passes" into a line in a log. And an agent that is told it may stop will stop at the right moments.

## What's next for Make Dinner

Oven temperatures and shared shelves, so two dishes at the same heat can share one oven. A dish that is allowed to finish early and be reheated. Recipes read from a photo. And `make -j2 dinner` for two cooks, with each cook on their own phone.

## Limits, stated plainly

One oven step takes a whole oven; oven temperatures are not modelled; the plan is valid, not optimal; recipes are read in English. Kiro powers and Kiro Crew were not used.

## Gallery

| file                                          | what it shows                                                         |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `docs/screens/01-menu.png`                    | Five sample dinners, one tap to a plan, no login                      |
| `docs/screens/02-plan.png`                    | "Start at 11:35 AM, serve at 1:30 PM", kitchen settings               |
| `docs/screens/03-timeline.png`                | The timeline per cook, burner and oven, with the critical path marked |
| `docs/screens/04-one-burner-one-oven.png`     | The same dinner with one burner and one oven: two honest warnings     |
| `docs/screens/05-dinnerfile.png`              | The plan as a Dinnerfile, a real Makefile                             |
| `docs/screens/06-steps-read-by-the-model.png` | Pasted recipes read into steps by the model, every step editable      |
| `docs/screens/07-cooking-mode.png`            | Cooking mode: what is running, with a countdown                       |
| `docs/screens/08-build-log.png`               | The roast needs 15 more minutes: the rebuild's build log              |
| `docs/screens/09-phone.png`                   | Cooking mode on a phone                                               |

All screenshots are real captures of the live site, taken headless with Playwright.
