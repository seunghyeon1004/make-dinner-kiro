Spec: recipe-graph. Implement T3 (graph helpers), T4 (canonical form) and T5 (parsing), in that order, and nothing after T5. T1 and T2 are done and ticked.

Each sub-task: test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Property tasks are real fast-check properties using the generators in test/support/arbitraries.ts and `fcParams()`; never lower the run count in code.

Working rule: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made" in your report, and continue. Stop and ask only when a requirement, a guarantee or a property would have to change.

Keep the example tests proportionate: one test per rule and boundary the requirement names, not a matrix. Do not commit. End with the report kiro-conduct.md asks for.
