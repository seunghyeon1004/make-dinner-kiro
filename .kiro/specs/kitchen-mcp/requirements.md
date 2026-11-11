# Requirements: kitchen-mcp

## Why

Scheduling, rebuild and the Dinnerfile are deterministic core code, so an agent can call them
instead of reasoning about schedules in prose. This spec adds a stdio MCP server in `src/mcp`
that exposes `src/core` and nothing else, registers it for this workspace, and adds the taster, a
Kiro agent that schedules a dinner under a few kitchens and reports what a cook would find odd.

## Scope

New: `src/mcp/{server,tools,text,samples}.ts`, `.kiro/settings/mcp.json`, `.kiro/agents/taster.json`,
`test/mcp/`, `test/support/mcp.ts`. Changed: `src/mcp/index.ts` (placeholder), `eslint.config.js`,
`package.json`, `README.md`; nothing in `src/core`, `src/server`, `src/web`. Ids are `KMn.m`
(decided here). No model calls (`product.md`): recipe parsing is not a tool.

## Requirements

### KM1. One server, seven tools

**User story:** As an agent, I want tools that wrap the core, so that I plan with the real scheduler.

- KM1.1 THE SYSTEM SHALL serve over stdio an MCP server named `make-dinner` with exactly the
  tools `check_plan`, `schedule_plan`, `rebuild_plan`, `export_dinnerfile`, `import_dinnerfile`,
  `list_samples`, `get_sample`, each with a description, zod input and output schemas and the
  annotations `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.
- KM1.2 THE SYSTEM SHALL compute every plan, issue, schedule, rebuild and Dinnerfile with the core
  function the design names, from `src/core/index.js`, and none of them in `src/mcp`.
- KM1.3 WHEN a tool succeeds, THE SYSTEM SHALL return `structuredContent` passing its output
  schema and two text blocks: the KM5 summary, then `JSON.stringify(structuredContent)`.

### KM2. The tools

- KM2.1 `check_plan(plan)` SHALL accept any JSON value and return `{ valid, issues }` from
  `validatePlan`; `valid` is true when no issue is an error.
- KM2.2 `schedule_plan(plan, kitchen)` SHALL return `schedule`'s `Schedule`, or its
  `ScheduleError` as a tool error with code `kind` and its `issues`.
- KM2.3 `rebuild_plan(schedule, progress, now)` SHALL accept a `Schedule` or `RebuiltSchedule` and
  return `rebuild`'s `Rebuilt`, or its `RebuildError` as a tool error with code `kind` and its fields.
- KM2.4 `export_dinnerfile(plan, options?)` SHALL return `{ dinnerfile }` from `toDinnerfile`
  (`options`: optional `kitchen`, `serve`); on `err`, the tool error `invalid_plan`.
- KM2.5 `import_dinnerfile(text)` SHALL return `{ plan, options, issues }` from `fromDinnerfile`
  then `validatePlan`; `DinnerfileError`s give `invalid_dinnerfile` with the line-numbered
  `errors`; a `null` plan gives `invalid_plan`.
- KM2.6 `list_samples()` SHALL return the `samples/index.json` entries in order with `id`,
  `title`, `dishes`, `kitchen`, `servingTime`; `get_sample(id)` SHALL return those fields plus
  the recorded `plan` after `validatePlan` and its `issues`.

### KM3. Errors

- KM3.1 THE SYSTEM SHALL report every failure as a result with `isError: true`, never as a
  protocol error thrown from a handler, holding two text blocks: a plain-English message and
  `JSON.stringify({ error: { code, message, ...details } })` with a code from the design's table.
  It SHALL NOT carry `structuredContent` (the SDK client validates that against the success
  schema even when `isError` is set).
- KM3.2 WHEN a handler throws, THE SYSTEM SHALL return `internal` with a fixed message and write
  the stack to stderr only. No result SHALL contain a stack trace, an absolute path, recipe text
  or an environment value.
- KM3.3 Arguments failing an input schema SHALL come back as the SDK's own `isError` result
  (`Input validation error: ...`), unchanged (decided here).

### KM4. Samples

- KM4.1 THE SYSTEM SHALL read, on each call (decided here), only `samples/index.json`,
  `samples/<id>.md` and `recordings/<id>.json` under the package root found from the module's
  URL, never the working directory, building paths only from ids matching the dish-id pattern.
- KM4.2 IF the index is missing or invalid, THEN `samples_unavailable`; IF the id is not listed,
  THEN `not_found`; IF the recording is missing, invalid, for another sample, stale against the
  SHA-256 of the normalised text, or its plan is `null` or has errors, THEN `sample_unavailable`.

### KM5. Text a person can read

- KM5.1 `schedule_plan` and `rebuild_plan` SHALL include the plan list as text: a header, one line
  per step by start then id with start and end minutes relative to serving, title, lanes and a
  mark, then the warnings; `rebuild_plan` also the serving shift and the moved steps. Other
  tools give the design's summary. All text is deterministic and uses glossary words.
- KM5.2 The mark SHALL be `Critical` only for slack 0 on a step whose result does not keep,
  `No slack` for slack 0 on a step that keeps, else `slack <n> min`; pinned steps `done`/`running`.

### KM6. Boundaries, running and registering

- KM6.1 `src/mcp` SHALL NOT open a network connection, write a file, read `process.env`, spawn a
  process or call a model (lint enforces it); SHALL write to stdout only MCP messages; SHALL give
  deep-equal results for equal arguments and files; SHALL reject arguments over 20,000 elements.
- KM6.2 `npm run mcp` SHALL start the server from source with tsx; `npm run build` SHALL emit
  `dist/mcp/index.js`, which starts from any working directory. `.kiro/settings/mcp.json` SHALL
  register it for this workspace as `make-dinner`, every tool auto-approved (all are read-only).
- KM6.3 `README.md` SHALL say how to build the server and add it to one's own MCP client, with a
  config example using an absolute path.

### KM7. The taster

**User story:** As the developer, I want an agent that tastes a schedule as a cook would.

- KM7.1 `.kiro/agents/taster.json` SHALL give the taster file read and the `make-dinner` tools
  only: no write, no shell, no other MCP server.
- KM7.2 Given a sample id or a plan, it SHALL schedule it under the design's kitchens and report,
  quoting tool output, each hold exceeded, each cook double-booked according to the step text and
  each start a cook would question, or say it found nothing. One run on `sunday-roast` SHALL be
  recorded with `scripts/kiro-run.sh`.

### KM8. Tests and limits

- KM8.1 Every tool SHALL have in-process tests over the SDK's `InMemoryTransport` pair, for
  success and each error code it can return; one test SHALL build and spawn `dist/mcp/index.js`
  over stdio, list the tools and call `schedule_plan` on a sample.
- N1 Thin adapter: no scheduling logic, no new dependency, named exports, no side effects outside
  `src/mcp/index.ts`. Out of scope: recipe parsing over MCP, HTTP transports, MCP resources and
  prompts, writing to disk, a hosted endpoint, changes to core results.
