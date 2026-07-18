// 対象設計: docs/design/detail/org-docs-ingestion.md §2.6(集計層の追随)/ §3(tests/knowledge-aggregation.test.ts)
//
// aggregateOverview() / aggregateReview() は純関数(DB/ネットワーク非依存)なので
// fixture 行(インライン生成)のみで検証する。実 DB・実ネットワークは使わない。
import { describe, expect, it } from "vitest";
import { aggregateOverview, type OverviewRow } from "../lib/data/overview";
import { aggregateReview, type ReviewRow } from "../lib/data/review";
import type { RecordType } from "../lib/ingestion/parsers/types";

const NOW = new Date(Date.UTC(2026, 6, 15, 10, 0, 0));
const IN_CURRENT_WEEK = new Date(Date.UTC(2026, 6, 14, 9, 0, 0));

function makeOverviewRow(
  overrides: Partial<OverviewRow> & { type: RecordType; occurred_at: Date }
): OverviewRow {
  return {
    status: "ok",
    title: null,
    source: "cc-sier-organization",
    file_path: "docs/daily-digest/2026-07-14.md",
    org: "demo-org",
    reward_score: null,
    quality_gate_result: null,
    ...overrides,
  };
}

function makeReviewRow(
  overrides: Partial<ReviewRow> & { type: RecordType; occurred_at: Date }
): ReviewRow {
  return {
    status: "ok",
    title: null,
    source: "cc-sier-organization",
    file_path: "docs/daily-digest/2026-07-14.md",
    org: "demo-org",
    reward_score: null,
    signals: null,
    completeness: null,
    accuracy: null,
    clarity: null,
    quality_gate_result: null,
    ...overrides,
  };
}

describe("集計層 — knowledge 混入で NaN が出ない", () => {
  it("aggregateReview: knowledge 行を含めても reward/QG の数値指標に NaN が出ない", () => {
    const rows: ReviewRow[] = [
      makeReviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK }),
      makeReviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK }),
      makeReviewRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.5 }),
      makeReviewRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "pass" }),
    ];
    const result = aggregateReview(rows, "week", NOW);
    const currentWeek = result.buckets[result.buckets.length - 1]!;

    expect(currentWeek.counts.knowledge).toBe(2);
    expect(currentWeek.rewardAvg).not.toBeNaN();
    expect(currentWeek.qualityGatePassRate).not.toBeNaN();
    expect(currentWeek.rewardAvg).toBeCloseTo(0.5, 10);
    expect(currentWeek.qualityGatePassRate).toBeCloseTo(1, 10);
  });

  it("aggregateOverview: knowledge 行を含めても KPI に NaN が出ない", () => {
    const rows: OverviewRow[] = [
      makeOverviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.8 }),
    ];
    const { kpis } = aggregateOverview(rows, NOW);
    expect(kpis.rewardWeekAvg).not.toBeNaN();
    expect(kpis.recordsThisWeek).toBe(2);
  });
});

describe("集計層 — overview recordsByType の8 type 全列挙順", () => {
  it("knowledge を含む乱順入力でも task/quality/score/session/decision/daily_log/knowledge の順で並ぶ", () => {
    const rows: OverviewRow[] = [
      makeOverviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "daily_log", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "decision", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "session", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "score", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "quality", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "task", occurred_at: IN_CURRENT_WEEK }),
    ];
    const { kpis } = aggregateOverview(rows, NOW);
    expect(kpis.recordsByType).toEqual([
      { type: "task", count: 1 },
      { type: "quality", count: 1 },
      { type: "score", count: 1 },
      { type: "session", count: 1 },
      { type: "decision", count: 1 },
      { type: "daily_log", count: 1 },
      { type: "knowledge", count: 1 },
    ]);
  });

  it("knowledge が0件のときは内訳に現れない(count>0 のみ)", () => {
    const rows: OverviewRow[] = [makeOverviewRow({ type: "task", occurred_at: IN_CURRENT_WEEK })];
    const { kpis } = aggregateOverview(rows, NOW);
    expect(kpis.recordsByType).toEqual([{ type: "task", count: 1 }]);
    expect(kpis.recordsByType.some((r) => r.type === "knowledge")).toBe(false);
  });
});

describe("集計層 — 週次トレンド(reward/QG)は knowledge 混入前後で同値", () => {
  it("knowledge 行(reward_score/quality_gate_result 非対象)を追加しても reward 平均・QG 合格率は変わらない", () => {
    const baseRows: OverviewRow[] = [
      makeOverviewRow({ type: "task", occurred_at: IN_CURRENT_WEEK, reward_score: 0.4 }),
      makeOverviewRow({ type: "quality", occurred_at: IN_CURRENT_WEEK, quality_gate_result: "pass" }),
    ];
    const withKnowledge: OverviewRow[] = [
      ...baseRows,
      makeOverviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK }),
      makeOverviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK }),
    ];

    const before = aggregateOverview(baseRows, NOW);
    const after = aggregateOverview(withKnowledge, NOW);

    expect(after.kpis.rewardWeekAvg).toBeCloseTo(before.kpis.rewardWeekAvg!, 10);
    expect(after.kpis.qgPassRate).toBeCloseTo(before.kpis.qgPassRate!, 10);
    expect(after.weeklyTrend).toEqual(before.weeklyTrend);
    // recordsThisWeek はチャンク計上で増える(単位変化は許容・宣言済み — §1-4)。
    expect(after.kpis.recordsThisWeek).toBe(before.kpis.recordsThisWeek + 2);
  });
});

describe("集計層 — review entries に knowledge は流入しない(構造的保証)", () => {
  it("type=knowledge の行は entries(decision/daily_log 限定)に現れない", () => {
    const rows: ReviewRow[] = [
      makeReviewRow({ type: "knowledge", occurred_at: IN_CURRENT_WEEK, title: "knowledge should be excluded" }),
      makeReviewRow({ type: "decision", occurred_at: IN_CURRENT_WEEK, title: "decision entry" }),
    ];
    const result = aggregateReview(rows, "week", NOW);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.title).toBe("decision entry");
  });
});
