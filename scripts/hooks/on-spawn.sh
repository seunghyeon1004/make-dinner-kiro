#!/usr/bin/env bash
# Runs when a sous-chef session starts (agent SessionStart hook): shows the working tree
# state and the first unticked tasks, so the agent starts from facts, and logs the firing.
#
# Environment overrides: HOOK_LOG.

set -u
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$HOOK_ROOT" || exit 0

echo "[on-spawn] git status --short"
status="$(git status --short 2>&1)"
printf '%s\n' "${status:-(clean)}"

echo "[on-spawn] unticked tasks (first 20)"
tasks="$(grep -n "\- \[ \]" .kiro/specs/*/tasks.md 2>/dev/null | head -20)"
printf '%s\n' "${tasks:-(none)}"

changed_count="$(printf '%s' "$status" | grep -c . || true)"
task_count="$(printf '%s' "$tasks" | grep -c . || true)"
log_fire on-spawn "changed_files=$changed_count unticked_shown=$task_count"
exit 0
