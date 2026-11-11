# Make Dinner

A build system stitched onto a kitchen. Paste the recipes for several dishes and get one
schedule in which every dish lands hot at the same time.

Built for Kiroween 2026, category **Frankenstein**. MIT licence.

## The problem

A recipe is written as if you had the whole stove, the whole oven and both hands to yourself.
Cook four at once and you have a scheduling problem that you solve in your head while something
burns. Build systems solved that problem decades ago: targets, prerequisites, a limit on
parallel jobs, incremental rebuilds when one input changes.

## The chimera

Three things that do not belong together, each doing a real job:

| part                   | what it does                                                                                                                                                                                                                                              | what it may not do                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A language model       | Reads messy recipe prose into a step graph: minutes, burner or oven, hands-on or not, what each step waits for. Its output is checked against a schema and sanity rules (cycles, impossible times, missing appliances), and you can correct every step.   | Schedule anything.                             |
| Build-system machinery | Plans the dinner with no model call: dependency graph, resource-constrained scheduling (burners, ovens and cooks are the kitchen's `-j`), backward scheduling from the serving time, slack, the critical path, incremental rebuilds when something slips. | Claim the plan is optimal. It claims valid.    |
| A kitchen timer app    | A timeline per burner, oven and cook, and a "right now" cooking mode with timers for a phone standing on the counter.                                                                                                                                     | Compute a schedule any other way than by core. |

The seam is visible. Every plan exports as a **Dinnerfile**, a real Makefile:

```make
# step dish=chicken minutes=75 appliance=oven handsOn=false hold=5 title="Roast the chicken"
chicken.roast: chicken.prep
	@echo 'Roast the chicken' # chicken.roast
```

`make -n -f Dinnerfile dinner` prints the steps in an order that works, and the app reads the
file back without the model.

## Try it

Open the page, pick a sample dinner (there are five, one of them a Halloween dinner party) and
you have a schedule. No login, and no model is needed: every sample's reading was recorded from
a real model call and is served from the recording.

Then change the kitchen (one burner instead of four), move the serving time, edit a step, start
cooking, and tell it the roast needs fifteen more minutes.

## What the scheduler promises

Resource-constrained scheduling is NP-hard, so the scheduler promises a valid plan, and says
what valid means. Each line below is a fast-check property over generated plans and kitchens
(`test/core/*.pbt.ts`), checked against oracles that share no code with the scheduler:

- **G1** no burner, oven or cook is ever over capacity.
- **G2** no step starts before the steps it waits for have ended.
- **G3** every step is scheduled once, for its full time, and nothing ends after serving time.
- **G4** with enough equipment every hot dish ends exactly at serving time; with less, within
  a stated bound; and every result that waits longer than it can hold is reported.
- **G5** hands-free steps never occupy a cook; the plan is never longer than doing everything
  in a row, and never shorter than the longest chain.
- **G6** two overlapping steps never share a burner, oven or cook.
- **G7** the same input gives the same plan, whatever order it is written in.
- **G8** the slack shown for a step is exact.
- **G9** every hot step sits as late as it can.
- **R1 to R7** a rebuild during cooking keeps what already happened, never moves a step
  earlier, changes nothing when nothing slipped, never moves the serving time earlier, reports
  exactly what moved, and holds the other hot dishes back to land with the late one.
- **D1, D2** a Dinnerfile round-trips exactly, and GNU Make agrees with the order.

The full wording is in [`.kiro/steering/scheduler-guarantees.md`](.kiro/steering/scheduler-guarantees.md).

## Limits

- One oven step takes a whole oven. If two dishes share a temperature, count the second shelf
  as a second oven.
- Oven temperatures are not modelled.
- The plan is valid, not optimal.
- The model reads recipes in English.

## Run it

```sh
npm ci
npm run build
npm start          # http://localhost:3000
```

Node 22 or later. Without `ANTHROPIC_API_KEY` everything works except reading your own pasted
recipes; samples and Dinnerfile import need no key.

| variable                | default | meaning                                           |
| ----------------------- | ------- | ------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | unset   | key for reading pasted recipes (server side only) |
| `PORT`                  | `3000`  | listen port                                       |
| `PARSE_RATE_PER_IP`     | `5`     | model calls per client per window                 |
| `PARSE_RATE_WINDOW_SEC` | `600`   | the window                                        |
| `PARSE_DAILY_CAP`       | `200`   | model calls per UTC day, all clients              |
| `PARSE_TIMEOUT_MS`      | `60000` | model request timeout                             |
| `TRUST_PROXY`           | `false` | read the client address from `X-Forwarded-For`    |
| `LOG_LEVEL`             | `info`  | `debug`, `info`, `warn`, `error`                  |

Deploys on Render's free plan from the `Dockerfile` and `render.yaml`.

## Checks

```sh
npm test              # example tests
npm run test:props    # fast-check properties (needs GNU Make for D2)
npm run test:e2e      # Playwright, phone and desktop, light and dark, axe on every screen
npm run typecheck && npm run lint && npx prettier --check . && npm run check:contrast
```

## The scheduler as an MCP tool

The scheduler is plain deterministic code, so an agent can use it as a tool. `npm run mcp`
(or `node dist/mcp/index.js` after a build) starts a stdio MCP server named `make-dinner` with
two tools: `check_plan` (schema and sanity rules) and `schedule_plan` (plan and kitchen in,
schedule out, with a readable plan list). The plan may be passed as an object or as a JSON
string. To add it to an MCP client:

```json
{ "mcpServers": { "make-dinner": { "command": "node", "args": ["/path/to/dist/mcp/index.js"] } } }
```

This is a slice of a larger spec (`.kiro/specs/kitchen-mcp`): rebuild, Dinnerfile and sample
tools are specified there and not built.

## How it was built with Kiro

Steering first, then every feature through Kiro's spec workflow, implemented by a custom agent
whose hooks run the typecheck and the scheduler's property tests after every file write, and
reviewed by hand between sessions. The record of that, including where Kiro failed and what was
done by hand, is in [`.kiro/README.md`](.kiro/README.md); the session transcripts are in
[`docs/kiro-evidence/`](docs/kiro-evidence).
