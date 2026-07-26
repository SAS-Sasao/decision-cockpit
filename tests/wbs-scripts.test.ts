// 対象設計: docs/design/detail/wbs-loop.md §3(tests/wbs-scripts.test.ts — CLI 契約)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pgMock = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    query = pgMock.query;
    end = pgMock.end;
  },
}));

const fetchMod = await import("../scripts/wbs/fetch");
const applyMod = await import("../scripts/wbs/apply");
const prMod = await import("../scripts/wbs/pr");
const markMod = await import("../scripts/wbs/mark");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetch — 2集合と多ユーザーガード", () => {
  it("SQL 契約: 送信 = pr_ref IS NULL / 監査 = 全アクティブ / overrides.json のキー集合に user_id 非収録", () => {
    expect(fetchMod.SEND_SQL).toContain("pr_ref IS NULL");
    expect(fetchMod.SEND_SQL).toContain("resolved_at IS NULL");
    expect(fetchMod.AUDIT_SQL).toContain("resolved_at IS NULL");
    expect(fetchMod.AUDIT_SQL).not.toContain("pr_ref");
    // SELECT 列に user_id を含めない(値は取得しない — COUNT(DISTINCT) のみ)
    expect(fetchMod.SEND_SQL).not.toContain("user_id");
    expect(fetchMod.AUDIT_SQL).not.toContain("user_id");
    expect(fetchMod.MULTI_USER_GUARD_SQL).toContain("count(DISTINCT user_id)");
    expect(fetchMod.MULTI_USER_GUARD_SQL).toContain("resolved_at IS NULL");
  });

  it("多ユーザーガード: DISTINCT user_id >= 2 で run fail(exit 1 相当の reject)", async () => {
    const out = mkdtempSync(join(tmpdir(), "wbs-fetch-"));
    process.env.WBS_DATABASE_URL = "postgres://x";
    process.env.WBS_OUT = out;
    pgMock.query.mockResolvedValueOnce({ rows: [{ count: "2" }] });
    await expect(fetchMod.runFetch()).rejects.toThrow("複数ユーザー");
  });
});

describe("apply — ORG_DIR 封じ込め", () => {
  it("containedPath は ORG_DIR 配下を返し、逸脱は throw する", () => {
    const orgDir = mkdtempSync(join(tmpdir(), "wbs-org-"));
    const ok = applyMod.containedPath(orgDir, ".companies/a/docs/secretary/x-wbs.md");
    expect(ok.startsWith(orgDir)).toBe(true);
    expect(() => applyMod.containedPath(orgDir, "../outside.md")).toThrow("ORG_DIR 外");
    expect(() => applyMod.containedPath(orgDir, "/etc/passwd")).toThrow("ORG_DIR 外");
  });
});

describe("pr — staged 閉包と push 形", () => {
  const P1 = ".companies/a/docs/secretary/x-wbs.md";
  const P2 = ".companies/a/docs/secretary/y-wbs.md";

  it("staged 閉包: 全行 'M' + glob 一致 + verify 済み集合と一致のみ true", () => {
    expect(prMod.isStagedClosureValid([`M\t${P1}`, `M\t${P2}`], [P1, P2])).toBe(true);
    expect(prMod.isStagedClosureValid([`A\t${P1}`], [P1])).toBe(false); // 追加
    expect(prMod.isStagedClosureValid([`D\t${P1}`], [P1])).toBe(false); // 削除
    expect(prMod.isStagedClosureValid([`M\tdocs/other.md`], ["docs/other.md"])).toBe(false); // glob 外
    expect(prMod.isStagedClosureValid([`M\t${P1}`], [P1, P2])).toBe(false); // 集合不足
    expect(prMod.isStagedClosureValid([`M\t${P1}`, `M\t${P2}`], [P1])).toBe(false); // 集合過剰
    expect(prMod.isStagedClosureValid([], [P1])).toBe(false); // 空
  });

  it("push は HEAD:refs/heads/wbs/<date>(+ なし・main 参照なし)・add は `--` 区切り", () => {
    const push = prMod.buildPushArgs("https://example/repo.git", "2026-07-26");
    expect(push[push.length - 1]).toBe("HEAD:refs/heads/wbs/2026-07-26");
    expect(push.join(" ")).not.toContain("+HEAD");
    expect(push.join(" ")).not.toContain("main");
    const add = prMod.buildAddArgs([P1]);
    expect(add).toContain("--");
    expect(add).toContain("core.hooksPath=");
  });

  it("PR 本文は item/file/from→to の一覧 + 機械生成の注意書き", () => {
    const body = prMod.buildPrBody([
      { path: P1, items: [{ item_key: "A-1", from: "todo", to: "done" }] },
    ]);
    expect(body).toContain("| A-1 |");
    expect(body).toContain("todo → done");
    expect(body).toContain("機械生成");
  });
});

describe("mark — pr_ref 更新と不在 superseded", () => {
  it("SQL 契約: pr_ref 更新は pr_ref IS NULL 条件付き / 不在は superseded", () => {
    expect(markMod.MARK_PR_SQL).toContain("SET pr_ref = $1");
    expect(markMod.MARK_PR_SQL).toContain("pr_ref IS NULL");
    expect(markMod.MARK_ABSENT_SQL).toContain("resolution = 'superseded'");
    expect(markMod.MARK_ABSENT_SQL).toContain("resolved_at IS NULL");
  });

  it("PR 失敗時(created=false)は pr_ref を書かない・不在 superseded は実行される", async () => {
    const out = mkdtempSync(join(tmpdir(), "wbs-mark-"));
    writeFileSync(join(out, "pr.json"), JSON.stringify({ created: false }));
    writeFileSync(
      join(out, "applied.json"),
      JSON.stringify([{ path: ".companies/a/docs/secretary/x-wbs.md", items: [{ item_key: "A-1", from: "todo", to: "done" }] }])
    );
    writeFileSync(
      join(out, "absent.json"),
      JSON.stringify([{ source: "cc-sier-organization", file_path: ".companies/a/docs/secretary/y-wbs.md", item_key: "B-9" }])
    );
    process.env.WBS_DATABASE_URL = "postgres://x";
    process.env.WBS_OUT = out;
    pgMock.query.mockResolvedValue({ rowCount: 1, rows: [] });
    await markMod.runMark();
    // 呼ばれた SQL は不在 superseded の1本のみ(pr_ref 更新は無し)
    const sqls = pgMock.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("SET pr_ref"))).toBe(false);
    expect(sqls.some((s) => s.includes("superseded"))).toBe(true);
  });
});
