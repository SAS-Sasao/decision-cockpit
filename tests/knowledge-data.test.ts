// 対象設計: docs/design/detail/search-foundation.md §2.4 / §3(tests/knowledge-data.test.ts)
//
// lib/db と lib/search/embedding をまるごとモックし、in-memory 行(述語ミラー)で
// searchKnowledge / decisionOutcome / topTags / getKnowledgeData を実 DB・実ネットワークなしで検証する。
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
  embedding_model: string | null;
  raw_similarity: number;
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

function applySearchFilters(rows: FakeRecord[], text: string, params: unknown[]): FakeRecord[] {
  const model = params[1] as string;
  let filtered = rows.filter((r) => r.status === "ok" && r.embedding_model === model);

  let idx = 2;
  if (text.includes("AND type = $")) {
    const val = params[idx] as string;
    idx += 1;
    filtered = filtered.filter((r) => r.type === val);
  }
  if (text.includes("AND org = $")) {
    const val = params[idx] as string;
    idx += 1;
    filtered = filtered.filter((r) => r.org === val);
  }
  if (text.includes("= ANY(tags)")) {
    const val = params[idx] as string;
    idx += 1;
    filtered = filtered.filter((r) => r.tags.includes(val));
  }
  if (text.includes("AND source = $")) {
    const val = params[idx] as string;
    idx += 1;
    filtered = filtered.filter((r) => r.source === val);
  }
  if (text.includes("AND occurred_at >= $")) {
    const val = new Date(params[idx] as string);
    idx += 1;
    filtered = filtered.filter((r) => r.occurred_at !== null && r.occurred_at >= val);
  }
  if (text.includes("AND occurred_at < $")) {
    const val = new Date(params[idx] as string);
    idx += 1;
    filtered = filtered.filter((r) => r.occurred_at !== null && r.occurred_at < val);
  }

  const limit = params[params.length - 1] as number;
  filtered = filtered.slice().sort((a, b) => b.raw_similarity - a.raw_similarity);
  return filtered.slice(0, limit);
}

vi.mock("../lib/db", () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    mocks.calls.push({ text, params });

    // searchKnowledge
    if (text.includes("1 - (embedding <=>")) {
      const targets = applySearchFilters(mocks.rows, text, params);
      return { rows: targets.map((r) => ({ ...r, raw_similarity: r.raw_similarity })) };
    }

    // topTags
    if (text.includes("SELECT tags FROM timeline_records")) {
      return { rows: mocks.rows.filter((r) => r.status === "ok").map((r) => ({ tags: r.tags })) };
    }

    // recentDecisions
    if (text.includes("ORDER BY occurred_at DESC")) {
      const [limit] = params as [number];
      const targets = mocks.rows
        .filter((r) => r.status === "ok" && r.type === "decision")
        .slice()
        .sort((a, b) => (b.occurred_at?.getTime() ?? 0) - (a.occurred_at?.getTime() ?? 0))
        .slice(0, limit);
      return { rows: targets };
    }

    // decisionOutcome — anchor lookup
    if (text.includes("SELECT id, type, status, occurred_at, org")) {
      const [id] = params as [string];
      const row = mocks.rows.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    // decisionOutcome — reward range
    if (text.includes("SELECT occurred_at, reward_score")) {
      const [start, end, org] = params as [Date, Date, string | undefined];
      let targets = mocks.rows.filter(
        (r) =>
          r.status === "ok" &&
          r.reward_score !== null &&
          r.occurred_at !== null &&
          r.occurred_at >= start &&
          r.occurred_at < end
      );
      if (org !== undefined) targets = targets.filter((r) => r.org === org);
      return { rows: targets.map((r) => ({ occurred_at: r.occurred_at, reward_score: r.reward_score })) };
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

const {
  searchKnowledge,
  outcomeWindows,
  decisionOutcome,
  topTags,
  getKnowledgeData,
} = await import("../lib/data/knowledge");

const ORIGINAL_ENV = { ...process.env };

function makeRecord(overrides: Partial<FakeRecord> & { id: string }): FakeRecord {
  return {
    source: "ai-war-room",
    file_path: `docs/decisions/${overrides.id}.md`,
    occurred_at: new Date("2026-06-01T00:00:00Z"),
    type: "decision",
    org: null,
    title: `title-${overrides.id}`,
    body: "本文テキスト",
    tags: [],
    status: "ok",
    embedding_model: "test-model",
    raw_similarity: 0.5,
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

describe("searchKnowledge — 近傍検索 + クランプ + 出典", () => {
  it("similarity は非厳密降順で並び、全て [0,1] にクランプされる(raw -0.3 / 1.2 相当を含む)", async () => {
    mocks.rows = [
      makeRecord({ id: "a", raw_similarity: 0.9 }),
      makeRecord({ id: "b", raw_similarity: -0.3 }),
      makeRecord({ id: "c", raw_similarity: 1.2 }),
      makeRecord({ id: "d", raw_similarity: 0.5 }),
    ];

    const hits = await searchKnowledge({ q: "検索語" });

    for (const hit of hits) {
      expect(hit.similarity).not.toBeNull();
      expect(hit.similarity!).toBeGreaterThanOrEqual(0);
      expect(hit.similarity!).toBeLessThanOrEqual(1);
    }
    // 非厳密降順(同値クランプ 0 が並んでも壊れない)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.similarity!).toBeGreaterThanOrEqual(hits[i]!.similarity!);
    }
    // raw 1.2 → 1 に、raw -0.3 → 0 にクランプされる
    expect(hits.find((h) => h.id === "c")!.similarity).toBe(1);
    expect(hits.find((h) => h.id === "b")!.similarity).toBe(0);
  });

  it("各 hit に source/filePath/occurredAt/similarity を含む", async () => {
    mocks.rows = [makeRecord({ id: "a", raw_similarity: 0.8, org: "org-x" })];
    const hits = await searchKnowledge({ q: "q" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: "a",
      source: "ai-war-room",
      filePath: "docs/decisions/a.md",
      occurredAt: "2026-06-01T00:00:00.000Z",
    });
    expect(typeof hits[0]!.similarity).toBe("number");
  });

  it("$1 はベクトル文字列形・$2 は有効識別子", async () => {
    embeddingMocks.currentModel = "fixture:test-model";
    embeddingMocks.embedFn = vi.fn(async () => [[0.1, -0.2, 3e-7]]);
    mocks.rows = [makeRecord({ id: "a", embedding_model: "fixture:test-model" })];

    await searchKnowledge({ q: "q" });

    const call = mocks.calls.find((c) => c.text.includes("1 - (embedding <=>"))!;
    expect(call.params[0]).toMatch(/^\[[-0-9.,eE]+\]$/);
    expect(call.params[1]).toBe("fixture:test-model");
  });

  it("モデル切替シミュレーション: 混在識別子データ → 現行識別子の行のみ返る", async () => {
    mocks.rows = [
      makeRecord({ id: "current", embedding_model: "test-model" }),
      makeRecord({ id: "old", embedding_model: "old-model" }),
      makeRecord({ id: "fixture-ver", embedding_model: "fixture:test-model" }),
    ];

    const hits = await searchKnowledge({ q: "q" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe("current");
  });

  it("type は既定 decision(絞り込み)・all で解除される", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision" }),
      makeRecord({ id: "t1", type: "task" }),
    ];

    const defaultHits = await searchKnowledge({ q: "q" });
    expect(defaultHits.map((h) => h.id)).toEqual(["d1"]);

    const allHits = await searchKnowledge({ q: "q", type: "all" });
    expect(allHits.map((h) => h.id).sort()).toEqual(["d1", "t1"]);
  });

  it("org / tag / source / date 範囲フィルタで件数が絞れる(意味論)+ params にフィルタ値が含まれる", async () => {
    mocks.rows = [
      makeRecord({ id: "match", org: "org-a", tags: ["x"], source: "ai-war-room", occurred_at: new Date("2026-06-10T00:00:00Z") }),
      makeRecord({ id: "other-org", org: "org-b", tags: ["x"], source: "ai-war-room", occurred_at: new Date("2026-06-10T00:00:00Z") }),
      makeRecord({ id: "other-tag", org: "org-a", tags: ["y"], source: "ai-war-room", occurred_at: new Date("2026-06-10T00:00:00Z") }),
      makeRecord({ id: "other-source", org: "org-a", tags: ["x"], source: "cc-sier-organization", occurred_at: new Date("2026-06-10T00:00:00Z") }),
      makeRecord({ id: "out-of-range", org: "org-a", tags: ["x"], source: "ai-war-room", occurred_at: new Date("2020-01-01T00:00:00Z") }),
    ];

    const unfiltered = await searchKnowledge({ q: "q", type: "all" });
    expect(unfiltered).toHaveLength(5);

    const orgFiltered = await searchKnowledge({ q: "q", type: "all", org: "org-a" });
    expect(orgFiltered.length).toBeLessThan(unfiltered.length);
    expect(orgFiltered.every((h) => h.org === "org-a")).toBe(true);

    const tagFiltered = await searchKnowledge({ q: "q", type: "all", tag: "x" });
    expect(tagFiltered.length).toBeLessThan(unfiltered.length);

    const sourceFiltered = await searchKnowledge({ q: "q", type: "all", source: "ai-war-room" });
    expect(sourceFiltered.length).toBeLessThan(unfiltered.length);

    const dateFiltered = await searchKnowledge({
      q: "q",
      type: "all",
      from: "2026-01-01T00:00:00Z",
      to: "2026-12-31T00:00:00Z",
    });
    expect(dateFiltered.length).toBeLessThan(unfiltered.length);

    const call = mocks.calls.filter((c) => c.text.includes("1 - (embedding <=>")).at(-1)!;
    expect(call.params).toContain("2026-01-01T00:00:00Z");
  });

  it("limit クランプ(既定 8・上限 20)", async () => {
    mocks.rows = Array.from({ length: 30 }, (_, i) => makeRecord({ id: `r${i}`, type: "task" }));

    const defaultLimit = await searchKnowledge({ q: "q", type: "all" });
    expect(defaultLimit).toHaveLength(8);

    const clamped = await searchKnowledge({ q: "q", type: "all", limit: 999 });
    expect(clamped).toHaveLength(20);
  });

  it("query() 第1引数に §4-4 の SQL ピン断片が含まれる", async () => {
    mocks.rows = [makeRecord({ id: "a" })];
    await searchKnowledge({ q: "q" });
    const call = mocks.calls.find((c) => c.text.includes("1 - (embedding <=>"))!;
    expect(call.text).toContain("WHERE status = 'ok' AND embedding IS NOT NULL AND embedding_model = $2");
    expect(call.text).toContain("ORDER BY embedding <=> $1::vector ASC");
    expect(call.text).toContain("1 - (embedding <=> $1::vector)");
  });
});

describe("outcomeWindows — 境界(anchor ちょうど・+42日直前/直後)", () => {
  it("6窓・各7日・anchor ちょうどが第1窓の開始", () => {
    const anchor = new Date("2026-06-01T00:00:00Z");
    const windows = outcomeWindows(anchor, 6);

    expect(windows).toHaveLength(6);
    expect(windows[0]!.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(windows[0]!.end.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    // 最終窓の終端 = anchor + 42日
    expect(windows[5]!.end.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("+42日直前は最終窓に含まれ、直後は含まれない", () => {
    const anchor = new Date("2026-06-01T00:00:00Z");
    const windows = outcomeWindows(anchor, 6);
    const last = windows[5]!;

    const justBefore = new Date(last.end.getTime() - 1);
    const justAfter = new Date(last.end.getTime());

    expect(justBefore >= last.start && justBefore < last.end).toBe(true);
    expect(justAfter < last.end).toBe(false);
  });
});

describe("decisionOutcome — 窓割り・delta・org 絞り・不正 uuid", () => {
  const VALID_ID = "11111111-1111-1111-1111-111111111111";

  it("不正 uuid → null(DB へ渡さない)", async () => {
    const result = await decisionOutcome("not-a-uuid");
    expect(result).toBeNull();
    expect(mocks.calls).toHaveLength(0);
  });

  it("type='decision' でない・存在しない・status='error' は null", async () => {
    mocks.rows = [makeRecord({ id: VALID_ID, type: "task" })];
    expect(await decisionOutcome(VALID_ID)).toBeNull();

    mocks.rows = [makeRecord({ id: VALID_ID, status: "error" })];
    expect(await decisionOutcome(VALID_ID)).toBeNull();

    expect(await decisionOutcome("22222222-2222-2222-2222-222222222222")).toBeNull();
  });

  it("窓割り・0行窓は null・org 絞り・delta の null 伝播", async () => {
    const anchor = new Date("2026-06-01T00:00:00Z");
    mocks.rows = [
      makeRecord({ id: VALID_ID, type: "decision", occurred_at: anchor, org: "org-a" }),
      // before(前42日): org-a の1件のみ有効 → avgBefore = 0.4
      makeRecord({
        id: "before-1",
        type: "task",
        occurred_at: new Date("2026-05-20T00:00:00Z"),
        org: "org-a",
        reward_score: 0.4,
      }),
      // before の org 不一致(除外される)
      makeRecord({
        id: "before-2",
        type: "task",
        occurred_at: new Date("2026-05-21T00:00:00Z"),
        org: "org-b",
        reward_score: 0.9,
      }),
      // after 第1週(anchor 〜 +7日): 2件 → avg 0.6
      makeRecord({
        id: "after-1",
        type: "task",
        occurred_at: new Date("2026-06-02T00:00:00Z"),
        org: "org-a",
        reward_score: 0.5,
      }),
      makeRecord({
        id: "after-2",
        type: "task",
        occurred_at: new Date("2026-06-03T00:00:00Z"),
        org: "org-a",
        reward_score: 0.7,
      }),
      // after 第2週分は無し(0行窓 → null)
    ];

    const result = await decisionOutcome(VALID_ID);
    expect(result).not.toBeNull();
    expect(result!.labels).toEqual(["+1週", "+2週", "+3週", "+4週", "+5週", "+6週"]);
    expect(result!.reward[0]).toBeCloseTo(0.6, 10);
    expect(result!.reward[1]).toBeNull(); // 0行窓
    expect(result!.stats.avgAfter).toBeCloseTo(0.6, 10);
    expect(result!.stats.count).toBe(2);
    // avgBefore = 0.4(org-a のみ)・avgAfter = 0.6 → delta = 0.2
    expect(result!.stats.delta).toBeCloseTo(0.2, 10);
  });

  it("before 側 0 行なら delta は null(片側 null 伝播)", async () => {
    const anchor = new Date("2026-06-01T00:00:00Z");
    mocks.rows = [
      makeRecord({ id: VALID_ID, type: "decision", occurred_at: anchor, org: null }),
      makeRecord({
        id: "after-1",
        type: "task",
        occurred_at: new Date("2026-06-02T00:00:00Z"),
        reward_score: 0.5,
      }),
    ];

    const result = await decisionOutcome(VALID_ID);
    expect(result!.stats.avgAfter).toBeCloseTo(0.5, 10);
    expect(result!.stats.delta).toBeNull();
  });
});

describe("topTags — 頻度降順・同数タグ名昇順", () => {
  it("頻度降順、同数はタグ名昇順に整列する", async () => {
    mocks.rows = [
      makeRecord({ id: "1", tags: ["b", "a"] }),
      makeRecord({ id: "2", tags: ["b"] }),
      makeRecord({ id: "3", tags: ["a", "c"] }),
      makeRecord({ id: "4", tags: ["c"] }),
      makeRecord({ id: "5", status: "error", tags: ["z"] }), // error 行は対象外
    ];

    const tags = await topTags(8);
    // b:2, a:2, c:2 → 同数なので タグ名昇順(a, b, c)
    expect(tags).toEqual([
      { tag: "a", count: 2 },
      { tag: "b", count: 2 },
      { tag: "c", count: 2 },
    ]);
    expect(tags.find((t) => t.tag === "z")).toBeUndefined();
  });

  it("n 件でクランプする", async () => {
    mocks.rows = [
      makeRecord({ id: "1", tags: ["a"] }),
      makeRecord({ id: "2", tags: ["b"] }),
      makeRecord({ id: "3", tags: ["c"] }),
    ];
    const tags = await topTags(2);
    expect(tags).toHaveLength(2);
  });
});

describe("getKnowledgeData — q 空 / embed throw", () => {
  it("q 空 → recent(最近の判断・similarity null)を返し hits は空", async () => {
    mocks.rows = [
      makeRecord({ id: "d1", type: "decision", occurred_at: new Date("2026-06-05T00:00:00Z") }),
      makeRecord({ id: "d2", type: "decision", occurred_at: new Date("2026-06-01T00:00:00Z") }),
    ];

    const data = await getKnowledgeData({ q: "" });

    expect(data.hits).toEqual([]);
    expect(data.recent).toHaveLength(2);
    expect(data.recent[0]!.id).toBe("d1"); // occurred_at 降順
    expect(data.recent.every((h) => h.similarity === null)).toBe(true);
    expect(data.searchError).toBe(false);
  });

  it("埋め込み throw → searchError=true + recent を返す", async () => {
    mocks.rows = [makeRecord({ id: "d1", type: "decision" })];
    embeddingMocks.embedFn = vi.fn(async () => {
      throw new Error("embedding provider unavailable");
    });

    const data = await getKnowledgeData({ q: "検索語" });

    expect(data.searchError).toBe(true);
    expect(data.hits).toEqual([]);
    expect(data.recent).toHaveLength(1);
  });
});
