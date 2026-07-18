// 対象設計: docs/design/detail/org-docs-ingestion.md §2.7 rev.5/6(recentRecords — type/tag 反映)・§5(/goal OD-FIX)
//
// lib/db と lib/search/embedding をまるごとモックし、in-memory 行(述語ミラー)で
// getKnowledgeData の recent 経路(q 空)が type/tag を反映することを実 DB・実ネットワークなしで検証する。
// 様式は tests/knowledge-data.test.ts を参考にするが、同ファイルは変更しない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeRecord = {
  id: string;
  source: string;
  file_path: string;
  occurred_at: Date | null;
  type: string;
  org: string | null;
  title: string | null;
  body: string | null;
  tags: string[];
  status: "ok" | "error";
  reward_score: number | null;
};

const mocks = vi.hoisted(() => ({
  rows: [] as FakeRecord[],
  calls: [] as { text: string; params: unknown[] }[],
}));

const embeddingMocks = vi.hoisted(() => ({
  currentModel: "test-model",
  embedFn: vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
}));

vi.mock("../lib/search/embedding", () => ({
  createEmbeddingClient: () => ({ embed: embeddingMocks.embedFn }),
  currentEmbeddingModel: () => embeddingMocks.currentModel,
}));

vi.mock("../lib/db", () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    mocks.calls.push({ text, params });

    // topTags
    if (text.includes("SELECT tags FROM timeline_records")) {
      return { rows: mocks.rows.filter((r) => r.status === "ok").map((r) => ({ tags: r.tags })) };
    }

    // recentRecords
    if (text.includes("ORDER BY occurred_at DESC NULLS LAST, id")) {
      let filtered = mocks.rows.filter((r) => r.status === "ok");

      let idx = 1; // params[0] = limit
      if (text.includes("AND type = $")) {
        const val = params[idx] as string;
        idx += 1;
        filtered = filtered.filter((r) => r.type === val);
      }
      if (text.includes("= ANY(tags)")) {
        const val = params[idx] as string;
        idx += 1;
        filtered = filtered.filter((r) => r.tags.includes(val));
      }

      const limit = params[0] as number;
      filtered = filtered.slice().sort((a, b) => {
        const at = a.occurred_at ? a.occurred_at.getTime() : -Infinity;
        const bt = b.occurred_at ? b.occurred_at.getTime() : -Infinity;
        if (at !== bt) return bt - at;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      return { rows: filtered.slice(0, limit) };
    }

    // decisionOutcome — anchor lookup
    if (text.includes("SELECT id, type, status, occurred_at, org")) {
      const [id] = params as [string];
      const row = mocks.rows.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    // decisionOutcome — reward range
    if (text.includes("SELECT occurred_at, reward_score")) {
      return { rows: [] };
    }

    // fetchSelected(id 指定)
    if (text.includes("tags, status")) {
      const [id] = params as [string];
      const row = mocks.rows.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    throw new Error(`unexpected query in test mock: ${text}`);
  }),
}));

const { getKnowledgeData } = await import("../lib/data/knowledge");

const ORIGINAL_ENV = { ...process.env };

function makeRecord(overrides: Partial<FakeRecord> & { id: string }): FakeRecord {
  return {
    source: "cc-sier-organization",
    file_path: `docs/decisions/${overrides.id}.md`,
    occurred_at: new Date("2026-06-01T00:00:00Z"),
    type: "decision",
    org: "demo-org",
    title: `title-${overrides.id}`,
    body: "本文テキスト",
    tags: [],
    status: "ok",
    reward_score: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mocks.rows = [];
  mocks.calls = [];
  embeddingMocks.currentModel = "test-model";
  embeddingMocks.embedFn = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function recentCall() {
  return mocks.calls.find((c) => c.text.includes("ORDER BY occurred_at DESC NULLS LAST, id"));
}

describe("getKnowledgeData — recent 経路(q 空)の type/tag 反映", () => {
  it("既定(未指定)= decision のみ(後方互換)", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision", occurred_at: new Date("2026-06-05T00:00:00Z") }),
      makeRecord({ id: "k1", type: "knowledge", occurred_at: new Date("2026-06-06T00:00:00Z") }),
    ];

    const data = await getKnowledgeData({ q: "" });

    expect(data.recent.map((h) => h.id)).toEqual(["d1"]);
    expect(data.recent.every((h) => h.type === "decision")).toBe(true);
  });

  it("type=knowledge で knowledge 行が返る", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision" }),
      makeRecord({ id: "k1", type: "knowledge" }),
      makeRecord({ id: "k2", type: "knowledge" }),
    ];

    const data = await getKnowledgeData({ q: "", type: "knowledge" });

    expect(data.recent.map((h) => h.id).sort()).toEqual(["k1", "k2"]);
    expect(data.recent.every((h) => h.type === "knowledge")).toBe(true);
  });

  it("type=all で全 type が返る", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision" }),
      makeRecord({ id: "k1", type: "knowledge" }),
      makeRecord({ id: "t1", type: "task" }),
    ];

    const data = await getKnowledgeData({ q: "", type: "all" });

    expect(data.recent.map((h) => h.id).sort()).toEqual(["d1", "k1", "t1"]);
  });

  it("不正 type(3語彙外)は既定 decision 扱い", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision" }),
      makeRecord({ id: "t1", type: "task" }),
    ];

    const data = await getKnowledgeData({ q: "", type: "task" });

    expect(data.recent.map((h) => h.id)).toEqual(["d1"]);
  });

  it("tag 指定で絞られる", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision", tags: ["reward"] }),
      makeRecord({ id: "d2", type: "decision", tags: ["other"] }),
    ];

    const data = await getKnowledgeData({ q: "", tag: "reward" });

    expect(data.recent.map((h) => h.id)).toEqual(["d1"]);
  });

  it("status='error' 行が出ない", async () => {
    mocks.rows = [
      makeRecord({ id: "ok1", type: "decision", status: "ok" }),
      makeRecord({ id: "err1", type: "decision", status: "error" }),
    ];

    const data = await getKnowledgeData({ q: "" });

    expect(data.recent.map((h) => h.id)).toEqual(["ok1"]);
  });

  it("LIMIT 8(9行入れて8行に切断・occurred_at 降順)", async () => {
    mocks.rows = Array.from({ length: 9 }, (_, i) =>
      makeRecord({
        id: `r${i}`,
        type: "decision",
        occurred_at: new Date(Date.UTC(2026, 5, 1 + i)),
      })
    );

    const data = await getKnowledgeData({ q: "" });

    expect(data.recent).toHaveLength(8);
    // occurred_at 降順(最新9件中、最も新しい8件が返る)
    expect(data.recent[0]!.id).toBe("r8");
    expect(data.recent.map((h) => h.id)).not.toContain("r0");
  });

  it("ORDER BY 全文(NULLS LAST, id)が SQL に含まれる", async () => {
    mocks.rows = [makeRecord({ id: "d1" })];
    await getKnowledgeData({ q: "" });

    const call = recentCall();
    expect(call).toBeDefined();
    expect(call!.text).toContain("ORDER BY occurred_at DESC NULLS LAST, id");
  });

  it("params[0] = limit(8)の束縛形", async () => {
    mocks.rows = [makeRecord({ id: "d1" })];
    await getKnowledgeData({ q: "" });

    const call = recentCall();
    expect(call).toBeDefined();
    expect(call!.params[0]).toBe(8);
  });
});
