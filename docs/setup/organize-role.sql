-- organize_bot: M5 整理ループ専用ロール(被害上限 = capture_inbox の3列 UPDATE)。
-- 適用は Vercel 展開時に人間が実施し、実パスワードは Neon 側で設定して CI Secret DATABASE_URL に登録する。
CREATE ROLE organize_bot LOGIN PASSWORD '__set_me__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE neondb TO organize_bot;
GRANT USAGE ON SCHEMA public TO organize_bot;
GRANT SELECT (id, user_id, kind, topic, tags, body, status, created_at, processed_at, deleted_at) ON capture_inbox TO organize_bot;
GRANT UPDATE (processed_at, curated_ref, status) ON capture_inbox TO organize_bot;
-- user_id は count(DISTINCT user_id) のガード用のみ(値は取得しない — §2.1・R3 R-7)。
-- 他テーブル・他スキーマへの GRANT は付与しない(到達可能オブジェクトの確認は §4 条件8 の手動項目)。

-- wbs_bot: wbs-loop(WBS 限定編集の書き戻し)専用ロール(docs/design/detail/wbs-loop.md §1-6/§0)。
-- organize_bot とは分離する(共有すると wbs workflow の侵害で capture_inbox の本文まで読めるため —
-- sec レビュー R1 3-b)。到達できるのは board_overrides のみ。board_items への GRANT も付与しない
-- (fetch は board_overrides しか読まず、不在検査は checkout 実物基準 — 最小権限)。
-- user_id は count(DISTINCT user_id) のガード用のみ(値は取得しない・overrides.json 非収録)。
CREATE ROLE wbs_bot LOGIN PASSWORD '__set_me__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE neondb TO wbs_bot;
GRANT USAGE ON SCHEMA public TO wbs_bot;
GRANT SELECT (source, file_path, item_key, desired_state, base_state, user_id, pr_ref, resolved_at) ON board_overrides TO wbs_bot;
GRANT UPDATE (pr_ref, resolved_at, resolution) ON board_overrides TO wbs_bot;

-- review_bot: review-loop(本番 UI からの CI レビュー)専用ロール(docs/design/detail/review-loop.md §1)。
-- 補足(card-review): question 列経由で capture 本文の複製に到達し得る点は card-review §1 で受容済み。
-- 分離の理由(capture 本文を読ませない)は question 列の複製までは守り切らない — 実態と食い違わせない
-- ために明記する。列限定の付与は列追加で自動拡張されないため 0011 の新列は不可視のまま。
-- organize_bot / wbs_bot とは分離する(共有すると review workflow の侵害で capture_inbox 本文まで
-- 読めるため)。到達できるのは review_requests のみ。
-- 依頼者の帰属列は SELECT にも含めない(user 帰属を CI に出さない — organize-loop と同思想)。
-- 質問・帰属・作成時刻は UPDATE 不可(履歴改ざん・注入踏み台・日次カウント汚染の遮断)。
CREATE ROLE review_bot LOGIN PASSWORD '__set_me__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE neondb TO review_bot;
GRANT USAGE ON SCHEMA public TO review_bot;
GRANT SELECT (id, status, question, created_at, started_at) ON review_requests TO review_bot;
GRANT UPDATE (status, started_at, completed_at, result, result_truncated, error_kind, run_ref) ON review_requests TO review_bot;
