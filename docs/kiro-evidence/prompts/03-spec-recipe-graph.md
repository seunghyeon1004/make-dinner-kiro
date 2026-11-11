Write the spec `recipe-graph` in .kiro/specs/recipe-graph/: requirements.md, then design.md, then tasks.md. No code in this session.

This is the foundation every other feature stands on: the domain model, its zod schemas, the dependency-graph helpers and the sanity rules. Read docs/BRIEF.md (sections "Domain model" and "Sanity rules") and the steering files first; they already fix the names, the file layout (src/core/schema.ts, result.ts, graph.ts, sanity.ts, normalise.ts, index.ts), the id patterns, the Result type, the issue codes style and the property ids S1 and S2.

Scope of this spec:
- Schemas and inferred types for Step, Dish, Plan, Kitchen and Issue, with the bounds from the brief (minutes 1..480, at most 12 dishes and 80 steps, kitchen 0..8 burners, 0..4 ovens, 1..6 cooks, title and detail length limits you choose and state).
- `parsePlan(input: unknown)`: schema validation of any JSON value into a Plan or a list of issues; never throws (S1).
- Graph helpers: successors, terminal steps, a deterministic topological order, cycle detection that reports the cycle path, longest dependency chain in minutes.
- `checkPlan(plan)`: every error and warning rule from the brief that does not need the kitchen. `checkKitchen(plan, kitchen)`: the missing-appliance error. Each issue has severity, a stable snake_case code, the step or dish it concerns when there is one, and a plain-English message a cook can act on.
- Canonical form: a function that returns the plan with dishes, steps and each `after` list in a stable order, so that later features (determinism G7.2, Dinnerfile round trip D1) have one definition of "the same plan".
- `normaliseRecipeText` as tech.md defines it.
- test/support/arbitraries.ts: the generators testing.md names that this spec needs (arbKitchen, arbPlan, arbPlanAndKitchen, arbBrokenPlan), valid by construction, and test/support/fixtures.ts with two or three hand-written plans that later specs will reuse (include one small "sunday roast" with a real cross-dish dependency: the gravy needs the roasting tin after the chicken comes out).

Format:
- requirements.md: a short "Why", "Scope", then numbered requirements with a user story and EARS acceptance criteria (WHEN/IF ... THE SYSTEM SHALL ...), ids R1.1, R1.2 ...; non-functional requirements N1...; "Out of scope".
- design.md: real file paths, exact exported types and function signatures, the full table of issue codes (code, severity, when it fires, example message), the algorithms in a few lines each, and a "Correctness properties" section listing each property with its id (S1, S2 and any new ones you need: give new ones ids P-RG1, P-RG2 ...), which requirement it validates and what the generator is.
- tasks.md: a checklist of small tasks in dependency order, test first. Each task names the files it touches, the requirement ids it covers, and the exact command that proves it. Property-test tasks are separate items. Use `- [ ]` checkboxes with ids T1, T1.1 ...

Do not restate the steering files; refer to them. Where you decide something neither the brief nor the steering fixes, mark it "(decided here)" and list those decisions at the end of your reply, with any open question you want answered before implementation.
