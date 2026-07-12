// 対象設計: docs/design/detail/ingestion-foundation.md §2.5(振り返り)/ §3(tests/review-data.test.ts)
//          docs/design/basic/ingestion-foundation.md §3.4(振り返りの集計契約 — 規範)
//
// aggregateReview() は純関数(DB/ネットワーク非依存)なので fixture 行(インライン生成)のみで検証する。
// 実 DB・実ネットワークは使わない。

import { describe, expect, it } from "vitest";
import { aggregateReview, type ReviewRow } from "../lib/data/review";
import type { RecordType, TaskRewardSignals } from "../lib/ingestion/parsers/types";

// 固定 now(決定的な週/月バケット判定のため)。2026-07-15 は UTC 水曜日。
// 直近8週の最終バケット(今週)= [2026-07-13T00:00Z, 2026-07-20T00:00Z)。
// 直近6ヶ月の最終バケット(今月)= [2026-07-01T00:00Z, 2026-08-01T00:00Z)。
const NOW = new Date(Date.UTC(2026, 6, 15, 10, 0, 0));

function makeRow(
  overrides: Partial<ReviewRow> & { type: RecordType; occurred_at: Date }
): ReviewRow {
  return {
    status: "ok",
    title: null,
    source: "ai-war-room",
    file_path: "docs/decisions/2026-07-14-example.md",
    org: null,
    reward_score: null,
    signals: null,
    completeness: null,
    accuracy: null,
    clarity: null,
    quality_gate_result: null,
    ...overrides,
  };
}

function signals(overrides: Partial<TaskRewardSignals>): TaskRewardSignals {
  return {
    completed: false,
    artifacts_exist: false,
    excessive_edits: false,
    retry_detected: false,
    ...overrides,
  };
}

// 今週バケット内の日時(2026-07-13T00:00Z 〜 2026-07-19T23:59Z の範囲)。
const IN_CURRENT_WEEK = new Date(Date.UTC(2026, 6, 14, 9, 0, 0));

describe("aggregateReview — §3.4 期待集計値", () => {
  it("reward 平均(type ∈ task, score)・4シグナル達成率・judge 3軸平均・QG 合格率が手計算値と一致する", () => {
    const rows: ReviewRow[] = [
      // reward: task 2件 + score 1件 → 平均対象
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.7 }),
      makeRow({ type: "score", occurred_at: IN_CURRENT_WEEK, reward_score: 0.9 }),
      // signals: 2件が非 null(分母=2)、1件は null(分母から除外)
      makeRow({
        type: "task",
        occurred_at: IN_CURRENT_WEEK,
        signals: signals({ completed: true, artifacts_exist: true }),
      }),
      makeRow({
        type: "task",
        occurred_at: IN_CURRENT_WEEK,
        signals: signals({ completed: true, excessive_edits: true }),
      }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, signals: null }),
      // judge 3軸: source 横断プール。completeness 2件・accuracy 1件・clarity 2件が分母。
      makeRow({
        type: "task",
        occurred_at: IN_CURRENT_WEEK,
        completeness: 0.8,
        accuracy: 0.6,
        clarity: 1.0,
      }),
      makeRow({
        type: "score",
        occurred_at: IN_CURRENT_WEEK,
        completeness: 0.4,
        accuracy: null,
        clarity: 0.5,
      }),
      // quality gate: 2件(pass 1 / fail 1)
      makeRow({
        type: "quality",
        occurred_at: IN_CURRENT_WEEK,
        quality_gate_result: "pass",
      }),
      makeRow({
        type: "quality",
        occurred_at: IN_CURRENT_WEEK,
        quality_gate_result: "fail",
      }),
    ];

    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;

    // 件数: type 別レコード数(全 type)
    expect(currentWeek.counts.task).toBe(6);
    expect(currentWeek.counts.score).toBe(2);
    expect(currentWeek.counts.quality).toBe(2);
    expect(currentWeek.counts.decision).toBe(0);
    expect(currentWeek.counts.daily_log).toBe(0);

    // reward 平均 = (0.5 + 0.7 + 0.9) / 3
    expect(currentWeek.rewardAvg).toBeCloseTo(0.7, 10);

    // 4シグナル達成率(分母=2)
    expect(currentWeek.signalRates.completed).toBeCloseTo(1.0, 10); // 2/2
    expect(currentWeek.signalRates.artifacts_exist).toBeCloseTo(0.5, 10); // 1/2
    expect(currentWeek.signalRates.excessive_edits).toBeCloseTo(0.5, 10); // 1/2
    expect(currentWeek.signalRates.retry_detected).toBeCloseTo(0.0, 10); // 0/2

    // judge 3軸平均
    expect(currentWeek.judgeAvg.completeness).toBeCloseTo((0.8 + 0.4) / 2, 10);
    expect(currentWeek.judgeAvg.accuracy).toBeCloseTo(0.6, 10); // 非 null 1件のみ
    expect(currentWeek.judgeAvg.clarity).toBeCloseTo((1.0 + 0.5) / 2, 10);

    // QG 合格率 = 1 / 2
    expect(currentWeek.qualityGatePassRate).toBeCloseTo(0.5, 10);
  });
});

describe("aggregateReview — status='error' の混入", () => {
  it("status='error' 行は件数・reward 平均・シグナル率に現れない(呼び出し側の取りこぼしに対する防御)", () => {
    const rows: ReviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeRow({
        type: "task",
        occurred_at: IN_CURRENT_WEEK,
        status: "error",
        reward_score: 999,
        signals: signals({ completed: true, artifacts_exist: true, excessive_edits: true, retry_detected: true }),
      }),
    ];

    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;

    // error 行を数えれば counts.task = 2 になるはずだが、混入させても 1 のまま。
    expect(currentWeek.counts.task).toBe(1);
    expect(currentWeek.rewardAvg).toBeCloseTo(0.5, 10);
    expect(currentWeek.signalRates.completed).toBeNull(); // ok 側の signals は無し → 分母 0
  });
});

describe("aggregateReview — null 分母除外", () => {
  it("reward_score が null の行は平均を歪めない(0 として扱われない)", () => {
    const rows: ReviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: null }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: null }),
    ];

    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;

    expect(currentWeek.counts.task).toBe(3);
    expect(currentWeek.rewardAvg).toBeCloseTo(0.5, 10); // null 2件を分母に含めれば 0.1666… になってしまう
  });

  it("signals が null の行は達成率の分母に入らない(全行 null なら null を返す)", () => {
    const rows: ReviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, signals: null }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, signals: null }),
    ];

    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;

    expect(currentWeek.signalRates.completed).toBeNull();
    expect(currentWeek.signalRates.artifacts_exist).toBeNull();
    expect(currentWeek.signalRates.excessive_edits).toBeNull();
    expect(currentWeek.signalRates.retry_detected).toBeNull();
  });

  it("judge 3軸・QG 合格率も分母 0 なら null を返す(空バケット)", () => {
    const result = aggregateReview([], "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;

    expect(currentWeek.rewardAvg).toBeNull();
    expect(currentWeek.judgeAvg.completeness).toBeNull();
    expect(currentWeek.judgeAvg.accuracy).toBeNull();
    expect(currentWeek.judgeAvg.clarity).toBeNull();
    expect(currentWeek.qualityGatePassRate).toBeNull();
  });
});

describe("aggregateReview — 週バケットの境界(月曜起点)", () => {
  it("直近8週・古→新順の8バケットを作る", () => {
    const result = aggregateReview([], "week", NOW);
    expect(result.buckets).toHaveLength(8);
    expect(result.buckets[0]!.start.toISOString()).toBe("2026-05-25T00:00:00.000Z");
    expect(result.buckets[7]!.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(result.buckets[7]!.end.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("月曜 00:00Z 未満(前週の日曜 23:59:59.999Z)は前週バケットに入る", () => {
    const sundayLastMoment = new Date(Date.UTC(2026, 6, 12, 23, 59, 59, 999));
    const rows: ReviewRow[] = [makeRow({ type: "task", occurred_at: sundayLastMoment })];

    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;
    const previousWeek = result.buckets[result.buckets.length - 2]!;

    expect(currentWeek.counts.task).toBe(0);
    expect(previousWeek.counts.task).toBe(1);
  });

  it("月曜 00:00:00.000Z ちょうどは今週バケットに入る(境界は start 含む)", () => {
    const mondayMidnight = new Date(Date.UTC(2026, 6, 13, 0, 0, 0, 0));
    const rows: ReviewRow[] = [makeRow({ type: "task", occurred_at: mondayMidnight })];

    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;
    const previousWeek = result.buckets[result.buckets.length - 2]!;

    expect(currentWeek.counts.task).toBe(1);
    expect(previousWeek.counts.task).toBe(0);
  });
});

describe("aggregateReview — 月バケットの境界(暦月)", () => {
  it("直近6ヶ月・古→新順の6バケットを作る", () => {
    const result = aggregateReview([], "month", NOW);
    expect(result.buckets).toHaveLength(6);
    expect(result.buckets[0]!.start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(result.buckets[5]!.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(result.buckets[5]!.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("前月末日の最後の瞬間は前月バケットに入る", () => {
    const juneLastMoment = new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999));
    const rows: ReviewRow[] = [makeRow({ type: "daily_log", occurred_at: juneLastMoment })];

    const result = aggregateReview(rows, "month", NOW);
    const currentMonth = result.buckets[result.buckets.length - 1]!;
    const previousMonth = result.buckets[result.buckets.length - 2]!;

    expect(currentMonth.counts.daily_log).toBe(0);
    expect(previousMonth.counts.daily_log).toBe(1);
  });

  it("月初 00:00:00.000Z ちょうどは今月バケットに入る", () => {
    const julyFirstMidnight = new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0));
    const rows: ReviewRow[] = [makeRow({ type: "daily_log", occurred_at: julyFirstMidnight })];

    const result = aggregateReview(rows, "month", NOW);
    const currentMonth = result.buckets[result.buckets.length - 1]!;
    const previousMonth = result.buckets[result.buckets.length - 2]!;

    expect(currentMonth.counts.daily_log).toBe(1);
    expect(previousMonth.counts.daily_log).toBe(0);
  });
});

describe("aggregateReview — entries", () => {
  it("type ∈ (decision, daily_log) のみを occurred_at 降順で返す", () => {
    const older = new Date(Date.UTC(2026, 6, 1, 8, 0, 0));
    const middle = new Date(Date.UTC(2026, 6, 10, 8, 0, 0));
    const newest = new Date(Date.UTC(2026, 6, 14, 8, 0, 0));

    const rows: ReviewRow[] = [
      makeRow({ type: "decision", occurred_at: middle, title: "middle decision" }),
      makeRow({ type: "daily_log", occurred_at: newest, title: "newest log" }),
      makeRow({ type: "decision", occurred_at: older, title: "older decision" }),
      // 対象外 type(entries に含まれてはならない)
      makeRow({ type: "task", occurred_at: newest, title: "task should be excluded" }),
      makeRow({ type: "quality", occurred_at: newest, title: "quality should be excluded" }),
      makeRow({ type: "score", occurred_at: newest, title: "score should be excluded" }),
    ];

    const result = aggregateReview(rows, "week", NOW);

    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.title)).toEqual([
      "newest log",
      "middle decision",
      "older decision",
    ]);
    expect(result.entries.every((e) => e.type === "decision" || e.type === "daily_log")).toBe(
      true
    );
  });
});
