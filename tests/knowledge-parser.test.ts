// 対象設計: docs/design/detail/org-docs-ingestion.md §2.2(parseKnowledge)/ §2.3(parseDecision org)
//          / §3(tests/knowledge-parser.test.ts)
import { describe, expect, it } from "vitest";
import { parseKnowledge } from "../lib/ingestion/parsers/knowledge";
import { parseDecision } from "../lib/ingestion/parsers/decision";
import type { SourceFile } from "../lib/ingestion/parsers/types";

const META = { source: "cc-sier-organization", commit: "sha1", org: "demo-org" };

describe("parseKnowledge — type / item_key / title", () => {
  it("1チャンク=1レコード・item_key は c0 起点連番・title は文書タイトル + 見出しパス", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/demo.md",
      content: ["# 調査メモ", "## 背景", "本文1", "", "## 詳細", "本文2"].join("\n"),
    };
    const records = parseKnowledge(file, META);

    expect(records).toHaveLength(2);
    expect(records.every((r) => r.type === "knowledge" && r.status === "ok")).toBe(true);
    expect(records.map((r) => r.item_key)).toEqual(["c0", "c1"]);
    expect(records.every((r) => /^c\d+$/.test(r.item_key))).toBe(true);
    expect(records[0]!.title).toBe("調査メモ › 背景");
    expect(records[1]!.title).toBe("調査メモ › 詳細");
    expect(records[0]!.raw_ref).toBe(".companies/demo-org/docs/research/demo.md#c0");
  });

  it("見出しパスが空(前文)の場合は文書タイトルのみが title になる", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/demo2.md",
      content: ["# 調査メモ2", "前文の本文。", "", "## 詳細", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records[0]!.title).toBe("調査メモ2");
    expect(records[1]!.title).toBe("調査メモ2 › 詳細");
  });

  it("H1 が無い場合は文書タイトル = ファイル名(拡張子除去)", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/no-h1.md",
      content: ["## 詳細", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records).toHaveLength(1);
    expect(records[0]!.title).toBe("no-h1 › 詳細");
  });
});

describe("parseKnowledge — occurred_at 解決順序(frontmatter date → ファイル名 → null)", () => {
  it("frontmatter の date:(YYYY-MM-DD)を最優先する", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/secretary/learning-notes/note.md",
      content: ["---", "date: 2026-07-05", "---", "# ノート", "## A", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records[0]!.occurred_at?.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("frontmatter が無ければファイル名 YYYY-MM-DD.md にフォールバックする", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/daily-digest/2026-07-06.md",
      content: ["# ダイジェスト", "## A", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records[0]!.occurred_at?.toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });

  it("どちらも無ければ null(status='ok' のまま — knowledge の契約改訂)", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/no-date.md",
      content: ["# 調査", "## A", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records[0]!.occurred_at).toBeNull();
    expect(records[0]!.status).toBe("ok");
  });

  it("frontmatter の date が YYYY-MM-DD 形式以外なら受理せず、フォールバックが働く", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/bad-date.md",
      content: ["---", "date: 2026-07-05T09:00:00", "---", "# 調査", "## A", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records[0]!.occurred_at).toBeNull();
  });
});

describe("parseKnowledge — sanitizeAbsPaths 継承(title・body とも)", () => {
  it("title・body に含まれる絶対パスがサニタイズされる", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/abs.md",
      content: ["# /home/user/調査メモ", "## 詳細", "参照: /home/user/repo/notes.md"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records[0]!.title).not.toContain("/home/");
    expect(records[0]!.title).toBe("調査メモ › 詳細");
    expect(records[0]!.body).not.toContain("/home/");
    expect(records[0]!.body).toBe("参照: notes.md");
  });
});

describe("parseKnowledge — tags は空配列(run-sync が applyTags で付与)", () => {
  it("パーサ出力の tags は常に空配列", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/tags.md",
      content: ["# タイトル", "## A", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records.every((r) => r.tags.length === 0)).toBe(true);
  });
});

describe("parseKnowledge — org = meta.org", () => {
  it("org はパス由来の meta.org をそのまま持つ", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/research/org.md",
      content: ["# タイトル", "## A", "本文"].join("\n"),
    };
    const records = parseKnowledge(file, META);
    expect(records.every((r) => r.org === "demo-org")).toBe(true);
  });
});

describe("parseDecision — org = meta.org(回帰)", () => {
  it("cc-sier-organization 相当の meta では org がパス由来の値になる", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/decisions/2026-07-01-x.md",
      content: "# 2026-07-01 - タイトル\n\n本文\n",
    };
    const record = parseDecision(file, { source: "cc-sier-organization", commit: "sha1", org: "demo-org" })[0]!;
    expect(record.org).toBe("demo-org");
  });

  it("ai-war-room 相当の meta(org: null)では org は null のまま(既存契約は無傷)", () => {
    const file: SourceFile = {
      path: "docs/decisions/2026-07-01-x.md",
      content: "# 2026-07-01 - タイトル\n\n本文\n",
    };
    const record = parseDecision(file, { source: "ai-war-room", commit: "sha1", org: null })[0]!;
    expect(record.org).toBeNull();
  });
});
