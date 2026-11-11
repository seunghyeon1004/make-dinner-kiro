# Requirements: dinnerfile

## Why

The Dinnerfile is the visible seam between the step graph and the build system the brief
borrows from: a plan exported as a real Makefile that GNU Make accepts, and that the app reads
back without the model. Cooks keep it, share it, edit it by hand and paste it into the menu
screen. Titles and details are free text, so the file is also the place where a step title
could turn into a Make expansion or a shell command. This spec fixes the file format as a
grammar, the encodings that keep free text inert, what import accepts and what it rejects.

## Scope

In `src/core` (pure, see `tech.md` and `structure.md`):

- `toDinnerfile(plan, options?)` and `fromDinnerfile(text)` in `src/core/dinnerfile.ts`.
- `ServeTimeSchema` in `src/core/schema.ts` for the optional serving time.
- The grammar of the file, the encoding of text in metadata comments and in the `@echo` line,
  target names and their collisions, the optional `# kitchen` and `# serve` comments.

In `test/support`: generator extensions, Dinnerfile generators, oracles, fixtures, a GNU Make
runner and a run-count helper for properties that spawn `make`.

Terms are the glossary in `product.md`. "Error" in R6 to R8 means a `DinnerfileError`, not an
`Issue`. "The design" is `design.md` in this folder. "Valid plan" is a plan for which
`validatePlan` returns a plan and no error issue.

## Requirements

### R1. Export layout

**User story:** As a cook, I want to export my plan as a file GNU Make accepts, so that I can
see the dependency graph run as a real build and keep the plan without the app.

- R1.1 WHEN `toDinnerfile(plan, options)` receives a plan that passes `PlanSchema` and options
  that pass R5.1, THE SYSTEM SHALL return `{ ok: true, value: text }` where `text` follows the
  layout in the design: the fixed header comments, the `# plan` line, the optional
  `# kitchen` and `# serve` lines, one `# dish` line per dish, the `.PHONY` rule, the `dinner`
  rule, one dish rule per distinct dish id, and one step block per step.
- R1.2 IF the plan fails `PlanSchema`, or `options.kitchen` fails `KitchenSchema`, or
  `options.serve` fails `ServeTimeSchema`, THEN `toDinnerfile` SHALL return
  `{ ok: false, error: Issue[] }` with the issues `parsePlan` and `parseKitchen` give and one
  `invalid_field` issue with `field: 'serve'` for a bad serving time, and SHALL NOT throw
  (decided here).
- R1.3 THE SYSTEM SHALL write dishes, steps and every prerequisite list in `canonicalPlan`
  order, so that `toDinnerfile` returns the same text for any permutation of `steps`,
  `dishes` and each `after` list.
- R1.4 THE SYSTEM SHALL write only LF line endings, no white space at the end of any line, no
  line that ends in `\`, and exactly one `\n` at the end of the text (decided here).
- R1.5 THE SYSTEM SHALL write the `dinner` rule as the first rule whose target is not
  `.PHONY`, so that `make -f Dinnerfile` with no goal makes `dinner` (decided here).
- R1.6 THE SYSTEM SHALL give the `dinner` rule the terminal steps of the plan as
  prerequisites (`terminalSteps(plan)`).
- R1.7 THE SYSTEM SHALL give the rule of each dish the dish's last steps as prerequisites:
  the steps whose `dish` is that dish and that no other step of the same dish lists in
  `after`, sorted by id (decided here).
- R1.8 THE SYSTEM SHALL list in the `.PHONY` rule `dinner`, every dish target and every step
  target, so that Make never checks for files of those names.
- R1.9 THE SYSTEM SHALL write each step as a block of three lines: its `# step` metadata line,
  its rule `<step-id>:` followed by its `after` entries, and its recipe line.

### R2. Text in metadata comments

**User story:** As a cook, I want any title, name or detail I typed to come back exactly as it
was, so that exporting and importing never changes my plan.

- R2.1 THE SYSTEM SHALL write the plan title, every dish name, every step title and every
  detail as a double-quoted string with the escapes listed in the design, and every other
  code point as itself (decided here).
- R2.2 THE SYSTEM SHALL write no metadata line that contains LF, CR, a code point in
  U+0000–U+001F or U+007F–U+009F, U+2028, U+2029, a bidirectional control listed in the
  design, U+FEFF or a lone surrogate.
- R2.3 THE SYSTEM SHALL end every metadata line that holds text with the closing `"` of that
  text, so that white space at the end of the text is never at the end of the line.
- R2.4 WHEN import decodes a string written by R2.1, THE SYSTEM SHALL return the original
  string unit for unit, with no Unicode normalisation.

### R3. The echo line

**User story:** As a cook running `make -n -f Dinnerfile dinner`, I want to see each step's
title in the order Make chose, and nothing in a title may make Make or the shell do anything
else.

- R3.1 THE SYSTEM SHALL write each step's recipe line as a tab, then
  `@echo '<argument>' # <step-id>` (the trailing shell comment decided here).
- R3.2 THE SYSTEM SHALL build the argument from the step title's display form: every code
  point in U+0000–U+001F or U+007F–U+009F and U+2028 and U+2029 replaced by a space, every
  bidirectional control listed in the design, U+FEFF and every lone surrogate replaced by
  U+FFFD, every other code point kept (decided here).
- R3.3 THE SYSTEM SHALL write each `'` of the display form as `'\''`, each `$` as `$$`, and
  SHALL add `''` after that `$$` when the next code point of the display form is `(` or `{`.
- R3.4 THE SYSTEM SHALL write no recipe line that contains `$(`, `${` or a run of `$` of odd
  length, so that Make expands no variable or function in it and GNU Make 3.81 does not treat
  it as a recursive `$(MAKE)` line that runs under `-n`.
- R3.5 WHEN GNU Make runs `make -n -f Dinnerfile <goal>` on an exported file, THE SYSTEM's
  file SHALL make Make print, for every step the goal needs, one line
  `echo '<argument>' # <step-id>` with each `$$` of the argument printed as `$`, whose
  single-quoted shell word reads as the display form of the step's title.
- R3.6 WHEN the exported file is run without `-n`, THE SYSTEM's file SHALL make the shell run
  only `echo` for each step, whatever the title contains.
- R3.7 THE SYSTEM SHALL never read data from a recipe line on import (R6.2).

### R4. Target names and collisions

**User story:** As a cook, I want `make -n -f Dinnerfile <dish-id>` to show one dish and
`make -n -f Dinnerfile dinner` the whole plan, whatever the dishes are called.

- R4.1 THE SYSTEM SHALL use as rule targets only `.PHONY`, `dinner`, dish ids and step ids,
  each written directly before its `:` with no white space between (decided here).
- R4.2 IF a dish id is `dinner`, THEN THE SYSTEM SHALL write no rule for that dish and SHALL
  write the fixed comment line given in the design in its place; the `dinner` rule stays the
  whole plan (decided here).
- R4.3 THE SYSTEM SHALL write every rule's prerequisites separated by one space, after one
  space following the `:`, and nothing after the last prerequisite.

### R5. Kitchen and serving time

**User story:** As a cook sharing a Dinnerfile, I want my kitchen and serving time to travel
with the plan, without them changing what Make does.

- R5.1 THE SYSTEM SHALL accept `options` of type `{ kitchen?: Kitchen; serve?: string }`
  where `serve` is a 24-hour time `HH:MM` from `00:00` to `23:59` (`ServeTimeSchema`,
  decided here).
- R5.2 WHEN `options.kitchen` is present, THE SYSTEM SHALL write
  `# kitchen burners=<n> ovens=<n> cooks=<n>` directly after the `# plan` line; WHEN
  `options.serve` is present, THE SYSTEM SHALL write `# serve <HH:MM>` after it (decided here).
- R5.3 THE SYSTEM SHALL write the options only as comment lines, so that removing the
  `# kitchen` and `# serve` lines from `toDinnerfile(plan, options)` gives
  `toDinnerfile(plan)`.
- R5.4 WHEN import reads a `# kitchen` or `# serve` line, THE SYSTEM SHALL return its values in
  `options`, and SHALL leave the key absent when the line is absent.

### R6. Import

**User story:** As a cook pasting a Dinnerfile, possibly edited by hand, I want the app to read
the plan back without the model, accept harmless edits, and refuse anything it might read
differently from what I meant.

- R6.1 WHEN `fromDinnerfile(text)` receives any string, THE SYSTEM SHALL return either
  `{ ok: true, value: { plan, options } }` or `{ ok: false, error: DinnerfileError[] }` with
  at least one error, and SHALL NOT throw.
- R6.2 THE SYSTEM SHALL read data only from the `# plan`, `# dish`, `# step`, `# kitchen` and
  `# serve` lines and from the targets and prerequisites of rules; recipe lines, `.PHONY`
  names and unknown comments are never read.
- R6.3 WHEN import succeeds, THE SYSTEM SHALL return a plan whose title is the `# plan` text,
  whose dishes are the `# dish` lines, and whose steps are the step rules, each with `id` the
  target, `after` its prerequisites and the other fields from its `# step` line; the plan is
  returned as `canonicalPlan` of that.
- R6.4 THE SYSTEM SHALL check in import only the lexical form of values given by the grammar
  (number syntax, `true`/`false`, the appliance words, `keeps`, id patterns, string syntax,
  `HH:MM`). Ranges, lengths and sanity rules are left to `validatePlan` and `parseKitchen`,
  which the caller runs on the result as for any other plan source (decided here).
- R6.5 THE SYSTEM SHALL attach each `# step` line to the next rule line, with only blank
  lines, comments and other metadata lines between them.
- R6.6 THE SYSTEM SHALL accept, with the same result as without them: a leading U+FEFF; CRLF
  line endings; white space at the end of any line; blank lines anywhere; comment lines whose
  first word is not a metadata keyword (keywords are case-sensitive); spaces before a comment
  or rule line; a `#` comment at the end of a rule line; rules, blocks and metadata lines in
  any order; metadata keys in any order; a prerequisite repeated in one rule; a missing,
  partial or repeated `.PHONY` rule; missing recipe lines or recipe lines with any content;
  missing dish rules, a missing `dinner` rule and missing header comments.
- R6.7 WHEN a dish rule or the `dinner` rule is present, THE SYSTEM SHALL check that its
  prerequisites, as a set, equal what export would write (R1.6, R1.7).

### R7. Import errors

**User story:** As a cook, I want every problem in a pasted Dinnerfile reported with its line
and a fix I can make, so that I can correct the file in one pass.

- R7.1 IF a line is not blank, not a comment, not a recipe line and not a rule in the grammar
  (a variable, a directive, `::`, several targets, white space before `:`, `;`, `|`, `$`, `%`,
  a wildcard or any other character outside a name), THEN THE SYSTEM SHALL report
  `unsupported_line` for it.
- R7.2 IF a line ends with `\` after white space at its end is removed, THEN THE SYSTEM SHALL
  report `line_continuation` for it.
- R7.3 IF a line starting with a tab comes before the first rule, THEN THE SYSTEM SHALL report
  `recipe_before_rule`.
- R7.4 IF a rule's target is not `.PHONY`, `dinner`, a dish id or a step id by pattern, THEN
  THE SYSTEM SHALL report `bad_target`; IF a prerequisite of a step, dish or `dinner` rule is
  not a step id by pattern, THEN `bad_prerequisite`.
- R7.5 IF the text has no `# plan` line, THEN THE SYSTEM SHALL report `missing_plan`; IF it has
  more than one `# plan`, `# kitchen` or `# serve` line, THEN `duplicate_metadata` for each
  later one.
- R7.6 IF a metadata line does not have the shape its keyword requires, THEN THE SYSTEM SHALL
  report `bad_metadata`; IF it has a key the grammar does not define, THEN `unknown_key`; a
  key twice, THEN `duplicate_key`; a required key missing, THEN `missing_key`; a value of the
  wrong lexical form (a bad number among them), THEN `bad_value` naming the key.
- R7.7 IF a `# step` line is not followed by a step rule before the next rule line, the next
  `# step` line or the end of the text, THEN THE SYSTEM SHALL report `step_without_target`; IF
  a step rule has no `# step` line attached, THEN `target_without_step`.
- R7.8 IF a step id, dish id or `dinner` is the target of more than one rule, THEN THE SYSTEM
  SHALL report `duplicate_target` for each later rule.
- R7.9 IF a present dish rule names no dish of a `# dish` line, or its prerequisites differ
  from the dish's last steps, THEN THE SYSTEM SHALL report `dish_target_mismatch`; IF a
  present `dinner` rule's prerequisites differ from the terminal steps, THEN
  `dinner_mismatch`.
- R7.10 THE SYSTEM SHALL give every error a `code`, a 1-based `line` (`null` only for
  `missing_plan`), a plain-English `message` that starts with the line and says how to fix
  it, and the extra fields listed for its code in the design.
- R7.11 THE SYSTEM SHALL build messages only from line numbers, ids that match their pattern,
  metadata key names, numbers and fixed words, never from other text in the file (decided
  here, following R7.2 of the recipe-graph spec).
- R7.12 THE SYSTEM SHALL report the errors it finds, not only the first, up to 50, followed by
  one `too_many_errors` line saying how many more there are (cap added in review), without exact
  duplicates, sorted by line (`null` first), then code, then `stepId`.
- R7.13 WHEN any error of R7.1 to R7.8 is found, THE SYSTEM SHALL skip the checks of R7.9, so
  that one broken line does not also show up as a mismatch elsewhere (decided here).

### R8. Round trip

**User story:** As the developer of the share and import features, I want export followed by
import to give back the same plan, so that the Dinnerfile is a faithful copy (D1).

- R8.1 WHEN `plan` is a valid plan, THE SYSTEM SHALL make
  `fromDinnerfile(toDinnerfile(plan).value)` equal
  `{ ok: true, value: { plan: canonicalPlan(plan), options: {} } }` (D1).
- R8.2 WHEN `options` pass R5.1, THE SYSTEM SHALL return them deep-equal in `options`.
- R8.3 WHEN a plan passes `PlanSchema` and its only error issues are among
  `unknown_dependency`, `self_dependency`, `cycle`, `unknown_dish`, `dish_without_steps` and
  `duplicate_dish_id`, THE SYSTEM SHALL still round-trip it to `canonicalPlan(plan)`, so that
  `validatePlan` after import reports the same issues; WHEN it has `duplicate_step_id`, import
  SHALL report `duplicate_target` (decided here).

### R9. Agreement with GNU Make

**User story:** As a cook, I want Make itself to confirm the plan's order, so that the seam
between the app and the build system is real (D2).

- R9.1 WHEN GNU Make (3.81 or later) runs `make -n -f Dinnerfile dinner` on the export of a
  valid plan, in an empty directory with only `PATH` in the environment, THE SYSTEM's file
  SHALL make Make exit 0, write nothing to stderr, and print only echo lines of R3.5, one per
  step, every step exactly once, in an order where every step comes after each of its
  prerequisites (D2).
- R9.2 WHEN GNU Make runs `make -n -f Dinnerfile <dish-id>` for a dish whose id is not
  `dinner`, THE SYSTEM's file SHALL make Make print exactly the steps of that dish and their
  prerequisites, transitively, each once, in an order that satisfies precedence.
- R9.3 IF `make` is missing or is not GNU Make, THEN the tests of R9.1 and R9.2 SHALL fail,
  not skip.

### R10. Test support

**User story:** As the author of the tests, I want generators that reach the hard cases,
oracles written apart from `src/`, and fixtures worked out by hand.

- R10.1 `test/support/arbitraries.ts` SHALL extend the plan generators so that, over a run,
  titles, names and details contain every token of the design's hostile alphabet, dish ids
  include `dinner` and Make directive words, and step slugs start or end with `-`; and SHALL
  add `arbHostileText`, `arbServeTime`, `arbDinnerfileOptions`, `arbAnyDinnerfileOptions`,
  `arbDinnerfileStyle`, `arbDinnerfileLikeText` and `arbBreakingEdit` with the contracts in
  the design.
- R10.2 `test/support/oracles.ts` SHALL add `oracleEncodeText`, `oracleEchoText`,
  `oracleDinnerfile` with `CANONICAL_STYLE`, `oracleMakeLines`, `decodeEchoLine`,
  `oracleDishLastSteps` and `oracleNeededSteps`, with no imports from `src/core` other than
  types and schemas.
- R10.3 `test/support/fixtures.ts` SHALL add `SUNDAY_ROAST_DINNERFILE` (the complete
  hand-written export of `SUNDAY_ROAST`), `SUNDAY_ROAST_MAKE_DINNER`,
  `SUNDAY_ROAST_MAKE_GRAVY`, `WORST_CASE`, `WORST_CASE_DINNERFILE` and
  `WORST_CASE_MAKE_DINNER`, as given in the design.
- R10.4 `test/support/make.ts` SHALL run GNU Make on a text in a fresh temporary directory
  with only `PATH` in the environment, and SHALL fail when `make` is missing or not GNU Make.
- R10.5 `test/support/fc-params.ts` SHALL add `fcMakeParams()` with the run count stated in the
  design, for properties that spawn `make`.

## Non-functional requirements

- N1 Purity: `toDinnerfile` and `fromDinnerfile` follow the `src/core` rules in `tech.md`: no
  throw on bad input, no clock, no randomness, no I/O, imports only zod and `src/core`.
- N2 Totality and cost: import runs in time linear in the text length (no recursion, no
  regular expression with nested quantifiers), and export in time polynomial in steps and
  edges; the property suite of this spec, `make` properties excluded, finishes within the
  default vitest timeout at `numRuns: 200` on 80-step plans.
- N3 Make subset: the exported file uses only GNU Make 3.81 features (no `.RECIPEPREFIX`,
  `.ONESHELL`, grouped targets, `!=`, `define`), so it runs on the GNU Make macOS ships.
- N4 Public surface: other packages reach this spec's exports through `src/core/index.ts`.
- N5 Glossary: identifiers, codes, comments in the file and messages use the glossary words
  in `product.md`.

## Out of scope

- The UI: copy, download, the paste box on the menu screen, how import errors are shown.
- The MCP tools `export_dinnerfile` and `import_dinnerfile`, the share link.
- Running `make` from the app or the server; `make` appears only in tests.
- Schedule data (start minutes, lanes, slack) in the Dinnerfile.
- Mapping `validatePlan` issues after import back to file lines (see open questions).
- Make features outside the grammar (variables, pattern rules, includes, conditionals) on
  import: they are errors, not features.
- Installing GNU Make in the Docker image; tests do not run there.
