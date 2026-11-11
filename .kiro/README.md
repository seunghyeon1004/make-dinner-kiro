# How Kiro built Make Dinner

This is the honest record: what Kiro did, where it failed, and what was done by hand. Every
claim here points at a file. The session transcripts are in `docs/kiro-evidence/`.

Kiro was driven from the command line (Kiro CLI 3.2.0, V3 engine, non-interactive) through
`scripts/kiro-run.sh`. That script asks the CLI for its event stream and
`scripts/kiro-render.mjs` turns the stream into a transcript: the agent's text, every tool
call, every shell command with its exit code and the tail of its output, the steering files
Kiro loaded, and the credits the session itself reported. So a line such as "npm test: 1642
passed" in a transcript is the command's real output, and a test run that never happened
cannot appear.

## Strategy

1. **Steering first.** One session (claude-opus-5.5) turned `docs/BRIEF.md` into seven
   steering files. They fix the vocabulary, the layout, the import rules, how tests are
   written, and the scheduler's promises as guarantee ids (G1 to G9, R1 to R7, S1, S2, D1,
   D2). Six load in every session; `ui.md` loads only for front-end files.
2. **Every feature through spec mode** (`--mode spec`, claude-opus-5.5): requirements in
   EARS form, a design with real paths, exact signatures and hand-worked expected results,
   then test-first tasks that each name the command that proves them. Each spec prompt asked
   Kiro to check the guarantees against the algorithm and report conflicts with a
   counterexample instead of adjusting quietly. Each spec was reviewed by hand before any
   code; the decisions are in a "Review notes" section at the end of each `design.md`.
3. **Implementation by a custom agent on the `auto` model**, a few task groups per session,
   every diff and every reported check re-run by hand before the commit.
4. **Guarantees as the contract.** A meta test (`test/meta/guarantees.test.ts`) reads the
   steering file and fails while any guarantee id has no property test. It stayed red, on
   purpose, from the session that wrote it until the properties existed.

## What is in this folder

### steering/ (7 files, written by Kiro, edited by hand where noted)

`product.md`, `tech.md`, `structure.md`, `scheduler-guarantees.md`, `testing.md`,
`kiro-conduct.md` (always loaded), `ui.md` (loaded for `src/web/**`, `public/**`, `e2e/**`).
Hand edits, each marked in the file: G4.1 narrowed twice, S1 reworded, R1/R4/R5/R6 reworded
after the rebuild spec's counterexamples, G9 and R7 added, `wait` redefined, the Dinnerfile
format note, the fifth sample, the "Critical" wording.

### specs/ (8 specs)

| spec           | tasks ticked | state                                                                 |
| -------------- | ------------ | --------------------------------------------------------------------- |
| recipe-graph   | 36 of 36     | implemented by Kiro                                                   |
| scheduler      | 39 of 39     | implemented by Kiro                                                   |
| rebuild        | 22 of 22     | implemented by Kiro                                                   |
| dinnerfile     | 17 of 17     | implemented by Kiro                                                   |
| recipe-reader  | 28 of 28     | implemented by Kiro; T6.3 (recording with the real key) run by hand   |
| plan-ui        | 40 of 40     | implemented by Kiro                                                   |
| cooking-mode   | 32 of 32     | implemented by Kiro                                                   |
| kitchen-mcp    | 0 of 16      | **spec only, not built**: the credit budget ran out (see "Not done")  |

### agents/

- `sous-chef.json`, the builder. It implemented every task above. Its hooks are the "run the
  scheduler's property tests on save" automation in the form that fires in CLI sessions:
  after every file write, `scripts/hooks/after-write.sh` runs the typecheck and, when
  `src/core`, `test/core` or `test/support` changed, the property tests at 50 runs; when the
  agent stops, `on-stop.sh` runs the example tests, the full property run and lint; on
  spawn, `on-spawn.sh` prints git status and the open tasks. Each firing appends a line to
  `docs/kiro-evidence/hook-fires.log`. Its write permissions exclude steering, the brief, the
  evidence folder and `recordings/`; its shell rules deny commits, pushes and resets (a
  `git checkout` and an `rm -rf` were in fact blocked mid-session, see the transcripts).
- `expediter.json`, the checker: given a spec name it re-runs the proving command of every
  ticked task, reads the tests, and may untick but never tick. It is configured and validated
  (`kiro-cli agent validate`), but **it was never run on a spec**: the budget went to building
  the product. The checking it describes was done by hand after each session instead.

### hooks/ (workspace hooks)

- `props-on-core-save.json`: file save under `src/core`, `test/core`, `test/support` runs the
  same `after-write.sh`. Seen firing in a CLI session when the default agent wrote a probe
  file (`agents-hooks-session.txt`).
- `contrast-on-tokens-save.json`: saving `tokens.css` runs `npm run check:contrast`. Not seen
  firing.
- `tasks-lint-on-save.json`: saving a `tasks.md` runs `scripts/hooks/tasks-lint.sh` (a ticked
  parent with an unticked child, or a task without an id, fails). The script was run by hand
  and by spec sessions; the save trigger itself was not seen firing.

## What Kiro found

These are the moments where the workflow earned its cost. Each is in a spec's "Conflicts
found" section or a session transcript.

- **Scheduler spec:** guarantee G4.1 was vacuous for larger plans (no kitchen within the caps
  is "unlimited"), and the G8 property as worded was weaker than its definition (a wrong
  slack of 19 would pass). Both fixed before any code.
- **Rebuild spec:** five conflicts, each with a counterexample: the first wording of R4, R5
  and R6 was false for a second rebuild; R1 cannot hold when what already happened exceeds
  capacity; steps done out of order broke the serving-time rule and the repair order.
- **Dinnerfile spec:** Kiro ran scratch Makefiles against the real GNU Make and found that
  `make -n` executes a recipe line containing `$(MAKE)`, that `export : x` is read as a
  directive, and that a comment ending in `\` swallows the next line. The export's escaping
  comes from those measurements.
- **Generators:** the first property-test generators made fast-check's shrinking run out of
  memory, so a failing property would have crashed instead of printing a counterexample.
  Kiro reported it, a task was added, Kiro rewrote the generators and proved shrinking works.
- **Mutation checks:** the builder removed the right-justify pass to see what failed.
  Nothing did. That gap became guarantee G9 with its own property; the same happened for the
  re-align pass in rebuild, which became R7.
- **Recipe reader:** by reading the installed SDK, Kiro found that `messages.parse` would
  surface a refusal as a parse error quoting the model's text, and designed around it.
- **Honest stops:** the builder stopped and asked when zod's length rule disagreed with a
  requirement, instead of bending the test, and it left the coverage meta test red for two
  sessions rather than add placeholder properties.

## Where Kiro failed or fell short

- The first spec session exited with code 1 after two of three files; it was resumed.
- Test-first was not always followed. The builder says so in its reports: some oracles and
  properties were written after the code and shown to fail by mutation instead.
- Early sessions wrote far more example tests than the requirement needed; later prompts
  asked for proportion.
- A first version of the wait rule (measure to the latest user) was Kiro's own decision. It
  produced a false warning on the first real recipe and was changed by hand, then carried
  through the specs, oracles and tables by Kiro.
- The first screen marked 14 of 17 steps "Critical". The critical-path rule that replaced it
  was a hand decision after looking at the page.
- Sessions were expensive: a spec cost 33 to 70 credits, an implementation session 7 to 70.

## Done by hand

- `docs/BRIEF.md`, the five sample recipes in `samples/`, `scripts/kiro-run.sh` and
  `scripts/kiro-render.mjs`, `README.md`, this file.
- Every review decision, the steering edits listed above, three tasks added to `tasks.md`
  files (generator shrinking, G9, R7), two small spec corrections.
- `npm run record`: the five recordings in `recordings/` are real `claude-opus-5-5` output,
  recorded once with the real key and never edited.
- One code change after the credits were spent: `criticalPath` now prefers the chain that
  reaches back to the start of the dinner (`src/core/critical-path.ts`, with a test that fails
  on the old rule). The first rule, which I had specified, marked the potatoes and stopped an
  hour short.
- Re-running every check after every session, and looking at every screen in headless
  Chromium at phone and desktop widths.

## Not done

- **kitchen-mcp** (an MCP server exposing the scheduler as tools, and a `taster` agent using
  it) has a complete spec and no code. There is no `.kiro/settings/mcp.json`. It was left out
  whole rather than half-built when the credit budget was reached.
- The `expediter` agent was not run.
- Kiro powers and Kiro Crew were not used.

## Mistakes of mine that affect the evidence

- A clean-up command replaced transcript files while three sessions were still writing to
  them. `spec-plan-ui` and `spec-cooking-mode` were rebuilt from the saved event streams;
  `spec-rebuild` lost its final message for good; one `impl-rebuild` session's ending was
  restored from the runner's captured output. Each affected file says so at that point.
- Three early sessions have no exact credit figure (see `docs/kiro-evidence/README.md`).
