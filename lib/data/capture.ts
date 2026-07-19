import "server-only";

// 対象設計: docs/design/detail/capture-spar.md §2.1(lib/data/capture.ts)
//          .claude/rules/capture.md(capture_inbox 契約)
//
// capture_inbox への書き込みは INSERT のみ(§1 — UPDATE/DELETE を発行しない)。
// 未処理件数は lib/data/overview.ts の getUnprocessedInboxCount を再利用する(二重実装しない)。

import { query } from "../db";

export type CaptureKind = "status" | "issue" | "next_move" | "spar_conclusion";

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
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

/**
 * capture_inbox への INSERT(唯一の書き込み経路)。source は SQL リテラル 'ui' 固定
 * (client から供給しない)。tags / processed_at / curated_ref は触らない(DB 既定に任せる)。
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
};

/**
 * 本人分の INBOX を新しい順(created_at DESC, id DESC — 同時刻タイブレーク)で取得する。
 * limit は既定 50・クランプ 1..100。
 */
export async function listInbox(userId: string, limit?: number): Promise<InboxRow[]> {
  const result = await query<InboxQueryRow>(
    `SELECT id, kind, topic, tags, body, source, created_at, processed_at, curated_ref
       FROM capture_inbox
      WHERE user_id = $1
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
  }));
}
