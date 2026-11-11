---
inclusion: always
---

# Conduct for agents in this repo

These rules apply to every Kiro session and every sub-agent. They override convenience.

## Before touching code

- Read the spec's three files in full: `.kiro/specs/<feature>/requirements.md`, `design.md`
  and `tasks.md`. If there is no spec for the work asked, say so and ask before writing code.
- Read the steering files that apply and the existing code you are about to change.
- If the spec and the code disagree, or the spec and the steering disagree, stop and report
  the disagreement with file and line. Do not guess which one is right.
- If the request is ambiguous in a way that changes the result, ask. Otherwise state the
  assumption you made in your reply.

## Scope

- Implement only the task named. No neighbouring tasks, no "while I was here" refactors, no
  unrequested features, files or dependencies. Note anything else you noticed in the reply.
- Follow `tech.md`, `structure.md`, `testing.md` and, for front-end files, `ui.md`. If a rule
  there blocks the task, report it rather than working around it.

## Ticking tasks

- Never tick a task in `tasks.md` unless, in this session, you ran the check that proves it
  (the tests, typecheck, lint or e2e named by the task) and it passed.
- When a task is partly done, leave it unticked and say exactly what is missing.
- Never tick a parent task while any of its sub-tasks is unticked.

## Never weaken the checks

- Never weaken a zod schema, a sanity rule, a property, a generator, an oracle, a lint rule,
  a tsconfig flag or a contrast threshold to make something pass.
- Never add `.skip`, `.only`, `.todo`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` or
  `as any` to get green. If a check looks wrong, stop and report why.
- A failing property is a scheduler bug until shown otherwise (`scheduler-guarantees.md`).
- Never hand-edit files in `recordings/`.

## Files and git

- Never commit, push, create branches, tag, or rewrite history unless asked in this session.
- Never edit files under `docs/kiro-evidence/` or `.kiro/steering/` unless asked.
  `docs/kiro-evidence/` is written only by `scripts/kiro-run.sh`.
- Never edit `docs/BRIEF.md` or `LICENSE` unless asked (decided here).
- Ask before deleting files you did not create in this session, and before any destructive
  command (`rm -rf`, `git reset --hard`, `git clean`, force push).
- Never start long-running processes (`npm run dev`, watchers, `npm start` left running).
  E2E tests start and stop their own server through Playwright's `webServer`.

## Secrets

- Never print, log, echo, paste or commit secrets: the Anthropic key, `.env` contents, tokens,
  auth headers. Do not `cat .env`. Check for a variable with `test -n "$ANTHROPIC_API_KEY"`.
- Never put a real key in tests, fixtures, recordings, docs or examples. `.env.example` keeps
  the value empty.
- Never call the real model from tests. Only `npm run record`, run by the user, does that.

## Reporting

- End each session with: what changed (files), the checks you ran with the exact commands and
  the real pass/fail/skip counts, what you did not do or could not verify, and any open
  question. Do not report a check you did not run.
- Use the glossary words from `product.md` in code, commits, specs and replies.
- Do not claim success because a command exited 0. Confirm the result against the task's
  stated outcome.
