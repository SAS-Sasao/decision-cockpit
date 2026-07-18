-- 対象設計: docs/design/detail/org-docs-ingestion.md §1
-- 逆付け替え(BEGIN/COMMIT で原子化 — knowledge 行存在時は ADD の検証失敗で全体ロールバックし
-- 旧状態が保たれる)。適用は人間承認のみ。
BEGIN;
ALTER TABLE timeline_records DROP CONSTRAINT IF EXISTS timeline_records_type_check;
ALTER TABLE timeline_records ADD CONSTRAINT timeline_records_type_check
  CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log'));
COMMIT;
