import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §1.4(冪等 upsert)/ §2.3(同期オーケストレーション)
//
// run-sync.ts が使うデータアクセスをここに集約する(lib/db.ts 経由の唯一の呼び出し口)。
// run-sync.test.ts はこのモジュールをまるごとモックし、実 DB なしで進行保証ロジックを検証する。

import { query } from "../db";
import type { TagVocabEntry } from "./normalize";
import type { NormalizedRecord } from "./parsers/types";

export type SyncProgress = { head: string; done: string[] };

export type SyncState = {
  lastCommit: string | null;
  progress: SyncProgress | null;
};

export type SavedSyncState = {
  lastCommit: string | null;
  lastSummary: unknown;
  progress: SyncProgress | null;
};

/** sync_state.repo の現在値を取得する(未同期なら null)。 */
export async function getSyncState(repo: string): Promise<SyncState | null> {
  const result = await query<{ last_commit: string | null; progress: SyncProgress | null }>(
    `SELECT last_commit, progress FROM sync_state WHERE repo = $1`,
    [repo]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { lastCommit: row.last_commit, progress: row.progress };
}

/** sync_state を冪等 upsert する(repo が主キー)。 */
export async function saveSyncState(repo: string, state: SavedSyncState): Promise<void> {
  await query(
    `INSERT INTO sync_state (repo, last_commit, last_synced_at, last_summary, progress)
     VALUES ($1, $2, now(), $3, $4)
     ON CONFLICT (repo) DO UPDATE SET
       last_commit = EXCLUDED.last_commit,
       last_synced_at = EXCLUDED.last_synced_at,
       last_summary = EXCLUDED.last_summary,
       progress = EXCLUDED.progress`,
    [
      repo,
      state.lastCommit,
      JSON.stringify(state.lastSummary),
      state.progress ? JSON.stringify(state.progress) : null,
    ]
  );
}

/** tag_synonyms 全件(ラン冒頭に一度だけロードして使う語彙スナップショット)。 */
export async function getAllTagSynonyms(): Promise<TagVocabEntry[]> {
  const result = await query<{ synonym: string; canonical: string }>(
    `SELECT synonym, canonical FROM tag_synonyms`
  );
  return result.rows;
}

/** masters 由来の語彙を tag_synonyms へ冪等 upsert する(索引レコードは作らない)。 */
export async function upsertTagSynonyms(entries: TagVocabEntry[]): Promise<void> {
  for (const entry of entries) {
    await query(
      `INSERT INTO tag_synonyms (synonym, canonical) VALUES ($1, $2)
       ON CONFLICT (synonym) DO UPDATE SET canonical = EXCLUDED.canonical`,
      [entry.synonym, entry.canonical]
    );
  }
}

/** timeline_records への冪等 upsert(§1.4 の ON CONFLICT 文どおり)。 */
export async function upsertTimelineRecord(record: NormalizedRecord): Promise<void> {
  await query(
    `INSERT INTO timeline_records (source, file_path, item_key, commit, type, occurred_at, org, topic,
       tags, title, body, raw_ref, status, reward_score, signals, completeness, accuracy, clarity,
       quality_gate_result, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
     ON CONFLICT (source, file_path, item_key) DO UPDATE SET
       commit = EXCLUDED.commit, type = EXCLUDED.type, occurred_at = EXCLUDED.occurred_at,
       org = EXCLUDED.org, topic = EXCLUDED.topic, tags = EXCLUDED.tags, title = EXCLUDED.title,
       body = EXCLUDED.body, raw_ref = EXCLUDED.raw_ref, status = EXCLUDED.status,
       reward_score = EXCLUDED.reward_score, signals = EXCLUDED.signals,
       completeness = EXCLUDED.completeness, accuracy = EXCLUDED.accuracy, clarity = EXCLUDED.clarity,
       quality_gate_result = EXCLUDED.quality_gate_result, synced_at = now()`,
    [
      record.source,
      record.file_path,
      record.item_key,
      record.commit,
      record.type,
      record.occurred_at,
      record.org,
      record.topic,
      record.tags,
      record.title,
      record.body,
      record.raw_ref,
      record.status,
      record.reward_score,
      record.signals ? JSON.stringify(record.signals) : null,
      record.completeness,
      record.accuracy,
      record.clarity,
      record.quality_gate_result,
    ]
  );
}
