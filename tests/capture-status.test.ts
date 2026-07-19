// 対象設計: docs/design/basic/capture-triage.md §4-3(tests/capture-status.test.ts)
// lib/db・lib/auth/user・next/cache をモックし、実 DB・実ネットワークなしで検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: mocks.query }));
vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateCaptureStatus } = await import("../app/(shell)/capture/actions");
const { listInbox } = await import("../lib/data/capture");
const { getUnprocessedInboxCount } = await import("../lib/data/overview");
const { revalidatePath } = await import("next/cache");

const SESSION_USER = { id: "user-1", email: "alice@example.com", name: "Alice" };
const VALID_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue(SESSION_USER);
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("updateCaptureStatus", () => {
  it("getUser null → unauthorized・query 不呼", async () => {
    mocks.getUser.mockResolvedValue(null);

    const result = await updateCaptureStatus({ id: VALID_ID, status: "in_progress" });

    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("status 語彙外 → bad_request・query 不呼", async () => {
    const result = await updateCaptureStatus({ id: VALID_ID, status: "unknown_status" });

    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("id が UUID 形式でない → bad_request・query 不呼", async () => {
    const result = await updateCaptureStatus({ id: "not-a-uuid", status: "done" });

    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("正常系: SQL に SET status・params = [status, id, セッション userId]・revalidatePath('/capture')", async () => {
    const result = await updateCaptureStatus({ id: VALID_ID, status: "done" });

    expect(result).toEqual({ ok: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("SET status");
    expect(params).toEqual(["done", VALID_ID, SESSION_USER.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/capture");
  });

  it("rowCount 0(他人の行・不存在) → bad_request", async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await updateCaptureStatus({ id: VALID_ID, status: "open" });

    expect(result).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("getUnprocessedInboxCount", () => {
  it("SQL に user_id = $1 と status = 'open' の両方を含み、params[0] = userId", async () => {
    mocks.query.mockResolvedValue({ rows: [{ count: "3" }] });

    const count = await getUnprocessedInboxCount("user-1");

    expect(count).toBe(3);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("status = 'open'");
    expect(params[0]).toBe("user-1");
  });
});

describe("listInbox の status 写像", () => {
  it("モック行 status: 'in_progress' → InboxRow.status", async () => {
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
          status: "in_progress",
        },
      ],
    });

    const rows = await listInbox("user-1");

    expect(rows[0]!.status).toBe("in_progress");
  });
});
