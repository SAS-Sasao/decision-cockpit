import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.5(振り返り)
//          docs/design/basic/ingestion-foundation.md §3.4(振り返りの集計契約 — 規範)
//
// 「テスト可能な構造」の分離:
//   aggregateReview() — 純関数。DB/ネットワーク非依存。tests/review-data.test.ts が直接検証する。
//   getReviewData()   — lib/db 経由のクエリ(WHERE status='ok' を既定)→ aggregateReview に委譲。
//
// 共有データ(user_id なし)のため userId 引数は取らない。認可は呼び出し側(app/review/page.tsx)の
// requireUser() が担う(§3.3)。

import { query } from "../db";
import type { RecordType, TaskRewardSignals } from "../ingestion/parsers/types";

export type Granularity = "week" | "month";

/**
 * 集計対象の1行(timeline_records の列サブセット)。
 * status を保持するのは、aggregateReview 単体で「error 行が混入しても集計に現れない」ことを
 * 実 DB なしに機械判定するため(基本設計 §3.4 / 詳細設計 §3 の review-data テスト観点)。
 * 実クエリ側は `WHERE status = 'ok'` を既定にするため、通常経路では 'error' は渡らない
 * (防御的フィルタは呼び出し側の取りこぼしに対する保険)。
 */
export type ReviewRow = {
  type: RecordType;
  status: "ok" | "error";
  occurred_at: Date;
  title: string | null;
  source: string;
  file_path: string;
  org: string | null;
  reward_score: number | null;
  signals: TaskRewardSignals | null;
  completeness: number | null;
  accuracy: number | null;
  clarity: number | null;
  quality_gate_result: string | null;
};

export type SignalRates = {
  completed: number | null;
  artifacts_exist: number | null;
  excessive_edits: number | null;
  retry_detected: number | null;
};

export type JudgeAverages = {
  completeness: number | null;
  accuracy: number | null;
  clarity: number | null;
};

export type Bucket = {
  /** バケット開始(UTC・含む) */
  start: Date;
  /** バケット終了(UTC・含まない) */
  end: Date;
  /** type 別レコード数(全 type)。 */
  counts: Record<RecordType, number>;
  /** reward_score 非 null の平均(type ∈ task, score)。分母 0 なら null。 */
  rewardAvg: number | null;
  /** 4シグナル達成率(signals 非 null のレコードが分母)。分母 0 なら null。 */
  signalRates: SignalRates;
  /** judge 3軸平均(各軸・非 null のみ。source 横断プール)。分母 0 なら null。 */
  judgeAvg: JudgeAverages;
  /** quality_gate_result='pass' の率(type=quality が分母)。分母 0 なら null。 */
  qualityGatePassRate: number | null;
};

export type Entry = {
  type: "decision" | "daily_log";
  occurred_at: Date;
  title: string | null;
  source: string;
  file_path: string;
  org: string | null;
};

export type ReviewData = {
  buckets: Bucket[];
  entries: Entry[];
};

// timeline_records の type CHECK 制約(db/migrations/0002_ingestion_foundation.up.sql +
// 0004_org_docs.up.sql)と一致させる。knowledge は org-docs-ingestion で8 type 目として末尾追加。
const ALL_RECORD_TYPES: RecordType[] = [
  "task",
  "quality",
  "score",
  "session",
  "conversation",
  "decision",
  "daily_log",
  "knowledge",
];

// reward 平均の対象(基本設計 §3.4)。
const REWARD_TYPES: readonly RecordType[] = ["task", "score"];

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rate(trueCount: number, total: number): number | null {
  if (total === 0) return null;
  return trueCount / total;
}

/** UTC の日付境界(時刻成分を 0)に切り詰める。 */
function truncateToUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * 直近 `weeks` 週(月曜起点・古→新)のバケット境界を作る。境界は [start, end) の半開区間。
 * 末尾バケットは now を含む進行中の部分週(週の途中でも end は次週月曜 00:00Z に固定)。
 * ui-shell(overview.ts)と review.ts の双方から共有するため export + パラメータ化。
 */
export function weekBucketBoundaries(now: Date, weeks: number): { start: Date; end: Date }[] {
  const today = truncateToUtcDate(now);
  const dayOfWeek = today.getUTCDay(); // 0=Sun .. 6=Sat
  const diffToMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const startOfThisWeek = new Date(today);
  startOfThisWeek.setUTCDate(startOfThisWeek.getUTCDate() - diffToMonday);

  const boundaries: { start: Date; end: Date }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(startOfThisWeek);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    boundaries.push({ start, end });
  }
  return boundaries;
}

/** 直近6ヶ月(暦月・古→新)のバケット境界を作る。境界は [start, end) の半開区間。 */
function monthBucketBoundaries(now: Date): { start: Date; end: Date }[] {
  const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const boundaries: { start: Date; end: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(
      Date.UTC(startOfThisMonth.getUTCFullYear(), startOfThisMonth.getUTCMonth() - i, 1)
    );
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    boundaries.push({ start, end });
  }
  return boundaries;
}

function buildBucket(rows: ReviewRow[], start: Date, end: Date): Bucket {
  const counts = Object.fromEntries(ALL_RECORD_TYPES.map((t) => [t, 0])) as Record<
    RecordType,
    number
  >;
  for (const row of rows) counts[row.type] += 1;

  const rewardValues = rows
    .filter((r) => REWARD_TYPES.includes(r.type) && r.reward_score !== null)
    .map((r) => r.reward_score as number);

  const signalRows = rows.filter((r) => r.signals !== null);
  const signalRates: SignalRates = {
    completed: rate(signalRows.filter((r) => r.signals!.completed).length, signalRows.length),
    artifacts_exist: rate(
      signalRows.filter((r) => r.signals!.artifacts_exist).length,
      signalRows.length
    ),
    excessive_edits: rate(
      signalRows.filter((r) => r.signals!.excessive_edits).length,
      signalRows.length
    ),
    retry_detected: rate(
      signalRows.filter((r) => r.signals!.retry_detected).length,
      signalRows.length
    ),
  };

  const judgeAvg: JudgeAverages = {
    completeness: average(
      rows.filter((r) => r.completeness !== null).map((r) => r.completeness as number)
    ),
    accuracy: average(rows.filter((r) => r.accuracy !== null).map((r) => r.accuracy as number)),
    clarity: average(rows.filter((r) => r.clarity !== null).map((r) => r.clarity as number)),
  };

  const qualityRows = rows.filter((r) => r.type === "quality");
  const qualityPass = qualityRows.filter((r) => r.quality_gate_result === "pass").length;

  return {
    start,
    end,
    counts,
    rewardAvg: average(rewardValues),
    signalRates,
    judgeAvg,
    qualityGatePassRate: rate(qualityPass, qualityRows.length),
  };
}

/**
 * 振り返り集計の純関数(基本設計 §3.4 の集計契約どおり)。DB/ネットワーク非依存。
 * - 対象は status='ok' のみ(呼び出し側で既に絞り込み済み前提だが、混入時も安全側に落ちるよう
 *   ここでも防御的にフィルタする)。
 * - 週 = 月曜起点・直近8週 / 月 = 直近6ヶ月(いずれも now 基準・古→新順)。
 * - null は全指標で分母から除外する。
 */
export function aggregateReview(rows: ReviewRow[], granularity: Granularity, now: Date): ReviewData {
  const okRows = rows.filter((r) => r.status === "ok");
  const boundaries = granularity === "week" ? weekBucketBoundaries(now, 8) : monthBucketBoundaries(now);

  const buckets = boundaries.map(({ start, end }) => {
    const bucketRows = okRows.filter((r) => r.occurred_at >= start && r.occurred_at < end);
    return buildBucket(bucketRows, start, end);
  });

  const periodStart = boundaries[0]!.start;
  const entries: Entry[] = okRows
    .filter(
      (r) =>
        (r.type === "decision" || r.type === "daily_log") &&
        r.occurred_at >= periodStart &&
        r.occurred_at <= now
    )
    .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
    .map((r) => ({
      type: r.type as "decision" | "daily_log",
      occurred_at: r.occurred_at,
      title: r.title,
      source: r.source,
      file_path: r.file_path,
      org: r.org,
    }));

  return { buckets, entries };
}

type ReviewQueryRow = {
  type: RecordType;
  status: "ok" | "error";
  occurred_at: Date;
  title: string | null;
  source: string;
  file_path: string;
  org: string | null;
  reward_score: number | null;
  signals: TaskRewardSignals | null;
  completeness: number | null;
  accuracy: number | null;
  clarity: number | null;
  quality_gate_result: string | null;
};

/**
 * 振り返りデータ取得(共有データ・userId 引数なし。認可は呼び出し側の requireUser)。
 * 全クエリの既定として WHERE status='ok' を課す(詳細設計 §2.5)。
 */
export async function getReviewData(granularity: Granularity): Promise<ReviewData> {
  // knowledge 型は occurred_at が null 許容(org-docs-ingestion §0 決着2)のため、
  // ここで除外する(ReviewRow.occurred_at の型を Date のまま真にするための SQL 側フィルタ)。
  const result = await query<ReviewQueryRow>(
    `SELECT type, status, occurred_at, title, source, file_path, org,
            reward_score, signals, completeness, accuracy, clarity, quality_gate_result
       FROM timeline_records
      WHERE status = 'ok' AND occurred_at IS NOT NULL`
  );

  const rows: ReviewRow[] = result.rows.map((row) => ({
    type: row.type,
    status: row.status,
    occurred_at: row.occurred_at,
    title: row.title,
    source: row.source,
    file_path: row.file_path,
    org: row.org,
    reward_score: row.reward_score,
    signals: row.signals,
    completeness: row.completeness,
    accuracy: row.accuracy,
    clarity: row.clarity,
    quality_gate_result: row.quality_gate_result,
  }));

  return aggregateReview(rows, granularity, new Date());
}
