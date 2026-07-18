import "server-only";

// 対象設計: docs/design/detail/org-docs-ingestion.md §2.1(chunkMarkdown)
//
// Markdown を見出し(`##`・`###`)境界 + 文字数上限で決定的にチャンク化する純関数。
// ネットワーク・DB 依存なし。knowledge パーサ(parsers/knowledge.ts)が唯一の呼び出し元。
//
// アルゴリズム(§2.1 の規則1〜6):
//  1. frontmatter(`---` 囲み)を除去。H1 行は文書タイトルとして除外(チャンクに含めない)。
//  2. 分割点 = `##`・`###` の見出し行のみ(h4 以深は分割点にせずブロックに内包)。
//     見出しパス = h2 > h3 の階層(h3 単独出現時は h3 のみ)。
//  3. H1 直後〜最初の分割点の前文 = headingPath 空([])のチャンク(空なら生成しない)。
//  4. 各ブロックが 500字超の場合: 段落(空行区切り)を先頭から貪欲に再結合して順次チャンク化
//     (連結は `\n\n` を挟んでカウントし、連結後長 ≤ 500 を条件とする)。単一段落が 500字超なら
//     500字で機械分割する。
//  5. フェンスコード(``` 内)の見出し様行・空行は分割点にしない。
//  6. 見出し行自体は chunk.text に含めない(headingPath にのみ反映)。ブロック長判定は本文のみ。

export const CHUNK_MAX_CHARS = 500;

export type Chunk = { headingPath: string[]; text: string };

type RawBlock = { headingPath: string[]; lines: string[] };

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const FENCE_RE = /^\s*```/;

function stripFrontmatter(markdown: string): string {
  const m = markdown.match(FRONTMATTER_RE);
  return m ? markdown.slice(m[0].length) : markdown;
}

/** 500字超の単一段落を機械的に CHUNK_MAX_CHARS ごとに分割する。 */
function hardSplit(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_MAX_CHARS) {
    out.push(text.slice(i, i + CHUNK_MAX_CHARS));
  }
  return out;
}

/**
 * 500字超のブロック本文を、段落(`\n{2,}` 区切り)の貪欲再結合で順次チャンク化する。
 * 連結後長 ≤ 500 の間は結合を続け、超えたら確定して次段落から再開する(決定的)。
 * 単一段落自体が 500字超なら機械分割(hardSplit)する。
 */
function splitOversizedBlock(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  let buffer = "";

  for (const p of paragraphs) {
    if (buffer === "") {
      if (p.length > CHUNK_MAX_CHARS) {
        out.push(...hardSplit(p));
      } else {
        buffer = p;
      }
      continue;
    }
    const candidate = `${buffer}\n\n${p}`;
    if (candidate.length <= CHUNK_MAX_CHARS) {
      buffer = candidate;
      continue;
    }
    out.push(buffer);
    if (p.length > CHUNK_MAX_CHARS) {
      out.push(...hardSplit(p));
      buffer = "";
    } else {
      buffer = p;
    }
  }
  if (buffer !== "") out.push(buffer);
  return out;
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const body = stripFrontmatter(markdown);
  const lines = body.split(/\r?\n/);

  const blocks: RawBlock[] = [];
  let currentHeadingPath: string[] = [];
  let currentLines: string[] = [];
  let currentH2: string | null = null;
  let inFence = false;

  const flush = () => {
    blocks.push({ headingPath: currentHeadingPath, lines: currentLines });
    currentLines = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      currentLines.push(line);
      continue;
    }

    if (!inFence) {
      const m = line.match(HEADING_RE);
      if (m) {
        const level = m[1]!.length;
        const text = m[2]!.trim();

        if (level === 1) {
          // H1 = 文書タイトル。チャンクには一切含めない(見出し行ごと除外)。
          continue;
        }
        if (level === 2) {
          flush();
          currentH2 = text;
          currentHeadingPath = [text];
          continue;
        }
        if (level === 3) {
          flush();
          currentHeadingPath = currentH2 ? [currentH2, text] : [text];
          continue;
        }
        // level 4-6(h4 以深)は分割点にせず、見出し行ごとブロックに内包する(下に落ちて push)。
      }
    }

    currentLines.push(line);
  }
  flush();

  const chunks: Chunk[] = [];
  for (const block of blocks) {
    const text = block.lines.join("\n").trim();
    if (text.length === 0) continue; // 前文(headingPath 空)を含め、空ブロックは生成しない。

    if (text.length <= CHUNK_MAX_CHARS) {
      chunks.push({ headingPath: block.headingPath, text });
      continue;
    }
    for (const piece of splitOversizedBlock(text)) {
      chunks.push({ headingPath: block.headingPath, text: piece });
    }
  }
  return chunks;
}
