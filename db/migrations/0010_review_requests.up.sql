-- 0010_review_requests.up.sql
-- 対象設計: docs/design/detail/review-loop.md §1(design-review 全レンズ PASS 後に適用)
-- 本番 UI からの AI レビュー依頼(review-loop)。アプリが INSERT・CI(review_bot)が
-- claim/writeback・全遷移は CAS(先勝ち・後着 no-op)。物理 DELETE なし。
CREATE TABLE IF NOT EXISTS review_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by     text NOT NULL,          -- Neon Auth の user id(FK は張らない: capture_inbox と同形)
  question         text NOT NULL CHECK (btrim(question) <> '' AND char_length(question) <= 2000),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','done','error')),
  -- result の DB 側上限は truncateResult(§2.3)と同単位(char_length = コードポイント)で二重化する。
  -- review_bot は UPDATE (result) を持つため、job3 侵害時の無制限格納・LIST 応答の増幅を防ぐ。
  result           text CHECK (result IS NULL OR char_length(result) <= 30000),
  result_truncated boolean NOT NULL DEFAULT false,
  error_kind       text CHECK (error_kind IN ('dispatch_failed','stale','ci_failed')),
  run_ref          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  -- 整合制約: error ⇔ error_kind / running ⇒ started_at / 終端 ⇒ completed_at
  CONSTRAINT review_requests_error_kind_iff
    CHECK ((status = 'error') = (error_kind IS NOT NULL)),
  CONSTRAINT review_requests_running_started
    CHECK (status <> 'running' OR started_at IS NOT NULL),
  CONSTRAINT review_requests_terminal_completed
    CHECK (status NOT IN ('done','error') OR completed_at IS NOT NULL)
);
-- 同時1件判定(INFLIGHT)・sweep 向け partial index(アクティブ行は常時 0〜2 行)
CREATE INDEX IF NOT EXISTS review_requests_active_idx
  ON review_requests (created_at) WHERE status IN ('pending','running');
-- 一覧(直近20件)向け。※日次上限カウントは式述語(AT TIME ZONE)のため本索引は効かない —
-- 物理 DELETE なし × 日次10件で行数は年数千規模、seq scan で許容する(設計 §1 の決着)。
CREATE INDEX IF NOT EXISTS review_requests_created_idx
  ON review_requests (created_at DESC);
