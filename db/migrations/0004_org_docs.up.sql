-- 対象設計: docs/design/detail/org-docs-ingestion.md §1(design-review PASS 後に適用)
-- type 語彙 7 → 8(knowledge 追加)。制約の付け替えのみでデータ・列・キーは不変。
BEGIN;
ALTER TABLE timeline_records DROP CONSTRAINT IF EXISTS timeline_records_type_check;
ALTER TABLE timeline_records ADD CONSTRAINT timeline_records_type_check
  CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log','knowledge'));
COMMIT;
