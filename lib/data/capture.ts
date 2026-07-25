import "server-only";

// 対象設計: docs/design/detail/capture-spar.md §2.1(lib/data/capture.ts)
//          docs/design/basic/capture-triage.md §1(status 列・setCaptureStatus)
//          docs/design/basic/capture-trash.md §1(deleted_at 列・softDeleteCapture・restoreCaptureRow・listTrash)
//          .claude/rules/capture.md(capture_inbox 契約)
//
// capture_inbox への書き込みは INSERT + status / deleted_at の限定 UPDATE のみ(capture-triage / capture-trash)
// (processed_at / curated_ref / kind / body への書き込みはしない)。
// 未処理件数は lib/data/overview.ts の getUnprocessedInboxCount を再利用する(二重実装しない)。

import { query } from "../db";

export type CaptureKind = "status" | "issue" | "next_move" | "spar_conclusion";
export type CaptureStatus = "open" | "in_progress" | "done";

export type InboxRow = {
  id: string;
  kind: CaptureKind;
  topic: string | null;
  tags: string[];
  body: string;
  source: string | null;
  createdAt: string;
  processedAt: string | null;
  curatedRef: string | null;
  status: CaptureStatus;
};

export type TrashRow = InboxRow & { deletedAt: string };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

/**
 * capture_inbox への INSERT(唯一の書き込み経路 — INSERT + status / deleted_at の限定 UPDATE のみ
 * (capture-triage / capture-trash))。
 * source は SQL リテラル 'ui' 固定(client から供給しない)。tags / processed_at / curated_ref は
 * 触らない(DB 既定に任せる)。
 */
export async function insertCapture(
  userId: string,
  kind: CaptureKind,
  topic: string | null,
  body: string
): Promise<void> {
  await query(
    `INSERT INTO capture_inbox (user_id, kind, topic, body, source) VALUES ($1, $2, $3, $4, 'ui')`,
    [userId, kind, topic, body]
  );
}

type InboxQueryRow = {
  id: string;
  kind: CaptureKind;
  topic: string | null;
  tags: string[];
  body: string;
  source: string | null;
  created_at: Date;
  processed_at: Date | null;
  curated_ref: string | null;
  status: CaptureStatus;
};

type TrashQueryRow = InboxQueryRow & { deleted_at: Date };

/**
 * 本人分の INBOX(未削除)を新しい順(created_at DESC, id DESC — 同時刻タイブレーク)で取得する。
 * limit は既定 50・クランプ 1..100。
 */
export async function listInbox(userId: string, limit?: number): Promise<InboxRow[]> {
  const result = await query<InboxQueryRow>(
    `SELECT id, kind, topic, tags, body, source, created_at, processed_at, curated_ref, status
       FROM capture_inbox
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, clampLimit(limit)]
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    topic: row.topic,
    tags: row.tags,
    body: row.body,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    processedAt: row.processed_at ? row.processed_at.toISOString() : null,
    curatedRef: row.curated_ref,
    status: row.status,
  }));
}

/** /today カンバンに載せるカード行(列サブセット — today-board-interactive §3)。 */
export type BoardCaptureRow = {
  id: string;
  kind: "next_move" | "issue";
  topic: string | null;
  body: string;
  status: CaptureStatus;
  processedAt: string | null;
  createdAt: string;
};

// カンバンの既定表示上限(today-board-interactive §1-4 — 既定 100。listInbox の既定 50 とは意図的に別値)。
const BOARD_DEFAULT_LIMIT = 100;

/**
 * /today カンバン用の本人 capture 行(kind = next_move / issue・生存行のみ)を新しい順で取得する
 * (SELECT のみ — 書き込み経路は追加しない。today-board-interactive §1-4)。
 * limit はクランプ 1..100・既定 100。
 */
export async function listBoardCaptures(userId: string, limit?: number): Promise<BoardCaptureRow[]> {
  const result = await query<BoardCaptureQueryRow>(
    `SELECT id, kind, topic, body, status, processed_at, created_at
       FROM capture_inbox
      WHERE user_id = $1 AND kind IN ('next_move', 'issue') AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, clampLimit(limit ?? BOARD_DEFAULT_LIMIT)]
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    topic: row.topic,
    body: row.body,
    status: row.status,
    processedAt: row.processed_at ? row.processed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }));
}

type BoardCaptureQueryRow = {
  id: string;
  kind: "next_move" | "issue";
  topic: string | null;
  body: string;
  status: CaptureStatus;
  processed_at: Date | null;
  created_at: Date;
};

/**
 * 本人分のゴミ箱(削除済み行)を新しい順(created_at DESC, id DESC)で取得する。
 * limit は listInbox と同型のクランプ(既定 50・1..100)。
 */
export async function listTrash(userId: string, limit?: number): Promise<TrashRow[]> {
  const result = await query<TrashQueryRow>(
    `SELECT id, kind, topic, tags, body, source, created_at, processed_at, curated_ref, status, deleted_at
       FROM capture_inbox
      WHERE user_id = $1 AND deleted_at IS NOT NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, clampLimit(limit)]
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    topic: row.topic,
    tags: row.tags,
    body: row.body,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    processedAt: row.processed_at ? row.processed_at.toISOString() : null,
    curatedRef: row.curated_ref,
    status: row.status,
    deletedAt: row.deleted_at.toISOString(),
  }));
}

/**
 * capture_inbox.status の単列更新(本人行のみ — capture-triage)。
 * 更新対象は status 列に限定(processed_at / curated_ref / kind / body は触らない)。
 * 戻り値は更新行数(0 = 他人の行・不存在 — 呼び出し側で bad_request に潰す)。
 */
export async function setCaptureStatus(
  userId: string,
  id: string,
  status: CaptureStatus
): Promise<number> {
  const result = await query(
    `UPDATE capture_inbox SET status = $1 WHERE id = $2 AND user_id = $3`,
    [status, id, userId]
  );
  return result.rowCount ?? 0;
}

/**
 * capture_inbox の論理削除(本人行のみ — capture-trash)。deleted_at に現在時刻をセットする冪等な
 * 更新(既に削除済みの行は対象外 — 二重実行は rowCount 0)。戻り値は更新行数。
 */
export async function softDeleteCapture(userId: string, id: string): Promise<number> {
  const result = await query(
    `UPDATE capture_inbox SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  );
  return result.rowCount ?? 0;
}

/**
 * capture_inbox の削除取り消し(本人行のみ — capture-trash)。deleted_at を NULL に戻す冪等な
 * 更新(削除済みでない行は対象外 — 二重実行は rowCount 0)。戻り値は更新行数。
 * action 側の名称は restoreCapture(データ層は Row 接尾辞で同名衝突を回避)。
 */
export async function restoreCaptureRow(userId: string, id: string): Promise<number> {
  const result = await query(
    `UPDATE capture_inbox SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`,
    [id, userId]
  );
  return result.rowCount ?? 0;
}
