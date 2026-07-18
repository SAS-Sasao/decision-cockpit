// 対象設計: docs/design/detail/ui-shell.md §0-2(NOW 固定・weekBucketBoundaries 直接 assert)/ §2.3(aggregateOverview 等)
//          docs/design/basic/ui-shell.md §3.1 / §3.4(集計規範)/ §3(tests/overview-data.test.ts)
//
// aggregateOverview() / buildLastSync() は純関数(DB/ネットワーク非依存)なので fixture 行のみで検証する。
// 実 DB・実ネットワークは使わない。期待値の正 = 本ファイル自身(§0-2)— 手計算根拠はコメントで示す。

import { describe, expect, it } from "vitest";
import { aggregateOverview, buildLastSync, REPOS, type OverviewRow } from "../lib/data/overview";
import { weekBucketBoundaries } from "../lib/data/review";
import type { RecordType } from "../lib/ingestion/parsers/types";

// 固定 now(決定的な週バケット判定のため)。2026-07-15 は UTC 水曜日。
// 今週バケット(weeks=6/8 共通の末尾) = [2026-07-13T00:00Z, 2026-07-20T00:00Z)。
// 前週バケット = [2026-07-06T00:00Z, 2026-07-13T00:00Z)。
const NOW = new Date(Date.UTC(2026, 6, 15, 10, 0, 0));

// 今週バケット内の日時。
const IN_CURRENT_WEEK = new Date(Date.UTC(2026, 6, 14, 9, 0, 0));
// 前週バケット内の日時。
const IN_PREVIOUS_WEEK = new Date(Date.UTC(2026, 6, 8, 9, 0, 0));

function makeRow(overrides: Partial<OverviewRow> & { type: RecordType; occurred_at: Date }): OverviewRow {
  return {
    status: "ok",
    title: null,
    source: "ai-war-room",
    file_path: "docs/decisions/2026-07-14-example.md",
    org: null,
    reward_score: null,
    quality_gate_result: null,
    ...overrides,
  };
}

describe("weekBucketBoundaries — 公開 IF の契約(weeks パラメータ化)", () => {
  it("weeks=6: 6バケット・古→新・末尾=今週の部分週", () => {
    const boundaries = weekBucketBoundaries(NOW, 6);
    expect(boundaries).toHaveLength(6);
    // 末尾(今週) = [2026-07-13, 2026-07-20)
    expect(boundaries[5]!.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(boundaries[5]!.end.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    // 先頭(直近6週前) = 2026-07-13 から 5*7=35日前 = 2026-06-08
    expect(boundaries[0]!.start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("weeks=8: review.ts の既存利用と同一の境界を返す(退行網 — review-data テストと同値)", () => {
    const boundaries = weekBucketBoundaries(NOW, 8);
    expect(boundaries).toHaveLength(8);
    expect(boundaries[7]!.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(boundaries[7]!.end.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(boundaries[0]!.start.toISOString()).toBe("2026-05-25T00:00:00.000Z");
  });
});

describe("aggregateOverview — KPI 手計算一致", () => {
  it("reward 平均(type ∈ task, score)・QG 合格率(type=quality)・記録件数・内訳が手計算値と一致する", () => {
    const rows: OverviewRow[] = [
      // 今週: reward 平均の分子 → task 0.5 + task 0.9 (score は reward_score null で除外)
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.9 }),
      makeRow({ type: "score", occurred_at: IN_CURRENT_WEEK, reward_score: null }),
      // 今週: QG 合格率 → quality 3件中 pass 2件
      makeRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "pass" }),
      makeRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "fail" }),
      makeRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "pass" }),
      // 今週: 件数のみ寄与する type
      makeRow({ type: "session", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "decision", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "daily_log", occurred_at: IN_CURRENT_WEEK }),
      // 今週: error 行(件数・平均のどちらにも現れてはならない — 別 describe でも単独検証)
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, status: "error", reward_score: 999 }),

      // 前週: reward 平均 → task 0.6 + score 0.8
      makeRow({ type: "task", occurred_at: IN_PREVIOUS_WEEK, reward_score: 0.6 }),
      makeRow({ type: "score", occurred_at: IN_PREVIOUS_WEEK, reward_score: 0.8 }),
      // 前週: QG 合格率 → quality 2件中 pass 2件
      makeRow({ type: "quality", occurred_at: IN_PREVIOUS_WEEK, quality_gate_result: "pass" }),
      makeRow({ type: "quality", occurred_at: IN_PREVIOUS_WEEK, quality_gate_result: "pass" }),
    ];

    const { kpis } = aggregateOverview(rows, NOW);

    // 今週 reward 平均 = (0.5 + 0.9) / 2 = 0.7
    expect(kpis.rewardWeekAvg).toBeCloseTo(0.7, 10);
    // 今週 QG 合格率 = 2 / 3
    expect(kpis.qgPassRate).toBeCloseTo(2 / 3, 10);
    // 今週 記録件数 = task2 + score1 + quality3 + session1 + decision1 + daily_log1 = 9(error 行は含まない)
    expect(kpis.recordsThisWeek).toBe(9);
    // 記録内訳: count>0 のみ・8 type 全列挙順(conversation・knowledge は今週 0 件のため現れない)
    expect(kpis.recordsByType).toEqual([
      { type: "task", count: 2 },
      { type: "quality", count: 3 },
      { type: "score", count: 1 },
      { type: "session", count: 1 },
      { type: "decision", count: 1 },
      { type: "daily_log", count: 1 },
    ]);

    // 前週 reward 平均 = (0.6 + 0.8) / 2 = 0.7 → delta = 0.7 - 0.7 = 0
    expect(kpis.rewardPrevDelta).toBeCloseTo(0, 10);
    // 前週 QG 合格率 = 2 / 2 = 1.0 → delta = 2/3 - 1.0
    expect(kpis.qgPrevDelta).toBeCloseTo(2 / 3 - 1, 10);
  });
});

describe("aggregateOverview — delta の null 伝播(片側 null → null)", () => {
  it("前週の reward 平均が null(対象行なし)なら rewardPrevDelta は null(今週は有効値でも)", () => {
    const rows: OverviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "pass" }),
      // 前週: quality はあるが task/score(reward 対象)が無い → 前週 reward 平均は null
      makeRow({ type: "quality", occurred_at: IN_PREVIOUS_WEEK, quality_gate_result: "fail" }),
    ];

    const { kpis } = aggregateOverview(rows, NOW);

    expect(kpis.rewardWeekAvg).toBeCloseTo(0.5, 10);
    expect(kpis.rewardPrevDelta).toBeNull();
    // qg 側は両週とも値がある(独立に正常計算されることの確認): 今週 1.0 / 前週 0.0
    expect(kpis.qgPassRate).toBeCloseTo(1.0, 10);
    expect(kpis.qgPrevDelta).toBeCloseTo(1.0, 10);
  });

  it("今週の QG 合格率が null(今週 quality 行なし)なら qgPrevDelta は null(前週は有効値でも)", () => {
    const rows: OverviewRow[] = [
      // 今週: quality 行なし → qgPassRate 今週 = null
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.9 }),
      // 前週: quality あり → qgPassRate 前週 = 1.0(有効値)
      makeRow({ type: "quality", occurred_at: IN_PREVIOUS_WEEK, quality_gate_result: "pass" }),
      makeRow({ type: "task", occurred_at: IN_PREVIOUS_WEEK, reward_score: 0.3 }),
    ];

    const { kpis } = aggregateOverview(rows, NOW);

    expect(kpis.qgPassRate).toBeNull();
    expect(kpis.qgPrevDelta).toBeNull();
    // reward 側は両週とも値がある: 今週 0.9 / 前週 0.3 → delta = 0.6
    expect(kpis.rewardWeekAvg).toBeCloseTo(0.9, 10);
    expect(kpis.rewardPrevDelta).toBeCloseTo(0.6, 10);
  });
});

describe("aggregateOverview — status='error' 混入", () => {
  it("error 行は件数・reward 平均に現れない(呼び出し側の取りこぼしに対する防御)", () => {
    const rows: OverviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeRow({
        type: "task",
        occurred_at: IN_CURRENT_WEEK,
        status: "error",
        reward_score: 999,
      }),
    ];

    const { kpis } = aggregateOverview(rows, NOW);

    // error 行を数えれば recordsThisWeek = 2 になるはずだが、混入させても 1 のまま。
    expect(kpis.recordsThisWeek).toBe(1);
    expect(kpis.rewardWeekAvg).toBeCloseTo(0.5, 10);
    expect(kpis.recordsByType).toEqual([{ type: "task", count: 1 }]);
  });
});

describe("aggregateOverview — null 分母除外", () => {
  it("reward_score が null の行は平均を歪めない(0 として扱われず、分母から除外される)", () => {
    const rows: OverviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: null }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: null }),
    ];

    const { kpis } = aggregateOverview(rows, NOW);

    expect(kpis.recordsThisWeek).toBe(2);
    expect(kpis.rewardWeekAvg).toBeNull(); // null 2件を分母に含めれば 0 になってしまうが、null が正
  });
});

describe("aggregateOverview — recordsByType(count>0 のみ・8 type 全列挙順)", () => {
  it("入力順に関わらず task/quality/score/session/conversation/decision/daily_log/knowledge の順に整列し、0件の型は現れない", () => {
    // 入力はわざと乱順(daily_log を先頭に置く)。conversation・knowledge のみ 0 件のまま。
    const rows: OverviewRow[] = [
      makeRow({ type: "daily_log", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "decision", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "session", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "score", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "quality", occurred_at: IN_CURRENT_WEEK }),
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK }),
    ];

    const { kpis } = aggregateOverview(rows, NOW);

    expect(kpis.recordsByType).toEqual([
      { type: "task", count: 1 },
      { type: "quality", count: 1 },
      { type: "score", count: 1 },
      { type: "session", count: 1 },
      { type: "decision", count: 1 },
      { type: "daily_log", count: 1 },
    ]);
  });
});

describe("aggregateOverview — 週境界の両側(月曜起点 UTC)", () => {
  it("月曜 00:00:00.000Z ちょうどは今週バケット、日曜 23:59:59.999Z は前週バケットに入る", () => {
    const mondayMidnight = new Date(Date.UTC(2026, 6, 13, 0, 0, 0, 0));
    const sundayLastMoment = new Date(Date.UTC(2026, 6, 12, 23, 59, 59, 999));

    const rows: OverviewRow[] = [
      makeRow({ type: "task", occurred_at: mondayMidnight, reward_score: 0.5 }),
      makeRow({ type: "task", occurred_at: sundayLastMoment, reward_score: 0.9 }),
    ];

    const { kpis, weeklyTrend } = aggregateOverview(rows, NOW);

    // 今週の行は月曜行のみ(0.5)・前週の行は日曜最終瞬間のみ(0.9)
    expect(kpis.recordsThisWeek).toBe(1);
    expect(kpis.rewardWeekAvg).toBeCloseTo(0.5, 10);
    expect(kpis.rewardPrevDelta).toBeCloseTo(0.5 - 0.9, 10);
    // トレンドの末尾2バケットでも同じ境界判定になっていること
    expect(weeklyTrend[weeklyTrend.length - 1]!.rewardAvg).toBeCloseTo(0.5, 10);
    expect(weeklyTrend[weeklyTrend.length - 2]!.rewardAvg).toBeCloseTo(0.9, 10);
  });
});

describe("aggregateOverview — 6週トレンド(古→新・末尾=部分週)", () => {
  it("weeklyTrend は6件・古→新順の weekStart を持ち、末尾は今週(進行中の部分週)を指す", () => {
    const { weeklyTrend } = aggregateOverview([], NOW);

    expect(weeklyTrend).toHaveLength(6);
    // weekBucketBoundaries(NOW, 6) の境界と同一(§0-2: バケット生成は1回・共有元は review.ts)
    expect(weeklyTrend[0]!.weekStart).toBe("2026-06-08T00:00:00.000Z");
    expect(weeklyTrend[1]!.weekStart).toBe("2026-06-15T00:00:00.000Z");
    expect(weeklyTrend[2]!.weekStart).toBe("2026-06-22T00:00:00.000Z");
    expect(weeklyTrend[3]!.weekStart).toBe("2026-06-29T00:00:00.000Z");
    expect(weeklyTrend[4]!.weekStart).toBe("2026-07-06T00:00:00.000Z");
    expect(weeklyTrend[5]!.weekStart).toBe("2026-07-13T00:00:00.000Z"); // 末尾 = 今週(部分週)
    // データなしなら全バケット null(分母0除外)
    for (const bucket of weeklyTrend) {
      expect(bucket.rewardAvg).toBeNull();
      expect(bucket.qgPassRate).toBeNull();
    }
  });

  it("末尾2バケットの値は KPI(今週/前週)と一致する(バケット生成は1回・KPI はトレンドから導出)", () => {
    const rows: OverviewRow[] = [
      makeRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.4 }),
      makeRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "pass" }),
      makeRow({ type: "task", occurred_at: IN_PREVIOUS_WEEK, reward_score: 0.2 }),
      makeRow({ type: "quality", occurred_at: IN_PREVIOUS_WEEK, quality_gate_result: "fail" }),
    ];

    const { kpis, weeklyTrend } = aggregateOverview(rows, NOW);

    expect(weeklyTrend[5]!.rewardAvg).toBeCloseTo(kpis.rewardWeekAvg!, 10);
    expect(weeklyTrend[5]!.qgPassRate).toBeCloseTo(kpis.qgPassRate!, 10);
    expect(weeklyTrend[4]!.rewardAvg).toBeCloseTo(0.2, 10);
    expect(weeklyTrend[4]!.qgPassRate).toBeCloseTo(0, 10);
  });
});

describe("buildLastSync — REPOS 突合", () => {
  it("行不在の repo は lastSyncedAt=null になる(REPOS 起点で全件構築)", () => {
    const result = buildLastSync([]);
    expect(result).toEqual([
      { repo: "cc-sier-organization", lastSyncedAt: null },
      { repo: "ai-war-room", lastSyncedAt: null },
    ]);
  });

  it("行在る repo は last_synced_at を ISO 文字列化する", () => {
    const syncedAt = new Date(Date.UTC(2026, 6, 15, 3, 0, 0));
    const result = buildLastSync([{ repo: "ai-war-room", last_synced_at: syncedAt }]);

    expect(result).toEqual([
      { repo: "cc-sier-organization", lastSyncedAt: null },
      { repo: "ai-war-room", lastSyncedAt: "2026-07-15T03:00:00.000Z" },
    ]);
  });

  it("REPOS 外の余剰行は無視される(結果は REPOS の2件のみ)", () => {
    const syncedAt = new Date(Date.UTC(2026, 6, 15, 3, 0, 0));
    const result = buildLastSync([
      { repo: "cc-sier-organization", last_synced_at: syncedAt },
      { repo: "some-unrelated-repo", last_synced_at: syncedAt },
    ]);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { repo: "cc-sier-organization", lastSyncedAt: "2026-07-15T03:00:00.000Z" },
      { repo: "ai-war-room", lastSyncedAt: null },
    ]);
  });
});

// REPOS 定数自体の契約(overview.ts が固定リストを持つこと)。
describe("REPOS 定数", () => {
  it("cc-sier-organization / ai-war-room の2件を持つ", () => {
    expect(REPOS).toEqual(["cc-sier-organization", "ai-war-room"]);
  });
});
