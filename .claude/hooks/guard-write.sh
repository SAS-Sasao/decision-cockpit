#!/usr/bin/env bash
# PreToolUse[Write|Edit]: 元 repo / .env / 秘密ファイルへの書き込みを遮断する(exit 2 + deny)。
set -uo pipefail

input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')"
else
  path="$input"
fi

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  echo "BLOCKED(guard-write): $1" >&2
  exit 2
}

case "$path" in
  *cc-sier-organization*|*ai-war-room*)
    deny "元 repo(SSoT)への書き込みは禁止。書き戻しは Claude Action の PR 経由のみ" ;;
esac

# .env / .env.* は禁止。ただし .env.example のみ許可。
case "$path" in
  *.env.example) : ;;
  *.env|*.env.*) deny ".env / .env.* への書き込みは禁止(.env.example のみ可)" ;;
esac

case "$path" in
  *secrets*|*credentials*|*.pem|*.key|*id_rsa*) deny "秘密ファイルへの書き込みは禁止" ;;
esac

exit 0
