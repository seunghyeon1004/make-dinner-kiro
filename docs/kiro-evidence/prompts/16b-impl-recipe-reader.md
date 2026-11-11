Two pieces of work, in order.

1. A reviewed change to a definition, across specs scheduler and rebuild. .kiro/steering/scheduler-guarantees.md now defines `wait(s)` for a non-terminal step as `min(start(u) for u in succ(s)) - end(s)` (the first user), not the latest user; read the note there for why (the first real recording showed the old rule warning about a roast that was not waiting). Carry this through, test first:
   - the scheduler and rebuild designs (the readout sections, the corner-case note about a step with several successors, and every hand-worked table whose wait column or warnings change: recompute those cells by hand and list each changed cell in your report; H1's `chicken.roast` wait goes from 5 to 0, for example);
   - the oracles (`oracleWaits` or whatever computes waits independently), with their example tests;
   - `src/core/passes/readout.ts` for both `readout` and `rebuildReadout`, and the `hold_exceeded` message if its wording depends on which user ("the step that uses it" should become "the first step that uses it" only if the design's message table says so after your edit; keep messages and tests identical);
   - any example test whose expected wait or warning changes. A changed expectation is legitimate only where the definition changed it; say which.
   This is a definition change made in review, not a weakened check: G4.3 still demands that every wait over its hold is reported and every warning is true, now under the new definition. Do not touch any other property.

2. Spec recipe-reader: T6.4 and T7. The user has run `npm run record`; recordings/*.json now exist for all five samples (never edit them). Also fold the review's `not-a-recipe` sentinel into requirements.md (a requirement id in the right group), the error table and the route-order table of design.md, since the last session left those out; and pluralise the record script's "1 warnings" properly ("1 warning", "2 warnings") with its test.

Each sub-task or change: test first, see it fail on an assertion, implement, run the proving command, tick only what passed in this session. Never lower a run count. `npm run test:e2e` must start the server now that recordings exist: run it and report the real result (the existing smoke test may need its heading assertion kept as is; do not change e2e files beyond what T7 says).

Do not commit. End with the report kiro-conduct.md asks for, with the real counts from `npm test`, `npm run test:props`, `npm run typecheck`, `npm run lint`, `npx prettier --check .`, `npm run build` and `npm run test:e2e`.
