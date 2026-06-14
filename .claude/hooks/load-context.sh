#!/usr/bin/env bash
# SessionStart: 現在のゴールと最終同期状態を提示する(雛形)。stdout がコンテキストに追加される。
set -uo pipefail

echo "=== Decision Cockpit / Session Context ==="

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "branch: $(git branch --show-current 2>/dev/null || echo unknown)"
fi

# 進行中ゴール: GOAL.md があれば提示(1ゴール=1ブランチ運用の補助)
if [ -f GOAL.md ]; then
  echo "--- 現在のゴール(GOAL.md) ---"
  sed -n '1,20p' GOAL.md
else
  echo "現在のゴール: 未設定 → /basic-design <topic> → /design-review <topic> → /goal で開始する。"
fi

# 直近の設計レビュー状況
if ls docs/design/reviews/*.md >/dev/null 2>&1; then
  echo "--- design-review 済み ---"
  ls -1 docs/design/reviews/*.md 2>/dev/null
fi

# 最終同期状態(雛形): 実値はアプリ/索引(Neon の last_sync)から取得する想定。
echo "最終同期状態: (雛形) アプリ内コードで Neon の last_sync を参照して表示する。"
echo "=========================================="
exit 0
