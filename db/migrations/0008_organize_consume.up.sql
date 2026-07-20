-- 対象設計: docs/design/detail/organize-loop.md §1(design-review PASS 後に適用)
CREATE INDEX IF NOT EXISTS capture_inbox_consume_idx
  ON capture_inbox (created_at) WHERE processed_at IS NULL AND deleted_at IS NULL;
