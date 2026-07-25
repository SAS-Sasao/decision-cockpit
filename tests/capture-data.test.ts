// 対象設計: docs/design/detail/capture-spar.md §2.1(listInbox)/ §3(tests/capture-data.test.ts)
// lib/db をモックし、実 DB なしで listInbox の SQL / クランプ / 行写像を検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../lib/db", () => ({ query: mocks.query }));

const { listInbox, listBoardCaptures } = await import("../lib/data/capture");

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

describe("listBoardCaptures — /today カンバン用(today-board-interactive §1-4 / §5)", () => {
  it("SQL: user_id = $1・kind IN ('next_move', 'issue')・deleted_at IS NULL・created_at DESC", async () => {
    await listBoardCaptures("user-1");

    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("kind IN ('next_move', 'issue')");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(params[0]).toBe("user-1");
  });

  it("limit クランプ: undefined→100(カンバン既定)/ 0→1 / 999→100", async () => {
    await listBoardCaptures("user-1", undefined);
    expect(mocks.query.mock.calls[0]![1][1]).toBe(100);

    await listBoardCaptures("user-1", 0);
    expect(mocks.query.mock.calls[1]![1][1]).toBe(1);

    await listBoardCaptures("user-1", 999);
    expect(mocks.query.mock.calls[2]![1][1]).toBe(100);
  });

  it("行写像: 列サブセット(id/kind/topic/body/status/processedAt/createdAt)・processed_at の ISO 変換", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: "row-1",
          kind: "next_move",
          topic: null,
          body: "次の一手の本文",
          status: "open",
          processed_at: new Date("2026-07-25T01:00:00Z"),
          created_at: new Date("2026-07-25T00:00:00Z"),
        },
      ],
    });

    const rows = await listBoardCaptures("user-1");
    expect(rows).toEqual([
      {
        id: "row-1",
        kind: "next_move",
        topic: null,
        body: "次の一手の本文",
        status: "open",
        processedAt: "2026-07-25T01:00:00.000Z",
        createdAt: "2026-07-25T00:00:00.000Z",
      },
    ]);
  });
});
