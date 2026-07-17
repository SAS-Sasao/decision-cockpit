#!/usr/bin/env bash
# 秘密実値スキャナ(M0 受け入れ条件7の判定器)
# 契約: docs/design/detail/auth-foundation.md §2.3(design-review 全レンズ PASS)
#
# 一般則(必ず守ること):
#  1. 秘密クラスの追加、または既存クラス(例: EMBEDDING_API_KEY)の実値形式の確定を行う
#     変更は、その実値形式パターンの本スクリプトへの追随を【同一コミット】に含める。
#  2. リポジトリ内のあらゆるファイルに接頭辞型秘密(下記8クラス)の実値形式ダミー
#     (接頭辞+英数字)を書かない。言及は正規表現形式(例: npg_[A-Za-z0-9]+)で行う。
#     形式のない秘密クラス(cookie secret 等)は明らかな非秘密ダミー(全ゼロ等)を許容。
#
# 走査対象: git ls-files --cached --others --exclude-standard のうち実在ファイルのみ
#   (= tracked + 未追跡だが gitignore されていないファイル。.env.example を含む。
#      .env / .next/ / node_modules/ は gitignore 準拠で自動除外)
# 除外: 本スクリプト自身のみ
# 判定: ヒット0件 → exit 0 / 1件以上 → 一覧を stderr に出して exit 1 / 判定不能 → exit 2
set -u

PATTERN='npg_[A-Za-z0-9]+|napi_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9-]+|sk-proj-[A-Za-z0-9_-]+|sk-svcacct-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{35}'
SELF="scripts/check-no-secrets.sh"

command -v git >/dev/null 2>&1 || { echo "check-no-secrets: git not found (判定不能)" >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "check-no-secrets: not a git work tree (判定不能)" >&2; exit 2; }

found=0
err=0
while IFS= read -r f; do
  [ "$f" = "$SELF" ] && continue
  [ -f "$f" ] || continue          # ステージ済みだが削除されたパスをスキップ
  hits="$(grep -IHnE "$PATTERN" -- "$f")"; s=$?
  if [ "$s" -eq 0 ]; then
    printf '%s\n' "$hits" >&2
    found=1
  elif [ "$s" -ge 2 ]; then
    echo "check-no-secrets: error scanning $f (grep exit $s)" >&2
    err=1
  fi
done < <(git ls-files --cached --others --exclude-standard)

[ "$found" -ne 0 ] && exit 1       # 違反が最優先
[ "$err" -ne 0 ] && exit 2         # エラーのみなら判定不能
exit 0
