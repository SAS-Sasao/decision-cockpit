// 対象設計: docs/design/detail/org-docs-ingestion.md §2.2(parseKnowledge)
//
// 入力: cc-sier-organization `.companies/<org>/docs/...` 配下の汎用ナレッジ MD
// (daily-digest / secretary/learning-notes / research / retail-domain / diagrams / drawio /
// info-source-master.md)。chunkMarkdown で決定的に分割し、1チャンク = 1レコードとする。
// tags はパーサ出力では空配列(run-sync の既存機構 applyTags(title + body) が付与する)。
// occurred_at: frontmatter の `date:`(YYYY-MM-DD のみ受理)→ ファイル名 YYYY-MM-DD.md → null
// (null でも status='ok' のまま — knowledge 型の契約改訂)。
//
// チャンク化に決定的な失敗モードは無い(任意の文字列がチャンク化可能)ため、本パーサに
// status='error' 経路は無い(0チャンクの場合はレコードなしを返すのみ — quality-gate の
// 「0行 jsonl → 空配列」と同じ扱い)。

import { chunkMarkdown } from "../chunk";
import { basename, dateFromFileDate, fileSlug, sanitizeAbsPaths } from "../normalize";
import type { NormalizedRecord, Parser } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FRONTMATTER_DATE_RE = /^date:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m;
const FILENAME_DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const H1_RE = /^#(?!#)[ \t]+(.+)$/m;

function splitFrontmatter(content: string): { frontmatterRaw: string | null; body: string } {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatterRaw: null, body: content };
  return { frontmatterRaw: m[1] ?? "", body: m[2] ?? "" };
}

/** frontmatter `date:`(YYYY-MM-DD のみ)→ ファイル名 YYYY-MM-DD.md → null の順で解決する。 */
function resolveOccurredAt(path: string, frontmatterRaw: string | null): Date | null {
  if (frontmatterRaw) {
    const m = frontmatterRaw.match(FRONTMATTER_DATE_RE);
    if (m) {
      const d = dateFromFileDate(m[1]!);
      if (d) return d;
    }
  }
  const filenameMatch = basename(path).match(FILENAME_DATE_RE);
  if (filenameMatch) {
    const d = dateFromFileDate(filenameMatch[1]!);
    if (d) return d;
  }
  return null;
}

/** 文書タイトル = H1(frontmatter 除去後の本文中の最初の `# ...` 行) or ファイル名(拡張子除去)。 */
function resolveDocTitle(body: string, path: string): string {
  const h1 = body.match(H1_RE);
  if (h1) return h1[1]!.trim();
  return fileSlug(path);
}

export const parseKnowledge: Parser = (file, meta) => {
  const { frontmatterRaw, body } = splitFrontmatter(file.content);
  const occurredAt = resolveOccurredAt(file.path, frontmatterRaw);
  const docTitle = resolveDocTitle(body, file.path);

  const chunks = chunkMarkdown(file.content);

  return chunks.map((chunk, index): NormalizedRecord => {
    const itemKey = `c${index}`;
    const rawTitle =
      chunk.headingPath.length > 0 ? `${docTitle} › ${chunk.headingPath.join(" › ")}` : docTitle;

    return {
      source: meta.source,
      file_path: file.path,
      item_key: itemKey,
      commit: meta.commit,
      type: "knowledge",
      occurred_at: occurredAt,
      org: meta.org,
      topic: null,
      tags: [],
      title: sanitizeAbsPaths(rawTitle),
      body: sanitizeAbsPaths(chunk.text),
      raw_ref: `${file.path}#${itemKey}`,
      status: "ok",
      reward_score: null,
      signals: null,
      completeness: null,
      accuracy: null,
      clarity: null,
      quality_gate_result: null,
    };
  });
};
