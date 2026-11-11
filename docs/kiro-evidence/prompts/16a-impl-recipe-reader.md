Spec: recipe-reader. Implement T1 to T5 and then T6.1 and T6.2, in order, and nothing after T6.2 (T6.3 is the user's task: recording with the real key; T6.4 and T7 follow in a later session).

Read .kiro/specs/recipe-reader/requirements.md, design.md (including the review notes at the end: the `not-a-recipe` sentinel that becomes `invalid_plan` 422, and the shared response schemas and `RECIPE_TEXT_MAX` in a new src/core/api.ts) and tasks.md in full first. Fold the two review decisions into the tasks where they belong (the sentinel into the prompt block, the error table and the route tests; the shared schemas into T1 or T2), say exactly what you added, and keep the prompt text in the design and in code identical (the design is the source; update the block between the markers there for the sentinel instruction and nothing else).

Rules that matter here more than anywhere:
- No test may reach the network or need a key. `npm test` runs with ANTHROPIC_API_KEY unset.
- Never print, log or echo the key, in code or in your commands. Do not read ~/.secrets or any .env file.
- Do not run `npm run record` and do not create anything under recordings/. Until the user has recorded, the server refuses to start; that is expected, and tests use the not-a-recording fixtures.
- The real Anthropic client is built only in src/server/index.ts and scripts/record.ts. Check the SDK's actual exported types in node_modules before writing the call (typed error classes, the `output_config` shape, `stop_reason` values); do not guess names.

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Never lower a run count.

Working rule: when the design is ambiguous or slightly off in a way that touches no requirement's intent, choose the reading closest to the requirement, write it under "Decisions I made", and continue. Stop and ask only when a requirement or a security rule would have to change.

Do not commit. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint`, `npx prettier --check .` and `npm run build`.
