#!/usr/bin/env bash
# scripts/codex/review.sh — Codex レビューの唯一の入口(正典 = docs/design/basic/codex-ops.md §0)
#
# クリーンコピー隔離: git archive HEAD を一時ディレクトリに展開(= git 追跡ファイルのみ)し、
# そこを作業ディレクトリに Codex を読取専用サンドボックスで起動する。
# .env / e2e/.auth / e2e/screenshots 等の gitignore 資産は構造的に不在になる。
# レビュー対象はコミット済み(HEAD)の内容のみ — 未コミット diff・秘密のプロンプト手貼りは禁止。
#
# 使い方(人間の端末から): scripts/codex/review.sh "<レビュー依頼プロンプト>"
# ※ Claude Code セッション内からの起動は guard-bash.sh が遮断する(人間の端末が正規経路)。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# サンドボックス/承認の実フラグは導入時に `codex --help` で確認して本スクリプトに確定する
# (docs/setup/codex-setup.md 手順)。要件 = 読取専用サンドボックス + 承認なしで昇格しない approval 設定。
CODEX_ARGS=(--sandbox read-only --ask-for-approval never)

STATUS_BEFORE="$(git -C "$REPO_ROOT" status --porcelain)"

WORKDIR="$(mktemp -d)"

cleanup() {
  rm -r -- "$WORKDIR"
  # 事後検知(検知範囲は本 repo のみ — SSoT clone・DB への逸脱は映らない)
  local after
  after="$(git -C "$REPO_ROOT" status --porcelain)"
  echo "--- 元 repo の git status --porcelain(空 = 変化なし)---"
  printf '%s\n' "$after"
  if [ "$after" != "$STATUS_BEFORE" ]; then
    echo "!! 警告: レビュー前後で元 repo の状態が変化した。逸脱の兆候として差分を確認すること" >&2
  fi
}
trap cleanup EXIT

(cd "$REPO_ROOT" && git archive HEAD) | tar -x -C "$WORKDIR"

# 毎回の不変条件 assert(初回限りにしない): コピー先に gitignore 資産(秘密)が存在しないこと。
# この保証は「追跡ファイルに秘密が無い」不変条件の上に立つ — 破れていたら起動せず中止する。
for p in .env e2e/.auth e2e/screenshots; do
  if [ -e "$WORKDIR/$p" ]; then
    echo "ABORT: コピー先に $p が存在する(追跡ファイルへの秘密混入の兆候 — 黄金ルール2 違反)" >&2
    exit 1
  fi
done

cd "$WORKDIR"
codex "${CODEX_ARGS[@]}" "$@"
