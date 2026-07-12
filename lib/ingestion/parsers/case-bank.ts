// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(case-bank 行)
//          docs/design/detail/ingestion-foundation.md §2.2
//
// 入力: `.case-bank/index.json`(cases[] 配列。1 case = 1 レコード)。
// 純関数・throw しない(壊れた JSON はファイル単位、org 不一致・occurred_at 欠損は case 単位で error)。

import {
  basename,
  dateFromFilenameDatetime,
  errorRecord,
  orgMismatch,
  parseFlexibleDate,
  sanitizeAbsPaths,
} from "../normalize";
import type { NormalizedRecord, ParseMeta, Parser, SourceFile } from "./types";

type RawCase = {
  id?: unknown;
  state?: {
    request_keywords?: unknown;
    request_head?: unknown;
    org_slug?: unknown;
  };
  action?: {
    subagent?: unknown;
    mode?: unknown;
  };
  reward?: unknown;
  judge?: {
    completeness?: unknown;
    accuracy?: unknown;
    clarity?: unknown;
  } | null;
  outcome?: {
    files_written?: unknown;
    started?: unknown;
  };
};

function caseErrorRecord(
  file: SourceFile,
  meta: ParseMeta,
  rawCase: unknown,
  itemKey: string,
  rawRef: string,
  reason: string
): NormalizedRecord {
  let serialized: string;
  try {
    serialized = JSON.stringify(rawCase);
  } catch {
    serialized = String(rawCase);
  }
  return {
    source: meta.source,
    file_path: file.path,
    item_key: itemKey,
    commit: meta.commit,
    type: "score",
    occurred_at: null,
    org: meta.org,
    topic: null,
    tags: [],
    title: reason,
    body: sanitizeAbsPaths(serialized).slice(0, 2000),
    raw_ref: rawRef,
    status: "error",
    reward_score: null,
    signals: null,
    completeness: null,
    accuracy: null,
    clarity: null,
    quality_gate_result: null,
  };
}

export const parseCaseBank: Parser = (file, meta) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return [errorRecord(file, meta, "case-bank: invalid JSON", "score")];
  }

  const cases =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { cases?: unknown }).cases)
      ? ((parsed as { cases: RawCase[] }).cases as RawCase[])
      : null;
  if (!cases) {
    return [errorRecord(file, meta, "case-bank: missing cases[] array", "score")];
  }

  const records: NormalizedRecord[] = [];

  cases.forEach((c, index) => {
    const id = typeof c.id === "string" && c.id.length > 0 ? c.id : `__index_${index}`;
    const rawRef = `${file.path}#${id}`;

    const orgSlug = typeof c.state?.org_slug === "string" ? c.state.org_slug : null;
    if (orgMismatch(orgSlug, meta.org)) {
      records.push(caseErrorRecord(file, meta, c, id, rawRef, "case-bank: org mismatch (state.org_slug vs path)"));
      return;
    }

    const startedRaw =
      typeof c.outcome?.started === "string" && c.outcome.started.trim().length > 0
        ? c.outcome.started
        : null;
    const occurredAt = (startedRaw && parseFlexibleDate(startedRaw)) ?? dateFromFilenameDatetime(id);
    if (!occurredAt) {
      records.push(
        caseErrorRecord(file, meta, c, id, rawRef, "case-bank: occurred_at not resolvable (started and id both missing)")
      );
      return;
    }

    const requestHead = typeof c.state?.request_head === "string" ? c.state.request_head : null;
    const keywords = Array.isArray(c.state?.request_keywords)
      ? (c.state?.request_keywords as unknown[]).filter((k): k is string => typeof k === "string")
      : [];
    const subagent = typeof c.action?.subagent === "string" ? c.action.subagent : "";
    const mode = typeof c.action?.mode === "string" ? c.action.mode : "";
    const filesWritten = Array.isArray(c.outcome?.files_written)
      ? (c.outcome?.files_written as unknown[])
          .filter((f): f is string => typeof f === "string")
          .map((f) => basename(f))
      : [];

    const bodyLines = [
      `request_head: ${requestHead ?? ""}`,
      `keywords: ${keywords.join(", ")}`,
      `subagent: ${subagent}`,
      `mode: ${mode}`,
      `files_written: ${filesWritten.join(", ")}`,
    ];
    const body = sanitizeAbsPaths(bodyLines.join("\n"));
    const title = requestHead !== null ? sanitizeAbsPaths(requestHead) : null;

    const rewardScore = typeof c.reward === "number" && !Number.isNaN(c.reward) ? c.reward : null;
    const judge = c.judge && typeof c.judge === "object" ? c.judge : null;
    const completeness = judge && typeof judge.completeness === "number" ? judge.completeness : null;
    const accuracy = judge && typeof judge.accuracy === "number" ? judge.accuracy : null;
    const clarity = judge && typeof judge.clarity === "number" ? judge.clarity : null;

    records.push({
      source: meta.source,
      file_path: file.path,
      item_key: id,
      commit: meta.commit,
      type: "score",
      occurred_at: occurredAt,
      org: meta.org,
      topic: id,
      tags: [],
      title,
      body,
      raw_ref: rawRef,
      status: "ok",
      reward_score: rewardScore,
      signals: null,
      completeness,
      accuracy,
      clarity,
      quality_gate_result: null,
    });
  });

  return records;
};
