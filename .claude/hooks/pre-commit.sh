#!/usr/bin/env bash
# PreToolUse:Bash gate.
#
# SPEC 0.7: "A phase is not complete while any test fails, typecheck fails, or lint
# fails." This hook enforces that at the commit boundary.
#
# Unlike a naive Bash hook, this one inspects the command first and only gates real
# commits -- it must not run the whole test suite before every `ls`.
#
# Exit 0 = allow. Exit 2 = block, and stderr is shown to Claude.

set -uo pipefail

payload="$(cat)"

# Extract the command being run. Falls back to a raw grep if node is unavailable.
cmd="$(node -e '
  let s = "";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    try { process.stdout.write(JSON.parse(s)?.tool_input?.command ?? ""); }
    catch { process.stdout.write(""); }
  });
' <<<"$payload" 2>/dev/null || printf '%s' "$payload")"

# Only gate commits. Everything else passes straight through.
if ! grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit([[:space:]]|$)' <<<"$cmd"; then
  exit 0
fi

# --- Secret / real-data tripwire: runs even before the toolchain exists -----------
staged="$(git diff --cached --name-only 2>/dev/null || true)"
if [ -n "$staged" ]; then
  if grep -Eq '(^|/)\.env($|\.)' <<<"$staged"; then
    echo "BLOCKED: a .env file is staged. SPEC 0.8 forbids committing secrets." >&2
    exit 2
  fi
  # sk-ant- / rzp_live_ / supabase service_role keys in staged content
  if git diff --cached -U0 2>/dev/null \
      | grep -Eq 'sk-ant-[A-Za-z0-9_-]{8}|rzp_live_[A-Za-z0-9]{8}|service_role.*eyJ'; then
    echo "BLOCKED: staged diff appears to contain a live API key. SPEC 0.8." >&2
    exit 2
  fi
fi

# --- Toolchain checks: skipped cleanly until the project is scaffolded ------------
if [ ! -f package.json ]; then
  echo "pre-commit: no package.json yet (Phase 0) -- secret scan only, checks skipped."
  exit 0
fi

has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null; }

if has_script typecheck; then
  pnpm typecheck || { echo "BLOCKED: typecheck failed (SPEC 0.7)." >&2; exit 2; }
elif [ -f tsconfig.json ]; then
  npx --no-install tsc --noEmit || { echo "BLOCKED: tsc failed (SPEC 0.7)." >&2; exit 2; }
fi

if has_script lint; then
  pnpm lint || { echo "BLOCKED: lint failed (SPEC 0.7)." >&2; exit 2; }
fi

if has_script test; then
  pnpm test || { echo "BLOCKED: tests failed (SPEC 0.7)." >&2; exit 2; }
fi

echo "pre-commit: all checks passed."
exit 0
