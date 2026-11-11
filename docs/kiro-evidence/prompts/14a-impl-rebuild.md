Two pieces of work, in order.

1. Spec scheduler, task T8.19 only (added to tasks.md by hand): the new guarantee G9 in .kiro/steering/scheduler-guarantees.md. `npm test` is red right now for exactly this reason: the coverage check demands a G9 property, and one meta test used "G9" as its example of an unknown id (change that example to an id that is still unknown, such as G12; that keeps the test's meaning). Do what T8.19 says, including the demonstration that the property fails when pass 3 is skipped, and restore the code afterwards.

2. Spec rebuild: T1 (types), T2 (test support), T3 (forward repair and re-align) and T4 (lanes and readout), in that order, and nothing after T4. Read .kiro/specs/rebuild/requirements.md, design.md (including "Conflicts found" and the review notes at the end) and tasks.md in full first. The hand-worked tables RB-a, RB-b, RB-c and the situations table are the expected results: if your implementation disagrees with one, work the case by hand before deciding which is wrong; if the table is wrong, stop and report it with your working.

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Never lower a run count in code; a failing property is a scheduler bug until shown otherwise.

Working rule: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made", and continue. Stop and ask only when a requirement, a guarantee, a property or a hand-worked table would have to change.

Do not commit. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint` and `npx prettier --check .`.
