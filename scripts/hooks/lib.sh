#!/usr/bin/env bash
# Shared helpers for the hook scripts in this folder. Sourced, never run on its own.
#
# Environment overrides (used by the tests of these scripts and for dry runs):
#   HOOK_LOG   file the one-line-per-firing log is appended to
#              (default docs/kiro-evidence/hook-fires.log)

HOOK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK_LOG="${HOOK_LOG:-$HOOK_ROOT/docs/kiro-evidence/hook-fires.log}"

# log_fire NAME DETAIL: append "<UTC time> <name> <detail>" to the log.
log_fire() {
  mkdir -p "$(dirname "$HOOK_LOG")"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >>"$HOOK_LOG"
}

# run_step SECONDS COMMAND: run COMMAND through bash, output into STEP_OUT, exit code into
# STEP_RC (124 when the time limit was hit). Uses timeout(1) when the machine has it.
run_step() {
  local seconds="$1" cmd="$2"
  if command -v timeout >/dev/null 2>&1; then
    STEP_OUT="$(cd "$HOOK_ROOT" && timeout "$seconds" bash -c "$cmd" 2>&1)"
  else
    STEP_OUT="$(cd "$HOOK_ROOT" && bash -c "$cmd" 2>&1)"
  fi
  STEP_RC=$?
}

# tail_lines N: print the last N lines of STEP_OUT, indented, with colour codes removed.
tail_lines() {
  printf '%s\n' "$STEP_OUT" | sed $'s/\x1b\\[[0-9;]*m//g' | tail -n "$1" | sed 's/^/    /'
}
