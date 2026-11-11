#!/usr/bin/env bash
# Runs one Kiro CLI session and keeps the evidence.
#
#   scripts/kiro-run.sh <evidence-name> <prompt-file> [kiro-cli chat flags...]
#
# What it does:
#   1. runs `kiro-cli chat --output-format stream-json` with the prompt file and the
#      flags given (stream-json implies --no-interactive),
#   2. renders the event stream with scripts/kiro-render.mjs into a readable transcript:
#      the agent's text, each tool call, each shell command with its exit code and the
#      tail of its output, and the credits the session itself reported,
#   3. appends the command, the prompt and that transcript to
#      docs/kiro-evidence/<evidence-name>.txt (home directory prefix replaced with ~),
#   4. appends one line to docs/kiro-evidence/credits.log.
#
# The raw event stream is kept only in $KIRO_RAW_DIR (default: not kept).
set -u
name="$1"
prompt_file="$2"
shift 2
KIRO="${KIRO_CLI:-$HOME/.local/bin/kiro-cli}"
out="docs/kiro-evidence/${name}.txt"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p docs/kiro-evidence
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

{
  echo
  echo "=== session $(date -u +%FT%TZ) ==="
  echo "\$ kiro-cli chat --output-format stream-json $* \"\$(cat ${prompt_file})\""
  echo "--- prompt ---"
  cat "$prompt_file"
  echo "--- transcript (rendered from the event stream by scripts/kiro-render.mjs) ---"
} | sed "s#${HOME}#~#g" >>"$out"

"$KIRO" chat --output-format stream-json "$@" "$(cat "$prompt_file")" 2>&1 |
  tee "$tmp" | node "$here/kiro-render.mjs" | tee -a "$out"
code="${PIPESTATUS[0]}"

if [ -n "${KIRO_RAW_DIR:-}" ]; then
  mkdir -p "$KIRO_RAW_DIR" && cp "$tmp" "$KIRO_RAW_DIR/${name}-$(date +%s).jsonl"
fi
credits="$(tail -1 "$out" | grep -oE 'session: [0-9.]+' | grep -oE '[0-9.]+' || true)"
echo "$(date -u +%FT%TZ) ${name} [$*] credits ${credits:-?} exit ${code}" >>docs/kiro-evidence/credits.log
exit "$code"
