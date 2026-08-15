-- 0011_review_card_ref.down.sql
-- 対象設計: docs/design/detail/card-review.md §1
-- 適用は人間の承認手順のみ(列 DROP = カード参照履歴の不可逆消失を伴う)。
DROP INDEX IF EXISTS review_requests_card_latest_idx;
ALTER TABLE review_requests
  DROP CONSTRAINT IF EXISTS review_requests_card_ref_shape,
  DROP CONSTRAINT IF EXISTS review_requests_card_title_len,
  DROP CONSTRAINT IF EXISTS review_requests_card_item_key_nonempty,
  DROP CONSTRAINT IF EXISTS review_requests_card_path_shape,
  DROP CONSTRAINT IF EXISTS review_requests_card_source_domain,
  DROP CONSTRAINT IF EXISTS review_requests_card_kind_domain,
  DROP COLUMN IF EXISTS card_title,
  DROP COLUMN IF EXISTS card_capture_id,
  DROP COLUMN IF EXISTS card_item_key,
  DROP COLUMN IF EXISTS card_file_path,
  DROP COLUMN IF EXISTS card_source,
  DROP COLUMN IF EXISTS card_kind;
