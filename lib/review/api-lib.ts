// 対象設計: docs/design/detail/review-loop.md §2.1(アプリ側の純関数 + SQL 定数)
//
// SQL 定数は全て CAS(WHERE に現在 status を含む)。SET 列・SET 値は DDL の整合制約
// (error_kind_iff / running_started / terminal_completed)を成立させる load-bearing な要素であり、
// テストと受け入れ条件で列名・値までピンされる。書式は「識別子 = 値」のスペース入りで統一する。
//
// server-only を付けない(純関数と文字列定数のみ — vitest から直接 import する)。

export const QUESTION_MAX_CHARS = 2000;
export const DAILY_LIMIT = 10;
export const LIST_LIMIT = 20;

export const DISPATCH_URL =
  "https://api.github.com/repos/SAS-Sasao/decision-cockpit/actions/workflows/ci-review.yml/dispatches";
export const RUN_REF_PREFIX = "https://github.com/SAS-Sasao/decision-cockpit/actions/";

/** 入力検証: question は trim 後 1..2000 文字。不正は null(= 400 bad_request)。 */
export function validateQuestion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const q = (body as { question?: unknown }).question;
  if (typeof q !== "string") return null;
  const trimmed = q.trim();
  if (trimmed.length < 1 || trimmed.length > QUESTION_MAX_CHARS) return null;
  return trimmed;
}

/**
 * run_ref のリンク化可否。固定リテラル起点の前置一致のみ true
 * (DB 侵害時に javascript: 等を仕込まれてもリンクにしない)。
 */
export function isSafeRunRef(ref: string | null | undefined): boolean {
  if (typeof ref !== "string") return false;
  return ref.startsWith(RUN_REF_PREFIX);
}

// --- SQL 定数(全て CAS)---

export const SWEEP_PENDING_SQL = `
  UPDATE review_requests
     SET status = 'error', error_kind = 'stale', completed_at = now()
   WHERE status = 'pending' AND created_at < now() - interval '15 minutes'`;

export const SWEEP_RUNNING_SQL = `
  UPDATE review_requests
     SET status = 'error', error_kind = 'stale', completed_at = now()
   WHERE status = 'running' AND started_at < now() - interval '60 minutes'`;

export const INFLIGHT_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM review_requests WHERE status IN ('pending','running')
  ) AS inflight`;

export const DAILY_COUNT_SQL = `
  SELECT count(*)::int AS n
    FROM review_requests
   WHERE (created_at AT TIME ZONE 'Asia/Tokyo')::date = (now() AT TIME ZONE 'Asia/Tokyo')::date`;

export const INSERT_SQL = `
  INSERT INTO review_requests (requested_by, question) VALUES ($1, $2) RETURNING id`;

// --- card-review(0011)---
// 対象設計: docs/design/detail/card-review.md §2.2
//
// カード起点の依頼はカード参照列も同時に埋める(0011 の形状 CHECK は「全列 NULL」
// 「wbs 完全形」「capture 形」の3形のみ受理する — 部分的な充填は INSERT で弾かれる)。
export const INSERT_WITH_CARD_SQL = `
  INSERT INTO review_requests
    (requested_by, question, card_kind, card_source, card_file_path, card_item_key,
     card_capture_id, card_title)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;

export const CARD_LATEST_SQL = `
  SELECT DISTINCT ON (card_kind, card_source, card_file_path, card_item_key, card_capture_id)
         card_kind, card_file_path, card_item_key, card_capture_id, card_title,
         status, result, result_truncated, error_kind, run_ref, created_at, started_at
    FROM review_requests
   WHERE card_kind IS NOT NULL
     AND created_at >= now() - interval '90 days'
   ORDER BY card_kind, card_source, card_file_path, card_item_key, card_capture_id,
            created_at DESC, id DESC`;
// 先頭の重複排除列と ORDER BY の先頭が一致していること(一致しないと SQL として成立しない)。
// card_kind IS NOT NULL = 自由入力行の除外(入れないと NULL 群が1グループに畳まれ偽のカード行が返る)。
// 90日窓 = 物理 DELETE なし × 日次上限で行が単調増加するため(result は最大30000字)。
// タイブレークの id DESC は 0011 の索引末尾と方向まで一致させる。

// sweep の閾値。**SQL 側はリテラルのまま**にする(定数から組み立てると review-loop 詳細 §4 RL-1 #2 の
// `grep -qF "15 minutes"` が落ちる)。二重定義の乖離はテストの同値アサートで防ぐ。
export const STALE_PENDING_MINUTES = 15;
export const STALE_RUNNING_MINUTES = 60;

// 同時1件の判定(UI 用)。sweep 済みでない stale 超過行を母集団から外すため、SWEEP_*_SQL と同じ
// 閾値の範囲述語を持つ。括弧付けが load-bearing(OR の結合順を変えると全 pending が inflight になる)。
export const INFLIGHT_ACTIVE_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM review_requests
     WHERE (status = 'pending' AND created_at >= now() - interval '15 minutes')
        OR (status = 'running' AND started_at >= now() - interval '60 minutes')
  ) AS inflight`;

export const DISPATCH_FAILED_SQL = `
  UPDATE review_requests
     SET status = 'error', error_kind = 'dispatch_failed', completed_at = now()
   WHERE id = $1 AND status = 'pending'`;

export const LIST_SQL = `
  SELECT id, question, status, result, result_truncated, error_kind, run_ref, created_at, completed_at
    FROM review_requests
   ORDER BY created_at DESC
   LIMIT ${LIST_LIMIT}`;
