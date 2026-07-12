// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(logs 行)
//          docs/design/detail/ingestion-foundation.md §2.2
//
// 入力: ai-war-room `docs/logs/YYYY-MM-DD.md`(frontmatter なし)。H1 全体をタイトルに使う。
// org は常に null。topic は固定で 'daily'。規則外の命名 / H1 なしは status='error' レコード化する。

import { basename, dateFromFileDate, errorRecord, sanitizeAbsPaths } from "../normalize";
import type { NormalizedRecord, Parser } from "./types";

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const H1_RE = /^#\s+(.+)$/;

export const parseDailyLog: Parser = (file, meta) => {
  const filenameBase = basename(file.path);
  const filenameMatch = filenameBase.match(FILENAME_RE);
  if (!filenameMatch) {
    return [errorRecord(file, meta, "daily-log: filename does not match YYYY-MM-DD.md", "daily_log")];
  }

  const occurredAt = dateFromFileDate(filenameMatch[1]);
  if (!occurredAt) {
    return [errorRecord(file, meta, "daily-log: invalid date in filename", "daily_log")];
  }

  const firstLine = (file.content.split(/\r?\n/)[0] ?? "").trim();
  const h1Match = firstLine.match(H1_RE);
  if (!h1Match) {
    return [errorRecord(file, meta, "daily-log: H1 heading not found", "daily_log")];
  }

  const title = sanitizeAbsPaths(h1Match[1].trim());
  const body = sanitizeAbsPaths(file.content);

  const record: NormalizedRecord = {
    source: meta.source,
    file_path: file.path,
    item_key: "",
    commit: meta.commit,
    type: "daily_log",
    occurred_at: occurredAt,
    org: null,
    topic: "daily",
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
