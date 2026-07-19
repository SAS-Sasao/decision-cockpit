-- 対象設計: docs/design/basic/capture-trash.md §1(design-review PASS 後に適用)
ALTER TABLE capture_inbox ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
