Spec: recipe-graph. Continue where the last session stopped (mid T1.2), then finish T1 and T2, and nothing after T2.

Decision on your open question: R1.5 now counts Unicode code points, which is what zod's `max` counts; requirements.md and the design comment were changed by hand. Change the surrogate-pair test to match the requirement (119 letters plus one astral character is 120 code points and is accepted; 120 letters plus one is rejected). This is a correction of the spec, not a weakened check.

Working rule from now on: when the design is ambiguous or slightly off in a way that touches no guarantee, no schema bound and no sanity rule, choose the reading closest to the requirement, write it under "Decisions I made" in your report, and continue. Stop and ask only when a requirement, a guarantee or a property would have to change.

As before: each sub-task test first, see it fail on an assertion, implement, run the proving command the task names, tick the sub-task only when it passed in this session. Do not commit. End with the report kiro-conduct.md asks for.
