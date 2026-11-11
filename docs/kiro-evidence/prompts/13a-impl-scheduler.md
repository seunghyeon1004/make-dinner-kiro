Spec: scheduler. Implement T1 (types), T2 (test support), T3 (guarantee coverage check) and T4 (timeline), in that order, and nothing after. Note for T3: the coverage check will list G families that have no property yet; follow the design on how it stays honest until T8 adds them (it must not pass vacuously, and you must not tick T3.1 on a check that cannot fail).

Read .kiro/specs/scheduler/requirements.md, design.md and tasks.md in full first, and the recipe-graph code they build on. The hand-worked tables H1 to H6 in the design are the expected results: if your implementation disagrees with a table, work the case by hand before deciding which is wrong; if the table is wrong, stop and report it with your working (do not change the expected values to match the code).

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Property tasks are real fast-check properties using `fcParams()`; never lower the run count in code; a failing property is a scheduler bug until shown otherwise (scheduler-guarantees.md).

Working rule: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made", and continue. Stop and ask only when a requirement, a guarantee, a property or a hand-worked table would have to change.

Keep example tests proportionate. Do not commit. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint` and `npx prettier --check .`.
