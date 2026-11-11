#!/usr/bin/env bash
# Lints spec task lists. Fails (exit 1) and prints the offending lines when a tasks.md has
#   - a task line (a "- [ ]" or "- [x]" checkbox) that does not start with a task id such as
#     T1.1 (id pattern: T, digits, optional ".digits" parts), or
#   - a ticked parent with an unticked child.
# A child is a checkbox nested under the parent by indentation, or a task whose id extends
# the parent's id (T1.2 is a child of T1 and T1.2.1 of T1.2).
#
# Usage: tasks-lint.sh [FILE...]   (default: .kiro/specs/*/tasks.md)
# Any hook payload on stdin is ignored.

set -u
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$HOOK_ROOT" || exit 1

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=()
  for f in .kiro/specs/*/tasks.md; do
    [ -f "$f" ] && files+=("$f")
  done
fi
if [ "${#files[@]}" -eq 0 ]; then
  echo "[tasks-lint] no tasks.md files found"
  log_fire tasks-lint "files=0 problems=0"
  exit 0
fi

problems=0
for file in "${files[@]}"; do
  out="$(awk -v file="$file" '
    function report(n, why) { printf "%s:%d: %s\n    %s\n", file, n, why, text[n]; bad++ }
    /^[ \t]*- \[[ xX]\]/ {
      n = NR
      line = $0
      indent = match(line, /[^ \t]/) - 1
      mark = (substr(line, indent + 4, 1) == " ") ? "open" : "done"
      rest = substr(line, indent + 7)
      sub(/^[ \t]+/, "", rest)
      text[n] = line
      order[++count] = n
      ind[n] = indent
      st[n] = mark
      if (match(rest, /^T[0-9]+(\.[0-9]+)*([ \t:.]|$)/)) {
        id = substr(rest, 1, RLENGTH)
        sub(/[ \t:.]+$/, "", id)
        tid[n] = id
        byid[id] = n
      } else {
        report(n, "task line has no id (expected T<number>[.<number>...] after the checkbox)")
      }
    }
    END {
      # Parent by indentation: nearest earlier checkbox with a smaller indent.
      for (i = 1; i <= count; i++) {
        n = order[i]
        for (j = i - 1; j >= 1; j--) {
          if (ind[order[j]] < ind[n]) { parent[n] = order[j]; break }
        }
        # Parent by id: drop the last .number; the parent must exist as a task.
        if (!(n in parent) && (n in tid)) {
          pid = tid[n]
          if (sub(/\.[0-9]+$/, "", pid) && (pid in byid)) parent[n] = byid[pid]
        }
      }
      for (i = 1; i <= count; i++) {
        n = order[i]
        if ((n in parent) && st[parent[n]] == "done" && st[n] == "open") {
          if (!(parent[n] in flagged)) {
            flagged[parent[n]] = 1
            report(parent[n], "ticked parent has an unticked child (first one below)")
          }
          printf "    child line %d: %s\n", n, text[n]
          bad++
        }
      }
      exit bad > 0 ? 1 : 0
    }
  ' "$file")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    problems=$((problems + 1))
    printf '%s\n' "$out"
  fi
done

if [ "$problems" -gt 0 ]; then
  echo "[tasks-lint] FAILED: $problems file(s) with problems" >&2
  log_fire tasks-lint "files=${#files[@]} bad_files=$problems"
  exit 1
fi
echo "[tasks-lint] ok: ${#files[@]} file(s)"
log_fire tasks-lint "files=${#files[@]} bad_files=0"
exit 0
