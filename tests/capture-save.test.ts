// 対象設計: docs/design/detail/capture-spar.md §2.2(saveCapture)/ §3(tests/capture-save.test.ts)
// lib/db・lib/auth/user・next/cache をモックし、実 DB・実ネットワークなしで検証する。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: mocks.query }));
vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveCapture } = await import("../app/(shell)/capture/actions");
const { revalidatePath } = await import("next/cache");

const SESSION_USER = { id: "user-1", email: "alice@example.com", name: "Alice" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue(SESSION_USER);
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("saveCapture", () => {
  it("正常系: INSERT INTO capture_inbox・params[0]=セッション userId・source='ui' 固定・revalidatePath('/capture')", async () => {
    const result = await saveCapture({ kind: "status", topic: "topic-x", body: "本文" });

    expect(result).toEqual({ ok: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO capture_inbox");
    expect(sql).toContain("'ui'");
    expect(params[0]).toBe(SESSION_USER.id);
    expect(revalidatePath).toHaveBeenCalledWith("/capture");
  });

  it("getUser null → unauthorized・query 不呼(二層目)", async () => {
    mocks.getUser.mockResolvedValue(null);

    const result = await saveCapture({ kind: "status", topic: "", body: "本文" });

    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("kind 語彙外 → bad_request・query 不呼", async () => {
    const result = await saveCapture({ kind: "unknown_kind", topic: "", body: "本文" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("body 空(trim 後) → bad_request・query 不呼", async () => {
    const result = await saveCapture({ kind: "issue", topic: "", body: "   " });
    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("body 4001字 → bad_request・query 不呼(4000字は受理)", async () => {
    const tooLong = await saveCapture({ kind: "issue", topic: "", body: "a".repeat(4001) });
    expect(tooLong).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();

    const boundary = await saveCapture({ kind: "issue", topic: "", body: "a".repeat(4000) });
    expect(boundary).toEqual({ ok: true });
  });

  it("topic 201字 → bad_request・query 不呼", async () => {
    const result = await saveCapture({ kind: "next_move", topic: "a".repeat(201), body: "本文" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("topic trim 後空 → params の topic が null", async () => {
    await saveCapture({ kind: "status", topic: "   ", body: "本文" });
    const [, params] = mocks.query.mock.calls[0]!;
    expect(params[2]).toBeNull();
  });

  it("spar_conclusion 受理(kind 4語彙内)", async () => {
    const result = await saveCapture({ kind: "spar_conclusion", topic: "壁打ち結論", body: "本文" });
    expect(result).toEqual({ ok: true });
  });

  it("DB throw → bad_request(CHECK 違反等を面に出さない)", async () => {
    mocks.query.mockRejectedValue(new Error("db error"));
    const result = await saveCapture({ kind: "status", topic: "", body: "本文" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
  });
});
