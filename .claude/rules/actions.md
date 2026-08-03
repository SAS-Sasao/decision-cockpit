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

## WBS 限定編集(wbs-loop — 2026-07-26 承認の第2例外)

- 「追加のみ」の例外として、**wbs-writeback workflow(決定的スクリプト・LLM 不使用)**にのみ
  cc-sier-organization の `.companies/<org>/docs/secretary/*-wbs.md` の**限定編集**を許可する:
  - 変更は**既存行のステータストークン(`[ ]`/`[~]`/`[x]`)の置換のみ**。行の追加・削除・他セルの変更・
    見出しや地の文の変更は禁止。
  - PR 作成前に機械 verify(**行単位バイト diff が一次基準** — 変更行は対象 item ごとに1行・トークン
    3バイト以外の差分ゼロ・他の全行バイト不変)+ staged 閉包検査(全行 'M'・glob 一致)。
  - PR 経由のみ・`wbs/<date>` ブランチ・force 禁止・自動マージなし(**人間レビューが最終防御** —
    毎日のトークン置換 PR を機械的に承認しない)。
  - secrets = `WBS_DATABASE_URL`(専用ロール wbs_bot — capture_inbox へ到達しない)/ `ORGREPO_PAT`。
- 正典 = docs/design/detail/wbs-loop.md(受け入れ条件は同 §4)。

## review-loop(CI レビュー — 第3のループ・**書き込みゼロ**)

本番 UI(壁打ちパネルの「CI レビュー」モード・admin 限定)から `workflow_dispatch` で起動し、
CI 上の Claude が**自 repo を読んでレビューする**だけのループ。**許可パスは存在しない**
(コミット・push・PR を一切作らないため、黄金ルール1 の例外追加は不要)。

- **対象は decision-cockpit のみ**。SSoT 2 repo は checkout も対象化もしない。
- **3-job 分離**(claim / review / writeback): **Claude が動く job に DB secrets を渡さない**。
  job 名とその定義順は受け入れ条件のレンジアンカー — 改名・並び替えをしない。
- **機械層の防御**(指示だけに頼らない): `--allowedTools "Read,Grep,Glob,Write(out/**)"` の完全一致
  (Bash・ネットワーク系ツールなし)/ 全 checkout `persist-credentials: false` / workflow 級
  `permissions: contents: read` のみ / 全 artifact `retention-days: 1` /
  **repo 側のエージェント設定(settings.json・settings.local.json・.mcp.json)を LLM 起動前に除去**
  (巻き戻しは sec レンズ再通過が必要)/ 質問は**ファイル経由**で渡す(式展開でプロンプトに埋めない)。
- 状態は `review_requests` の CAS 遷移(先勝ち・後着 no-op)。専用ロール **review_bot**(列限定 GRANT・
  review_requests のみ到達)。ゲート = `ENABLE_CI_REVIEW`・上限 = 同時1件 + 日次10件 + timeout。
- **結果は参考意見**。design-review / acceptance-judge の**代替にしない**(黄金ルール4 不変)。
  capture_inbox・SSoT への還流経路も持たない。
- 正典 = docs/design/detail/review-loop.md(受け入れ条件は同 §4)。

