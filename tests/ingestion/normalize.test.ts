// 対象設計: docs/design/detail/ingestion-foundation.md §2.2(共通前処理)/ §3(tests/ingestion/normalize.test.ts)
//          docs/design/basic/ingestion-foundation.md §2.1(denylist)/ §3.1(サニタイズ・org 突合)
import { describe, expect, it } from "vitest";
import {
  applyTags,
  errorRecord,
  isDenied,
  orgFromPath,
  orgMismatch,
  sanitizeAbsPaths,
} from "../../lib/ingestion/normalize";
import type { SourceFile } from "../../lib/ingestion/parsers/types";

describe("orgFromPath", () => {
  it(".companies/<org>/ セグメントを抽出する", () => {
    expect(orgFromPath(".companies/demo-org/.task-log/x.md")).toBe("demo-org");
    expect(orgFromPath(".companies/another-org/masters/roles.md")).toBe("another-org");
  });

  it("該当セグメントが無ければ null", () => {
    expect(orgFromPath("docs/decisions/2026-06-01-x.md")).toBeNull();
  });
});

describe("orgMismatch", () => {
  it("両方非 null かつ不一致のときのみ true", () => {
    expect(orgMismatch("a", "b")).toBe(true);
    expect(orgMismatch("a", "a")).toBe(false);
    expect(orgMismatch(null, "a")).toBe(false);
    expect(orgMismatch("a", null)).toBe(false);
    expect(orgMismatch(null, null)).toBe(false);
  });
});

describe("isDenied(denylist 6パターン全列挙)", () => {
  const cases: [string, boolean][] = [
    [".companies/demo-org/docs/secretary/personality-profile-demo.md", true],
    [".companies/demo-org/docs/secretary/profile.md", true],
    [".companies/demo-org/docs/secretary/personality-notes.md", true],
    [".companies/demo-org/docs/secretary/minefield.md", true],
    [".companies/demo-org/.interaction-log/2026-06-01-x.md", true],
    [".companies/demo-org/.active", true],
    [".companies/demo-org/agent-memory/notes.md", true],
    [".companies/demo-org/.task-log/20260601-090000-x.md", false],
    [".companies/demo-org/masters/roles.md", false],
  ];

  for (const [path, expected] of cases) {
    it(`${path} → ${expected}`, () => {
      expect(isDenied(path)).toBe(expected);
    });
  }
});

describe("sanitizeAbsPaths", () => {
  it("Unix 絶対パスをファイル名のみに切り詰める", () => {
    expect(sanitizeAbsPaths("/home/x/repo/src/a.ts")).toBe("a.ts");
  });

  it("/Users/ 配下の絶対パスも切り詰める", () => {
    expect(sanitizeAbsPaths("target: /Users/demo/repo/docs/b.md")).toBe("target: b.md");
  });

  it("Windows 形式の絶対パスも切り詰める", () => {
    expect(sanitizeAbsPaths("C:\\Users\\demo\\repo\\c.md")).toBe("c.md");
  });

  it("絶対パスを含まないテキストは変化しない", () => {
    expect(sanitizeAbsPaths("docs/decisions/2026-06-01-x.md")).toBe("docs/decisions/2026-06-01-x.md");
  });

  it("文中に複数回出現しても全て切り詰める", () => {
    const text = "from /home/a/x.md to /Users/b/y.md";
    expect(sanitizeAbsPaths(text)).toBe("from x.md to y.md");
  });
});

describe("applyTags(タグ包含マッチ)", () => {
  const vocab = [
    { synonym: "aws", canonical: "aws" },
    { synonym: "小売ドメイン室", canonical: "小売ドメイン室" },
  ];

  it("テキストに含まれる語彙の canonical を返す", () => {
    const tags = applyTags("AWS移行の技術スタックを調査する", vocab);
    expect(tags).toContain("aws");
  });

  it("大文字小文字を無視してマッチする", () => {
    const tags = applyTags("aws 移行の話", [{ synonym: "aws", canonical: "aws" }]);
    expect(tags).toEqual(["aws"]);
  });

  it("複数語彙にマッチしても重複なく返す", () => {
    const tags = applyTags("AWSと小売ドメイン室が連携する", vocab);
    expect(tags.sort()).toEqual(["aws", "小売ドメイン室"].sort());
  });

  it("マッチしない語彙は含まれない", () => {
    const tags = applyTags("無関係なテキスト", vocab);
    expect(tags).toEqual([]);
  });
});

describe("errorRecord", () => {
  const meta = { source: "cc-sier-organization", commit: "abc123", org: "demo-org" };

  it("body はサニタイズ→切り詰め(先頭2000字)の順で作られる", () => {
    const longText = "/home/x/very/long/path.md ".repeat(200);
    const file: SourceFile = { path: ".companies/demo-org/.task-log/x.md", content: longText };
    const record = errorRecord(file, meta, "test reason", "task");

    expect(record.status).toBe("error");
    expect(record.type).toBe("task");
    expect(record.occurred_at).toBeNull();
    expect(record.body).not.toContain("/home/");
    expect(record.body!.length).toBeLessThanOrEqual(2000);
    expect(record.body).toBe(sanitizeAbsPaths(longText).slice(0, 2000));
  });

  it("item_key / raw_ref を上書きできる", () => {
    const file: SourceFile = { path: ".companies/demo-org/.case-bank/index.json", content: "{}" };
    const record = errorRecord(file, meta, "case error", "score", {
      itemKey: "case-1",
      rawRef: "path#case-1",
    });
    expect(record.item_key).toBe("case-1");
    expect(record.raw_ref).toBe("path#case-1");
  });
});
