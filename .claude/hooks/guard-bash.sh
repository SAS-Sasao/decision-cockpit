#!/usr/bin/env bash
# PreToolUse[Bash]: 危険・禁止コマンドを遮断する(exit 2 + permissionDecision: deny)。
# 設計思想#1: 確実に守らせる制約は permissions(deny) と PreToolUse hook に置く。
set -uo pipefail

input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
else
  cmd="$input"
fi

deny() {
  reason="$1"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  echo "BLOCKED(guard-bash): $reason" >&2
  exit 2
}

# --- 破壊的・禁止コマンド ---
case "$cmd" in
  *"rm -rf"*|*"rm -fr"*)                                        deny "rm -rf は禁止" ;;
  *"git push --force"*|*"git push -f"*|*"--force-with-lease"*)  deny "force push は禁止(deny)" ;;
  *DROP\ *|*"DROP TABLE"*|*TRUNCATE\ *)                          deny "生の DROP/TRUNCATE は禁止(マイグレーションで明示し承認を得ること)" ;;
  *"DELETE FROM"*)                                              deny "生の DELETE は禁止" ;;
esac

# --- 元 repo(SSoT)への書き込み兆候 ---
case "$cmd" in
  *cc-sier-organization*|*ai-war-room*)
    case "$cmd" in
      *">"*|*">>"*|*"git -C"*|*"git push"*|*"rm "*|*"cp "*|*"mv "*|*"tee "*)
        deny "元 repo(SSoT)への書き込み操作は禁止。読み取りは GitHub API 経由のみ" ;;
    esac ;;
esac

exit 0
