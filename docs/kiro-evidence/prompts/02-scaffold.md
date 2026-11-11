Scaffold the project exactly as the steering files describe (tech.md, structure.md, testing.md). There is no spec for this session: it is tooling only, and no feature code. Features come later, each from its own spec.

Deliver:

1. package.json (name "make-dinner", private, type module, engines node >=22 <23, MIT), .npmrc (save-exact=true), .nvmrc, with every script from tech.md. Install the dependencies the steering names, each pinned to an exact current version (look the versions up with `npm view <pkg> version`, do not guess): zod, hono, @hono/node-server, @anthropic-ai/sdk, preact, @modelcontextprotocol/sdk; dev: typescript, tsx, esbuild, vitest, fast-check, @playwright/test, @axe-core/playwright, eslint, typescript-eslint, eslint-plugin-import (or eslint-plugin-import-x if that is what works with flat config), @vitest/eslint-plugin, prettier, @types/node. Commit-ready package-lock.json. Do not run `npx playwright install` (Chromium is already installed on this machine).

2. TypeScript: a base tsconfig and one per package as tech.md says (core with lib ES2023 and types [], server, mcp, web with JSX for Preact and DOM lib, test). `npm run typecheck` must check all of them.

3. eslint.config.js (flat config) enforcing: the import boundaries in structure.md, the banned globals in src/core (Date, Math.random, performance, crypto, setTimeout, setInterval, process), no default exports, no disabled or focused tests, no-cycle. prettier config (.prettierrc.json: single quotes, semicolons, trailing commas, printWidth 100) and .prettierignore (ignore .kiro/, docs/kiro-evidence/, recordings/, public/assets/, dist/, package-lock.json).

4. vitest.config.ts so that `npm test` runs test/**/*.test.ts and `npm run test:props` runs test/**/*.pbt.ts. playwright.config.ts with a phone project (390x844) and a desktop project, a webServer that runs `npm run build && npm start` on a free port with ANTHROPIC_API_KEY unset, testDir e2e.

5. The smallest real code that lets every command run green, and nothing more:
   - src/core/result.ts (the Result type and ok/err helpers) and src/core/index.ts exporting it, with test/core/result.test.ts.
   - src/server/env.ts, errors.ts, app.ts (createApp(deps)), routes/health.ts (GET /api/health -> { status: "ok" }), index.ts; static serving of public/; the single onError handler; test/server/health.test.ts and a test that an unknown /api route returns 404 with { error: { code: "not_found" } }.
   - public/index.html shell and src/web/main.tsx rendering a placeholder heading "Make Dinner", src/web/styles/tokens.css with the tokens from ui.md (both themes), scripts/build-web.ts (esbuild, fails the build if "ANTHROPIC" or "sk-ant-" appears in public/assets/), scripts/check-contrast.ts implementing the rule in ui.md (parse tokens.css, both themes, fail on any pair below threshold) with a test for its contrast function.
   - e2e/smoke.spec.ts: the page loads, shows the heading, and has zero axe violations.
   - test/core/placeholder.pbt.ts is NOT wanted; instead make `npm run test:props` pass with zero property files only if vitest allows it cleanly (passWithNoTests for that script only). Do not write fake properties.

6. Dockerfile and render.yaml. Dockerfile: node:22-slim, WORKDIR /app, copy package*.json, `npm ci`, copy the rest, `npm run build`, ENV NODE_ENV=production PORT=3000, EXPOSE 3000, a HEALTHCHECK that fetches /api/health with node, CMD ["npm","start"]. Keep devDependencies installed (the build needs them; the free plan image size is fine). render.yaml: one free web service, runtime docker, healthCheckPath /api/health, envVars ANTHROPIC_API_KEY (sync: false), PARSE_RATE_PER_IP, PARSE_RATE_WINDOW_SEC, PARSE_DAILY_CAP, TRUST_PROXY=true. Add .dockerignore and .env.example. Do not run docker (it is switched off on this machine).

7. Run, and paste the real results of: `npm run typecheck`, `npm run lint`, `npx prettier --check .`, `npm test`, `npm run test:props`, `npm run build`, `npm run check:contrast`, `npm run test:e2e`. All must pass. If the e2e run cannot start a browser, say so plainly rather than marking it passed.

Constraints: do not commit. Do not create specs, hooks or agents. Do not add dependencies beyond the list without saying why. Do not start watchers.
