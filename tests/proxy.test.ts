// 対象設計: docs/design/detail/auth-foundation.md §3(tests/proxy.test.ts)
// proxy.ts(Next 16 の middleware 相当)の config.matcher を保護/素通しパスで検証し、
// auth.middleware() に渡される loginUrl オプションを捕捉して assert する。
// lib/auth/server をまるごとモックするため、env 未設定チェックには触れない。
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  middleware: vi.fn(() => "MIDDLEWARE_HANDLER"),
}));

vi.mock("../lib/auth/server", () => ({
  auth: { middleware: mocks.middleware },
}));

let config: { matcher: string[] };

beforeAll(async () => {
  ({ config } = await import("../proxy"));
});

function isProtected(pathname: string): boolean {
  const pattern = config.matcher[0];
  const anchored = new RegExp(`^${pattern}$`);
  return anchored.test(pathname);
}

describe("proxy config.matcher", () => {
  it("保護対象: パス境界付きの除外に一致しないパスはすべて保護される", () => {
    for (const p of ["/", "/search", "/review", "/api/authx", "/api/syncx", "/loginx"]) {
      expect.soft(isProtected(p), `expected ${p} to be protected`).toBe(true);
    }
  });

  it("素通し対象: auth API / login / 静的アセットは保護から除外される", () => {
    for (const p of ["/api/auth/session", "/api/sync", "/login", "/_next/static/x", "/favicon.ico"]) {
      expect.soft(isProtected(p), `expected ${p} to pass through`).toBe(false);
    }
  });

  it("auth.middleware({ loginUrl: '/login' }) が呼ばれる", () => {
    expect(mocks.middleware).toHaveBeenCalledWith({ loginUrl: "/login" });
  });
});
