T1 to T4 are done. On your open question about empty pinned intervals: an empty pinned interval (a step done in zero time cannot exist: minutes >= 1; an interval is empty only if the cook recorded end == start) occupies no minute, so it never clashes with anything; make the lane oracle and the algorithm agree on that if they do not, and say what you changed.

Spec rebuild: T5 (rebuild), T6 (properties R1 to R6 and P-RB) and T7 (public surface and the whole suite); that completes the spec. Read .kiro/specs/rebuild/requirements.md, design.md (including "Conflicts found" and the review notes at the end) and tasks.md in full first. The hand-worked tables RB-a, RB-b, RB-c and the situations table are the expected results: if your implementation disagrees with one, work the case by hand before deciding which is wrong; if the table is wrong, stop and report it with your working.

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Never lower a run count in code; a failing property is a scheduler bug until shown otherwise.

Working rule: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made", and continue. Stop and ask only when a requirement, a guarantee, a property or a hand-worked table would have to change.

Do not commit. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint` and `npx prettier --check .`.
