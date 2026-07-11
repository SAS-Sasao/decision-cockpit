// 対象設計: docs/design/detail/auth-foundation.md §3(tests/auth-user.test.ts)
// @neondatabase/auth/next/server と next/navigation を全面モックし、実ネットワーク/実
// redirect を発生させない。lib/auth/server は env 未設定で throw する(fail-fast)ため、
// 動的 import 前に process.env を設定してから読み込む。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@neondatabase/auth/next/server", () => ({
  createNeonAuth: () => ({
    getSession: mocks.getSession,
    signOut: mocks.signOut,
    handler: () => ({ GET: vi.fn(), POST: vi.fn() }),
    middleware: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

let getUser: typeof import("../lib/auth/user").getUser;
let requireUser: typeof import("../lib/auth/user").requireUser;

beforeAll(async () => {
  process.env.NEON_AUTH_BASE_URL = "http://localhost:9";
  process.env.NEON_AUTH_COOKIE_SECRET = "0".repeat(32);
  ({ getUser, requireUser } = await import("../lib/auth/user"));
});

beforeEach(() => {
  mocks.getSession.mockReset();
  vi.mocked(redirect).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getUser / requireUser", () => {
  it("(a) セッションなし: getUser は null、requireUser は redirect('/login') を throw する", async () => {
    mocks.getSession.mockResolvedValue({ data: null, error: null });

    await expect(getUser()).resolves.toBeNull();
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("(b) セッションあり: AuthUser { id, email, name } に正規化する", async () => {
    mocks.getSession.mockResolvedValue({
      data: { user: { id: "user-1", email: "alice@example.com", name: "Alice" } },
      error: null,
    });

    await expect(getUser()).resolves.toEqual({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
    });

    const user = await requireUser();
    expect(user).toEqual({ id: "user-1", email: "alice@example.com", name: "Alice" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("(c) getSession が error を返す: console.error して null(fail-closed)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getSession.mockResolvedValue({
      data: null,
      error: { message: "upstream unavailable" },
    });

    await expect(getUser()).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
