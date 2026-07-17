import "server-only";

// 対象設計: docs/design/detail/search-foundation.md §2.3(embed-index バッチ)/ §1-3(埋め込みバッチ契約)
//
// 対象行(status='ok' AND (embedding IS NULL OR embedding_model <> 現行識別子 OR synced_at > embedded_at))を
// synced_at 古い順に取得し、EmbeddingClient で埋め込み → 冪等 UPDATE する。
// lib/db の query() を直接呼ぶ唯一の経路(テストは lib/db をモックする)。

import { query } from "../db";
import { createEmbeddingClient, currentEmbeddingModel, type EmbeddingClient } from "./embedding";

export type EmbedSummary = { embedded: number; failed: number; remaining: number };

export const EMBED_INPUT_MAX_CHARS = 600;

// 対象行の共有 WHERE 句(SELECT / COUNT で再利用)。§4-3 の grep -F ピン対象(1行厳守)。
const EMBED_TARGET_WHERE = "WHERE status = 'ok' AND (embedding IS NULL OR embedding_model <> $1 OR synced_at > embedded_at)";

const EMBED_BATCH_SIZE = 100;
const DEFAULT_MAX_ROWS = 200;

function resolveMaxRows(): number {
  const raw = process.env.EMBED_MAX_ROWS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_ROWS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ROWS;
}

/**
 * 埋め込み入力テキスト(純関数)。[title, tags.join(" "), body] の非空要素を "\n" 連結し、
 * EMBED_INPUT_MAX_CHARS 文字(code unit 基準)で切詰める。
 */
export function buildEmbedInput(row: {
  title: string | null;
  tags: string[];
  body: string | null;
}): string {
  const parts = [row.title, row.tags.join(" "), row.body].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  return parts.join("\n").slice(0, EMBED_INPUT_MAX_CHARS);
}

type EmbedTargetRow = {
  id: string;
  title: string | null;
  tags: string[];
  body: string | null;
  // ::text の全精度文字列で読む。pg ドライバの Date 変換はミリ秒精度で µs を落とし、
  // embedded_at < synced_at が恒久成立して全行が再対象化される(2026-07-18 実バグ)。
  synced_at: string;
};

function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * 対象行を走査し埋め込み → UPDATE する(client 省略時 createEmbeddingClient())。
 * embed 失敗バッチは行数分 failed に計上して続行する(恒常失敗の可視化 — 詳細設計 §1-3)。
 */
export async function runEmbedIndex(
  client: EmbeddingClient = createEmbeddingClient()
): Promise<EmbedSummary> {
  const currentModel = currentEmbeddingModel();
  const maxRows = resolveMaxRows();

  const selectResult = await query<EmbedTargetRow>(
    `SELECT id, title, tags, body, synced_at::text AS synced_at
       FROM timeline_records
      ${EMBED_TARGET_WHERE}
      ORDER BY synced_at ASC
      LIMIT $2`,
    [currentModel, maxRows]
  );
  const targetRows = selectResult.rows;

  let embedded = 0;
  let failed = 0;

  for (const batch of chunkRows(targetRows, EMBED_BATCH_SIZE)) {
    const inputs = batch.map((row) => buildEmbedInput(row));
    let vectors: number[][];
    try {
      vectors = await client.embed(inputs);
    } catch {
      failed += batch.length;
      continue;
    }

    for (let i = 0; i < batch.length; i += 1) {
      const row = batch[i]!;
      const vec = vectors[i]!;
      const qvec = "[" + vec.join(",") + "]";
      await query(
        `UPDATE timeline_records
            SET embedding = $1::vector, embedding_model = $2, embedded_at = $3
          WHERE id = $4`,
        [qvec, currentModel, row.synced_at, row.id]
      );
      embedded += 1;
    }
  }

  const countResult = await query<{ count: string }>(
    `SELECT count(*) AS count
       FROM timeline_records
      ${EMBED_TARGET_WHERE}`,
    [currentModel]
  );
  const remaining = Number(countResult.rows[0]?.count ?? 0);

  return { embedded, failed, remaining };
}
