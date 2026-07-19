// 対象設計: docs/design/detail/capture-spar.md §2.5(app/api/spar/route.ts)/ §3(tests/spar-route.test.ts)
// getUser / searchKnowledge / lib/spar/llm をモックし、実 DB・実ネットワークなしで POST を検証する
// (new Request() で直呼び — tests/api-sync.test.ts 前例)。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  searchKnowledge: vi.fn(),
  getSparConfig: vi.fn(),
  getSparGuards: vi.fn(),
  callChat: vi.fn(),
}));

vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("../lib/data/knowledge", () => ({ searchKnowledge: mocks.searchKnowledge }));
vi.mock("../lib/spar/llm", async () => {
  const actual = await vi.importActual<typeof import("../lib/spar/llm")>("../lib/spar/llm");
  return {
    ...actual,
    getSparConfig: mocks.getSparConfig,
    getSparGuards: mocks.getSparGuards,
    callChat: mocks.callChat,
  };
});

const { POST } = await import("../app/api/spar/route");
const { SparConfigError, SparUpstreamError } = await import("../lib/spar/llm");

const SESSION_USER = { id: "user-1", email: "alice@example.com", name: "Alice" };
const DEFAULT_GUARDS = { maxTurns: 8, ctxTopK: 3, maxInputChars: 2000, maxTokens: 1024 };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/spar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue(SESSION_USER);
  mocks.getSparConfig.mockReturnValue({ provider: "openai", model: "gpt-4o-mini", apiKey: "test-key" });
  mocks.getSparGuards.mockReturnValue(DEFAULT_GUARDS);
  mocks.searchKnowledge.mockResolvedValue([]);
  mocks.callChat.mockResolvedValue("応答テキスト");
});

describe("POST /api/spar", () => {
  it("未認証 → 401(callChat 不呼)", async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ message: "こんにちは" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.callChat).not.toHaveBeenCalled();
  });

  it("getSparConfig throw(SparConfigError) → 400 spar_not_configured", async () => {
    mocks.getSparConfig.mockImplementation(() => {
      throw new SparConfigError("missing env");
    });
    const res = await POST(makeRequest({ message: "こんにちは" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "spar_not_configured" });
    expect(mocks.callChat).not.toHaveBeenCalled();
  });

  it("message 欠落 → 400 bad_request", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(mocks.callChat).not.toHaveBeenCalled();
  });

  it("message 空(trim 後)→ 400 bad_request", async () => {
    const res = await POST(makeRequest({ message: "   " }));
    expect(res.status).toBe(400);
    expect(mocks.callChat).not.toHaveBeenCalled();
  });

  it("message 超過(maxInputChars 超え)→ 400 bad_request", async () => {
    const res = await POST(makeRequest({ message: "a".repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mocks.callChat).not.toHaveBeenCalled();
  });

  it("history の role 不正 → 400 bad_request", async () => {
    const res = await POST(
      makeRequest({ message: "こんにちは", history: [{ role: "system", content: "x" }] })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(mocks.callChat).not.toHaveBeenCalled();
  });

  it("searchKnowledge throw → 200 + degraded:true + refs:[](縮退・callChat は呼ばれる)", async () => {
    mocks.searchKnowledge.mockRejectedValue(new Error("embedding env missing"));
    const res = await POST(makeRequest({ message: "こんにちは" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.degraded).toBe(true);
    expect(json.refs).toEqual([]);
    expect(mocks.callChat).toHaveBeenCalledTimes(1);
  });

  it("正常系: refs 写像(title/date/score の null 透過)・refs に excerpt 非包含・degraded:false", async () => {
    mocks.searchKnowledge.mockResolvedValue([
      {
        id: "rec-1",
        source: "ai-war-room",
        filePath: "docs/decisions/x.md",
        occurredAt: "2026-07-01T00:00:00.000Z",
        type: "decision",
        org: null,
        title: "決定X",
        excerpt: "抜粋テキスト_EXCERPT_MARKER",
        tags: [],
        similarity: 0.87,
      },
      {
        id: "rec-2",
        source: "cc-sier-organization",
        filePath: "docs/logs/y.md",
        occurredAt: null,
        type: "decision",
        org: null,
        title: null,
        excerpt: "抜粋2",
        tags: [],
        similarity: null,
      },
    ]);

    const res = await POST(makeRequest({ message: "こんにちは" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toBe("応答テキスト");
    expect(json.degraded).toBe(false);
    expect(json.refs).toEqual([
      {
        title: "決定X",
        date: "2026-07-01T00:00:00.000Z",
        score: 0.87,
        source: "ai-war-room",
        filePath: "docs/decisions/x.md",
      },
      { title: null, date: null, score: null, source: "cc-sier-organization", filePath: "docs/logs/y.md" },
    ]);

    const rawJson = JSON.stringify(json);
    expect(rawJson).not.toContain("EXCERPT_MARKER");
    expect(rawJson).not.toContain("excerpt");
  });

  it("SparUpstreamError → 502 + status 透過・本文非転送", async () => {
    mocks.callChat.mockRejectedValue(new SparUpstreamError(503));
    const res = await POST(makeRequest({ message: "こんにちは" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "spar_upstream", status: 503 });
  });

  it("history 12件 → callChat に渡る messages は system + 8 + 1 件(サーバ側切詰め)", async () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn-${i}`,
    }));

    const res = await POST(makeRequest({ message: "最新メッセージ", history }));
    expect(res.status).toBe(200);

    expect(mocks.callChat).toHaveBeenCalledTimes(1);
    const [, , messages] = mocks.callChat.mock.calls[0]!;
    expect(messages).toHaveLength(10); // system(1) + history(8) + 新メッセージ(1)
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("turn-4"); // 末尾8件 = turn-4..turn-11
    expect(messages[8].content).toBe("turn-11");
    expect(messages[9]).toEqual({ role: "user", content: "最新メッセージ" });
  });
});
