#!/usr/bin/env bash
# PostToolUse:Edit|Write -- format the file that was just written.
#
# Advisory only: never exits 2. A formatter that is missing or unhappy must not block
# editing, and this runs after the write has already landed.

set -uo pipefail

file="$(node -e '
  let s = "";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    try {
      const i = JSON.parse(s)?.tool_input ?? {};
      process.stdout.write(i.file_path ?? i.notebook_path ?? "");
    } catch { process.stdout.write(""); }
  });
' 2>/dev/null)"

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.md) ;;
  *) exit 0 ;;
esac

[ -f package.json ] || exit 0

npx --no-install prettier --write "$file" >/dev/null 2>&1 \
  && echo "formatted: $file"

exit 0
