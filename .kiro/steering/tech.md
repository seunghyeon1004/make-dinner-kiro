---
inclusion: always
---

# Tech

## Stack

- Runtime: Node 22 (`engines.node: ">=22 <23"`, `.nvmrc` with `22`) (decided here). ES modules (`"type": "module"`).
- Language: TypeScript, strict. Validation: zod.
- Server: Hono on `@hono/node-server`; serves `public/` and `/api/*`.
- Front end: Preact, bundled by esbuild into `public/assets/` (gitignored build output).
  Styling is plain CSS with custom properties, bundled by esbuild (decided here).
- Model: `@anthropic-ai/sdk`, model id `claude-opus-5-5`, server side only.
- MCP: `@modelcontextprotocol/sdk`, stdio transport, exposes the deterministic core only (decided here).
- Tests: vitest (examples), fast-check (properties), Playwright with `@axe-core/playwright` (e2e, accessibility).
- Tooling: eslint with typescript-eslint, prettier, tsx for running TS in dev (decided here).
- Deploy: Dockerfile at the repo root, Render free plan, health check `GET /api/health`.
- No database, no accounts, no analytics, no web fonts, no CSS framework, no state library.

## Versions policy

- Every dependency in `package.json` is pinned to an exact version: no `^`, no `~`, no ranges,
  no `latest`. `.npmrc` contains `save-exact=true` (decided here).
- `package-lock.json` is committed. Install with `npm ci` in Docker and CI.
- Adding a dependency needs a one-line reason in the session's reply. Prefer the platform.

## Commands

| command             | does                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `npm test`          | `vitest run` over `test/**/*.test.ts`. No network, no key needed.    |
| `npm run test:props`| `vitest run` over `test/**/*.pbt.ts` (fast-check properties).        |
| `npm run test:e2e`  | `playwright test` over `e2e/` against a built app, key unset.        |
| `npm run typecheck` | `tsc --noEmit` for every tsconfig (core, server, mcp, web, test).    |
| `npm run lint`      | `eslint .` including the import-boundary rules in `structure.md`.    |
| `npm run format`    | `prettier --write .` (CI runs `prettier --check .`).                 |
| `npm run build`     | `tsc` to `dist/` for core, server and mcp; esbuild bundle to `public/assets/`. |
| `npm run dev`       | server with `tsx watch` plus esbuild watch. Long-running: the user starts it. |
| `npm start`         | `node dist/server/index.js`.                                         |
| `npm run check:contrast` | checks every token pair in `ui.md` meets WCAG AA (decided here). |
| `npm run record`    | re-records sample parses from the real model; needs a key (decided here). |

Never start `npm run dev` or any watcher from an agent session.

## TypeScript rules

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`.
- `module`/`moduleResolution`: `NodeNext` for core, server, mcp and tests. Relative imports
  carry the `.js` suffix (`import { schedule } from '../core/schedule.js'`). The web code uses
  the same `.js` suffixes so core files read identically everywhere (decided here).
- `src/core` compiles with `lib: ["ES2023"]` and `types: []`: no DOM, no Node types. Lint bans
  `Date`, `Math.random`, `performance`, `crypto`, `setTimeout` and `process` there (decided here).
- No `any`; use `unknown` and narrow. No non-null `!` except with a comment saying why it holds.
- No default exports; named exports only (decided here). No enums; use string literal unions.
- Types for domain data are inferred from zod schemas (`z.infer`), defined once in `src/core/schema.ts`.

## Error handling

- Core never throws on bad input. Fallible functions return
  `type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }` with a typed,
  discriminated `E` (`{ kind: 'cycle'; path: string[] }`, ...). A throw from core means a bug.
- Sanity findings are data (`Issue { severity: 'error' | 'warning'; code; stepId?; message }`),
  not exceptions.
- The server validates every request body with zod at the boundary and maps every failure to
  JSON `{ "error": { "code": string, "message": string } }` with a fitting status (decided here):
  `bad_request` 400, `input_too_long` 413, `invalid_plan` 422, `rate_limited` 429,
  `daily_cap_reached` 429, `model_unavailable` 503 (no key, network, 5xx), `model_refused` 502,
  `model_output_invalid` 502, `not_found` 404, `internal` 500.
- One Hono `onError` handler turns unexpected throws into `internal` with a generic message;
  stack traces go to the server log only, never to the response.
- `message` is plain English the UI can show as is. It never contains secrets or raw model output.

## Model calls (server only)

- Only `src/server/parse/` talks to Anthropic, through an injected client interface so tests
  can replay recordings.
- Order in `POST /api/parse`: validate (max 12,000 characters) → normalise → recorded sample
  match → rate limit → daily cap → key present → model call → schema → sanity rules.
- Normalisation (decided here, pure, in core): Unicode NFC, CRLF to LF, trailing whitespace
  stripped per line, runs of blank lines collapsed to one, whole text trimmed.
- The prompt states that recipe text is data, not instructions.

## Environment variables (decided here, except `ANTHROPIC_API_KEY` and `PORT`)

| name                      | default  | meaning                                         |
| ------------------------- | -------- | ----------------------------------------------- |
| `ANTHROPIC_API_KEY`       | unset    | model key; unset means samples and import only  |
| `PORT`                    | `3000`   | listen port (Render sets it)                    |
| `PARSE_RATE_PER_IP`       | `5`      | model calls per IP per window                   |
| `PARSE_RATE_WINDOW_SEC`   | `600`    | rate-limit window                               |
| `PARSE_DAILY_CAP`         | `200`    | model calls per UTC day, all clients            |
| `TRUST_PROXY`             | `false`  | read client IP from `X-Forwarded-For` (Render: `true`) |
| `LOG_LEVEL`               | `info`   | `debug`, `info`, `warn`, `error`                |

Read and validate env once at startup with zod in `src/server/env.ts`. `.env.example` lists
every variable with an empty key.

## The API key

The Anthropic key is never logged, never returned in a response or error, never put in the
browser bundle, the Dinnerfile, a recording, a test fixture, a snapshot or a commit. Logging
redacts any field named like `key`, `token`, `secret` or `authorization`. The web bundle must
not import from `src/server`; the build fails if `ANTHROPIC` or `sk-ant-` appears in
`public/assets/` (decided here).
