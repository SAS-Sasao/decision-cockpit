-- 対象設計: docs/design/basic/capture-trash.md §1(適用は人間承認のみ — ゴミ箱状態を不可逆に失う)
ALTER TABLE capture_inbox DROP COLUMN IF EXISTS deleted_at;
