// 対象設計: docs/design/detail/wbs-loop.md §3(tests/wbs-verify.test.ts — 一次バイト diff の反例検出)
import { describe, expect, it } from "vitest";
import { splitLinesKeepEol, verifyLineDiff } from "../scripts/wbs/verify";

const BEFORE = [
  "# 見出し",
  "| WBS | タスク | ステータス |",
  "|---|---|---|",
  "| A-1 | 作業1 | [ ] |",
  "| A-1 | 重複行(skip) | [ ] |",
  "| A-2 | 作業2 | [~] |",
  "地の文。",
  "",
].join("\n");

function swap(content: string, from: string, to: string, at: number): string {
  return content.slice(0, at) + to + content.slice(at + from.length);
}

describe("verifyLineDiff — 一次基準(行単位バイト diff)", () => {
  it("正常: 宣言どおりのトークン置換のみ → ok", () => {
    const at = BEFORE.indexOf("[ ]");
    const after = swap(BEFORE, "[ ]", "[x]", at);
    const result = verifyLineDiff(BEFORE, after, [{ item_key: "A-1", from: "todo", to: "done" }]);
    expect(result.ok).toBe(true);
  });

  it("skip 行(重複 ID の2行目)の改変を検出して fail する", () => {
    const at = BEFORE.indexOf("[ ]"); // 先勝ち行
    const afterOk = swap(BEFORE, "[ ]", "[x]", at);
    // さらに skip 行のトークンも書き換わってしまった(= rewrite の不具合/改ざん)
    const skipAt = afterOk.indexOf("[ ]"); // 残る [ ] は skip 行のもの
    const afterBad = swap(afterOk, "[ ]", "[x]", skipAt);
    const result = verifyLineDiff(BEFORE, afterBad, [{ item_key: "A-1", from: "todo", to: "done" }]);
    expect(result.ok).toBe(false);
  });

  it("パディング正規化(トークン以外のバイト変化)を検出して fail する", () => {
    const after = BEFORE.replace("| A-2 | 作業2 | [~] |", "|A-2|作業2|[~]|");
    const result = verifyLineDiff(BEFORE, after, []);
    expect(result.ok).toBe(false);
  });

  it("行の追加・削除を検出して fail する", () => {
    const added = BEFORE + "\n| A-9 | 追加行 | [ ] |";
    expect(verifyLineDiff(BEFORE, added, []).ok).toBe(false);
    const removed = splitLinesKeepEol(BEFORE).slice(0, -1).join("");
    expect(verifyLineDiff(BEFORE, removed, []).ok).toBe(false);
  });

  it("宣言と異なるトークン置換(from/to 不一致)を fail する", () => {
    const at = BEFORE.indexOf("[~]");
    const after = swap(BEFORE, "[~]", "[x]", at);
    // 宣言は A-2 を doing→todo と主張(実際は doing→done)
    const result = verifyLineDiff(BEFORE, after, [{ item_key: "A-2", from: "doing", to: "todo" }]);
    expect(result.ok).toBe(false);
  });

  it("変更行数が宣言 item 数と一致しない場合は fail する(宣言のみ・変更なし)", () => {
    const result = verifyLineDiff(BEFORE, BEFORE, [{ item_key: "A-1", from: "todo", to: "done" }]);
    expect(result.ok).toBe(false);
  });

  it("splitLinesKeepEol は CRLF/LF の EOL を保持する(バイト単位比較の前提)", () => {
    const mixed = "a\r\nb\nc";
    expect(splitLinesKeepEol(mixed)).toEqual(["a\r\n", "b\n", "c"]);
    expect(splitLinesKeepEol(mixed).join("")).toBe(mixed);
  });
});
