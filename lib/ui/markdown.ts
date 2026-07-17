// 対象設計: docs/design/basic/md-render.md §1-1(型)・§4-1(受け入れ条件)
//
// Markdown を型付きトークン木に変換する純関数群(React 非依存・HTML 文字列を一切生成しない)。
// 対応外の記法は段落(プレーンテキスト)として素通しする(fail-soft)。

export type Inline =
  | { kind: "text" | "strong" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "para"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "quote"; inline: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^-{3,}$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```/;
const FENCE_CLOSE_RE = /^```\s*$/;

const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]*)\]\(([^)]+)\)/g;

function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HR_RE.test(line.trim()) ||
    HEADING_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    QUOTE_RE.test(line)
  );
}

/** 1行分のインラインテキストをトークン列に分解する(強調 / コード / リンク)。 */
function parseInline(text: string): Inline[] {
  if (text === "") return [];
  const tokens: Inline[] = [];
  let lastIndex = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: "strong", text: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: "code", text: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ kind: "link", text: match[3], href: match[4] });
    }
    lastIndex = INLINE_RE.lastIndex;
    // 空マッチによる無限ループ防止(理論上は起きないが全域性のため保険)
    if (match[0].length === 0) {
      lastIndex += 1;
      INLINE_RE.lastIndex += 1;
    }
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }
  if (tokens.length === 0) {
    tokens.push({ kind: "text", text });
  }
  return tokens;
}

/** Markdown 本文を型付きブロック木に変換する。対応外の記法は段落として素通しする。 */
export function parseMarkdown(text: string): Block[] {
  const lines = (text ?? "").split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (FENCE_RE.test(line)) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // 閉じフェンス行を消費
      blocks.push({ kind: "code", text: codeLines.join("\n") });
      continue;
    }

    if (HR_RE.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, inline: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    const isOrderedLine = OL_RE.test(line);
    const isUnorderedLine = UL_RE.test(line);
    if (isOrderedLine || isUnorderedLine) {
      const ordered = isOrderedLine;
      const re = ordered ? OL_RE : UL_RE;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]);
        if (!m) break;
        quoteLines.push(m[1]);
        i += 1;
      }
      blocks.push({ kind: "quote", inline: parseInline(quoteLines.join(" ")) });
      continue;
    }

    // 段落: 空行 or 他ブロック開始行まで連結する
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") break;
      if (isBlockStart(l)) break;
      paraLines.push(l);
      i += 1;
    }
    blocks.push({ kind: "para", inline: parseInline(paraLines.join(" ")) });
  }

  return blocks;
}

/** 行頭ブロック記号とインライン装飾を除いたプレーン文字列を返す(excerpt 用・fail-soft)。 */
export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/).map(stripBlockMarker);
  return stripInline(lines.join("\n"));
}

function stripBlockMarker(line: string): string {
  if (FENCE_RE.test(line.trim())) return "";
  const heading = HEADING_RE.exec(line);
  if (heading) return heading[2];
  const quote = QUOTE_RE.exec(line);
  if (quote) return quote[1];
  const ol = OL_RE.exec(line);
  if (ol) return ol[1];
  const ul = UL_RE.exec(line);
  if (ul) return ul[1];
  return line;
}

/** 強調・インラインコード・リンクの装飾記号を除去する(切断入力でも throw しない)。 */
function stripInline(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end === -1) {
        result += text.slice(i + 2);
        break;
      }
      result += text.slice(i + 2, end);
      i = end + 2;
      continue;
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        result += text.slice(i + 1);
        break;
      }
      result += text.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          result += text.slice(i + 1, closeBracket);
          i = closeParen + 1;
          continue;
        }
      }
      result += "[";
      i += 1;
      continue;
    }
    result += text[i];
    i += 1;
  }
  return result;
}

/** href が http:// または https:// で始まる場合のみ true(trim → 小文字化 → 前方一致)。 */
export function isSafeHref(href: string): boolean {
  const v = href.trim().toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://");
}
