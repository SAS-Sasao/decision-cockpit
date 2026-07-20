// 対象設計: docs/design/detail/organize-loop.md §2.1 / §2.3 / §3(tests/organize-sql.test.ts)
// pg・node:fs をモックし、実 DB・実ネットワークなしで fetch/mark の SQL 契約を検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    query(...args: unknown[]) {
      return mocks.query(...args);
    }
    end() {
      return mocks.end();
    }
  },
}));

vi.mock("node:fs", () => ({
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
  appendFileSync: mocks.appendFileSync,
  readFileSync: mocks.readFileSync,
}));

const { FETCH_SQL, MULTI_USER_GUARD_SQL, resolveLimit, parseAllowedOrgs, buildRowsPayload, runFetch } = await import(
  "../scripts/organize/fetch"
);
const { MARK_SQL, buildCuratedRef, runMark } = await import("../scripts/organize/mark");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockResolvedValue(undefined);
  process.env = {
    ...ORIGINAL_ENV,
    DATABASE_URL: "postgres://organize_bot:x@example.invalid/db",
    ORGANIZE_DATE: "2026-07-20",
    ORGANIZE_SLOT: "morning",
    ORGANIZE_ALLOWED_ORGS: "domain-tech-collection",
    ORGANIZE_OUT: "/out",
    ORGANIZE_STATE: "/state",
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("fetch: SQL 完全形", () => {
  it("列リスト + WHERE + ORDER BY・SELECT 列に user_id を含まない", () => {
    expect(FETCH_SQL).toBe(
      "SELECT id, kind, topic, tags, body, status, created_at FROM capture_inbox WHERE processed_at IS NULL AND deleted_at IS NULL ORDER BY created_at ASC, id ASC LIMIT $1"
    );
    expect(FETCH_SQL).not.toMatch(/\buser_id\b/);
  });

  it("params [limit] で呼び出す", async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql === MULTI_USER_GUARD_SQL) return Promise.resolve({ rows: [{ count: "1" }] });
      return Promise.resolve({ rows: [] });
    });
    await runFetch();
    const fetchCall = mocks.query.mock.calls.find((c) => c[0] === FETCH_SQL);
    expect(fetchCall?.[1]).toEqual([50]);
  });

  it("クランプ: 既定 50 / 下限1 / 上限200 / 不正値は既定", () => {
    expect(resolveLimit(undefined)).toBe(50);
    expect(resolveLimit("")).toBe(50);
    expect(resolveLimit("0")).toBe(1);
    expect(resolveLimit("-5")).toBe(1);
    expect(resolveLimit("300")).toBe(200);
    expect(resolveLimit("abc")).toBe(50);
    expect(resolveLimit("10")).toBe(10);
  });
});

describe("多ユーザーガード", () => {
  it("count(DISTINCT user_id) が2以上 → run fail(値は取得しない)", async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql === MULTI_USER_GUARD_SQL) return Promise.resolve({ rows: [{ count: "2" }] });
      return Promise.resolve({ rows: [] });
    });
    await expect(runFetch()).rejects.toThrow();
  });

  it("1なら継続する", async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql === MULTI_USER_GUARD_SQL) return Promise.resolve({ rows: [{ count: "1" }] });
      return Promise.resolve({ rows: [] });
    });
    await expect(runFetch()).resolves.toBeUndefined();
  });
});

describe("rows.json 形状", () => {
  it("{ date, slot, allowed_orgs, rows }(env をそのまま書き写す)", async () => {
    const fetchedRows = [
      { id: "11111111-1111-1111-1111-111111111111", kind: "status", topic: null, tags: [], body: "b", status: "open", created_at: "2026-07-20T00:00:00.000Z" },
    ];
    mocks.query.mockImplementation((sql: string) => {
      if (sql === MULTI_USER_GUARD_SQL) return Promise.resolve({ rows: [{ count: "1" }] });
      return Promise.resolve({ rows: fetchedRows });
    });
    await runFetch();

    const call = mocks.writeFileSync.mock.calls.find((c) => String(c[0]).endsWith("rows.json"));
    expect(call).toBeTruthy();
    const payload = JSON.parse(call![1] as string);
    expect(payload).toEqual({
      date: "2026-07-20",
      slot: "morning",
      allowed_orgs: ["domain-tech-collection"],
      rows: fetchedRows,
    });
  });

  it("buildRowsPayload はそのまま env の値を写す純関数", () => {
    const run = { date: "2026-07-20", slot: "morning", allowed_orgs: ["a", "b"] };
    expect(buildRowsPayload(run, [])).toEqual({ date: "2026-07-20", slot: "morning", allowed_orgs: ["a", "b"], rows: [] });
  });

  it("parseAllowedOrgs はカンマ区切りを trim して配列化する", () => {
    expect(parseAllowedOrgs("a, b ,c")).toEqual(["a", "b", "c"]);
  });
});

describe("mark: SQL 完全形", () => {
  it("3列・AND processed_at IS NULL AND deleted_at IS NULL", () => {
    expect(MARK_SQL).toBe(
      "UPDATE capture_inbox SET processed_at = now(), status = 'done', curated_ref = $1 WHERE id = ANY($2) AND processed_at IS NULL AND deleted_at IS NULL"
    );
  });

  it("curated_ref は <repo>:<path> 形式", () => {
    expect(buildCuratedRef("ai-war-room", "docs/logs/2026-07-20-morning.md")).toBe(
      "ai-war-room:docs/logs/2026-07-20-morning.md"
    );
  });

  it("params [ref, ids]・ファイル単位反復", async () => {
    const entries = [
      { repo: "ai-war-room", path: "docs/logs/2026-07-20-morning.md", file: "out/md/a.md", capture_ids: ["id-1"] },
      { repo: "cc-sier-organization", path: ".companies/x/docs/decisions/2026-07-20-morning-d01.md", file: "out/md/b.md", capture_ids: ["id-2", "id-3"] },
    ];
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("files.json")) return JSON.stringify(entries);
      if (path.endsWith("pr-repos.json")) return JSON.stringify(["ai-war-room", "cc-sier-organization"]);
      throw new Error(`unexpected read: ${path}`);
    });
    mocks.query.mockResolvedValue({ rowCount: 1 });

    await runMark();

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenNthCalledWith(1, MARK_SQL, ["ai-war-room:docs/logs/2026-07-20-morning.md", ["id-1"]]);
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      MARK_SQL,
      ["cc-sier-organization:.companies/x/docs/decisions/2026-07-20-morning-d01.md", ["id-2", "id-3"]]
    );
  });

  it("rowCount < ids で警告(throw しない)", async () => {
    const entries = [
      { repo: "ai-war-room", path: "docs/logs/2026-07-20-morning.md", file: "out/md/a.md", capture_ids: ["id-1", "id-2"] },
    ];
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("files.json")) return JSON.stringify(entries);
      if (path.endsWith("pr-repos.json")) return JSON.stringify(["ai-war-room"]);
      throw new Error(`unexpected read: ${path}`);
    });
    mocks.query.mockResolvedValue({ rowCount: 1 });

    await expect(runMark()).resolves.toBeUndefined();
  });

  it("成功していない repo のファイルは対象外", async () => {
    const entries = [
      { repo: "ai-war-room", path: "docs/logs/2026-07-20-morning.md", file: "out/md/a.md", capture_ids: ["id-1"] },
    ];
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("files.json")) return JSON.stringify(entries);
      if (path.endsWith("pr-repos.json")) return JSON.stringify([]);
      throw new Error(`unexpected read: ${path}`);
    });

    await runMark();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
