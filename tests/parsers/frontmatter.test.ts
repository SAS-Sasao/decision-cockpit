// 対象設計: docs/design/detail/organize-loop.md §2.4 / §3(tests/parsers/frontmatter.test.ts)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "../../lib/ingestion/parsers/frontmatter";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SOURCE_PATH = join(REPO_ROOT, "lib", "ingestion", "parsers", "frontmatter.ts");

describe("stripFrontmatter", () => {
  it("剥離: frontmatter を除去し本文のみ返す", () => {
    const content = "---\ndate: 2026-07-20\nslot: morning\n---\n# H1\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\n本文");
  });

  it("空行スキップ: 閉じ `---` の後の空行1つを読み飛ばす", () => {
    const content = "---\ndate: 2026-07-20\n---\n\n# H1\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\n本文");
  });

  it("空行スキップ: 空白のみの行も読み飛ばす", () => {
    const content = "---\ndate: 2026-07-20\n---\n   \n# H1\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\n本文");
  });

  it("空行スキップ: 複数の空行も読み飛ばす", () => {
    const content = "---\ndate: 2026-07-20\n---\n\n\n# H1\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\n本文");
  });

  it("CRLF: 改行が \\r\\n でも剥離できる", () => {
    const content = "---\r\ndate: 2026-07-20\r\n---\r\n\r\n# H1\r\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\r\n本文");
  });

  it("閉じ `---` が無い場合は原文のまま(非剥離)", () => {
    const content = "---\ndate: 2026-07-20\n本文のみ";
    expect(stripFrontmatter(content)).toBe(content);
  });

  it("frontmatter なし(1行目が `---` でない)は原文のまま", () => {
    const content = "# H1\n本文";
    expect(stripFrontmatter(content)).toBe(content);
  });

  it("中身を解釈しない: frontmatter 内が不正な YAML でも剥離のみ行う", () => {
    const content = "---\n: : invalid yaml :::\n---\n\n# H1\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\n本文");
  });

  it("閉じ直後に空行なしで本文が続く場合もそのまま本文を返す", () => {
    const content = "---\ndate: 2026-07-20\n---\n# H1\n本文";
    expect(stripFrontmatter(content)).toBe("# H1\n本文");
  });

  it("依存ゼロの純モジュールであること(import 文ゼロ)", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const importLines = source.split(/\r?\n/).filter((line) => line.startsWith("import"));
    expect(importLines).toHaveLength(0);
  });
});
