// 対象設計: docs/design/detail/review-loop.md §2.3(CI 側の純関数 + SQL 定数)
//
// 全遷移は CAS(WHERE に現在 status)。SET 列・SET 値は DDL の整合制約を成立させる load-bearing な
// 要素であり、テストと受け入れ条件で列名・値までピンされる。書式は「識別子 = 値」で統一する。

export const RESULT_MAX_CHARS = 30000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 不正な request_id は green skip に丸めるための判定(赤 run を量産しない)。 */
export function isUuid(v: string | undefined | null): boolean {
  if (typeof v !== "string") return false;
  return UUID_RE.test(v);
}

/**
 * result の切り詰め(コードポイント単位 — DDL の char_length と同単位・サロゲートペアを割らない)。
 */
export function truncateResult(s: string): { text: string; truncated: boolean } {
  const points = Array.from(s);
  if (points.length <= RESULT_MAX_CHARS) return { text: s, truncated: false };
  return { text: points.slice(0, RESULT_MAX_CHARS).join(""), truncated: true };
}

/** claim: 単一文で CAS + started_at/run_ref 設定 + question 取得(0行 = green skip)。 */
export const CLAIM_SQL = `UPDATE review_requests SET status = 'running', started_at = now(), run_ref = $2 WHERE id = $1 AND status = 'pending' RETURNING question`;

export const DONE_SQL = `
  UPDATE review_requests
     SET status = 'done', result = $2, result_truncated = $3, completed_at = now()
   WHERE id = $1 AND status = 'running'`;

export const CI_FAILED_SQL = `
  UPDATE review_requests
     SET status = 'error', error_kind = 'ci_failed', completed_at = now()
   WHERE id = $1 AND status = 'running'`;
