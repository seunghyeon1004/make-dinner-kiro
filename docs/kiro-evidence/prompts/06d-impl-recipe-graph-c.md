Spec: recipe-graph. First T2.7 (added to tasks.md by hand: failing properties must report a shrunk counterexample instead of crashing; you found this problem last session). Then T6 (plan and kitchen rules), T7 (normalisation) and T8 (public surface and the whole suite), in that order. That completes the spec.

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Property tasks are real fast-check properties using `fcParams()`; never lower the run count in code.

Working rule: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made", and continue. Stop and ask only when a requirement, a guarantee or a property would have to change.

Keep the example tests proportionate: one per rule and boundary the requirement names. Do not commit. End with the report kiro-conduct.md asks for, including the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint`, `npx prettier --check .` and `npm run build`.
