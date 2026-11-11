# Design: kitchen-mcp

Requirements: `requirements.md`. Core signatures as exported by `src/core/index.ts` today:
`validatePlan(input: unknown): PlanCheck`, `hasErrors`, `checkKitchen(plan, kitchen): Issue[]`,
`schedule(plan, kitchen): Result<Schedule, ScheduleError>`,
`rebuild(schedule: Schedule | RebuiltSchedule, progress: Progress, now: number): Result<Rebuilt, RebuildError>`,
`toDinnerfile(plan, options?: DinnerfileOptions): Result<string, Issue[]>`,
`fromDinnerfile(text): Result<DinnerfileImport, DinnerfileError[]>`, `normaliseRecipeText`.

## Files

| file | holds |
| ---- | ----- |
| `src/mcp/index.ts` | the only file with side effects: root URL, stdio transport, stderr log |
| `src/mcp/server.ts` | `createKitchenServer(deps)`, `SERVER_INFO`, `MAX_TOOL_INPUT_ELEMENTS` |
| `src/mcp/tools.ts` | output schemas, one handler per tool, `ToolOutcome`, `ToolError`, `toCallToolResult`, `guarded` |
| `src/mcp/text.ts` | the summaries of "Text" below (pure) |
| `src/mcp/samples.ts` | `SampleSource`, `fileSampleSource(root)`, sample schemas, `listSamples`, `getSample` |
| `test/support/mcp.ts` | `connectInProcess(deps)`, `memorySamples(files)`, `errorOf(result)` |
| `test/mcp/{text,samples,tools,lint,stdio,config}.test.ts` | the tests of "Testing" |
| `.kiro/settings/mcp.json`, `.kiro/agents/taster.json` | registration, the taster |
| `package.json`, `eslint.config.js`, `README.md` | `"mcp": "tsx src/mcp/index.ts"`; the src/mcp lint block; the README section |

## Findings that shaped the design

- F1 SDK 1.32.2: `McpServer.registerTool(name, { title, description, inputSchema, outputSchema,
  annotations }, cb)` takes zod raw shapes (zod 4 accepted); its `tools/call` handler catches every
  throw, including "Tool x not found", input validation and `maxToolInputElements`, and returns
  `{ content: [text], isError: true }`, so KM3.1 holds for SDK-side failures by construction.
- F2 `Client.callTool` validates `structuredContent` against the output schema whenever it is
  present, `isError` or not (`dist/esm/client/index.js`, "Only validate structured content if
  present"). Error results therefore carry details as a JSON text block, not `structuredContent`.
- F3 With real input schemas the SDK rejects malformed arguments before our code runs, with its own
  message (KM3.3). Trade-off chosen: agents get exact JSON Schema in `tools/list`, which matters more
  than one error shape; `check_plan` takes `z.unknown()` so a broken plan can still be diagnosed
  issue by issue. Core errors that the schemas make unreachable (`invalid_kitchen`,
  `invalid_progress`, `invalid_schedule` with reason `shape`) are still mapped.
- F4 At the start of this session `samples/index.json`, `src/server/parse/` and `recordings/`
  did not exist; a recipe-reader session running alongside has since added the first two
  (uncommitted), with `SampleEntrySchema` in `src/core/api.ts` (exported from `src/core/index.ts`)
  and `SampleIndexSchema`, `RecordingSchema` in `src/server/parse/recordings.ts`, which `src/mcp`
  may not import (`structure.md`). `samples.ts` imports `SampleEntrySchema` from core and copies
  the other two, and a parity test (T3.2) keeps them equal. Recordings need the user's key (Q1).
- F5 `AXIS_MIN` and `REBUILD_LIMITS` are not exported by `src/core/index.ts`, so the
  `invalid_now` message names no numbers (this spec does not change core).
- F6 Import paths, confirmed by importing them: `@modelcontextprotocol/sdk/` + `server/mcp.js`,
  `server/stdio.js`, `inMemory.js` (`InMemoryTransport.createLinkedPair()`), `client/index.js`,
  `client/stdio.js` (`StdioClientTransport`), `types.js` (`CallToolResult`).

## Signatures

```ts
// samples.ts
export type SamplePath = 'samples/index.json' | `samples/${string}.md` | `recordings/${string}.json`;
export interface SampleSource { readText(path: SamplePath): string | null } // null: no such file
export function fileSampleSource(root: URL): SampleSource; // readFileSync only; ENOENT -> null
export interface SampleSummary { id: string; title: string; dishes: string[]; kitchen: Kitchen; servingTime: string }
export interface SampleDetail extends SampleSummary { plan: Plan; issues: Issue[] }
export function listSamples(source: SampleSource): Result<SampleSummary[], ToolError>;
export function getSample(source: SampleSource, id: string): Result<SampleDetail, ToolError>;
// tools.ts
export type ToolErrorCode = ScheduleError['kind'] | RebuildError['kind'] | 'invalid_plan'
  | 'invalid_dinnerfile' | 'samples_unavailable' | 'not_found' | 'sample_unavailable' | 'internal';
export interface ToolError { code: ToolErrorCode; message: string; details: Record<string, unknown> }
export type ToolOutcome<T> = { ok: true; data: T; text: string } | { ok: false; error: ToolError };
export function toCallToolResult<T>(outcome: ToolOutcome<T>): CallToolResult;
export function guarded(log: (line: string) => void, run: () => CallToolResult): CallToolResult;
// server.ts
export interface KitchenServerDeps { samples: SampleSource; log: (line: string) => void }
export const SERVER_INFO = { name: 'make-dinner', version: '0.1.0' } as const;
export const MAX_TOOL_INPUT_ELEMENTS = 20_000;
export function createKitchenServer(deps: KitchenServerDeps): McpServer; // no I/O until connect
```

`toCallToolResult`: ok → `{ structuredContent: data, content: [{type:'text', text}, {type:'text',
text: JSON.stringify(data)}] }`; error → `{ isError: true, content: [{ text: message + list lines },
{ text: JSON.stringify({ error: { code, message, ...details } }) }] }`. `guarded` catches a throw,
logs `tool <name> failed: <stack>` to `log`, and returns `internal`. Handlers are synchronous.
A `fileSampleSource` read error other than ENOENT throws.

## Tools

All tools: annotations `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`;
descriptions say what the tool computes, that minute 0 is serving, and which tool gives the input
(for example "the plan from get_sample or import_dinnerfile").

| tool | input shape | core | `structuredContent` |
| ---- | ----------- | ---- | ------------------- |
| `check_plan` | `{ plan: z.unknown() }` | `validatePlan`, `hasErrors` | `{ valid: boolean, issues: Issue[] }` |
| `schedule_plan` | `{ plan: PlanSchema, kitchen: KitchenSchema }` | `schedule` | `ScheduleSchema` |
| `rebuild_plan` | `{ schedule: RebuiltScheduleSchema, progress: ProgressSchema, now: z.int() }` | `rebuild` | `RebuiltSchema` |
| `export_dinnerfile` | `{ plan: PlanSchema, options: OptionsSchema.optional() }` | `toDinnerfile` | `{ dinnerfile: string }` |
| `import_dinnerfile` | `{ text: z.string().max(1_000_000) }` | `fromDinnerfile`, `validatePlan` | `{ plan: PlanSchema, options: OptionsSchema, issues }` |
| `list_samples` | none | none | `{ samples: SampleSummary[] }` |
| `get_sample` | `{ id: DishIdSchema }` | `normaliseRecipeText`, `validatePlan`, `checkKitchen` | `SampleDetail` |

`OptionsSchema = z.strictObject({ kitchen: KitchenSchema.optional(), serve: ServeTimeSchema.optional() })`;
the handler copies only present keys into `DinnerfileOptions` (`exactOptionalPropertyTypes`).
1,000,000 characters bounds the import text (decided here; 80 steps with 1,000-character details,
escaped, stay well below). `import_dinnerfile` returns success with error issues when the plan
parses but breaks a sanity rule, like `POST /api/parse`, so the agent can fix and `check_plan` it.

## Errors

Codes from core keep core's `kind`. Every message is plain English, built from ids that match
their pattern, numbers and fixed words; lists add one line per issue
(`<severity> <code> <stepId or dishId or "plan">: <message>`) or Dinnerfile error.

| code | tool | message | details |
| ---- | ---- | ------- | ------- |
| `invalid_plan` | schedule, export | `The plan has <n> error(s). Fix them, then try again:` | `issues` |
| `invalid_kitchen` | schedule | `The kitchen is not valid:` | `issues` |
| `missing_appliance` | schedule | `The kitchen lacks an appliance these steps need:` | `issues` |
| `invalid_schedule` | rebuild | `The schedule is not valid (<reason>).` | `reason`, `issues` |
| `invalid_now` | rebuild | `now is outside the minutes rebuild accepts for this schedule.` | none |
| `invalid_progress` | rebuild | `The progress is not valid.` | none |
| `unknown_step` | rebuild | `Progress names step <id>, which is not in the schedule.` | `stepId` |
| `done_ends_before_start` | rebuild | `Step <id> is done but ends before it starts.` | `stepId` |
| `done_after_now` | rebuild | `Step <id> is done but ends after now.` | `stepId` |
| `running_starts_after_now` | rebuild | `Step <id> is running but starts after now.` | `stepId` |
| `serving_out_of_range` | rebuild | `Serving would move to minute <n>, more than a day after the plan.` | `servingMin` |
| `invalid_dinnerfile` | import | `The Dinnerfile has <n> error(s):` then each core message (`Line <n>: ...`) | `errors` |
| `invalid_plan` | import | `The Dinnerfile's steps fail the plan schema:` | `issues` |
| `samples_unavailable` | list, get | the problem line | `problem` |
| `not_found` | get | `There is no sample <id>. Call list_samples for the ids.` | `id` |
| `sample_unavailable` | get | the problem line | `id`, `problem` |
| `internal` | any | `The kitchen server failed on this call. Its log has the details.` | none |

## Samples

`getSample(source, id)`, stopping at the first problem: index text (`null`, not JSON, fails
`SampleIndexSchema`: `samples_unavailable`); `id` not listed: `not_found`; `samples/<id>.md`
missing; recording missing, not JSON, fails `RecordingSchema`, `sampleId !== id`, `textSha256 !==
sha256(normaliseRecipeText(md))` (`node:crypto`, UTF-8); `validatePlan(raw)` gives `null` or an
error; `checkKitchen(plan, entry.kitchen)` gives an error: `sample_unavailable`. Problem lines are
the recipe-reader design's problem-table lines for these cases, plus, for a missing recording,
` Run npm run record (needs the user's key).` Paths are built only after `DishIdSchema` passes; the
file source also rejects any stem not matching `DISH_ID_PATTERN`. `listSamples` reads the index only.
Files are read on every call, so `get_sample` after `npm run record` sees the new recording.

## Text

Plan list (`schedule_plan`, hand-worked for `H1_SCHEDULE`, the scheduler's table H1):

```
Sunday roast: 3 dishes, 10 steps. Kitchen: 4 burners, 1 oven, 1 cook.
Span 110 min, longest chain 110 min. Minute 0 is serving; earlier minutes are negative.
-110 to -100  chicken.prep  Season and truss the chicken  Cook 1  No slack
-100 to -25  chicken.roast  Roast the chicken  Oven 1  Critical
-100 to -95  greens.shred  Shred the greens  Cook 1  slack 75 min
-25 to -5  chicken.rest  Rest the chicken under foil  no lane  Critical
-20 to -18  gravy.roux  Make a roux in the roasting tin  Burner 1, Cook 1  Critical
-18 to -8  gravy.simmer  Add stock and let the gravy thicken  Burner 1  Critical
-10 to -6  greens.boil  Cook the greens in salted water  Burner 2  Critical
-8 to -6  gravy.strain  Strain the gravy into a jug  Cook 1  Critical
-6 to -5  greens.toss  Toss the greens with butter  Cook 1  Critical
-5 to 0  chicken.carve  Carve the chicken  Cook 1  Critical
Warnings: none.
```

Order by `startMin`, then `compareIds`. Lanes in the order burner, oven, cook; `no lane` when all
are `null`. Singular and plural by count. A step with `waitMin > holdMin` gets
`, waits <w> min (hold <h> min)` after its mark; each warning prints as `Warning: <message>`.
`rebuild_plan` puts two lines first, `Serving moves <n> min later, to minute <S'>.` or `Serving
stays at minute <S'>.`, then `Moved: <id> <from> to <to>, ...` or `Moved: none.`; pinned steps
read `done` or `running` in place of the slack mark; minutes after 0 print without a sign.

Other summaries: `check_plan` `Valid: <e> errors, <w> warnings.` or `Not valid: ...` then issue
lines; `export_dinnerfile` `Dinnerfile for "<title>" (<n> steps). Check it with make -n -f
Dinnerfile dinner.`, a blank line, the file; `import_dinnerfile` `Imported "<title>": <d> dishes,
<s> steps, <e> errors, <w> warnings.` then issue lines; `list_samples` one line per sample,
`<id>: <title> (<dishes joined by "; ">). Kitchen: <kitchen>. Serving <time>.`; `get_sample`
`<title> (<id>): <d> dishes, <s> steps. Suggested kitchen: <kitchen>. Serving <time>.`.

## Entry point and registration

`index.ts`: `root = new URL('../../', import.meta.url)` (the package root from both
`src/mcp/index.ts` and `dist/mcp/index.js`); `log` writes a line to stderr; it connects
`createKitchenServer({ samples: fileSampleSource(root), log })` to a `StdioServerTransport`, then
logs `make-dinner MCP server ready`. A failed start logs one line and sets `process.exitCode = 1`.
`tsconfig.mcp.json` already emits `dist/mcp/` (and the core files it imports) in `npm run build`.

`.kiro/settings/mcp.json`:

```json
{ "mcpServers": { "make-dinner": {
  "command": "npx", "args": ["--no-install", "tsx", "src/mcp/index.ts"], "disabled": false,
  "autoApprove": ["check_plan", "schedule_plan", "rebuild_plan", "export_dinnerfile",
                  "import_dinnerfile", "list_samples", "get_sample"] } } }
```

`--no-install` keeps npx off the network. The relative path needs the workspace root as working
directory (Q2). The server is started from source, so after a change to `src/core` the developer
reconnects it from Kiro's MCP panel before asking "does every sample still land within its holds".

README section "Use the scheduler from your MCP client": `npm ci && npm run build`, a config with
`"command": "node", "args": ["/absolute/path/to/makedinner/dist/mcp/index.js"]`, the seven tools
one line each; no key, no network, nothing written; samples need `recordings/`.

## Lint

Added to the `src/mcp/**` block of `eslint.config.js`: `no-restricted-imports` paths `node:http`,
`node:https`, `node:net`, `node:tls`, `node:dgram`, `node:child_process`, `node:worker_threads`,
`node:fs/promises`, their bare names, `@anthropic-ai/sdk`, `hono`, `@hono/node-server`, and
`node:fs` with `allowImportNames: ['readFileSync']`; `no-restricted-globals` `fetch`, `WebSocket`,
`XMLHttpRequest`; `no-restricted-properties` `process.env`, `process.stdout`, `process.argv`.

## The taster

`.kiro/agents/taster.json`, in the shape of `sous-chef.json`: `tools: ["read", "@make-dinner"]`,
`allowedTools` the same, `includeMcpJson: true` (to load `make-dinner` from the workspace file),
permission rules denying `fs_write` on `**` and every `shell` command, `resources`
`file://.kiro/steering/product.md`, no hooks. Prompt, in substance:

1. Sample id: `get_sample`. Pasted plan: `check_plan` first; on errors, report them and stop.
2. Kitchens: K1 the sample's suggested kitchen (pasted plan: 4 burners, 1 oven, 1 cook); K2 is K1
   with 1 burner; K3 is K1 with 1 oven and 1 cook. Skip a kitchen equal to an earlier one. A
   `missing_appliance` result is a finding.
3. Call `schedule_plan` under each; read the plan list as a cook would and report:
   (a) every `hold_exceeded` warning; (b) a hands-off step whose title or detail asks for hands
   (stir constantly, watch, baste, whisk) running while its cook has another step: the cook is
   double-booked according to the text; (c) starts a cook would question: more than 4 hours before
   serving, a "just before serving" step far from minute 0, a step that keeps finished long before
   a hot step that needs the same cook.
4. Output: one line per kitchen (span, warning count); then each finding with the kitchen, the
   tool's line quoted exactly, and one sentence on why a cook would mind; or "Nothing odd under
   K1 to K3." Scheduler output is fact, a reading of step text is opinion: say which. Never invent
   minutes, never call a schedule optimal, never claim to have edited or run anything.

Recorded run, by the user, prompt file text `Taste the sample sunday-roast.` under the next free
number (17 is taken by plan-ui); all its tools are read-only, so trusting them is safe:
`scripts/kiro-run.sh taster-sunday-roast docs/kiro-evidence/prompts/<nn>-taster-sunday-roast.md --agent taster --trust-all-tools`

## Testing

- `connectInProcess(deps)`: `const [c, s] = InMemoryTransport.createLinkedPair()`, connects
  `createKitchenServer(deps)` to `s` and a `Client({ name: 'test', version: '0' })` to `c`.
  `memorySamples` maps paths to texts; a throwing variant fakes a broken disk (storage fakes only).
- Expected values: `H1_SCHEDULE` for `schedule_plan(SUNDAY_ROAST, HOME_KITCHEN)`; RB-a's
  hand-worked diff and serving minute (rebuild design) for `rebuild_plan(H1_SCHEDULE, RB_A_PROGRESS,
  RB_A_NOW)`; `SUNDAY_ROAST_DINNERFILE` for export and, read back, `canonicalPlan(SUNDAY_ROAST)`;
  `missing_appliance` on `chicken.roast` for `BURNER_ONLY_KITCHEN`; the text block lines above.
- Each error code of the table that the input schemas allow has one test asserting `isError`, no
  `structuredContent`, the exact message and details. SDK paths: a kitchen with 9 burners gives
  one text block starting `Input validation error`; tool `nope` gives `isError`; 20,001 elements
  are rejected. `internal`: the throwing source; the result has no `/` path or `at ` frame, the log
  fake got the stack.
- `stdio.test.ts`: `beforeAll` runs `tsc -p tsconfig.mcp.json` (120 s timeout), then
  `StdioClientTransport({ command: process.execPath, args: [<abs>/dist/mcp/index.js],
  cwd: os.tmpdir(), env: { PATH }, stderr: 'pipe' })`: seven tools; `list_samples` ids in the order
  of `structure.md`; `get_sample('sunday-roast')` then `schedule_plan` with its plan and kitchen
  passes `ScheduleSchema` with one step per plan step; stderr has the ready line and nothing else.

## Open questions

- Q1 Move `SampleIndexSchema` and `RecordingSchema` into `src/core/api.ts` beside
  `SampleEntrySchema`, so server and MCP share them? Until then they are copied (F4).
- Q2 Does Kiro start workspace MCP servers in the workspace root? T3.3 checks; if not, use an
  absolute path. Q3 Does `tools: ["@make-dinner"]` keep user-level servers from the taster? T4.1.

## Review notes (by hand, 2026-11-11)

- Q1: yes. `SampleIndexSchema` and `RecordingSchema` move into `src/core/api.ts`; nothing is
  copied and the parity test is not needed.
- Q2 and Q3 are checked when the server and the taster agent are first run (T3.3, T4.1).
- T4.2 (the recorded taster run) is run by hand through `scripts/kiro-run.sh`.
