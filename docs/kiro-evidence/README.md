# Kiro evidence

Every `*-session.txt` here is one or more Kiro CLI 3.2.0 sessions (V3 engine, non-interactive)
run in this repository through `scripts/kiro-run.sh`. Each session block has the command, the
prompt (also kept in `prompts/`), and a transcript rendered from the CLI's event stream by
`scripts/kiro-render.mjs`: the agent's text, each tool call, each shell command with its exit
code and the tail of its output, and the credits the session reported. The home directory is
shown as `~` and the local user name as `user`; nothing else is edited, except where a file
says its ending was lost (see below).

| file | model | what it shows | credits reported |
| --- | --- | --- | --- |
| `steering-session.txt` | claude-opus-5.5 | the seven steering files written from `docs/BRIEF.md` | not reported (first runner version) |
| `scaffold-session.txt` | claude-sonnet-5.5 | tooling, lint boundaries, health route, contrast check, e2e smoke | 37.59 |
| `agents-hooks-session.txt` | auto | the two custom agents, three workspace hooks, hook scripts, and the hooks seen firing | 7.45 |
| `spec-recipe-graph-session.txt` | claude-opus-5.5, spec mode | spec; first run exited with code 1 after two files, resumed | 19.73 for the resumed run |
| `impl-recipe-graph-session.txt` | auto, sous-chef | four sessions; the stop on the zod length mismatch; the generator shrinking fix | 6.42, 15.29, 14.65, 16.87 |
| `spec-scheduler-session.txt` | claude-opus-5.5, spec mode | spec with hand-worked schedules; conflicts C1, C2 | 33.47 |
| `impl-scheduler-session.txt` | auto, sous-chef | three sessions; the coverage test left red on purpose; the mutation check that led to G9 | 23.12, 7.25, 9.84 |
| `spec-rebuild-session.txt` | claude-opus-5.5, spec mode | spec; five conflicts (in `design.md`); the final message was lost | not known |
| `impl-rebuild-session.txt` | auto, sous-chef | two sessions; G9 property; the mutation check that led to R7 | 39.59, 22.63 |
| `spec-dinnerfile-session.txt` | claude-opus-5.5, spec mode | spec; scratch Makefiles run against GNU Make 3.81 | 50.90 |
| `impl-dinnerfile-session.txt` | auto, sous-chef | R7 property, then the whole Dinnerfile spec | 70.67 |
| `spec-recipe-reader-session.txt` | claude-opus-5.5, spec mode | spec; the installed SDK inspected before the design was fixed | 49.23 |
| `impl-recipe-reader-session.txt` | auto, sous-chef | two sessions; the wait definition change carried through; tests on the real recordings | 56.33, 26.57 |
| `spec-plan-ui-session.txt` | claude-opus-5.5, spec mode | spec | 70.25 |
| `impl-plan-ui-session.txt` | auto, sous-chef | five sessions; screenshots reviewed by the agent; the critical-path change | 28.13, 28.22, 29.40, 46.71, 51.56 |
| `spec-cooking-mode-session.txt` | claude-opus-5.5, spec mode | spec | 33.60 |
| `impl-cooking-mode-session.txt` | auto, sous-chef | three sessions | 38.06, 40.69, 26.60 |
| `spec-kitchen-mcp-session.txt` | claude-opus-5.5, spec mode | spec | 63.57 |
| `impl-kitchen-mcp-session.txt` | auto, sous-chef | the two-tool slice; stopped at a blocked write and a lint rule instead of working around them | 8.16 |
| `mcp-use-session.txt` | auto | Kiro calling the `make-dinner` MCP server: a first attempt that failed because the client dropped empty arrays and nulls, then a working one | 2.19, 1.55 |

`hook-fires.log` is appended to by the hook scripts themselves, one line per firing.

## Credits

Sessions that reported a figure add up to **976.29** credits. Three did not report one: the
steering session (run before the runner read the event stream; the shared account meter moved
60.81 during it, with other work on the same account running at the same time), the first run
of the recipe-graph spec (exited with code 1) and the rebuild spec (final message lost). Judged
by similar sessions those three cost about 100 to 130 together, so the total is roughly 1,075
to 1,105. `credits.log` is the runner's raw log; where it disagrees with the table above, the
table is right (the log's figure for a file with several sessions was sometimes read from the
wrong session).

## Lost endings

A clean-up command replaced some transcript files while their sessions were still writing.
`spec-plan-ui-session.txt` and `spec-cooking-mode-session.txt` were re-rendered in full from
the saved event streams. `spec-rebuild-session.txt` ends after its last tool call; the spec
files it wrote are complete. The second session in `impl-rebuild-session.txt` ends with its
final report as captured from the runner's output, and says so at that point.

## Not shown here

- No Kiro session ran the `expediter` agent, a Kiro power or Kiro Crew.
- The save-triggered workspace hooks for `tokens.css` and `tasks.md` were not seen firing.
- The five files in `recordings/` were made by `npm run record` run by hand with a real key,
  not by a Kiro session.
