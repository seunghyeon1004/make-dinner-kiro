Spec: cooking-mode. Implement T1 (session state and transitions, pure) and T2 (the view, pure), in order, and nothing after. The plan-ui spec is fully implemented.

Read .kiro/specs/cooking-mode/requirements.md, design.md (including the review notes at the end: there is no automatic rebuild for overdue steps; adjust the affected requirement, example, property wording and tasks as the note says and list what you changed) and tasks.md in full first, and ui.md. Use the exact copy, tokens, signatures and file paths the design gives. The recordings now exist (recordings/*.json, made from real model calls), so the server starts and `npm run test:e2e` works.

Each sub-task: test first (unit test or e2e as the task says), see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Keep tests proportionate: the cases the task names, not a matrix. E2E runs are slow, so while iterating run the single spec file and project you are working on (`npx playwright test e2e/<file> --project=phone`), then the task's full command once before ticking.

Look at what you build: after each screen works, take a screenshot at 390x844 in light and dark with Playwright (a throwaway script outside the repo's tracked files, or `page.screenshot` in a scratch spec you delete) and check it against ui.md with your own eyes: spacing rhythm, type scale, targets at least 48 px, nothing overflowing, no horizontal page scroll. Fix what looks wrong before ticking. Say in your report what you looked at and what you changed.

Working rule: when the design is ambiguous or slightly off in a way that touches no requirement's intent, choose the reading closest to the requirement and to ui.md, write it under "Decisions I made", and continue. Stop and ask only when a requirement would have to change.

Do not commit. Do not start `npm run dev`. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint`, `npx prettier --check .`, `npm run build` and `npm run test:e2e`.
