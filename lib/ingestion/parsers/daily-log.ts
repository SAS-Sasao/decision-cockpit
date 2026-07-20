// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(logs 行)
//          docs/design/detail/ingestion-foundation.md §2.2
//          docs/design/detail/organize-loop.md §2.4(FILENAME_RE 拡張・frontmatter 剥離 — 凍結例外)
//
// 入力: ai-war-room `docs/logs/YYYY-MM-DD.md`(frontmatter なし・従来契約)/
// `docs/logs/YYYY-MM-DD-<slot>.md`(M5 整理ループの生成物。frontmatter + 空行 + H1)。
// H1 全体をタイトルに使う。org は常に null。topic は固定で 'daily'。
// 冒頭で frontmatter を剥離し、H1 判定・title・body・error レコードの body はすべて
// 剥離後の本文を基準にする(frontmatter の中身はパーサでは解釈しない・tags は [] のまま)。
// 規則外の命名 / H1 なしは status='error' レコード化する。

import { basename, dateFromFileDate, errorRecord, sanitizeAbsPaths } from "../normalize";
import { stripFrontmatter } from "./frontmatter";
import type { NormalizedRecord, Parser, SourceFile } from "./types";

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})(?:-([a-z0-9-]+))?\.md$/;
const H1_RE = /^#\s+(.+)$/;

export const parseDailyLog: Parser = (file, meta) => {
  const content = stripFrontmatter(file.content);
  const strippedFile: SourceFile = { path: file.path, content };

  const filenameBase = basename(file.path);
  const filenameMatch = filenameBase.match(FILENAME_RE);
  if (!filenameMatch) {
    return [errorRecord(strippedFile, meta, "daily-log: filename does not match YYYY-MM-DD[-slot].md", "daily_log")];
  }

  const occurredAt = dateFromFileDate(filenameMatch[1]);
  if (!occurredAt) {
    return [errorRecord(strippedFile, meta, "daily-log: invalid date in filename", "daily_log")];
  }

  const firstLine = (content.split(/\r?\n/)[0] ?? "").trim();
  const h1Match = firstLine.match(H1_RE);
  if (!h1Match) {
    return [errorRecord(strippedFile, meta, "daily-log: H1 heading not found", "daily_log")];
  }

  const title = sanitizeAbsPaths(h1Match[1].trim());
  const body = sanitizeAbsPaths(content);

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
