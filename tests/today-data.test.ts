// 対象設計: docs/design/detail/today-view.md §2.4(getTodayData)/ §3(tests/today-data.test.ts)
//
// lib/db をまるごとモックし、in-memory 行(board_items・timeline_records 相当)で
// getTodayData を実 DB・実ネットワークなしで検証する(tests/knowledge-data.test.ts と同型)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeBoardRow = {
  source: string;
  file_path: string;
  item_key: string;
  commit: string;
  synced_at: Date;
  title: string;
  assignee: string | null;
  period: string | null;
  deliverable: string | null;
  pri: string | null;
  org: string | null;
  section: string | null;
  state: "todo" | "doing" | "done";
};

type FakeTimelineRow = {
  type: string;
  reward_score: number | null;
  signals: { retry_detected: boolean } | null;
  occurred_at: Date;
  status: "ok" | "error";
};

const mocks = vi.hoisted(() => ({
  boardRows: [] as FakeBoardRow[],
  timelineRows: [] as FakeTimelineRow[],
  calls: [] as { text: string; params: unknown[] }[],
}));

/** 実 SQL の array_agg(commit ORDER BY synced_at DESC, commit DESC) 相当の JS 側エミュレーション。 */
function applyGenerationFilter(rows: FakeBoardRow[]): FakeBoardRow[] {
  const groups = new Map<string, FakeBoardRow[]>();
  for (const row of rows) {
    const key = `${row.source}|${row.file_path}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: FakeBoardRow[] = [];
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => {
      const bySyncedAt = b.synced_at.getTime() - a.synced_at.getTime();
      if (bySyncedAt !== 0) return bySyncedAt;
      return b.commit < a.commit ? -1 : b.commit > a.commit ? 1 : 0; // commit DESC タイブレーク
    });
    const genCommit = sorted[0]!.commit;
    out.push(...list.filter((r) => r.commit === genCommit));
  }
  return out;
}

vi.mock("../lib/db", () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    mocks.calls.push({ text, params });

    if (text.includes("FROM board_items")) {
      const filtered = applyGenerationFilter(mocks.boardRows);
      return {
        rows: filtered.map((r) => ({
          item_key: r.item_key,
          title: r.title,
          assignee: r.assignee,
          period: r.period,
          deliverable: r.deliverable,
          pri: r.pri,
          org: r.org,
          section: r.section,
          state: r.state,
        })),
      };
    }

    if (text.includes("FROM timeline_records")) {
      const [start, end] = params as [Date, Date];
      const rows = mocks.timelineRows.filter(
        (r) => r.status === "ok" && r.occurred_at >= start && r.occurred_at < end
      );
      return {
        rows: rows.map((r) => ({ type: r.type, reward_score: r.reward_score, signals: r.signals })),
      };
    }

    throw new Error(`unexpected query in test mock: ${text}`);
  }),
}));

const { getTodayData } = await import("../lib/data/today");

function makeBoardRow(
  overrides: Partial<FakeBoardRow> & { item_key: string; state: FakeBoardRow["state"] }
): FakeBoardRow {
  return {
    source: "cc-sier-organization",
    file_path: ".companies/demo-org/docs/secretary/demo-wbs.md",
    commit: "sha1",
    synced_at: new Date("2026-07-01T00:00:00Z"),
    title: `title-${overrides.item_key}`,
    assignee: null,
    period: null,
    deliverable: null,
    pri: null,
    org: null,
    section: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.boardRows = [];
  mocks.timelineRows = [];
  mocks.calls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getTodayData — 世代フィルタ(旧 commit 行の非表示・タイブレーク)", () => {
  it("同一 file_path の旧 commit 行は結果に現れない", async () => {
    mocks.boardRows = [
      makeBoardRow({
        item_key: "W-OLD",
        state: "todo",
        commit: "sha-old",
        synced_at: new Date("2026-07-01T00:00:00Z"),
      }),
      makeBoardRow({
        item_key: "W-NEW",
        state: "todo",
        commit: "sha-new",
        synced_at: new Date("2026-07-02T00:00:00Z"),
      }),
    ];

    const data = await getTodayData();
    const todoKeys = data.columns.find((c) => c.state === "todo")!.items.map((i) => i.itemKey);
    expect(todoKeys).toEqual(["W-NEW"]);
    expect(todoKeys).not.toContain("W-OLD");
  });

  it("synced_at 同値のときは commit の辞書順(降順)でタイブレークする", async () => {
    const sameSyncedAt = new Date("2026-07-01T00:00:00Z");
    mocks.boardRows = [
      makeBoardRow({ item_key: "W-A", state: "todo", commit: "sha-a", synced_at: sameSyncedAt }),
      makeBoardRow({ item_key: "W-B", state: "todo", commit: "sha-b", synced_at: sameSyncedAt }),
    ];
    const data = await getTodayData();
    const todoKeys = data.columns.find((c) => c.state === "todo")!.items.map((i) => i.itemKey);
    // commit 降順("sha-b" > "sha-a")なので sha-b 世代の行(W-B)のみ残る
    expect(todoKeys).toEqual(["W-B"]);
  });
});

describe("getTodayData — 列並び(todo/doing 昇順・done 降順8件)", () => {
  it("todo は item_key 文字列昇順に並ぶ", async () => {
    mocks.boardRows = [
      makeBoardRow({ item_key: "W-3", state: "todo" }),
      makeBoardRow({ item_key: "W-1", state: "todo" }),
      makeBoardRow({ item_key: "W-2", state: "todo" }),
    ];
    const data = await getTodayData();
    const todoKeys = data.columns.find((c) => c.state === "todo")!.items.map((i) => i.itemKey);
    expect(todoKeys).toEqual(["W-1", "W-2", "W-3"]);
  });

  it("doing も item_key 文字列昇順に並ぶ", async () => {
    mocks.boardRows = [
      makeBoardRow({ item_key: "W-20", state: "doing" }),
      makeBoardRow({ item_key: "W-10", state: "doing" }),
    ];
    const data = await getTodayData();
    const doingKeys = data.columns.find((c) => c.state === "doing")!.items.map((i) => i.itemKey);
    // 文字列比較のため "W-10" < "W-20"(数値順ではなく文字列順)
    expect(doingKeys).toEqual(["W-10", "W-20"]);
  });

  it("done は item_key 文字列降順・直近8件に切り詰められる", async () => {
    mocks.boardRows = Array.from({ length: 10 }, (_, i) =>
      makeBoardRow({ item_key: `W-${String(i).padStart(2, "0")}`, state: "done" })
    );
    const data = await getTodayData();
    const doneKeys = data.columns.find((c) => c.state === "done")!.items.map((i) => i.itemKey);
    expect(doneKeys).toHaveLength(8);
    expect(doneKeys[0]).toBe("W-09");
    expect(doneKeys[7]).toBe("W-02");
  });
});

describe("getTodayData — summary(open/doing 件数・rewardAvg・retryRate)", () => {
  it("open/doing は世代フィルタ後の件数と一致する", async () => {
    mocks.boardRows = [
      makeBoardRow({ item_key: "W-1", state: "todo" }),
      makeBoardRow({ item_key: "W-2", state: "todo" }),
      makeBoardRow({ item_key: "W-3", state: "doing" }),
    ];
    const data = await getTodayData();
    expect(data.summary.open).toBe(2);
    expect(data.summary.doing).toBe(1);
  });

  it("rewardAvg は task/score の reward_score 平均(今週の occurred_at のみ)", async () => {
    const now = new Date();
    mocks.timelineRows = [
      { type: "task", reward_score: 0.4, signals: null, occurred_at: now, status: "ok" },
      { type: "score", reward_score: 0.8, signals: null, occurred_at: now, status: "ok" },
      { type: "quality", reward_score: null, signals: null, occurred_at: now, status: "ok" },
      // 今週対象外(古い日付) — 混入しても平均に影響しない
      {
        type: "task",
        reward_score: 999,
        signals: null,
        occurred_at: new Date("2020-01-01T00:00:00Z"),
        status: "ok",
      },
    ];
    const data = await getTodayData();
    expect(data.summary.rewardAvg).toBeCloseTo(0.6, 10);
  });

  it("retryRate は signals 非 null 行のうち retry_detected true の率・分母0は null", async () => {
    const now = new Date();
    mocks.timelineRows = [
      { type: "task", reward_score: null, signals: { retry_detected: true }, occurred_at: now, status: "ok" },
      { type: "task", reward_score: null, signals: { retry_detected: false }, occurred_at: now, status: "ok" },
      { type: "task", reward_score: null, signals: null, occurred_at: now, status: "ok" },
    ];
    const data = await getTodayData();
    expect(data.summary.retryRate).toBeCloseTo(0.5, 10);
  });

  it("signals 行が無い週は retryRate・rewardAvg が null になる", async () => {
    mocks.timelineRows = [];
    const data = await getTodayData();
    expect(data.summary.retryRate).toBeNull();
    expect(data.summary.rewardAvg).toBeNull();
  });
});

describe("getTodayData — boardEmpty", () => {
  it("board_items が0行なら boardEmpty=true・全列空・open/doing=0", async () => {
    mocks.boardRows = [];
    const data = await getTodayData();
    expect(data.boardEmpty).toBe(true);
    expect(data.summary.open).toBe(0);
    expect(data.summary.doing).toBe(0);
    expect(data.columns.every((c) => c.items.length === 0)).toBe(true);
  });

  it("board_items が1行以上あれば boardEmpty=false", async () => {
    mocks.boardRows = [makeBoardRow({ item_key: "W-1", state: "todo" })];
    const data = await getTodayData();
    expect(data.boardEmpty).toBe(false);
  });
});

describe("getTodayData — weekBucketBoundaries の再利用・SQL 固定表記", () => {
  it("query() 呼び出しの SQL に §2.4 の固定表記断片が含まれる", async () => {
    mocks.boardRows = [];
    await getTodayData();
    const call = mocks.calls.find((c) => c.text.includes("FROM board_items"))!;
    expect(call.text).toContain("array_agg(commit ORDER BY synced_at DESC, commit DESC)");
  });
});

describe("laneOfCaptureStatus — status → レーンの全域写像(today-board-interactive §1-1)", () => {
  it("open→todo / in_progress→doing / done→done(CaptureStatus 3値の網羅)", async () => {
    const { laneOfCaptureStatus } = await import("../lib/data/today");
    const statuses = ["open", "in_progress", "done"] as const;
    const lanes = statuses.map((s) => laneOfCaptureStatus(s));
    expect(lanes).toEqual(["todo", "doing", "done"]);
  });
});
