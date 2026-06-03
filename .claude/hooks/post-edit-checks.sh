#!/usr/bin/env bash
# PostToolUse per-edit quality hook for 10xCards (Module 3, Lesson 3).
#
# Fast lane  : prettier --write + eslint --fix on every edited source file.
# Scoped test: `vitest related --run` ONLY when the edited file is a risk area
#              from test-plan.md §2 (api / services / middleware / generate /
#              collection / auth). Heavy gates (astro check, full suite) stay at
#              commit/CI per test-plan §5 — they are too slow for the edit loop.
#
# Signal: exit 2 + stdout on failure → Claude Code feeds it back as
# additionalContext so the agent self-corrects next turn. Exit 0 otherwise.
set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

# No path, or the path no longer exists (deletion/rename): nothing to gate.
[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

# Only gate source files we lint/test.
case "$file" in
  *.ts | *.tsx | *.astro) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# --- Fast lane: format, then autofixable lint -------------------------------
npx --no-install prettier --write "$file" >/dev/null 2>&1

lint_out=$(npx --no-install eslint --fix "$file" 2>&1)
lint_code=$?

# --- Scoped tests: risk areas only (test-plan.md §2) ------------------------
test_out=""
test_code=0
case "$file" in
  */src/pages/api/* | */src/lib/services/* | */src/middleware.ts | \
    */src/components/generate/* | */src/components/collection/* | */src/components/auth/*)
    test_out=$(npx --no-install vitest related "$file" --run --passWithNoTests 2>&1)
    test_code=$?
    ;;
esac

if [ "$lint_code" -ne 0 ] || [ "$test_code" -ne 0 ]; then
  echo "Per-edit checks failed for ${file#"$PWD"/}"
  [ "$lint_code" -ne 0 ] && { echo "--- eslint --fix (unfixable errors remain) ---"; echo "$lint_out"; }
  [ "$test_code" -ne 0 ] && { echo "--- vitest related ---"; echo "$test_out"; }
  exit 2
fi

exit 0
