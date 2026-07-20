-- 対象設計: docs/design/detail/organize-loop.md §1(適用は人間承認のみ — インデックス削除は復旧可能だが人間確認を経る)
DROP INDEX IF EXISTS capture_inbox_consume_idx;
