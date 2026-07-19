// 対象設計: docs/design/detail/capture-spar.md §0「M4-FIX 追補」
// proxy.ts の GET 正規化ラッパー(M4-FIX)を検証する。
// @neondatabase/auth 0.4.2-beta の middleware は get-session 照会へ元リクエストの
// method をそのまま転送するため、保護パスへの POST が常に 307 になる欠陥がある。
// GET/HEAD 以外は url + headers を保持した GET 複製の NextRequest を SDK middleware に
// 渡すことで回避する(セッション判定は cookie ヘッダのみに依存するため意味論同値)。
import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handler = vi.fn(
    async (_request: NextRequest, _event?: NextFetchEvent) =>
      new Response(null, { status: 200 })
  );
  return {
    handler,
    middleware: vi.fn(() => handler),
  };
});

vi.mock("../lib/auth/server", () => ({
  auth: { middleware: mocks.middleware },
}));

let proxy: (request: NextRequest, event: NextFetchEvent) => unknown;

beforeAll(async () => {
  ({ default: proxy } = await import("../proxy"));
});

beforeEach(() => {
  mocks.handler.mockClear();
});

const fakeEvent = { marker: "fake-event" } as unknown as NextFetchEvent;

describe("proxy GET 正規化ラッパー(M4-FIX)", () => {
  it("POST リクエストは SDK へ method=GET・同一 url・cookie ヘッダ保持で渡る", async () => {
    const request = new NextRequest("http://localhost:3000/api/spar", {
      method: "POST",
      headers: { cookie: "a=b" },
    });

    await proxy(request, fakeEvent);

    expect(mocks.handler).toHaveBeenCalledTimes(1);
    const passed = mocks.handler.mock.calls[0][0];
    expect(passed.method).toBe("GET");
    expect(passed.url).toBe(request.url);
    expect(passed.headers.get("cookie")).toBe("a=b");
  });

  it("GET リクエストは method=GET のまま・同一 url で渡る", async () => {
    const request = new NextRequest("http://localhost:3000/capture", {
      method: "GET",
      headers: { cookie: "a=b" },
    });

    await proxy(request, fakeEvent);

    expect(mocks.handler).toHaveBeenCalledTimes(1);
    const passed = mocks.handler.mock.calls[0][0];
    expect(passed.method).toBe("GET");
    expect(passed.url).toBe(request.url);
  });

  it("SDK ハンドラの返り値が素通しで返る", async () => {
    const response = new Response(null, { status: 307 });
    mocks.handler.mockResolvedValueOnce(response);
    const request = new NextRequest("http://localhost:3000/api/spar", {
      method: "POST",
    });

    const result = await proxy(request, fakeEvent);

    expect(result).toBe(response);
  });
});
