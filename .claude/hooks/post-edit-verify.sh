#!/usr/bin/env bash
# PostToolUse[Write|Edit]: *.ts/tsx 保存時に lint --fix + typecheck を実行する(雛形・best-effort)。
# 型エラーがあれば exit 2 で Claude に通知し、是正を促す。
set -uo pipefail

input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')"
else
  path="$input"
fi

case "$path" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

[ -f package.json ] || exit 0
[ -d node_modules ] || { echo "post-edit-verify: node_modules 未インストールのためスキップ" >&2; exit 0; }

# lint --fix(失敗しても止めない)
npm run -s lint -- --fix >/dev/null 2>&1 || true

# typecheck(型エラーは Claude に通知)
if ! npm run -s typecheck >/tmp/dc-typecheck.log 2>&1; then
  echo "typecheck FAILED after editing ${path}:" >&2
  tail -n 30 /tmp/dc-typecheck.log >&2
  exit 2
fi

exit 0
