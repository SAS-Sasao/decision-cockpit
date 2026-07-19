-- 対象設計: docs/design/basic/capture-triage.md §1(適用は人間承認のみ — in_progress/done のトリアージ状態を不可逆に失う)
ALTER TABLE capture_inbox DROP COLUMN IF EXISTS status;
