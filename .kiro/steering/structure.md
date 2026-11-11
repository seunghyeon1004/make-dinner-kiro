---
inclusion: always
---

# Structure

## Layout (decided here, following the brief's architecture)

```
src/
  core/                 pure, isomorphic; imports only zod
    schema.ts           zod schemas and inferred types: Step, Dish, Plan, Kitchen, Schedule, Issue
    result.ts           Result<T, E> and helpers
    sanity.ts           checkPlan(plan) and checkKitchen(plan, kitchen) -> Issue[]
    graph.ts            successors, terminal steps, topological order, cycle path
    schedule.ts         schedule(plan, kitchen) -> Result<Schedule, ScheduleError>
    passes/             backward.ts, prep-forward.ts, right-justify.ts, lanes.ts, readout.ts
    timeline.ts         resource usage per minute, used by schedule and by tests
    rebuild.ts          rebuild(schedule, progress, now) -> Result<Rebuilt, RebuildError>
    dinnerfile.ts       toDinnerfile(plan) and fromDinnerfile(text)
    normalise.ts        normaliseRecipeText(text)
    index.ts            the public surface; other packages import only from here
  server/
    index.ts            starts Hono on PORT
    app.ts              createApp(deps) -> Hono app; no side effects at import time
    env.ts              zod-validated environment
    errors.ts           ApiError codes and the { error: { code, message } } mapper
    routes/             health.ts, parse.ts
    parse/              anthropic-client.ts, prompt.ts, recordings.ts, limits.ts
  web/
    main.tsx            mounts the app
    app.tsx             screen routing: menu, steps, plan, cook
    screens/            Menu.tsx, Steps.tsx, Plan.tsx, Cook.tsx
    components/         Timeline.tsx, PlanList.tsx, StepEditor.tsx, IssueList.tsx, Countdown.tsx, ...
    state/              store.ts, share-link.ts (URL fragment), persist.ts (localStorage), clock.ts
    styles/             tokens.css, base.css, print.css
  mcp/
    index.ts            stdio MCP server: tools check_plan, schedule_plan, rebuild_plan,
                        export_dinnerfile, import_dinnerfile (no model calls)
public/
  index.html            static shell; links /assets/main.js and /assets/main.css
  assets/               esbuild output, gitignored
samples/                <sample-id>.md recipe text; index.json lists id, title, dish names
recordings/             <sample-id>.json recorded model parses, written only by `npm run record`
test/                   mirrors src/: test/core/schedule.test.ts, test/core/schedule.pbt.ts, ...
  support/              arbitraries.ts (fast-check generators), oracles.ts (independent
                        recomputations), fixtures.ts (hand-written example plans)
  meta/                 guarantees.test.ts: every guarantee id has a property
e2e/                    *.spec.ts Playwright flows and axe checks, phone viewport
scripts/                kiro-run.sh, check-contrast.ts, record.ts, build-web.ts
docs/
  BRIEF.md
  kiro-evidence/        session transcripts and credits.log; written by scripts/kiro-run.sh only
.kiro/
  steering/  specs/<feature>/{requirements,design,tasks}.md  hooks/
Dockerfile  package.json  package-lock.json  tsconfig*.json  eslint.config.js
.prettierrc.json  .npmrc  .nvmrc  .env.example  playwright.config.ts  vitest.config.ts
```

Samples (decided here): `sunday-roast`, `halloween-party`, `weeknight-curry`,
`vegetarian-feast`, `korean-table` (the fifth added by hand). Each has a matching file in `recordings/`.

## Import rules (enforced by eslint `no-restricted-imports`)

- `src/core` imports nothing but `zod` and other files in `src/core`.
- `src/server`, `src/web` and `src/mcp` import core only through `src/core/index.js`.
- `src/web` and `src/server` never import each other. `src/mcp` imports neither.
- `src/web` never imports `@anthropic-ai/sdk`, `node:*`, or `hono`.
- Tests may import any `src/` file directly, and `test/support/`. `src/` never imports `test/`.
- No circular imports inside a package (eslint `import/no-cycle`) (decided here).

## Naming conventions

- Files: kebab-case `.ts` (`prep-forward.ts`); Preact components PascalCase `.tsx`
  (`Timeline.tsx`), one component per file.
- Tests: `<module>.test.ts` for examples, `<module>.pbt.ts` for properties, next to the
  mirrored path. E2E: `e2e/<flow>.spec.ts`.
- Functions and variables camelCase, types and components PascalCase, constants
  `UPPER_SNAKE` only for true module-level constants.
- Zod schemas are `<Type>Schema` (`StepSchema`) and the type is `type Step = z.infer<typeof StepSchema>`.
- Error and issue codes are snake_case string literals (`unknown_dependency`, `cycle`,
  `missing_appliance`, `hold_exceeded`).
- Ids in data (decided here): dish id `^[a-z0-9]+(-[a-z0-9]+)*$`; step id
  `<dish-id>.<slug>`, e.g. `chicken.roast`, matching `^[a-z0-9-]+\.[a-z0-9-]+$`. These are
  safe as Make target names.
- Time values are named for their unit: `minutes`, `startMin`, `endMin`, `holdMin`, `slackMin`.
  Minute values on the scheduler axis are integers, `<= 0` means at or before serving.
- Glossary terms from `product.md` are used in identifiers: `terminal`, `hold`, `slack`,
  `critical`, `lane`, `rebuild`. Not `task`, `job`, `deadline buffer`, `track`.

## Where things go

- A new scheduling rule: `src/core/passes/` plus a property in `test/core/*.pbt.ts`.
- A new sanity rule: `src/core/sanity.ts` plus examples for both the firing and the
  non-firing case in `test/core/sanity.test.ts`.
- A new API route: `src/server/routes/`, registered in `app.ts`, with a test calling
  `app.request()` (no listening socket).
- Browser-only behaviour (timers, wake lock, storage): `src/web/state/`, behind small
  functions that take the clock or storage as parameters so they can be tested.
