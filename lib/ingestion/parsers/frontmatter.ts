// 対象設計: docs/design/detail/organize-loop.md §2.4 / §0-D-4(依存ゼロの純モジュール)
//
// scripts/organize/verify.ts が CI(tsx・素の Node 実行)から直接読み込むため、他モジュール
// への依存を一切持たない(モジュール境界を越えた実行時の破綻を構造的に排除する — R3 A-1)。
// このファイルに import 文を書かないこと(機械ピン: 条件2)。

const EMPTY_OR_WHITESPACE_LINE_RE = /^\s*$/;

/**
 * frontmatter を剥離し、剥離後の本文のみを返す。
 * - 1行目が正確に `---` のときのみ剥離を行う(それ以外は原文のまま)。
 * - 閉じ `---` 行とその改行までを消費し、続く空行(空文字列または空白のみの行。
 *   CRLF(`\r?\n`)対応)を読み飛ばした残りを返す。
 * - 閉じ `---` が見つからない場合は原文のまま返す。
 * - frontmatter の中身(開始行と閉じ行の間)は一切解釈しない。
 */
export function stripFrontmatter(content: string): string {
  const parts = content.split(/(\r?\n)/);
  if (parts[0] !== "---") {
    return content;
  }

  let closeIndex = -1;
  for (let i = 2; i < parts.length; i += 2) {
    if (parts[i] === "---") {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) {
    return content;
  }

  // 閉じ行の直後の改行(存在すれば)まで消費する。
  let cursor = closeIndex + 1;
  if (cursor < parts.length) {
    cursor += 1;
  }

  // 続く空行(空文字列 or 空白のみ)を読み飛ばす。
  while (cursor < parts.length) {
    const line = parts[cursor];
    if (line !== undefined && EMPTY_OR_WHITESPACE_LINE_RE.test(line)) {
      if (cursor + 1 < parts.length) {
        cursor += 2;
      } else {
        cursor += 1;
      }
    } else {
      break;
    }
  }

  return parts.slice(cursor).join("");
}
