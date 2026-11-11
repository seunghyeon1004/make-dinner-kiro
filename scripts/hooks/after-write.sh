#!/usr/bin/env bash
# Runs after a file is written (agent PostToolUse hook) or saved (IDE PostFileSave hook).
#
#   1. npm run typecheck, always.
#   2. npm run test:props with FC_NUM_RUNS=50, only if a file under src/core, test/core or
#      test/support changed since the previous firing of this script.
#
# Prints the last lines of each step and its exit code. Exits 1 if any step failed, so the
# agent is told. Appends one line per firing to the hook log. The step limits keep the whole
# run inside the 60 second hook timeout.
#
# Environment overrides: HOOK_LOG, HOOK_STAMP (file whose mtime marks the previous firing),
# HOOK_TYPECHECK_CMD, HOOK_PROPS_CMD, HOOK_TYPECHECK_SECONDS, HOOK_PROPS_SECONDS.

set -u
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STAMP="${HOOK_STAMP:-$HOOK_ROOT/node_modules/.cache/after-write.stamp}"
TYPECHECK_CMD="${HOOK_TYPECHECK_CMD:-npm run typecheck}"
PROPS_CMD="${HOOK_PROPS_CMD:-env FC_NUM_RUNS=50 npm run test:props}"
TYPECHECK_SECONDS="${HOOK_TYPECHECK_SECONDS:-25}"
PROPS_SECONDS="${HOOK_PROPS_SECONDS:-25}"
WATCHED=(src/core test/core test/support)

# Did anything in the watched folders change since the previous firing? No stamp means this
# is the first firing, which counts as changed.
changed=no
if [ ! -f "$STAMP" ]; then
  changed=yes
else
  existing=()
  for dir in "${WATCHED[@]}"; do
    [ -d "$HOOK_ROOT/$dir" ] && existing+=("$HOOK_ROOT/$dir")
  done
  if [ "${#existing[@]}" -gt 0 ] &&
    [ -n "$(find "${existing[@]}" -type f -newer "$STAMP" -print -quit 2>/dev/null)" ]; then
    changed=yes
  fi
fi
# Touch the stamp before the checks so an edit made while they run is seen next time.
mkdir -p "$(dirname "$STAMP")"
touch "$STAMP"

failed=0

run_step "$TYPECHECK_SECONDS" "$TYPECHECK_CMD"
type_rc=$STEP_RC
echo "[after-write] typecheck: exit $type_rc"
tail_lines 8
[ "$type_rc" -ne 0 ] && failed=1

if [ "$changed" = yes ]; then
  run_step "$PROPS_SECONDS" "$PROPS_CMD"
  props_rc=$STEP_RC
  echo "[after-write] test:props (FC_NUM_RUNS=50): exit $props_rc"
  tail_lines 12
  [ "$props_rc" -ne 0 ] && failed=1
else
  props_rc=skipped
  echo "[after-write] test:props: skipped, nothing changed under ${WATCHED[*]} since the last run"
fi

if [ "$failed" -ne 0 ]; then
  echo "[after-write] FAILED: read the output above and fix it before the next step." >&2
fi
log_fire after-write "ran=typecheck$([ "$changed" = yes ] && echo ',test:props') typecheck=$type_rc props=$props_rc"
exit "$failed"
