-- 対象設計: docs/design/basic/capture-triage.md §1(design-review PASS 後に適用)
ALTER TABLE capture_inbox ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done'));
CREATE INDEX IF NOT EXISTS capture_inbox_user_status_idx ON capture_inbox (user_id, status);
