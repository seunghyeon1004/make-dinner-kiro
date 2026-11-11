Write the spec `kitchen-mcp` in .kiro/specs/kitchen-mcp/: requirements.md, then design.md, then tasks.md. No code in this session.

The scheduler is deterministic core code, so any agent should be able to use it as a tool. This spec adds an MCP server (stdio) in src/mcp that exposes the core and nothing else, registers it in .kiro/settings/mcp.json for this workspace, and uses it during development: Kiro itself can then answer "schedule the Sunday roast with one burner" or "does every sample still land within its holds after this change" by calling the real scheduler instead of reasoning about it. Read the steering (structure.md names the tools: check_plan, schedule_plan, rebuild_plan, export_dinnerfile, import_dinnerfile; product.md: no model calls here), the specs recipe-graph, scheduler, rebuild and dinnerfile (exact core signatures), and the installed @modelcontextprotocol/sdk version's real API (look in node_modules before fixing signatures). Follow the format of the earlier specs.

Scope:
- Tools with zod input schemas and structured results: check_plan(plan) -> issues; schedule_plan(plan, kitchen) -> schedule or typed error; rebuild_plan(schedule, progress, now) -> rebuilt or typed error; export_dinnerfile(plan, options?) -> text; import_dinnerfile(text) -> plan or line-numbered errors; plus list_samples() and get_sample(id) -> the recorded plan, so an agent has something to schedule without pasting JSON. Each tool also returns a short human-readable text block (for schedule_plan: the plan list as text, one line per step with relative minutes, lanes and marks).
- Errors are tool results with isError, never thrown protocol errors, and never contain stack traces.
- No network, no file writes, no environment access beyond reading samples/ and recordings/ relative to the package root.
- `npm run mcp` starts it from source with tsx; the build emits dist/mcp/index.js; .kiro/settings/mcp.json registers it for this workspace under the name `make-dinner`.
- Tests: in-process tests using the SDK's in-memory transport pair (client and server linked without a process) for every tool, success and error; one test that spawns the built server over stdio, lists the tools and calls schedule_plan on a sample.
- A custom agent .kiro/agents/taster.json that uses only this MCP server and read access: given a sample id or a plan, it schedules it under two or three kitchens and reports, as a cook would read it, anything odd (a dish waiting past its hold, a cook double-booked according to the text, a start time that makes no sense), quoting the tool results. Its config and a recorded run are part of the tasks.
- The README section that tells a user how to add the server to their own MCP client.

Keep tasks.md to about 12 to 16 sub-tasks.

Length: this is a thin adapter over core. Aim for requirements.md under 110 lines, design.md under 260 lines and tasks.md under 130 lines. Read only what you need: the core index.ts exports, the Schedule, Progress and Dinnerfile types, and the MCP SDK's server and in-memory transport typings. Do not run exploratory scripts beyond confirming the SDK's import paths.
