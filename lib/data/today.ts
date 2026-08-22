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
import { CARD_LATEST_SQL, INFLIGHT_ACTIVE_SQL } from "../review/api-lib";
import { cardKeyOf, isStaleReview } from "../review/card-key";

export type TodayCard = {
  itemKey: string;
  title: string;
  assignee: string | null;
  period: string | null;
  deliverable: string | null;
  pri: string | null;
  org: string | null;
  section: string | null;
  filePath?: string; // wbs-loop §2.4: updateBoardState の識別子(additive)
  overridden?: boolean; // wbs-loop §2.4: アクティブなオーバーレイ中(「PR 反映待ち」バッジ)
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

/**
 * レーン件数の集計(today-summary-sync §1 — 純関数・ユニットテスト対象)。
 * 各レーンの件数 = columns(applyBoardOverrides 適用後)の items 数 + captureLanes の件数。
 * 盤面に見えているカード数と定義上一致する(要素の中身は数えない — unknown[])。
 * columns に該当レーンが無い場合は captureLanes のみの件数。
 * **レーン件数の正典はこの関数**(board.tsx のレーンバッジは同型式の表示実装 — 乖離時はこちらに合わせる)。
 */
export function laneCounts(
  columns: { state: "todo" | "doing" | "done"; items: unknown[] }[],
  captureLanes: Record<"todo" | "doing" | "done", unknown[]>
): { todo: number; doing: number; done: number } {
  const counts = {
    todo: captureLanes.todo.length,
    doing: captureLanes.doing.length,
    done: captureLanes.done.length,
  };
  for (const col of columns) {
    counts[col.state] += col.items.length;
  }
  return counts;
}

/**
 * WBS カードへのオーバーレイ適用(wbs-loop §2.4 — 純関数・ユニットテスト対象)。
 * アクティブなオーバーレイに一致するカード(filePath + itemKey)を実効レーン(desiredState)へ
 * 移し替え、`overridden: true`(「PR 反映待ち」バッジ)を立てる。一致しないオーバーレイは無視
 * (最新世代フィルタで消えた item — CI の不在出口が解消する。基本設計 §1-2)。
 * 移動カードは移動先レーンの末尾に付ける(決定的)。
 */
export function applyBoardOverrides(
  columns: { state: "todo" | "doing" | "done"; items: TodayCard[] }[],
  overrides: { filePath: string; itemKey: string; desiredState: "todo" | "doing" | "done" }[]
): { state: "todo" | "doing" | "done"; items: TodayCard[] }[] {
  if (overrides.length === 0) return columns;

  const byKey = new Map<string, "todo" | "doing" | "done">();
  for (const o of overrides) {
    byKey.set(`${o.filePath}|${o.itemKey}`, o.desiredState);
  }

  const moved: Record<"todo" | "doing" | "done", TodayCard[]> = { todo: [], doing: [], done: [] };
  const kept = columns.map((col) => ({
    state: col.state,
    items: col.items.filter((item) => {
      const desired = item.filePath ? byKey.get(`${item.filePath}|${item.itemKey}`) : undefined;
      if (desired === undefined) return true;
      moved[desired].push({ ...item, overridden: true });
      return false;
    }),
  }));

  return kept.map((col) => ({ state: col.state, items: [...col.items, ...moved[col.state]] }));
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
  file_path?: string; // wbs-loop §2.4(additive — 既存モック行に無くても undefined 透過)
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
    filePath: row.file_path,
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
     SELECT b.item_key, b.title, b.assignee, b.period, b.deliverable, b.pri, b.org, b.section, b.state, b.file_path
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


// --- card-review(対象設計: docs/design/detail/card-review.md §2.5)---

export type LatestCardReview = {
  cardKey: string; // 突き合わせ用の内部表記(server 側で埋める)
  status: "pending" | "running" | "done" | "error";
  result: string | null;
  resultTruncated: boolean;
  errorKind: string | null;
  runRef: string | null;
  createdAt: string;
  startedAt: string | null;
  cardTitle: string | null; // 依頼時のスナップショット(表示側で現在の title と突き合わせる)
  stale: boolean; // 取得時点の滞留判定(client はポーリングのたびに再計算する)
};

type CardReviewQueryRow = {
  card_kind: "wbs" | "capture";
  card_file_path: string | null;
  card_item_key: string | null;
  card_capture_id: string | null;
  card_title: string | null;
  status: "pending" | "running" | "done" | "error";
  result: string | null;
  result_truncated: boolean;
  error_kind: string | null;
  run_ref: string | null;
  created_at: Date;
  started_at: Date | null;
};

/**
 * カード別の最新レビュー1件(90日窓)。**user_id 非スコープは意図的**
 * (単一ユーザー前提 — board-override.ts の家風と同じ)。WBS カードは共有物なので他 admin の
 * 依頼結果も見える。capture 由来行も同じ配列に入る(cardTitle = topic のスナップショット)ため、
 * capture.md の「参照は所有者本人のみ」に対しては単一ユーザー前提で受容する。
 * 呼び出しは admin 限定(page.tsx のゲート)。複数ユーザー運用では requested_by スコープを足すこと。
 */
export async function listLatestCardReviews(): Promise<LatestCardReview[]> {
  const result = await query<CardReviewQueryRow>(CARD_LATEST_SQL);
  const nowMs = Date.now();
  return result.rows.map((row) => {
    const createdAt = row.created_at.toISOString();
    const startedAt = row.started_at === null ? null : row.started_at.toISOString();
    return {
      cardKey:
        row.card_kind === "wbs"
          ? cardKeyOf({ kind: "wbs", filePath: row.card_file_path ?? "", itemKey: row.card_item_key ?? "" })
          : cardKeyOf({ kind: "capture", captureId: row.card_capture_id ?? "" }),
      status: row.status,
      result: row.result,
      resultTruncated: row.result_truncated,
      errorKind: row.error_kind,
      runRef: row.run_ref,
      createdAt,
      startedAt,
      cardTitle: row.card_title,
      stale: isStaleReview({ status: row.status, createdAt, startedAt }, nowMs),
    };
  });
}

/**
 * グローバル同時1件の判定(受理側と同じ不変量を UI に見せる)。stale 超過行は母集団から外す
 * ため、閾値超過で放置された行がボタンを永久に無効化することはない。
 * SQL は経過 > 閾値・純関数 isStaleReview は経過 >= 閾値でちょうど境界の1点だけずれる
 * (UI 側を stale 寄りに倒すのは意図的 = 安全側)。
 */
export async function hasInflightReview(): Promise<boolean> {
  const result = await query<{ inflight: boolean }>(INFLIGHT_ACTIVE_SQL);
  return result.rows[0]?.inflight === true;
}
