// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(decisions 行)
//          docs/design/detail/ingestion-foundation.md §2.2
//
// 入力: ai-war-room `docs/decisions/YYYY-MM-DD-<slug>.md`(frontmatter なし)。
// H1 `# YYYY-MM-DD - {タイトル}` からタイトルを取り出す。org は常に null(ai-war-room に org 概念なし)。
// 規則外の命名 / H1 なしは throw せず status='error' レコード化する。

import { basename, dateFromFileDate, errorRecord, fileSlug, sanitizeAbsPaths } from "../normalize";
import type { NormalizedRecord, Parser } from "./types";

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;
const H1_RE = /^#\s+\d{4}-\d{2}-\d{2}\s+-\s+(.+)$/;

export const parseDecision: Parser = (file, meta) => {
  const filenameBase = basename(file.path);
  const filenameMatch = filenameBase.match(FILENAME_RE);
  if (!filenameMatch) {
    return [errorRecord(file, meta, "decision: filename does not match YYYY-MM-DD-<slug>.md", "decision")];
  }

  const occurredAt = dateFromFileDate(filenameMatch[1]);
  if (!occurredAt) {
    return [errorRecord(file, meta, "decision: invalid date in filename", "decision")];
  }

  const firstLine = (file.content.split(/\r?\n/)[0] ?? "").trim();
  const h1Match = firstLine.match(H1_RE);
  if (!h1Match) {
    return [errorRecord(file, meta, "decision: H1 heading not found or malformed", "decision")];
  }

  const topic = fileSlug(filenameBase);
  const title = sanitizeAbsPaths(h1Match[1].trim());
  const body = sanitizeAbsPaths(file.content);

  const record: NormalizedRecord = {
    source: meta.source,
    file_path: file.path,
    item_key: "",
    commit: meta.commit,
    type: "decision",
    occurred_at: occurredAt,
    org: null,
    topic,
    tags: [],
    title,
    body,
    raw_ref: file.path,
    status: "ok",
    reward_score: null,
    signals: null,
    completeness: null,
    accuracy: null,
    clarity: null,
    quality_gate_result: null,
  };

  return [record];
};
