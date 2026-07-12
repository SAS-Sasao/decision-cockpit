// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(quality-gate 行)/ §3.1(item_key 生成規則)
//          docs/design/detail/ingestion-foundation.md §2.2
//
// 入力: `.quality-gate-log/YYYY-MM-DD.jsonl`(1行=1レコード)。
// item_key = sha256(生行バイト列 UTF-8) の hex + '#' + 同一ファイル内の同一ハッシュ出現順序(0起点)。
// ハッシュはサニタイズ前の生行で計算する(処理系の変更でキーが揺れないため)。
// 壊れた JSON 行はその行だけ status='error' レコード化する(throw しない)。

import { createHash } from "node:crypto";
import { basename, dateFromFileDate, errorRecord, sanitizeAbsPaths, sanitizeDeep } from "../normalize";
import type { NormalizedRecord, Parser } from "./types";

const FILE_DATE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

function hashLine(rawLine: string): string {
  return createHash("sha256").update(rawLine, "utf8").digest("hex");
}

export const parseQualityGate: Parser = (file, meta) => {
  const filenameBase = basename(file.path);
  const dateMatch = filenameBase.match(FILE_DATE_RE);
  if (!dateMatch) {
    return [errorRecord(file, meta, "quality-gate: filename does not match YYYY-MM-DD.jsonl", "quality")];
  }
  const occurredAt = dateFromFileDate(dateMatch[1]);
  if (!occurredAt) {
    return [errorRecord(file, meta, "quality-gate: invalid date in filename", "quality")];
  }

  const lines = file.content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const occurrenceCounts = new Map<string, number>();
  const records: NormalizedRecord[] = [];

  for (const rawLine of lines) {
    const hash = hashLine(rawLine);
    const occurrence = occurrenceCounts.get(hash) ?? 0;
    occurrenceCounts.set(hash, occurrence + 1);
    const itemKey = `${hash}#${occurrence}`;
    const rawRef = `${file.path}#${itemKey}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      records.push({
        source: meta.source,
        file_path: file.path,
        item_key: itemKey,
        commit: meta.commit,
        type: "quality",
        occurred_at: occurredAt,
        org: meta.org,
        topic: null,
        tags: [],
        title: "quality-gate: invalid JSON line",
        body: sanitizeAbsPaths(rawLine).slice(0, 2000),
        raw_ref: rawRef,
        status: "error",
        reward_score: null,
        signals: null,
        completeness: null,
        accuracy: null,
        clarity: null,
        quality_gate_result: null,
      });
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      records.push({
        source: meta.source,
        file_path: file.path,
        item_key: itemKey,
        commit: meta.commit,
        type: "quality",
        occurred_at: occurredAt,
        org: meta.org,
        topic: null,
        tags: [],
        title: "quality-gate: line is not a JSON object",
        body: sanitizeAbsPaths(rawLine).slice(0, 2000),
        raw_ref: rawRef,
        status: "error",
        reward_score: null,
        signals: null,
        completeness: null,
        accuracy: null,
        clarity: null,
        quality_gate_result: null,
      });
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const targetRaw = typeof record.target === "string" ? record.target : "";
    const sanitizedTarget = sanitizeAbsPaths(targetRaw);
    const targetFilename = sanitizedTarget ? basename(sanitizedTarget) : null;
    const status = typeof record.status === "string" ? record.status : "unknown";
    const title = `QG ${status}: ${sanitizedTarget}`;
    const sanitizedBody = JSON.stringify(sanitizeDeep(record));

    records.push({
      source: meta.source,
      file_path: file.path,
      item_key: itemKey,
      commit: meta.commit,
      type: "quality",
      occurred_at: occurredAt,
      org: meta.org,
      topic: targetFilename,
      tags: [],
      title,
      body: sanitizedBody,
      raw_ref: rawRef,
      status: "ok",
      reward_score: null,
      signals: null,
      completeness: null,
      accuracy: null,
      clarity: null,
      quality_gate_result: status,
    });
  }

  return records;
};
