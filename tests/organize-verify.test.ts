// 対象設計: docs/design/detail/organize-loop.md §2.2 / §3(tests/organize-verify.test.ts)
// verify.ts の純関数群を実 DB・実ネットワークなしで検証する。
import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  DENY_WORDS,
  checkFilename,
  checkFrontmatter,
  checkH1,
  checkOrg,
  checkPartition,
  checkRunMeta,
  checkUniquePaths,
  isAllowedDest,
  isAllowedSource,
  type ManifestEntry,
  type RunMeta,
} from "../scripts/organize/verify";

const RUN: RunMeta = { date: "2026-07-20", slot: "morning", allowed_orgs: ["domain-tech-collection"] };

const CAPTURE_ID_1 = "11111111-1111-1111-1111-111111111111";
const CAPTURE_ID_2 = "22222222-2222-2222-2222-222222222222";

function buildEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    repo: "ai-war-room",
    path: "docs/logs/2026-07-20-morning.md",
    file: "out/md/2026-07-20-morning.md",
    capture_ids: [CAPTURE_ID_1],
    ...overrides,
  };
}

function buildMd(overrides: Partial<Record<string, unknown>> = {}): string {
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
  return `---\n${lines.join("\n")}\n---\n\n# 2026-07-20 morning 整理ログ\n本文`;
}

describe("ALLOWED / DENY_WORDS", () => {
  it("ALLOWED は ai-war-room・cc-sier-organization の2 repo を定義する", () => {
    expect(Object.keys(ALLOWED).sort()).toEqual(["ai-war-room", "cc-sier-organization"]);
  });

  it("DENY_WORDS に既知の機微語幹が含まれる", () => {
    for (const w of ["profile", "personality", "minefield", "memory", "agents", "claude"]) {
      expect(DENY_WORDS).toContain(w);
    }
  });
});

describe("isAllowedDest", () => {
  it("許可4パスは ok", () => {
    expect(isAllowedDest("ai-war-room", "docs/logs/2026-07-20-morning.md")).toBe(true);
    expect(isAllowedDest("ai-war-room", "docs/decisions/2026-07-20-morning-d01.md")).toBe(true);
    expect(isAllowedDest("cc-sier-organization", ".companies/demo-org/docs/decisions/2026-07-20-morning-d01.md")).toBe(
      true
    );
    expect(isAllowedDest("cc-sier-organization", ".companies/demo-org/docs/todos/2026-07-20-morning-t01.md")).toBe(
      true
    );
  });

  it("../・絶対パス・\\ は fail", () => {
    expect(isAllowedDest("ai-war-room", "docs/logs/../../../etc/passwd")).toBe(false);
    expect(isAllowedDest("ai-war-room", "/etc/passwd")).toBe(false);
    expect(isAllowedDest("ai-war-room", "docs\\logs\\x.md")).toBe(false);
  });

  it("許可外 repo / パスは fail", () => {
    expect(isAllowedDest("unknown-repo", "docs/logs/2026-07-20-morning.md")).toBe(false);
    expect(isAllowedDest("ai-war-room", "docs/todos/2026-07-20-morning-t01.md")).toBe(false);
  });

  it("denylist 語入り basename は fail", () => {
    expect(isAllowedDest("ai-war-room", "docs/logs/profile-2026-07-20.md")).toBe(false);
  });
});

describe("isAllowedSource", () => {
  it("out/md/ 配下は ok", () => {
    expect(isAllowedSource("out/md/2026-07-20-morning.md")).toBe(true);
  });

  it("域外は fail", () => {
    expect(isAllowedSource("out/other/x.md")).toBe(false);
    expect(isAllowedSource("../secret.md")).toBe(false);
  });
});

describe("checkFrontmatter", () => {
  it("正常系は違反なし", () => {
    const entry = buildEntry();
    expect(checkFrontmatter(buildMd(), entry, RUN)).toEqual([]);
  });

  it("7キー欠落を検出する", () => {
    const md = "---\ndate: \"2026-07-20\"\n---\n\n# H1\n本文";
    const violations = checkFrontmatter(md, buildEntry(), RUN);
    expect(violations.some((v) => v.includes("missing key"))).toBe(true);
  });

  it("source 不正を検出する", () => {
    const md = buildMd({ source: "not-decision-cockpit" });
    const violations = checkFrontmatter(md, buildEntry(), RUN);
    expect(violations).toContain("frontmatter source invalid");
  });

  it("date とファイル名日付の不一致(run.date 不一致)を検出する", () => {
    const md = buildMd({ date: "2026-01-01" });
    const violations = checkFrontmatter(md, buildEntry(), RUN);
    expect(violations).toContain("frontmatter date mismatch");
  });

  it("capture_ids が entry と集合不一致なら検出する", () => {
    const md = buildMd({ capture_ids: [CAPTURE_ID_2] });
    const violations = checkFrontmatter(md, buildEntry({ capture_ids: [CAPTURE_ID_1] }), RUN);
    expect(violations).toContain("frontmatter capture_ids mismatch with manifest");
  });

  it("kind の語彙メンバシップ検査(語彙外は invalid)", () => {
    const md = buildMd({ kind: "not-a-kind" });
    const violations = checkFrontmatter(md, buildEntry(), RUN);
    expect(violations).toContain("frontmatter kind invalid");
  });
});

describe("checkUniquePaths", () => {
  it("同一 (repo,path) の重複は fail", () => {
    const entries = [buildEntry(), buildEntry()];
    const violations = checkUniquePaths(entries);
    expect(violations.some((v) => v.includes("duplicate path"))).toBe(true);
  });

  it("logs が repo ごと2件以上は fail", () => {
    const entries = [
      buildEntry({ path: "docs/logs/2026-07-20-morning.md" }),
      buildEntry({ path: "docs/logs/2026-07-20-morning-2.md" }),
    ];
    const violations = checkUniquePaths(entries);
    expect(violations.some((v) => v.includes("multiple logs files"))).toBe(true);
  });

  it("正常系は違反なし", () => {
    expect(checkUniquePaths([buildEntry()])).toEqual([]);
  });
});

describe("checkOrg", () => {
  it("allowed_orgs 内は ok", () => {
    expect(
      checkOrg(".companies/domain-tech-collection/docs/decisions/2026-07-20-morning-d01.md", RUN)
    ).toBe(true);
  });

  it("allowed_orgs 外は fail", () => {
    expect(checkOrg(".companies/unknown-org/docs/decisions/2026-07-20-morning-d01.md", RUN)).toBe(false);
  });

  it("org 概念のない repo(セグメントなし)は true", () => {
    expect(checkOrg("docs/logs/2026-07-20-morning.md", RUN)).toBe(true);
  });
});

describe("checkRunMeta", () => {
  it("正常系は違反なし", () => {
    expect(checkRunMeta(RUN)).toEqual([]);
  });

  it("date 書式不正を検出する", () => {
    expect(checkRunMeta({ ...RUN, date: "2026/07/20" })).toContain("run.date format invalid");
  });

  it("slot 書式不正を検出する", () => {
    expect(checkRunMeta({ ...RUN, slot: "Morning!" })).toContain("run.slot format invalid");
  });

  it("allowed_orgs 非空を要求する", () => {
    expect(checkRunMeta({ ...RUN, allowed_orgs: [] })).toContain("run.allowed_orgs empty");
  });
});

describe("checkH1", () => {
  it("H1 あり(frontmatter 直後)は ok", () => {
    expect(checkH1(buildMd())).toBe(true);
  });

  it("`##` 始まりは fail", () => {
    const md = "---\ndate: \"2026-07-20\"\n---\n\n## 見出し\n本文";
    expect(checkH1(md)).toBe(false);
  });

  it("frontmatter 直後の H1 を剥離後基準で判定する(空行を挟んでも ok)", () => {
    const md = "---\ndate: \"2026-07-20\"\n---\n\n\n# H1\n本文";
    expect(checkH1(md)).toBe(true);
  });
});

describe("checkPartition", () => {
  it("欠落を検出する", () => {
    const result = checkPartition([CAPTURE_ID_1, CAPTURE_ID_2], [buildEntry({ capture_ids: [CAPTURE_ID_1] })]);
    expect(result.missing).toEqual([CAPTURE_ID_2]);
  });

  it("捏造(unknown)を検出する", () => {
    const result = checkPartition([CAPTURE_ID_1], [buildEntry({ capture_ids: [CAPTURE_ID_1, CAPTURE_ID_2] })]);
    expect(result.unknown).toEqual([CAPTURE_ID_2]);
  });

  it("重複を検出する", () => {
    const result = checkPartition(
      [CAPTURE_ID_1],
      [buildEntry({ capture_ids: [CAPTURE_ID_1] }), buildEntry({ path: "docs/logs/other.md", capture_ids: [CAPTURE_ID_1] })]
    );
    expect(result.dup).toEqual([CAPTURE_ID_1]);
  });

  it("正常系は全て空", () => {
    const result = checkPartition([CAPTURE_ID_1], [buildEntry({ capture_ids: [CAPTURE_ID_1] })]);
    expect(result).toEqual({ missing: [], unknown: [], dup: [] });
  });
});

describe("checkFilename", () => {
  it("logs = <date>-<slot>.md", () => {
    expect(checkFilename("ai-war-room", "docs/logs/2026-07-20-morning.md", RUN)).toBe(true);
    expect(checkFilename("ai-war-room", "docs/logs/2026-07-20-morning-x.md", RUN)).toBe(false);
  });

  it("decisions = <date>-<slot>-d<nn>.md", () => {
    expect(checkFilename("ai-war-room", "docs/decisions/2026-07-20-morning-d01.md", RUN)).toBe(true);
    expect(checkFilename("ai-war-room", "docs/decisions/2026-07-20-morning.md", RUN)).toBe(false);
  });

  it("todos = <date>-<slot>-t<nn>.md", () => {
    expect(
      checkFilename("cc-sier-organization", ".companies/demo-org/docs/todos/2026-07-20-morning-t01.md", RUN)
    ).toBe(true);
  });
});
