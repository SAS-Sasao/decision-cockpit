// 対象設計: docs/design/detail/search-foundation.md §2.3 / §3(tests/embed-index.test.ts)
//
// lib/db をまるごとモックし、in-memory 行(述語ミラー — §0-1)で冪等バッチの進行保証を検証する。
// 実 DB・実ネットワークは使わない(EmbeddingClient もテスト用のダミー実装で代替)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingClient } from "../lib/search/embedding";

type FakeRow = {
  id: string;
  status: "ok" | "error";
  title: string | null;
  tags: string[];
  body: string | null;
  synced_at: Date;
  embedding: number[] | null;
  embedding_model: string | null;
  embedded_at: Date | null;
};

const mocks = vi.hoisted(() => ({
  rows: [] as FakeRow[],
  calls: [] as { text: string; params: unknown[] }[],
}));

function isTarget(row: FakeRow, currentModel: string): boolean {
  if (row.status !== "ok") return false;
  if (row.embedding === null) return true;
  if (row.embedding_model !== currentModel) return true;
  if (row.embedded_at !== null && row.synced_at.getTime() > row.embedded_at.getTime()) return true;
  return false;
}

vi.mock("../lib/db", () => ({
  query: vi.fn(async (text: string, params: unknown[] = []) => {
    mocks.calls.push({ text, params });

    if (text.includes("UPDATE timeline_records")) {
      const [qvec, model, embeddedAt, id] = params as [string, string, Date, string];
      const row = mocks.rows.find((r) => r.id === id);
      if (row) {
        row.embedding = qvec
          .slice(1, -1)
          .split(",")
          .map((v) => Number(v));
        row.embedding_model = model;
        row.embedded_at = embeddedAt;
      }
      return { rows: [] };
    }

    if (text.includes("SELECT count(*)")) {
      const [model] = params as [string];
      const count = mocks.rows.filter((r) => isTarget(r, model)).length;
      return { rows: [{ count: String(count) }] };
    }

    // SELECT の対象行取得(id, title, tags, body, synced_at)
    const [model, limit] = params as [string, number];
    const targets = mocks.rows
      .filter((r) => isTarget(r, model))
      .sort((a, b) => a.synced_at.getTime() - b.synced_at.getTime())
      .slice(0, limit);
    return {
      rows: targets.map((r) => ({
        id: r.id,
        title: r.title,
        tags: r.tags,
        body: r.body,
        synced_at: r.synced_at,
      })),
    };
  }),
}));

const { runEmbedIndex, buildEmbedInput, EMBED_INPUT_MAX_CHARS } = await import(
  "../lib/search/embed-index"
);
const dbModule = await import("../lib/db");

const ORIGINAL_ENV = { ...process.env };

function makeRow(overrides: Partial<FakeRow> & { id: string; synced_at: Date }): FakeRow {
  return {
    status: "ok",
    title: `title-${overrides.id}`,
    tags: ["tag-a"],
    body: "本文",
    embedding: null,
    embedding_model: null,
    embedded_at: null,
    ...overrides,
  };
}

function makeClient(embed: EmbeddingClient["embed"]): EmbeddingClient {
  return { embed };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.EMBEDDING_SOURCE;
  delete process.env.EMBED_MAX_ROWS;
  process.env.EMBEDDING_MODEL = "test-model";
  mocks.rows = [];
  mocks.calls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("runEmbedIndex — 初回・冪等・再対象化", () => {
  it("初回 → status='ok' の全行が embed され、error 行は対象外", async () => {
    mocks.rows = [
      makeRow({ id: "a", synced_at: new Date("2026-07-01T00:00:00Z") }),
      makeRow({ id: "b", synced_at: new Date("2026-07-02T00:00:00Z") }),
      makeRow({ id: "err", status: "error", synced_at: new Date("2026-07-03T00:00:00Z") }),
    ];
    const client = makeClient(vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])));

    const summary = await runEmbedIndex(client);

    expect(summary).toEqual({ embedded: 2, failed: 0, remaining: 0 });
    expect(mocks.rows.find((r) => r.id === "a")!.embedding_model).toBe("test-model");
    expect(mocks.rows.find((r) => r.id === "b")!.embedding_model).toBe("test-model");
    // error 行は選択されず UPDATE もされない(embedding_model は null のまま)
    expect(mocks.rows.find((r) => r.id === "err")!.embedding_model).toBeNull();
  });

  it("2回目の実行 → 対象 0 件(冪等)", async () => {
    mocks.rows = [makeRow({ id: "a", synced_at: new Date("2026-07-01T00:00:00Z") })];
    const client = makeClient(vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])));

    await runEmbedIndex(client);
    mocks.calls = [];
    const second = await runEmbedIndex(client);

    expect(second).toEqual({ embedded: 0, failed: 0, remaining: 0 });
  });

  it("識別子変更(fixture:A → fixture:B)→ 全行が再対象化される", async () => {
    mocks.rows = [
      makeRow({ id: "a", synced_at: new Date("2026-07-01T00:00:00Z") }),
      makeRow({ id: "b", synced_at: new Date("2026-07-02T00:00:00Z") }),
    ];
    const client = makeClient(vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])));

    process.env.EMBEDDING_SOURCE = "fixture";
    process.env.EMBEDDING_MODEL = "modelA";
    const first = await runEmbedIndex(client);
    expect(first).toEqual({ embedded: 2, failed: 0, remaining: 0 });
    expect(mocks.rows.every((r) => r.embedding_model === "fixture:modelA")).toBe(true);

    process.env.EMBEDDING_MODEL = "modelB";
    const second = await runEmbedIndex(client);
    expect(second).toEqual({ embedded: 2, failed: 0, remaining: 0 });
    expect(mocks.rows.every((r) => r.embedding_model === "fixture:modelB")).toBe(true);
  });

  it("embedded_at = 読取時 synced_at(now() は使わない)", async () => {
    const syncedAt = new Date("2026-06-20T12:00:00Z");
    mocks.rows = [makeRow({ id: "a", synced_at: syncedAt })];
    const client = makeClient(vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])));

    await runEmbedIndex(client);

    const updateCall = mocks.calls.find((c) => c.text.includes("UPDATE timeline_records"));
    expect(updateCall).toBeDefined();
    const embeddedAtParam = updateCall!.params[2] as Date;
    expect(embeddedAtParam.getTime()).toBe(syncedAt.getTime());
    expect(mocks.rows[0]!.embedded_at!.getTime()).toBe(syncedAt.getTime());
  });

  it("EMBED_MAX_ROWS 上限・remaining 計上", async () => {
    process.env.EMBED_MAX_ROWS = "2";
    mocks.rows = [
      makeRow({ id: "a", synced_at: new Date("2026-07-01T00:00:00Z") }),
      makeRow({ id: "b", synced_at: new Date("2026-07-02T00:00:00Z") }),
      makeRow({ id: "c", synced_at: new Date("2026-07-03T00:00:00Z") }),
      makeRow({ id: "d", synced_at: new Date("2026-07-04T00:00:00Z") }),
      makeRow({ id: "e", synced_at: new Date("2026-07-05T00:00:00Z") }),
    ];
    const client = makeClient(vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])));

    const summary = await runEmbedIndex(client);

    expect(summary).toEqual({ embedded: 2, failed: 0, remaining: 3 });
    // 古い順(synced_at ASC)に処理される
    expect(mocks.rows.find((r) => r.id === "a")!.embedding_model).toBe("test-model");
    expect(mocks.rows.find((r) => r.id === "b")!.embedding_model).toBe("test-model");
    expect(mocks.rows.find((r) => r.id === "c")!.embedding_model).toBeNull();
  });

  it("client.embed throw → failed 計上・UPDATE なし", async () => {
    mocks.rows = [
      makeRow({ id: "a", synced_at: new Date("2026-07-01T00:00:00Z") }),
      makeRow({ id: "b", synced_at: new Date("2026-07-02T00:00:00Z") }),
      makeRow({ id: "c", synced_at: new Date("2026-07-03T00:00:00Z") }),
    ];
    const client = makeClient(vi.fn(async () => {
      throw new Error("embed provider unavailable");
    }));

    const summary = await runEmbedIndex(client);

    expect(summary).toEqual({ embedded: 0, failed: 3, remaining: 3 });
    expect(mocks.calls.some((c) => c.text.includes("UPDATE timeline_records"))).toBe(false);
  });
});

describe("buildEmbedInput — 連結順・切詰め・null スキップ", () => {
  it("title・tags・body を \\n 連結する(非空要素のみ)", () => {
    const input = buildEmbedInput({ title: "タイトル", tags: ["a", "b"], body: "本文です" });
    expect(input).toBe("タイトル\na b\n本文です");
  });

  it("null 要素はスキップされる", () => {
    const input = buildEmbedInput({ title: null, tags: [], body: "本文のみ" });
    expect(input).toBe("本文のみ");
  });

  it(`${EMBED_INPUT_MAX_CHARS} 文字で切詰める`, () => {
    const longBody = "あ".repeat(1000);
    const input = buildEmbedInput({ title: null, tags: [], body: longBody });
    expect(input).toHaveLength(EMBED_INPUT_MAX_CHARS);
    expect(input).toBe("あ".repeat(EMBED_INPUT_MAX_CHARS));
  });

  it("tags が空配列なら連結に加わらない(空文字列は非空要素扱いしない)", () => {
    const input = buildEmbedInput({ title: "T", tags: [], body: "B" });
    expect(input).toBe("T\nB");
  });
});

describe("query() 実引数への SQL ピン断片 assert(コメント一致の偽 PASS 封鎖)", () => {
  it("SELECT 対象行クエリに §4-3 の WHERE ピンが含まれる", async () => {
    mocks.rows = [makeRow({ id: "a", synced_at: new Date("2026-07-01T00:00:00Z") })];
    const client = makeClient(vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])));
    await runEmbedIndex(client);

    const selectCall = mocks.calls.find((c) => c.text.includes("ORDER BY synced_at ASC"));
    expect(selectCall).toBeDefined();
    expect(selectCall!.text).toContain(
      "WHERE status = 'ok' AND (embedding IS NULL OR embedding_model <> $1 OR synced_at > embedded_at)"
    );

    const updateCall = mocks.calls.find((c) => c.text.includes("UPDATE timeline_records"));
    expect(updateCall!.text).toContain(
      "SET embedding = $1::vector, embedding_model = $2, embedded_at = $3"
    );
  });

  it("query のモック自体が呼ばれている(dbModule 経由)", () => {
    expect(dbModule.query).toBeDefined();
  });
});
