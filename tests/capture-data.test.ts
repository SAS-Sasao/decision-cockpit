// 対象設計: docs/design/detail/capture-spar.md §2.1(listInbox)/ §3(tests/capture-data.test.ts)
// lib/db をモックし、実 DB なしで listInbox の SQL / クランプ / 行写像を検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../lib/db", () => ({ query: mocks.query }));

const { listInbox } = await import("../lib/data/capture");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("listInbox", () => {
  it("SQL に user_id = $1 / ORDER BY created_at DESC, id DESC を含み、params[0] = userId", async () => {
    await listInbox("user-1");

    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(params[0]).toBe("user-1");
  });

  it("limit クランプ: undefined→50 / 0→1 / 999→100 / 小数切り捨て", async () => {
    await listInbox("user-1", undefined);
    expect(mocks.query.mock.calls[0]![1][1]).toBe(50);

    await listInbox("user-1", 0);
    expect(mocks.query.mock.calls[1]![1][1]).toBe(1);

    await listInbox("user-1", 999);
    expect(mocks.query.mock.calls[2]![1][1]).toBe(100);

    await listInbox("user-1", 12.7);
    expect(mocks.query.mock.calls[3]![1][1]).toBe(12);
  });

  it("行写像: processedAt / curatedRef の null 透過", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: "row-1",
          kind: "status",
          topic: "topic-x",
          tags: [],
          body: "本文",
          source: "ui",
          created_at: new Date("2026-07-19T00:00:00Z"),
          processed_at: null,
          curated_ref: null,
        },
      ],
    });

    const rows = await listInbox("user-1");
    expect(rows).toEqual([
      {
        id: "row-1",
        kind: "status",
        topic: "topic-x",
        tags: [],
        body: "本文",
        source: "ui",
        createdAt: "2026-07-19T00:00:00.000Z",
        processedAt: null,
        curatedRef: null,
      },
    ]);
  });
});
