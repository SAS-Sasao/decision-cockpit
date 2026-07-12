// 対象設計: docs/design/detail/ingestion-foundation.md §2.4(Route Handler 契約)/ §3
// getUser / isAdmin / runSync をモックし、実ネットワーク・実 DB なしで認可ゲートを検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isAdmin: vi.fn(),
  runSync: vi.fn(),
}));

vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("../lib/auth/roles", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("../lib/ingestion/run-sync", () => ({ runSync: mocks.runSync }));
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
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/sync", { headers });
}

describe("GET /api/sync(Cron・Bearer CRON_SECRET)", () => {
  it("Authorization ヘッダなし → 401", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("不正な Bearer → 401", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const res = await GET(makeRequest({ authorization: "Bearer wrong-value" }));
    expect(res.status).toBe(401);
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("CRON_SECRET が未設定(空)→ fail-closed で常に 401", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("正しい Bearer → 2xx(runSync モック)", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const res = await GET(makeRequest({ authorization: "Bearer test-secret-value" }));
    expect(res.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/sync(手動・admin セッション)", () => {
  it("セッションなし → 401", async () => {
    mocks.getUser.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("非 admin → 403", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1", email: null, name: null });
    mocks.isAdmin.mockResolvedValue(false);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("admin → 2xx", async () => {
    mocks.getUser.mockResolvedValue({ id: "admin-1", email: null, name: null });
    mocks.isAdmin.mockResolvedValue(true);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });
});
