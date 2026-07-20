// 対象設計: docs/design/detail/organize-loop.md §2.3 / §3(tests/organize-pr.test.ts)
// pr.ts の git 引数生成(純関数)+ 実行順序をモック child_process/fs で検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("node:fs", () => ({ readFileSync: mocks.readFileSync, writeFileSync: mocks.writeFileSync }));

const {
  buildAddArgs,
  buildDiffNameStatusArgs,
  buildCommitArgs,
  buildRemoteUrl,
  buildPushArgs,
  parseNameStatusLines,
  isAllAdded,
  isValidSlot,
  buildPrTitle,
  buildPrBody,
  runPr,
} = await import("../scripts/organize/pr");

const ORIGINAL_ENV = { ...process.env };

describe("pr の git 引数生成(純関数)", () => {
  it("add が [\"add\",\"--\",...paths] 形(-A/. を含まない)", () => {
    const args = buildAddArgs(["docs/logs/x.md", "docs/decisions/y.md"]);
    expect(args).toEqual(["-c", "core.hooksPath=", "add", "--", "docs/logs/x.md", "docs/decisions/y.md"]);
    expect(args).not.toContain("-A");
    expect(args).not.toContain("--all");
    expect(args).not.toContain(".");
  });

  it("core.hooksPath= を含む(add・commit 双方)", () => {
    expect(buildAddArgs(["a"])).toContain("core.hooksPath=");
    expect(buildCommitArgs("2026-07-20", "morning")).toContain("core.hooksPath=");
  });

  it("push 引数が HEAD:refs/heads/organize/... で force フラグを含まない・main を含まない", () => {
    const url = buildRemoteUrl("ai-war-room", "token-x");
    const args = buildPushArgs(url, "2026-07-20", "morning");
    expect(args).toEqual(["push", url, "HEAD:refs/heads/organize/2026-07-20-morning"]);
    expect(args.join(" ")).not.toMatch(/--force|force-with-lease/);
    expect(args.join(" ")).not.toMatch(/refs\/heads\/main|HEAD:main/);
  });

  it("slot 不正で拒否", () => {
    expect(isValidSlot("morning")).toBe(true);
    expect(isValidSlot("Morning!")).toBe(false);
    expect(isValidSlot("../etc")).toBe(false);
  });

  it("--name-status の出力を解析し全行 A 始まりを判定する", () => {
    expect(parseNameStatusLines("A\tdocs/logs/x.md\nA\tdocs/decisions/y.md")).toEqual([
      "A\tdocs/logs/x.md",
      "A\tdocs/decisions/y.md",
    ]);
    expect(isAllAdded(["A\tx.md", "A\ty.md"])).toBe(true);
    expect(isAllAdded(["A\tx.md", "M\ty.md"])).toBe(false);
    expect(isAllAdded([])).toBe(false);
  });

  it("PR タイトル・本文の固定テンプレート", () => {
    expect(buildPrTitle("2026-07-20", "morning")).toBe("organize: 2026-07-20 morning");
    expect(buildPrBody(["docs/logs/x.md"])).toContain("件数: 1");
    expect(buildPrBody(["docs/logs/x.md"])).toContain("docs/logs/x.md");
  });
});

describe("runPr: 実行順序と exit 相当", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, ORGANIZE_OUT: "/out", ORGANIZE_STATE: "/state", WARROOM_PAT: "warroom-token" };
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) return JSON.stringify({ date: "2026-07-20", slot: "morning", allowed_orgs: ["x"] });
      if (path.endsWith("files.json")) {
        return JSON.stringify([
          { repo: "ai-war-room", path: "docs/logs/2026-07-20-morning.md", file: "out/md/a.md", capture_ids: ["id-1"] },
        ]);
      }
      throw new Error(`unexpected read: ${path}`);
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("'--name-status の順序'(add の後・commit の前に name-status を実行する)", async () => {
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("--name-status")) return { status: 0, stdout: "A\tdocs/logs/2026-07-20-morning.md\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });

    await runPr();

    const gitCalls = mocks.spawnSync.mock.calls.filter((c) => c[0] === "git");
    const addIndex = gitCalls.findIndex((c) => (c[1] as string[]).includes("add"));
    const nameStatusIndex = gitCalls.findIndex((c) => (c[1] as string[]).includes("--name-status"));
    const commitIndex = gitCalls.findIndex((c) => (c[1] as string[]).includes("commit"));

    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(nameStatusIndex).toBeGreaterThan(addIndex);
    expect(commitIndex).toBeGreaterThan(nameStatusIndex);
  });

  it("出力が A 以外を含むとき停止する(commit を呼ばない)", async () => {
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("--name-status")) return { status: 0, stdout: "M\tdocs/logs/2026-07-20-morning.md\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });

    await expect(runPr()).rejects.toThrow();

    const gitCalls = mocks.spawnSync.mock.calls.filter((c) => c[0] === "git");
    expect(gitCalls.some((c) => (c[1] as string[]).includes("commit"))).toBe(false);
  });

  it("slot 不正(run.json)で拒否", async () => {
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("run.json")) return JSON.stringify({ date: "2026-07-20", slot: "Bad Slot!", allowed_orgs: ["x"] });
      if (path.endsWith("files.json")) return JSON.stringify([]);
      throw new Error(`unexpected read: ${path}`);
    });
    await expect(runPr()).rejects.toThrow();
  });
});
