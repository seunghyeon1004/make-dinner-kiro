Two pieces of work, in order.

1. Spec rebuild, task T6.9 only (added to tasks.md by hand): the new guarantee R7 in .kiro/steering/scheduler-guarantees.md. `npm test` is red until an R7 property exists, because the coverage check demands one. Do what T6.9 says, including the demonstration that the property fails when re-align is skipped, and restore the code afterwards (use a file copy to restore, not git).

2. Spec dinnerfile: all of it, T1 to T4, in order. Read .kiro/specs/dinnerfile/requirements.md, design.md (including "Conflicts found" and the review notes at the end: 50 runs for the properties that spawn `make`, at most 50 import errors then a summary line) and tasks.md in full first. The two complete Dinnerfiles in the design (sunday-roast and the worst case) are expected output, character for character: if your export disagrees, work out which is wrong before changing anything, and if the design is wrong stop and report it.

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Never lower a run count in code. The D2 property runs the real `make`; it must fail, not skip, if `make` is missing.

Working rule: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made", and continue. Stop and ask only when a requirement, a guarantee, a property or an expected file would have to change. The generators become more hostile in T1 (titles with shell and Make metacharacters, dishes named `dinner`): if an existing property of another spec now fails, that is a real finding; keep the shrunk counterexample as a named example test and fix the code, never the generator.

Do not commit. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint` and `npx prettier --check .`.
