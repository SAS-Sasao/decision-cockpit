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
// messy fixture は FixtureSource の走査対象外(fixtures/parser-samples/)に置く —
// board-sync 統合テストの凍結期待値(files/items/skippedRows)を変えないため(WL-1 実装中の発見)。
const PARSER_SAMPLES_DIR = join(REPO_ROOT, "fixtures", "parser-samples");

const FIXTURES = ["demo-plan-wbs.md", "demo-messy-wbs.md"] as const;

const TOKEN: Record<"todo" | "doing" | "done", string> = {
  todo: "[ ]",
  doing: "[~]",
  done: "[x]",
};

function loadFixture(name: string): string {
  const dir = name === "demo-messy-wbs.md" ? PARSER_SAMPLES_DIR : SECRETARY_DIR;
  return readFileSync(join(dir, name), "utf8");
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

// ---------------------------------------------------------------------------
// WL-2 分の追記(wbs-loop 詳細 §3 — rewriteBoardState のバイト精密性)
// ---------------------------------------------------------------------------
const { rewriteBoardState } = await import("../lib/ingestion/parsers/board-rewrite");

describe("rewriteBoardState — バイト精密置換(WL-2)", () => {
  it("対象行のトークン3バイト以外は全バイト一致(messy fixture・CRLF 保存)", () => {
    const content = loadFixture("demo-messy-wbs.md");
    const { content: next, changed } = rewriteBoardState(content, "B-1", "done");
    expect(changed).toBe(true);
    expect(next.length).toBe(content.length); // 同長スプライス
    // 差分はちょうど3バイト・位置は B-1 の tokenStart
    const row = locateAdoptedRows(content).find((r) => r.itemKey === "B-1")!;
    expect(next.slice(row.tokenStart, row.tokenStart + 3)).toBe("[x]");
    expect(next.slice(0, row.tokenStart)).toBe(content.slice(0, row.tokenStart));
    expect(next.slice(row.tokenStart + 3)).toBe(content.slice(row.tokenStart + 3));
    expect(next.includes("\r\n")).toBe(true); // CRLF 保存
  });

  it("changed=false 2系統: (i) 採用行に無い itemKey (ii) 既に desired と同一トークン", () => {
    const content = loadFixture("demo-messy-wbs.md");
    const gone = rewriteBoardState(content, "GONE-1", "done");
    expect(gone).toEqual({ content, changed: false });
    const noop = rewriteBoardState(content, "M1-2", "doing"); // M1-2 は既に [~]
    expect(noop).toEqual({ content, changed: false });
  });

  it("重複 ID は先勝ち行のみ置換(2行目のトークンは不変)", () => {
    const content = loadFixture("demo-messy-wbs.md");
    const { content: next, changed } = rewriteBoardState(content, "M1-1", "done");
    expect(changed).toBe(true);
    // 2行目(「重複IDの2行目」の行)の [ ] は不変のまま
    const dupLineStart = next.indexOf("| M1-1 | 重複IDの2行目");
    const dupLine = next.slice(dupLineStart, next.indexOf("\n", dupLineStart));
    expect(dupLine).toContain("[ ]");
  });

  it("fence 内・非対象テーブルの同名 ID は触らない(F-1 / 進捗まとめの M1-1)", () => {
    const content = loadFixture("demo-messy-wbs.md");
    const fence = rewriteBoardState(content, "F-1", "done");
    expect(fence.changed).toBe(false);
    const { content: next } = rewriteBoardState(content, "M1-1", "done");
    expect(next).toContain("| M1-1 | 50% |"); // 非対象テーブルの行は不変
  });
});
