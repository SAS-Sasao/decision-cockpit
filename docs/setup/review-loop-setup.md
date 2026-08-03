# CI レビュー(review-loop)の有効化手順

正典 = docs/design/detail/review-loop.md。運用契約 = .claude/rules/actions.md「review-loop」節。
**実装は完了済み(RL-1 / RL-2)。以下はすべてユーザー操作**で、全 PASS まで運用開始しない
(1つでも fail = 導入中止して設計を改訂・3レンズ再通過)。

有効化するまでは安全側に倒れる: `REVIEW_DISPATCH_PAT` 未設定なら UI から依頼しても **503**、
`ENABLE_CI_REVIEW` 未設定なら dispatch されても**全 job skip**(DB 不変)。

## 1. 本番マイグレーション(0010)

`db/migrations/0010_review_requests.up.sql` を Neon 本番に適用する
(**main へマージする前に**適用すること — マージ = Vercel 自動デプロイのため)。

## 2. 専用 DB ロール

`docs/setup/organize-role.sql` の **review_bot セクション**を Neon 本番で実行する
(パスワードは Neon 側で設定。organize_bot / wbs_bot とは別ロール)。
実行後、**review_requests 以外に到達できないこと**を確認する(被害上限 = レビュー行の状態列の改ざん)。

## 3. トリガー用 PAT(Vercel 環境変数)

GitHub → Settings → Developer settings → **Fine-grained personal access token**:

- Repository access: **decision-cockpit のみ**(他 repo を含めない)
- Permissions: **Actions = Read and write** のみ(他は No access)
- 期限を設定し、失効日をカレンダーに入れる

発行した値を **Vercel の環境変数 `REVIEW_DISPATCH_PAT`** に登録して Redeploy。
**チャットにもファイルにも値を貼らない。**

> ⚠ この PAT の実害上限(設計 §4 で受容済み): 漏えいすると本 repo の**他 workflow の起動・キャンセル**
> (daily-organize / wbs-writeback = SSoT への PR 経路の間接起動)、**artifact の読み取り**
> (capture 本文を含む organize の中間生成物)、run・ログの削除が可能になる。GitHub は PAT を
> workflow 単位に絞れないため、これは構造的な制約。**露出が疑われたら即 revoke + 再発行**。

## 4. GitHub Secrets / Variables

- Secrets: **`REVIEW_DATABASE_URL`**(review_bot の接続文字列)。
  `CLAUDE_CODE_OAUTH_TOKEN` は M5(organize-loop)と共用。
- Variables: **`ENABLE_CI_REVIEW=true`**。

## 5. 動作確認(ゲート — 全 PASS まで運用開始しない)

- (a) admin で `http://.../capture` を開き「CI レビュー」チップから1件依頼 → 数分で **done** になり
  結果が表示される。行の `run` リンクが正しい Actions run に飛ぶ。
- (b) ランナー側の失敗時: review job を失敗させると **error(CI の実行に失敗しました)** になる。
- (c) `ENABLE_CI_REVIEW` を外して dispatch → **全 job skip・DB 不変**。その pending 行は
  **次回依頼時の sweep**(15分経過後)で error(時間切れ)になる。
- (d) 非 admin ユーザーではチップが**表示されない**、かつ `/api/review` が **403**。
- (e) 同時1件: 実行中にもう1件依頼 → **409**(実行中の依頼があります)。
- (f) 日次上限: 同日11件目 → **429**。
- (g) job2(review)のログに **DB 接続情報が出ていない**ことを目視。
- (h) 生成された結果に秘密の引用が無いことを目視(補助 — 限界は設計 §4 に明記)。

## 6. 停止・撤収

- 一時停止: Variables の `ENABLE_CI_REVIEW` を `false` にする(以後の dispatch は全 job skip)。
- 完全停止: 加えて Vercel の `REVIEW_DISPATCH_PAT` を削除(UI からの依頼が 503 になる)。
- 失効・ローテーション: PAT は GitHub で revoke → 再発行 → Vercel 差し替え。
  `REVIEW_DATABASE_URL` は Neon で review_bot のパスワードを再設定 → Secrets 差し替え。

## 7. 運用上の注意

- 結果は**参考意見**。設計レビュー(design-review)や受け入れ判定(acceptance-judge)の代替にしない。
- 質問文は CI のログ・artifact(保持1日)・DB に残る。**機微情報(実名・秘密)を書かない。**
- 依頼行は物理削除しない(履歴として残る)。一覧表示は直近20件。
