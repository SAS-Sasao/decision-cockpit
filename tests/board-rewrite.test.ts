// 対象設計: docs/design/detail/wbs-loop.md §2.2 / §3(tests/board-rewrite.test.ts — WL-1 分)
//
// locateAdoptedRows の同値性(parseBoard と同数・同順・同 key/state)と tokenStart の実バイト検証。
// WL-2 で rewriteBoardState のケース(バイト精密置換・changed=false 2系統・先勝ち)を追記する。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locateAdoptedRows, parseBoard } from "../lib/ingestion/parsers/board";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SECRETARY_DIR = join(
  REPO_ROOT,
  "fixtures",
  "cc-sier-organization",
  ".companies",
  "demo-org",
  "docs",
  "secretary"
);

const FIXTURES = ["demo-plan-wbs.md", "demo-messy-wbs.md"] as const;

const TOKEN: Record<"todo" | "doing" | "done", string> = {
  todo: "[ ]",
  doing: "[~]",
  done: "[x]",
};

function loadFixture(name: string): string {
  return readFileSync(join(SECRETARY_DIR, name), "utf8");
}

describe("locateAdoptedRows — parseBoard との同値性(両 fixture)", () => {
  for (const name of FIXTURES) {
    it(`${name}: items と同数・同順・同 itemKey/state`, () => {
      const content = loadFixture(name);
      const items = parseBoard({ path: name, content }).items;
      const rows = locateAdoptedRows(content);
      expect(rows.length).toBe(items.length);
      expect(rows.map((r) => `${r.itemKey}:${r.state}`)).toEqual(
        items.map((i) => `${i.itemKey}:${i.state}`)
      );
    });
  }
});

describe("locateAdoptedRows — tokenStart の実バイト検証", () => {
  for (const name of FIXTURES) {
    it(`${name}: 全採用行で content[tokenStart..+3] が現トークンと一致`, () => {
      const content = loadFixture(name);
      for (const row of locateAdoptedRows(content)) {
        expect(content.slice(row.tokenStart, row.tokenStart + 3)).toBe(TOKEN[row.state]);
      }
    });
  }

  it("不整形(messy)は行頭 | 無し・インデント・行末 | 無し・CRLF の採用行を含む(反例の実在)", () => {
    const content = loadFixture("demo-messy-wbs.md");
    const keys = locateAdoptedRows(content).map((r) => r.itemKey);
    // M1-2 = インデント行 / M1-3 = 行頭 | 無し / M1-4 = 行末 | 無し(ステータス末尾セル)/ B-* = CRLF 部
    expect(keys).toContain("M1-2");
    expect(keys).toContain("M1-3");
    expect(keys).toContain("M1-4");
    expect(keys).toContain("B-1");
    expect(content).toContain("\r\n"); // CRLF が実在すること(fixture の性質固定)
  });

  it("重複 ID は先勝ちの1行のみ採用(2行目の位置を指さない)", () => {
    const content = loadFixture("demo-messy-wbs.md");
    const rows = locateAdoptedRows(content).filter((r) => r.itemKey === "M1-1");
    expect(rows.length).toBe(1);
    // 先勝ち行(最初の M1-1)は重複行(「重複IDの2行目」)より前に現れる
    expect(rows[0]!.tokenStart).toBeLessThan(content.indexOf("重複IDの2行目"));
  });
});
