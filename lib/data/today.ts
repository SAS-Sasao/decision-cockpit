import "server-only";

// 対象設計: docs/design/detail/today-view.md §2.4(getTodayData)
//          docs/design/basic/today-view.md §1-2(表示契約 — 最新世代フィルタ)/ §1-5(SC-03 データ契約)
//
// board_items(最新 commit 世代のみ)+ timeline_records(今週の reward/retry)を集約して
// SC-03 今日ビューのデータを構築する。週境界は lib/data/review.ts の weekBucketBoundaries を
// 再利用する(二重実装しない — overview.ts と同じ規範)。全クエリ $n 束縛のみ。

import { query } from "../db";
import type { RecordType, TaskRewardSignals } from "../ingestion/parsers/types";
import { weekBucketBoundaries } from "../data/review";

export type TodayCard = {
  itemKey: string;
  title: string;
  assignee: string | null;
  period: string | null;
  deliverable: string | null;
  pri: string | null;
  org: string | null;
  section: string | null;
};

export type TodayData = {
  summary: { open: number; doing: number; retryRate: number | null; rewardAvg: number | null };
  columns: { state: "todo" | "doing" | "done"; items: TodayCard[] }[];
  boardEmpty: boolean; // board_items が 0 行(未同期)— 空状態表示用
};

/**
 * capture の status → カンバンレーンのマップ(today-board-interactive §1-1)。
 * CaptureStatus 3値の全域写像(open→todo / in_progress→doing / done→done)。純関数・ユニットテスト対象。
 */
export function laneOfCaptureStatus(status: "open" | "in_progress" | "done"): "todo" | "doing" | "done" {
  switch (status) {
    case "open":
      return "todo";
    case "in_progress":
      return "doing";
    case "done":
      return "done";
  }
}

// reward 平均の対象(ingestion-foundation 基本設計 §3.4 を継承・review/overview と同じ局所定数)。
const REWARD_TYPES: readonly RecordType[] = ["task", "score"];

// 完了列(done)の表示上限(§0-5)。
const DONE_LIMIT = 8;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rate(trueCount: number, total: number): number | null {
  if (total === 0) return null;
  return trueCount / total;
}

function compareAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type BoardQueryRow = {
  item_key: string;
  title: string;
  assignee: string | null;
  period: string | null;
  deliverable: string | null;
  pri: string | null;
  org: string | null;
  section: string | null;
  state: "todo" | "doing" | "done";
};

function toCard(row: BoardQueryRow): TodayCard {
  return {
    itemKey: row.item_key,
    title: row.title,
    assignee: row.assignee,
    period: row.period,
    deliverable: row.deliverable,
    pri: row.pri,
    org: row.org,
    section: row.section,
  };
}

type SummaryQueryRow = {
  type: RecordType;
  reward_score: number | null;
  signals: TaskRewardSignals | null;
};

/**
 * SC-03 今日ビューのデータ取得(共有データ・userId 引数なし。認可は呼び出し側の requireUser)。
 * board_items は「各 file_path の最新 commit 世代の行のみ」を対象にする(基本設計 §1-2)。
 * 世代代表の選出は array_agg(commit ORDER BY synced_at DESC, commit DESC) の先頭要素
 * (max(synced_at) 行の commit・同時刻は commit 降順でタイブレーク)。
 */
export async function getTodayData(): Promise<TodayData> {
  const boardResult = await query<BoardQueryRow>(
    `WITH generations AS (
       SELECT source, file_path,
              (array_agg(commit ORDER BY synced_at DESC, commit DESC))[1] AS commit
         FROM board_items
        GROUP BY source, file_path
     )
     SELECT b.item_key, b.title, b.assignee, b.period, b.deliverable, b.pri, b.org, b.section, b.state
       FROM board_items b
       JOIN generations g
         ON b.source = g.source AND b.file_path = g.file_path AND b.commit = g.commit`
  );

  const boardEmpty = boardResult.rows.length === 0;

  const todoItems = boardResult.rows
    .filter((r) => r.state === "todo")
    .sort((a, b) => compareAsc(a.item_key, b.item_key))
    .map(toCard);
  const doingItems = boardResult.rows
    .filter((r) => r.state === "doing")
    .sort((a, b) => compareAsc(a.item_key, b.item_key))
    .map(toCard);
  const doneItems = boardResult.rows
    .filter((r) => r.state === "done")
    .sort((a, b) => compareAsc(b.item_key, a.item_key)) // 降順
    .slice(0, DONE_LIMIT)
    .map(toCard);

  // 「今週」= weekBucketBoundaries(now, 1) の唯一のバケット(今週の部分週を含む)。
  const [{ start, end }] = weekBucketBoundaries(new Date(), 1);

  const summaryResult = await query<SummaryQueryRow>(
    `SELECT type, reward_score, signals
       FROM timeline_records
      WHERE status = 'ok' AND occurred_at >= $1 AND occurred_at < $2`,
    [start, end]
  );

  const rewardValues = summaryResult.rows
    .filter((r) => REWARD_TYPES.includes(r.type) && r.reward_score !== null)
    .map((r) => r.reward_score as number);
  const signalRows = summaryResult.rows.filter((r) => r.signals !== null);
  const retryRate = rate(
    signalRows.filter((r) => r.signals!.retry_detected).length,
    signalRows.length
  );

  return {
    summary: {
      open: todoItems.length,
      doing: doingItems.length,
      retryRate,
      rewardAvg: average(rewardValues),
    },
    columns: [
      { state: "todo", items: todoItems },
      { state: "doing", items: doingItems },
      { state: "done", items: doneItems },
    ],
    boardEmpty,
  };
}
