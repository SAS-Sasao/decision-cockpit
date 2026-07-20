-- organize_bot: M5 整理ループ専用ロール(被害上限 = capture_inbox の3列 UPDATE)。
-- 適用は Vercel 展開時に人間が実施し、実パスワードは Neon 側で設定して CI Secret DATABASE_URL に登録する。
CREATE ROLE organize_bot LOGIN PASSWORD '__set_me__' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE neondb TO organize_bot;
GRANT USAGE ON SCHEMA public TO organize_bot;
GRANT SELECT (id, user_id, kind, topic, tags, body, status, created_at, processed_at, deleted_at) ON capture_inbox TO organize_bot;
GRANT UPDATE (processed_at, curated_ref, status) ON capture_inbox TO organize_bot;
-- user_id は count(DISTINCT user_id) のガード用のみ(値は取得しない — §2.1・R3 R-7)。
-- 他テーブル・他スキーマへの GRANT は付与しない(到達可能オブジェクトの確認は §4 条件8 の手動項目)。
