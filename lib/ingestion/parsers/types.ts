// 対象設計: docs/design/detail/ingestion-foundation.md §2.2 / §1.2(timeline_records DDL)
//          docs/design/basic/ingestion-foundation.md §3.2(正規化規範表)
//
// パーサ / normalize 共通の型定義。パーサは純関数(ネットワーク・DB 依存なし)。
// NormalizedRecord は timeline_records の列に対応する(id / synced_at は DB 側で採番するため除く)。

export type SourceFile = {
  path: string;
  content: string;
};

export type ParseMeta = {
  source: string;
  commit: string;
  org: string | null;
};

// db/migrations/0002_ingestion_foundation.up.sql の type CHECK 制約と一致させる。
// M1-A のパーサ5本が実際に出力するのは task/score/quality/decision/daily_log の5値
// (session/conversation は M1 スコープ外だが CHECK 制約上の語彙として型に残す)。
export type RecordType =
  | "task"
  | "quality"
  | "score"
  | "session"
  | "conversation"
  | "decision"
  | "daily_log";

export type RecordStatus = "ok" | "error";

// task-log の `## reward > signals`(bool×4・task-log のみ)。他ソースは null。
export type TaskRewardSignals = {
  completed: boolean;
  artifacts_exist: boolean;
  excessive_edits: boolean;
  retry_detected: boolean;
};

export type NormalizedRecord = {
  source: string;
  file_path: string;
  item_key: string;
  commit: string;
  type: RecordType;
  occurred_at: Date | null;
  org: string | null;
  topic: string | null;
  tags: string[];
  title: string | null;
  body: string | null;
  raw_ref: string;
  status: RecordStatus;
  reward_score: number | null;
  signals: TaskRewardSignals | null;
  completeness: number | null;
  accuracy: number | null;
  clarity: number | null;
  quality_gate_result: string | null;
};

export type Parser = (file: SourceFile, meta: ParseMeta) => NormalizedRecord[];
