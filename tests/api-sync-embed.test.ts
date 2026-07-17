// 対象設計: docs/design/detail/search-foundation.md §2.5 / §3(tests/api-sync-embed.test.ts)
//
// run-sync / embed-index / auth をモックし、実ネットワーク・実 DB なしで
// runSync 後の embed フェーズ接続と認可後段配置(非認可時は runEmbedIndex を呼ばない)を検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isAdmin: vi.fn(),
  runSync: vi.fn(),
  runEmbedIndex: vi.fn(),
}));

vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("../lib/auth/roles", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("../lib/ingestion/run-sync", () => ({ runSync: mocks.runSync }));
vi.mock("../lib/search/embed-index", () => ({ runEmbedIndex: mocks.runEmbedIndex }));
vi.mock("../lib/ingestion/fixture-source", () => ({
  FixtureSource: class {
    repo: string;
    constructor(repo: string) {
      this.repo = repo;
    }
  },
}));
vi.mock("../lib/ingestion/github-source", () => ({
  GithubSource: class {
    repo: string;
    constructor(repo: string) {
      this.repo = repo;
    }
  },
}));

const { GET, POST } = await import("../app/api/sync/route");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.SYNC_SOURCE = "fixture";
  mocks.runSync.mockResolvedValue({ repos: {} });
  mocks.runEmbedIndex.mockResolvedValue({ embedded: 1, failed: 0, remaining: 0 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/sync", { headers });
}

describe("GET /api/sync — embed フェーズ接続", () => {
  it("正 secret → 200 + embed キー(runEmbedIndex の結果)", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const res = await GET(makeRequest({ authorization: "Bearer test-secret-value" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.runEmbedIndex).toHaveBeenCalledTimes(1);
    expect(body.embed).toEqual({ embedded: 1, failed: 0, remaining: 0 });
  });

  it("runEmbedIndex throw → 200 + embed.error(同期本体の成功を妨げない)", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    mocks.runEmbedIndex.mockRejectedValue(new Error("embed phase failed"));

    const res = await GET(makeRequest({ authorization: "Bearer test-secret-value" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.embed).toEqual({ error: true });
  });

  it("非認可(不正 secret)→ 401 かつ runEmbedIndex 呼び出し回数 0", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const res = await GET(makeRequest({ authorization: "Bearer wrong-value" }));

    expect(res.status).toBe(401);
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(mocks.runEmbedIndex).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 未設定 → 401 かつ runEmbedIndex 呼び出し回数 0", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest({ authorization: "Bearer anything" }));

    expect(res.status).toBe(401);
    expect(mocks.runEmbedIndex).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync — embed フェーズ接続", () => {
  it("admin → 200 + embed キー", async () => {
    mocks.getUser.mockResolvedValue({ id: "admin-1", email: null, name: null });
    mocks.isAdmin.mockResolvedValue(true);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.runEmbedIndex).toHaveBeenCalledTimes(1);
    expect(body.embed).toEqual({ embedded: 1, failed: 0, remaining: 0 });
  });

  it("runEmbedIndex throw → 200 + embed.error", async () => {
    mocks.getUser.mockResolvedValue({ id: "admin-1", email: null, name: null });
    mocks.isAdmin.mockResolvedValue(true);
    mocks.runEmbedIndex.mockRejectedValue(new Error("pool init failed"));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.embed).toEqual({ error: true });
  });

  it("セッションなし(非認可)→ 401 かつ runEmbedIndex 呼び出し回数 0", async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await POST();

    expect(res.status).toBe(401);
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(mocks.runEmbedIndex).not.toHaveBeenCalled();
  });

  it("非 admin → 403 かつ runEmbedIndex 呼び出し回数 0", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1", email: null, name: null });
    mocks.isAdmin.mockResolvedValue(false);

    const res = await POST();

    expect(res.status).toBe(403);
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(mocks.runEmbedIndex).not.toHaveBeenCalled();
  });
});
