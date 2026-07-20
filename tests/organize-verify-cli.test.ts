// 対象設計: docs/design/detail/organize-loop.md §2.2 / §3(tests/organize-verify-cli.test.ts — R2 G-2)
// verify CLI の配線契約をモック fs で検証する(実 DB・実ネットワークなし)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({ readFileSync: mocks.readFileSync }));

const { runVerifyCli } = await import("../scripts/organize/verify");

const ORIGINAL_ENV = { ...process.env };

const CAPTURE_ID_1 = "11111111-1111-1111-1111-111111111111";

const RUN = { date: "2026-07-20", slot: "morning", allowed_orgs: ["domain-tech-collection"] };

function frontmatter(overrides: Partial<Record<string, unknown>> = {}): string {
  const fm = {
    date: RUN.date,
    slot: RUN.slot,
    source: "decision-cockpit",
    capture_ids: [CAPTURE_ID_1],
    kind: "mixed",
    status: "curated",
    tags: [] as string[],
    ...overrides,
  };
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function validMd(): string {
  return `${frontmatter()}\n# 2026-07-20 morning 整理ログ\n本文`;
}

type FsMap = Record<string, string>;

function setupFs(files: FsMap): void {
  mocks.readFileSync.mockImplementation((path: string) => {
    if (Object.prototype.hasOwnProperty.call(files, path)) {
      return files[path];
    }
    throw new Error(`ENOENT: no such file: ${path}`);
  });
}

const VALID_ENTRY = {
  repo: "ai-war-room",
  path: "docs/logs/2026-07-20-morning.md",
  file: "out/md/2026-07-20-morning.md",
  capture_ids: [CAPTURE_ID_1],
};

function baseFiles(overrides: Partial<FsMap> = {}, entries = [VALID_ENTRY]): FsMap {
  return {
    "/state/ids.json": JSON.stringify([CAPTURE_ID_1]),
    "/state/run.json": JSON.stringify(RUN),
    "/out/files.json": JSON.stringify(entries),
    "/out/out/md/2026-07-20-morning.md": validMd(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, ORGANIZE_OUT: "/out", ORGANIZE_STATE: "/state" };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("verify CLI", () => {
  it("正常系: 全検査通過で exit 0", () => {
    setupFs(baseFiles());
    expect(runVerifyCli()).toBe(0);
  });

  it("'H1 なし' → exit 1", () => {
    const badMd = `${frontmatter()}\n## 見出しのみ(H1 でない)\n本文`;
    setupFs(baseFiles({ "/out/out/md/2026-07-20-morning.md": badMd }));
    expect(runVerifyCli()).toBe(1);
  });

  it("許可外パス → exit 1", () => {
    const entry = { ...VALID_ENTRY, path: "docs/todos/2026-07-20-morning-t01.md" };
    setupFs(baseFiles({}, [entry]));
    expect(runVerifyCli()).toBe(1);
  });

  it("ソース域外 → exit 1", () => {
    const entry = { ...VALID_ENTRY, file: "elsewhere/2026-07-20-morning.md" };
    setupFs(baseFiles({}, [entry]));
    expect(runVerifyCli()).toBe(1);
  });

  it("'run.json 不一致'(ファイル名の date/slot が run と違う) → exit 1", () => {
    const entry = { ...VALID_ENTRY, path: "docs/logs/2026-01-01-evening.md" };
    setupFs(
      baseFiles({ "/out/out/md/2026-07-20-morning.md": validMd() }, [
        { ...entry, file: "out/md/2026-07-20-morning.md" },
      ])
    );
    expect(runVerifyCli()).toBe(1);
  });

  it("'allowed_orgs 外' → exit 1", () => {
    const entry = {
      repo: "cc-sier-organization",
      path: ".companies/unknown-org/docs/decisions/2026-07-20-morning-d01.md",
      file: "out/md/2026-07-20-morning-d01.md",
      capture_ids: [CAPTURE_ID_1],
    };
    setupFs(baseFiles({ "/out/out/md/2026-07-20-morning-d01.md": validMd() }, [entry]));
    expect(runVerifyCli()).toBe(1);
  });

  it("'ids.json 基準'(食い違う rows.json 相当があっても ids.json だけで判定する)", () => {
    // verify は rows.json を一切読まない(読もうとした場合は throw して検知する)。
    const files = baseFiles();
    files["/out/rows.json"] = "THIS_SHOULD_NEVER_BE_READ";
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path === "/out/rows.json") {
        throw new Error("verify must not read rows.json");
      }
      if (Object.prototype.hasOwnProperty.call(files, path)) {
        return files[path];
      }
      throw new Error(`ENOENT: no such file: ${path}`);
    });
    expect(runVerifyCli()).toBe(0);
  });

  it("'重複 path'(同一 (repo,path) が manifest に2件) → exit 1", () => {
    setupFs(baseFiles({}, [VALID_ENTRY, VALID_ENTRY]));
    expect(runVerifyCli()).toBe(1);
  });

  it("'capture_ids 不一致'(frontmatter と manifest の集合が違う) → exit 1", () => {
    const otherId = "22222222-2222-2222-2222-222222222222";
    const md = `${frontmatter({ capture_ids: [otherId] })}\n# 2026-07-20 morning 整理ログ\n本文`;
    setupFs(baseFiles({ "/state/ids.json": JSON.stringify([CAPTURE_ID_1, otherId]), "/out/out/md/2026-07-20-morning.md": md }));
    expect(runVerifyCli()).toBe(1);
  });

  it("連番形式外(decisions のファイル名が -d<nn> でない) → exit 1", () => {
    const entry = {
      repo: "ai-war-room",
      path: "docs/decisions/2026-07-20-morning.md",
      file: "out/md/2026-07-20-morning.md",
      capture_ids: [CAPTURE_ID_1],
    };
    setupFs(baseFiles({}, [entry]));
    expect(runVerifyCli()).toBe(1);
  });

  it("ORGANIZE_OUT 未設定なら throw する", () => {
    delete process.env.ORGANIZE_OUT;
    expect(() => runVerifyCli()).toThrow();
  });
});
