// 対象設計: docs/design/detail/wbs-loop.md §2.1 / §2.3 / §3(tests/board-override.test.ts)
//
// lib/db をモックし、実 DB なしで board-override データ層の SQL 契約と
// updateBoardState(Server Action)の検証7段を機械判定する。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../lib/db", () => ({ query: mocks.query }));
vi.mock("../lib/auth/user", () => ({ getUser: mocks.getUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { revalidatePath } = await import("next/cache");
const {
  LATEST_BOARD_CTE,
  listActiveOverrides,
  resolveOverridesAfterSync,
  upsertBoardOverride,
} = await import("../lib/data/board-override");
const { updateBoardState } = await import("../app/(shell)/today/actions");

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
});

const KEY = {
  source: "cc-sier-organization",
  filePath: ".companies/demo-org/docs/secretary/demo-plan-wbs.md",
  itemKey: "W1-1",
};

describe("upsertBoardOverride — UPSERT とリセット3列", () => {
  it("ON CONFLICT (source, file_path, item_key) と pr_ref/resolved_at/resolution の NULL リセットを含む", async () => {
    await upsertBoardOverride("user-1", KEY, "doing", "todo");
    const [sql, params] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("ON CONFLICT (source, file_path, item_key) DO UPDATE");
    expect(sql).toContain("pr_ref = NULL");
    expect(sql).toContain("resolved_at = NULL");
    expect(sql).toContain("resolution = NULL");
    expect(params).toEqual([KEY.source, KEY.filePath, KEY.itemKey, "doing", "todo", "user-1"]);
  });
});

describe("listActiveOverrides — アクティブ述語", () => {
  it("resolved_at IS NULL で絞り、行を camelCase に写像する", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          source: KEY.source,
          file_path: KEY.filePath,
          item_key: KEY.itemKey,
          desired_state: "doing",
          base_state: "todo",
          pr_ref: null,
          updated_at: new Date("2026-07-26T00:00:00Z"),
        },
      ],
    });
    const rows = await listActiveOverrides();
    const [sql] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("resolved_at IS NULL");
    expect(rows).toEqual([
      {
        source: KEY.source,
        filePath: KEY.filePath,
        itemKey: KEY.itemKey,
        desiredState: "doing",
        baseState: "todo",
        prRef: null,
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    ]);
  });
});

describe("resolveOverridesAfterSync — 最新世代 CTE と2出口", () => {
  it("SQL が LATEST_BOARD_CTE を含み、applied/superseded の2出口条件を持つ", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ resolution: "applied" }, { resolution: "applied" }, { resolution: "superseded" }],
    });
    const result = await resolveOverridesAfterSync();
    const [sql] = mocks.query.mock.calls[0]!;
    expect(sql).toContain("(array_agg(commit ORDER BY synced_at DESC, commit DESC))[1]");
    expect(sql).toContain("l.state = o.desired_state");
    expect(sql).toContain("l.state <> o.base_state AND l.state <> o.desired_state");
    expect(sql).toContain("RETURNING o.resolution");
    expect(result).toEqual({ applied: 2, superseded: 1 });
  });

  it("LATEST_BOARD_CTE の世代選出式は lib/data/today.ts と文字同一(3重コピー乖離の検知)", () => {
    const todaySource = readFileSync(join(REPO_ROOT, "lib", "data", "today.ts"), "utf8");
    const selector = "(array_agg(commit ORDER BY synced_at DESC, commit DESC))[1]";
    expect(LATEST_BOARD_CTE).toContain(selector);
    expect(todaySource).toContain(selector);
  });
});

describe("updateBoardState — 検証7段(§2.3)", () => {
  const okEffective = { rows: [{ state: "todo", desired_state: null }] };

  it("(1) 未認証 → unauthorized", async () => {
    mocks.getUser.mockResolvedValue(null);
    const result = await updateBoardState({ ...KEY, desired: "doing" });
    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("(2) desired 語彙外 → bad_request", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    const result = await updateBoardState({ ...KEY, desired: "open" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
  });

  it("(3) source 固定値以外 → bad_request", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    const result = await updateBoardState({ ...KEY, source: "ai-war-room", desired: "doing" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
  });

  it("(4) filePath 形式外(regex 不一致 / '..')→ bad_request", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    const r1 = await updateBoardState({ ...KEY, filePath: "docs/decisions/x.md", desired: "doing" });
    expect(r1).toEqual({ ok: false, error: "bad_request" });
    const r2 = await updateBoardState({
      ...KEY,
      filePath: ".companies/a/docs/secretary/../secretary/x-wbs.md",
      desired: "doing",
    });
    expect(r2).toEqual({ ok: false, error: "bad_request" });
  });

  it("(5) itemKey 空 → bad_request", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    const result = await updateBoardState({ ...KEY, itemKey: "", desired: "doing" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
  });

  it("(6) 最新世代に不在 → bad_request(存在秘匿)", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    mocks.query.mockResolvedValue({ rows: [] });
    const result = await updateBoardState({ ...KEY, desired: "doing" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
  });

  it("(7) no-op(desired = 実効状態)→ bad_request", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    mocks.query.mockResolvedValue({ rows: [{ state: "doing", desired_state: null }] });
    const result = await updateBoardState({ ...KEY, desired: "doing" });
    expect(result).toEqual({ ok: false, error: "bad_request" });
  });

  it("正常系: base = 実効状態(アクティブ override があれば旧 desired)で UPSERT・revalidatePath('/today')", async () => {
    mocks.getUser.mockResolvedValue({ id: "user-1" });
    // 実効 = 旧 desired(doing)。board の生 state は todo — base には doing が渡ること(§2.3)。
    mocks.query
      .mockResolvedValueOnce({ rows: [{ state: "todo", desired_state: "doing" }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await updateBoardState({ ...KEY, desired: "done" });
    expect(result).toEqual({ ok: true });
    const upsertParams = mocks.query.mock.calls[1]![1];
    expect(upsertParams).toEqual([KEY.source, KEY.filePath, KEY.itemKey, "done", "doing", "user-1"]);
    expect(revalidatePath).toHaveBeenCalledWith("/today");
  });
});
