#!/usr/bin/env bash
# Runs when the agent stops (agent Stop hook): the full example suite, the full property
# suite (default run count, FC_NUM_RUNS unset) and lint. Prints the summary lines, appends
# them to the hook log, exits 1 if anything failed. ANTHROPIC_API_KEY is unset for the run.
#
# Environment overrides: HOOK_LOG, HOOK_TEST_CMD, HOOK_PROPS_CMD, HOOK_LINT_CMD,
# HOOK_STEP_SECONDS (limit per step, default 300).

set -u
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TEST_CMD="${HOOK_TEST_CMD:-env -u ANTHROPIC_API_KEY -u FC_NUM_RUNS npm test}"
PROPS_CMD="${HOOK_PROPS_CMD:-env -u ANTHROPIC_API_KEY -u FC_NUM_RUNS npm run test:props}"
LINT_CMD="${HOOK_LINT_CMD:-npm run lint}"
STEP_SECONDS="${HOOK_STEP_SECONDS:-300}"

failed=0
log_detail=""

# summarise LABEL COMMAND: run one step, print its summary lines, add it to the log detail.
summarise() {
  local label="$1" cmd="$2" summary
  run_step "$STEP_SECONDS" "$cmd"
  summary="$(printf '%s\n' "$STEP_OUT" | sed $'s/\x1b\\[[0-9;]*m//g' |
    grep -E '^ *(Test Files|Tests) ' | sed 's/^ *//; s/  */ /g' | paste -sd ';' -)"
  echo "[on-stop] $label: exit $STEP_RC"
  if [ -n "$summary" ]; then
    printf '%s\n' "$summary" | tr ';' '\n' | sed 's/^/    /'
  else
    tail_lines 6
  fi
  [ "$STEP_RC" -ne 0 ] && failed=1
  log_detail="$log_detail $label=$STEP_RC"
  [ -n "$summary" ] && log_detail="$log_detail ($summary)"
}

summarise test "$TEST_CMD"
summarise test:props "$PROPS_CMD"
summarise lint "$LINT_CMD"

[ "$failed" -ne 0 ] && echo "[on-stop] FAILED: see above." >&2
log_fire on-stop "${log_detail# }"
exit "$failed"
