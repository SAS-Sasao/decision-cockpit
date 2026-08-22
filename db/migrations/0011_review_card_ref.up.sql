-- 0011_review_card_ref.up.sql
-- 対象設計: docs/design/detail/card-review.md §1(design-review PASS 後に適用)
-- review_requests に「依頼元カード」の参照を additive に足す(既存行は全列 NULL のまま)。
-- CI(review_bot)は列限定 GRANT のため新列を読めない・書けない(意図的)。
--
-- 再実行安全(db-recovery.md の replay が 2 回目でも停止しない): 列は ADD COLUMN IF NOT EXISTS、
-- 制約は pg_constraint 存在検査つきの DO ブロックで冪等化する。
ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS card_kind       text,
  ADD COLUMN IF NOT EXISTS card_source     text,
  ADD COLUMN IF NOT EXISTS card_file_path  text,
  ADD COLUMN IF NOT EXISTS card_item_key   text,
  ADD COLUMN IF NOT EXISTS card_capture_id uuid,
  ADD COLUMN IF NOT EXISTS card_title      text;

DO $$
BEGIN
  -- 値域(0009 board_overrides と同水準。nullable と両立させるため IS NULL OR … 形)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_kind_domain' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_kind_domain
      CHECK (card_kind IS NULL OR card_kind IN ('wbs','capture'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_source_domain' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_source_domain
      CHECK (card_source IS NULL OR card_source = 'cc-sier-organization');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_path_shape' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_path_shape
      CHECK (card_file_path IS NULL OR (
        card_file_path ~ '^\.companies/[^/]+/docs/secretary/[^/]+-wbs\.md$'
        AND position('..' in card_file_path) = 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_item_key_nonempty' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_item_key_nonempty
      CHECK (card_item_key IS NULL OR card_item_key <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_title_len' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_title_len
      CHECK (card_title IS NULL OR char_length(card_title) <= 500);
  END IF;
  -- 形状(**CASE 全域形**)。※`card_kind_domain` と組で load-bearing: 形状 CHECK の '' 分岐は
  -- coalesce(card_kind,'') なので **空文字の kind** も「参照列すべて NULL」なら通す。未知値を弾くのは
  -- domain CHECK 側の責務(両方を §4 でピンする)。
  -- 選言の連結形は使わない — card_kind が NULL の行では等値比較が NULL に評価され、
  -- **式全体が NULL = CHECK 合格**になる(R1 data G1)。
  -- 実測(2026-08-09・ローカル db): 連結形は「kind NULL + capture_id」「kind NULL + wbs 完全形」を
  -- 受理してしまい、部分欠落形だけを弾く(最も気づきにくい分類)。CASE + coalesce 形は
  -- 正常3形を受理・違反5形すべてを拒否することを実測済み。
  -- WBS は card_title 必須(差異注記の入力)。capture は topic が nullable なので card_title も nullable。
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'review_requests_card_ref_shape'
                    AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_ref_shape
      CHECK (
        CASE coalesce(card_kind, '')
          WHEN ''        THEN (card_source IS NULL AND card_file_path IS NULL
                               AND card_item_key IS NULL AND card_capture_id IS NULL
                               AND card_title IS NULL)
          WHEN 'wbs'     THEN (card_source IS NOT NULL AND card_file_path IS NOT NULL
                               AND card_item_key IS NOT NULL AND card_title IS NOT NULL
                               AND card_capture_id IS NULL)
          WHEN 'capture' THEN (card_capture_id IS NOT NULL AND card_source IS NULL
                               AND card_file_path IS NULL AND card_item_key IS NULL)
          ELSE false
        END
      );
  END IF;
END $$;

-- カード別最新1件(DISTINCT ON)の順序供給用。ORDER BY と同じ方向・同じ列順にする
-- (前5列 ASC + created_at DESC の混在。NULLS 位置は両側とも ASC 既定 = NULLS LAST)。
CREATE INDEX IF NOT EXISTS review_requests_card_latest_idx
  ON review_requests (card_kind, card_source, card_file_path, card_item_key, card_capture_id,
                      created_at DESC, id DESC)
  WHERE card_kind IS NOT NULL;
-- 末尾 id DESC は CARD_LATEST_SQL のタイブレーク(§2.5)と方向まで一致させる。
-- 90日窓は6列目の範囲述語なので前方一致には使えない(順序供給とフィルタのみ)— 0010 の
-- 日次カウントと同型の受容。
