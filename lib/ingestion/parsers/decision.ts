// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(decisions 行)
//          docs/design/detail/ingestion-foundation.md §2.2
//          docs/design/detail/org-docs-ingestion.md §2.3(org: meta.org への変更 + rev.8/9 H1 フォールバック)
//          docs/design/detail/organize-loop.md §2.4(frontmatter 剥離 — 凍結例外)
//
// 入力: ai-war-room `docs/decisions/YYYY-MM-DD-<slug>.md` / cc-sier-organization
// `.companies/<org>/docs/decisions/<slug>.md`(frontmatter なし・従来契約。M5 整理ループの
// 生成物は frontmatter + H1 を持つ)。ファイル名は `YYYY-MM-DD-<slug>.md` 必須(全分岐の
// 前提・不変)。org はパス由来の meta.org をそのまま使う(ai-war-room は org 概念が無いため
// orgFromPath が null を返し、結果として org は null のまま — 既存契約は無傷。
// cc-sier-organization 側の組織 decision は meta.org 経由で org 帰属が付く)。
//
// 冒頭で frontmatter を剥離し、H1 3分岐判定・title・body・error レコードの body はすべて
// 剥離後の本文を基準にする(frontmatter の中身はパーサでは解釈しない・tags は [] のまま)。
//
// H1 は3分岐で評価する(rev.8・列挙順の逐次評価 1 → 2 → 3。rev.9: 分岐2/3 の H1 判定は
// 分岐1 と同じ空白規約 `/^#\s+/` — literal `# ` ではない):
//   1. 日付付き H1(`# YYYY-MM-DD - {タイトル}`)→ 従来どおり title = 日付以降。
//   2. H1 はあるが日付なし(`/^#\s+/` に一致し 1 に不一致)→ フォールバック:
//      title = H1 全文(`/^#\s+/` 除去・trim・sanitizeAbsPaths)・occurred_at = ファイル名日付
//      (既存検査済み)で ok レコード化。body・topic は分岐1 と同一。
//   3. H1 なし(`/^#\s+/` 不一致)→ throw せず status='error' レコード化する(不変)。

import { basename, dateFromFileDate, errorRecord, fileSlug, sanitizeAbsPaths } from "../normalize";
import { stripFrontmatter } from "./frontmatter";
import type { NormalizedRecord, Parser, SourceFile } from "./types";

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;
const H1_RE = /^#\s+\d{4}-\d{2}-\d{2}\s+-\s+(.+)$/;
const H1_ANY_RE = /^#\s+(.+)$/;

export const parseDecision: Parser = (file, meta) => {
  const content = stripFrontmatter(file.content);
  const strippedFile: SourceFile = { path: file.path, content };

  const filenameBase = basename(file.path);
  const filenameMatch = filenameBase.match(FILENAME_RE);
  if (!filenameMatch) {
    return [errorRecord(strippedFile, meta, "decision: filename does not match YYYY-MM-DD-<slug>.md", "decision")];
  }

  const occurredAt = dateFromFileDate(filenameMatch[1]);
  if (!occurredAt) {
    return [errorRecord(strippedFile, meta, "decision: invalid date in filename", "decision")];
  }

  const firstLine = (content.split(/\r?\n/)[0] ?? "").trim();

  // 分岐1: 日付付き H1
  const datedMatch = firstLine.match(H1_RE);
  // 分岐2: H1 はあるが日付なし(分岐1 に不一致)
  const genericMatch = datedMatch ? null : firstLine.match(H1_ANY_RE);

  if (!datedMatch && !genericMatch) {
    // 分岐3: H1 なし
    return [errorRecord(strippedFile, meta, "decision: H1 heading not found or malformed", "decision")];
  }

  const topic = fileSlug(filenameBase);
  const title = sanitizeAbsPaths((datedMatch ? datedMatch[1] : genericMatch![1]).trim());
  const body = sanitizeAbsPaths(content);

  const record: NormalizedRecord = {
    source: meta.source,
    file_path: file.path,
    item_key: "",
    commit: meta.commit,
    type: "decision",
    occurred_at: occurredAt,
    org: meta.org,
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
