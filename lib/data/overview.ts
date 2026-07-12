import "server-only";

// 対象設計: docs/design/detail/ui-shell.md §1(参照列)/ §2.3(overview.ts の型・関数契約)
//          docs/design/basic/ui-shell.md §3.1 / §3.4(集計規範 — ingestion-foundation 基本設計 §3.4 を完全継承)
//
// SC-02 概観ダッシュボードの集計。「テスト可能な構造」の分離は lib/data/review.ts と同型:
//   aggregateOverview() — 純関数。DB/ネットワーク非依存。tests/overview-data.test.ts が直接検証する。
//   getOverviewData()   — lib/db 経由のクエリ(a〜d)→ aggregateOverview + buildLastSync に委譲。
//
// 週バケットは lib/data/review.ts の weekBucketBoundaries(now, weeks) を再利用する(二重定義しない — §0-2)。

import { query } from "../db";
import type { RecordType } from "../ingestion/parsers/types";
import { weekBucketBoundaries } from "./review";

/** 集計対象の1行(timeline_records の列サブセット — §1 の参照列)。 */
export type OverviewRow = {
  type: RecordType;
  occurred_at: Date;
  reward_score: number | null;
  quality_gate_result: string | null;
  status: "ok" | "error";
  title: string | null;
  source: string;
  file_path: string;
  org: string | null;
};

export type OverviewData = {
  kpis: {
    rewardWeekAvg: number | null;
    rewardPrevDelta: number | null; // 片側 null → delta null(§0-3)
    qgPassRate: number | null;
    qgPrevDelta: number | null;
    recordsThisWeek: number;
    recordsByType: { type: string; count: number }[]; // count>0 のみ。表示順は7 type 全列挙で固定
    unprocessedInbox: number;
  };
  weeklyTrend: { weekStart: string; rewardAvg: number | null; qgPassRate: number | null }[]; // 6週・古→新・末尾=部分週
  recentDecisions: {
    occurredAt: string;
    title: string | null;
    source: string;
    filePath: string;
    org: string | null;
  }[]; // 5件
  lastSync: { repo: string; lastSyncedAt: string | null }[]; // REPOS 定数起点(§0)
};

/** lastSync 構築の固定リスト(SSoT 2 repo)。 */
export const REPOS = ["cc-sier-organization", "ai-war-room"] as const;

export type OverviewAggregates = {
  kpis: Omit<OverviewData["kpis"], "unprocessedInbox">;
  weeklyTrend: OverviewData["weeklyTrend"];
};

// recordsByType の表示順(基本設計の5 type 列挙を意図的に7 type 全列挙へ詳細化 — §2.3)。
const RECORD_TYPE_ORDER: RecordType[] = [
  "task",
  "quality",
  "score",
  "session",
  "conversation",
  "decision",
  "daily_log",
];

// reward 平均の対象(ingestion-foundation 基本設計 §3.4 を継承)。
const REWARD_TYPES: readonly RecordType[] = ["task", "score"];

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rate(trueCount: number, total: number): number | null {
  if (total === 0) return null;
  return trueCount / total;
}

/** 片側でも null(分母0)なら delta は null('na' 表示)。 */
function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

type BucketStats = {
  start: Date;
  rewardAvg: number | null;
  qgPassRate: number | null;
  recordsByType: { type: string; count: number }[];
  recordsTotal: number;
};

function buildBucketStats(rows: OverviewRow[], start: Date): BucketStats {
  const counts: Record<string, number> = {};
  for (const t of RECORD_TYPE_ORDER) counts[t] = 0;
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;

  const rewardValues = rows
    .filter((r) => REWARD_TYPES.includes(r.type) && r.reward_score !== null)
    .map((r) => r.reward_score as number);

  const qualityRows = rows.filter((r) => r.type === "quality");
  const qualityPass = qualityRows.filter((r) => r.quality_gate_result === "pass").length;

  const recordsByType = RECORD_TYPE_ORDER.filter((t) => counts[t] > 0).map((t) => ({
    type: t,
    count: counts[t]!,
  }));

  return {
    start,
    rewardAvg: average(rewardValues),
    qgPassRate: rate(qualityPass, qualityRows.length),
    recordsByType,
    recordsTotal: rows.length,
  };
}

/**
 * SC-02 概観集計の純関数(DB/ネットワーク非依存)。
 * - weekBucketBoundaries(now, 6) で6バケット(月曜起点 UTC・古→新・末尾=now を含む進行中の部分週)。
 * - KPI(今週/前週)はトレンド6週の末尾2バケットから導出(バケット生成は1回)。
 * - status='error' 行は入力に混入しても防御的に除外する。null は全指標で分母除外。
 */
export function aggregateOverview(rows: OverviewRow[], now: Date): OverviewAggregates {
  const okRows = rows.filter((r) => r.status === "ok");
  const boundaries = weekBucketBoundaries(now, 6);

  const bucketStats = boundaries.map(({ start, end }) => {
    const bucketRows = okRows.filter((r) => r.occurred_at >= start && r.occurred_at < end);
    return buildBucketStats(bucketRows, start);
  });

  const weeklyTrend = bucketStats.map((b) => ({
    weekStart: b.start.toISOString(),
    rewardAvg: b.rewardAvg,
    qgPassRate: b.qgPassRate,
  }));

  const thisWeek = bucketStats[bucketStats.length - 1]!;
  const prevWeek = bucketStats[bucketStats.length - 2]!;

  return {
    kpis: {
      rewardWeekAvg: thisWeek.rewardAvg,
      rewardPrevDelta: delta(thisWeek.rewardAvg, prevWeek.rewardAvg),
      qgPassRate: thisWeek.qgPassRate,
      qgPrevDelta: delta(thisWeek.qgPassRate, prevWeek.qgPassRate),
      recordsThisWeek: thisWeek.recordsTotal,
      recordsByType: thisWeek.recordsByType,
    },
    weeklyTrend,
  };
}

/**
 * REPOS(固定 repo リスト)起点で sync_state の行を突合する純関数。
 * 行不在の repo は lastSyncedAt=null(「未同期」)。REPOS 外の余剰行は無視する。
 */
export function buildLastSync(
  stateRows: { repo: string; last_synced_at: Date | null }[]
): OverviewData["lastSync"] {
  return REPOS.map((repo) => {
    const row = stateRows.find((r) => r.repo === repo);
    if (!row || row.last_synced_at === null) {
      return { repo, lastSyncedAt: null };
    }
    return { repo, lastSyncedAt: row.last_synced_at.toISOString() };
  });
}

type SyncStateQueryRow = { repo: string; last_synced_at: Date | null };

/** layout 用(sync_state 全行 → buildLastSync)。 */
export async function getLastSync(): Promise<OverviewData["lastSync"]> {
  const result = await query<SyncStateQueryRow>(`SELECT repo, last_synced_at FROM sync_state`);
  return buildLastSync(result.rows);
}

/** 未処理 inbox バッジ用の軽量 count(layout から毎リクエスト呼ばれるため count 1本に限定)。 */
export async function getUnprocessedInboxCount(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) AS count
       FROM capture_inbox
      WHERE user_id = $1 AND processed_at IS NULL`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

type AggregateQueryRow = {
  type: RecordType;
  occurred_at: Date;
  reward_score: number | null;
  quality_gate_result: string | null;
  status: "ok" | "error";
  title: string | null;
  source: string;
  file_path: string;
  org: string | null;
};

type RecentDecisionQueryRow = {
  occurred_at: Date;
  title: string | null;
  source: string;
  file_path: string;
  org: string | null;
};

/**
 * SC-02 概観データ取得(本人の capture_inbox 未処理件数を内包 — userId 必須)。
 * クエリ (a) 集計用行(6週窓) (b) 最近の判断ログ5件 (c) sync_state 全行 (d) inbox count。
 */
export async function getOverviewData(userId: string): Promise<OverviewData> {
  const now = new Date();
  const windowStart = weekBucketBoundaries(now, 6)[0]!.start;

  const [aggregateRows, recentDecisionRows, syncStateRows, unprocessedInbox] = await Promise.all([
    query<AggregateQueryRow>(
      `SELECT type, occurred_at, reward_score, quality_gate_result, status,
              title, source, file_path, org
         FROM timeline_records
        WHERE status = 'ok' AND occurred_at >= $1`,
      [windowStart]
    ),
    query<RecentDecisionQueryRow>(
      `SELECT occurred_at, title, source, file_path, org
         FROM timeline_records
        WHERE status = 'ok' AND type = 'decision'
        ORDER BY occurred_at DESC
        LIMIT 5`
    ),
    query<SyncStateQueryRow>(`SELECT repo, last_synced_at FROM sync_state`),
    getUnprocessedInboxCount(userId),
  ]);

  const rows: OverviewRow[] = aggregateRows.rows.map((row) => ({
    type: row.type,
    occurred_at: row.occurred_at,
    reward_score: row.reward_score,
    quality_gate_result: row.quality_gate_result,
    status: row.status,
    title: row.title,
    source: row.source,
    file_path: row.file_path,
    org: row.org,
  }));

  const aggregates = aggregateOverview(rows, now);
  const lastSync = buildLastSync(syncStateRows.rows);
  const recentDecisions = recentDecisionRows.rows.map((row) => ({
    occurredAt: row.occurred_at.toISOString(),
    title: row.title,
    source: row.source,
    filePath: row.file_path,
    org: row.org,
  }));

  return {
    kpis: { ...aggregates.kpis, unprocessedInbox },
    weeklyTrend: aggregates.weeklyTrend,
    recentDecisions,
    lastSync,
  };
}
