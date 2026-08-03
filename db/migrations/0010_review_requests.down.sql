-- 0010_review_requests.down.sql(ロールバック用 — 適用は人間の承認手順のみ)
-- 対象設計: docs/design/detail/review-loop.md §1
DROP INDEX IF EXISTS review_requests_created_idx;
DROP INDEX IF EXISTS review_requests_active_idx;
DROP TABLE IF EXISTS review_requests;
