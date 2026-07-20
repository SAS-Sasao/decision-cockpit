# Claude Action(CI ハーネス)制約

- 書き込みは**許可パス配下のみ**(organize-loop で2 repo に拡張):
  - ai-war-room: `docs/logs/`・`docs/decisions/`
  - cc-sier-organization: `.companies/<org>/docs/decisions/`・`.companies/<org>/docs/todos/`
  それ以外は禁止。**追加のみ**(既存ファイルの編集・削除は禁止)。
- **PR ゲート**: 生成物は必ず PR 経由。`main` への直接 push 禁止・**force push(`--force` / `--force-with-lease`)禁止**・
  ファイル削除禁止。PR の自動マージはしない(**人間レビューが最終防御**)。
- トークンは**最小スコープ**を repo 単位で分離(WARROOM_PAT / ORGREPO_PAT)。env から注入しコードに直書きしない。
  **Claude が動くジョブには workflow secrets を渡さない**(整理ループは 3-job 分離 — 設計 organize-loop §2.5)。
- **機微ファイル(profile.md / minefield.md)へのアクセス禁止。**
- 受け入れ条件(機械判定): 変更は許可パス配下のみ / 各 MD に必須 frontmatter /
  **分割一致**(消費対象の全 capture id がちょうど1つの生成ファイルに現れる — 取りこぼし・捏造・重複はいずれも fail)/
  **mark は repo 単位**(PR 作成に成功した repo のファイルのみ processed_at を更新。片方失敗時は成功分のみ)。
- 正典 = docs/design/detail/organize-loop.md(受け入れ条件は同 §4)。
