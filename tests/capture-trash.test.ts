// 対象設計: docs/design/basic/capture-trash.md §4-3(tests/capture-trash.test.ts)
// lib/db・lib/auth/user・next/cache をモックし、実 DB・実ネットワークなしで検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: mocks.query }));
vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { deleteCapture, restoreCapture } = await import("../app/(shell)/capture/actions");
const { listInbox, listTrash } = await import("../lib/data/capture");
const { getUnprocessedInboxCount } = await import("../lib/data/overview");
const { revalidatePath } = await import("next/cache");

const SESSION_USER = { id: "user-1", email: "alice@example.com", name: "Alice" };
const VALID_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue(SESSION_USER);
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("deleteCapture", () => {
  it("getUser null → unauthorized・query 不呼", async () => {
    mocks.getUser.mockResolvedValue(null);

    const result = await deleteCapture({ id: VALID_ID });

    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("id が UUID 形式でない → bad_request・query 不呼", async () => {
    const result = await deleteCapture({ id: "not-a-uuid" });

    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("正常系: SQL に SET deleted_at・params = [id, セッション userId]・revalidatePath('/capture')", async () => {
    const result = await deleteCapture({ id: VALID_ID });

    expect(result).toEqual({ ok: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("SET deleted_at");
    expect(params).toEqual([VALID_ID, SESSION_USER.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/capture");
  });

  it("rowCount 0(他人の行・不存在・二重削除) → bad_request", async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await deleteCapture({ id: VALID_ID });

    expect(result).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("restoreCapture", () => {
  it("getUser null → unauthorized・query 不呼", async () => {
    mocks.getUser.mockResolvedValue(null);

    const result = await restoreCapture({ id: VALID_ID });

    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("id が UUID 形式でない → bad_request・query 不呼", async () => {
    const result = await restoreCapture({ id: "not-a-uuid" });

    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("正常系: SQL に SET deleted_at・params = [id, セッション userId]・revalidatePath('/capture')", async () => {
    const result = await restoreCapture({ id: VALID_ID });

    expect(result).toEqual({ ok: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("SET deleted_at");
    expect(params).toEqual([VALID_ID, SESSION_USER.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/capture");
  });

  it("rowCount 0(他人の行・不存在・二重復元) → bad_request", async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await restoreCapture({ id: VALID_ID });

    expect(result).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("listInbox の WHERE(未削除のみ)", () => {
  it("SQL に user_id = $1 AND deleted_at IS NULL を含む", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await listInbox("user-1");

    const [sql] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("user_id = $1 AND deleted_at IS NULL");
  });
});

describe("listTrash", () => {
  it("SQL に user_id = $1・deleted_at IS NOT NULL・ORDER BY created_at DESC, id DESC を含み、params[0] = userId", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await listTrash("user-1");

    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("deleted_at IS NOT NULL");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(params[0]).toBe("user-1");
  });

  it("limit クランプ: 999 → 100", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await listTrash("user-1", 999);

    expect(mocks.query.mock.calls[0]![1][1]).toBe(100);
  });

  it("行写像: deleted_at: Date → TrashRow.deletedAt が ISO 文字列", async () => {
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
          status: "open",
          deleted_at: new Date("2026-07-20T00:00:00Z"),
        },
      ],
    });

    const rows = await listTrash("user-1");

    expect(rows[0]!.deletedAt).toBe("2026-07-20T00:00:00.000Z");
  });
});

describe("getUnprocessedInboxCount(バッジ)の WHERE(deleted_at 除外)", () => {
  it("SQL に deleted_at IS NULL と user_id = $1 を含み、params[0] = userId", async () => {
    mocks.query.mockResolvedValue({ rows: [{ count: "2" }] });

    const count = await getUnprocessedInboxCount("user-1");

    expect(count).toBe(2);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("user_id = $1");
    expect(params[0]).toBe("user-1");
  });
});
