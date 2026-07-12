// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(task-log 行)
//          docs/design/detail/ingestion-foundation.md §2.2
//
// 入力: `.task-log/YYYYMMDD-HHMMSS-<slug>.md`(MD + YAML frontmatter + 末尾 `## reward`
// (score float / signals bool×4)+ optional `## judge`(completeness/accuracy/clarity 1-5))。
// 純関数・throw しない(失敗は status='error' レコード化)。

import yaml from "js-yaml";
import {
  dateFromFilenameDatetime,
  errorRecord,
  fileSlug,
  orgMismatch,
  parseFlexibleDate,
  sanitizeAbsPaths,
} from "../normalize";
import type { NormalizedRecord, Parser, TaskRewardSignals } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function loadYamlObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** `heading` (例 "## reward") の後に続く最初の ```yaml フェンスを取り出してパースする。 */
function extractFencedYaml(body: string, heading: string): Record<string, unknown> | null {
  const idx = body.indexOf(heading);
  if (idx === -1) return null;
  const rest = body.slice(idx + heading.length);
  const fence = rest.match(/```ya?ml\r?\n([\s\S]*?)```/);
  if (!fence) return null;
  return loadYamlObject(fence[1]);
}

/** judge の 1-5 点スケールを (x-1)/4 で 0-1 に正規化する。 */
function normalizeJudgeScore(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return (value - 1) / 4;
}

export const parseTaskLog: Parser = (file, meta) => {
  const match = file.content.match(FRONTMATTER_RE);
  if (!match) {
    return [errorRecord(file, meta, "task-log: frontmatter not found", "task")];
  }

  const frontmatter = loadYamlObject(match[1]);
  if (!frontmatter) {
    return [errorRecord(file, meta, "task-log: invalid frontmatter YAML", "task")];
  }

  const fmOrg = typeof frontmatter.org === "string" ? frontmatter.org : null;
  if (orgMismatch(fmOrg, meta.org)) {
    return [errorRecord(file, meta, "task-log: org mismatch (frontmatter vs path)", "task")];
  }

  const body = match[2] ?? "";
  const slug = fileSlug(file.path);

  const startedRaw = typeof frontmatter.started === "string" ? frontmatter.started : null;
  const occurredAt =
    (startedRaw ? parseFlexibleDate(startedRaw) : null) ?? dateFromFilenameDatetime(slug);
  if (!occurredAt) {
    return [errorRecord(file, meta, "task-log: occurred_at not resolvable", "task")];
  }

  const requestRaw = typeof frontmatter.request === "string" ? frontmatter.request : "";
  const title = requestRaw.slice(0, 120);

  const reward = extractFencedYaml(body, "## reward");
  const rewardScore =
    reward && typeof reward.score === "number" && !Number.isNaN(reward.score) ? reward.score : null;

  let signals: TaskRewardSignals | null = null;
  if (reward && reward.signals && typeof reward.signals === "object" && !Array.isArray(reward.signals)) {
    const s = reward.signals as Record<string, unknown>;
    signals = {
      completed: Boolean(s.completed),
      artifacts_exist: Boolean(s.artifacts_exist),
      excessive_edits: Boolean(s.excessive_edits),
      retry_detected: Boolean(s.retry_detected),
    };
  }

  const judge = extractFencedYaml(body, "## judge");
  const completeness = judge ? normalizeJudgeScore(judge.completeness) : null;
  const accuracy = judge ? normalizeJudgeScore(judge.accuracy) : null;
  const clarity = judge ? normalizeJudgeScore(judge.clarity) : null;

  const record: NormalizedRecord = {
    source: meta.source,
    file_path: file.path,
    item_key: "",
    commit: meta.commit,
    type: "task",
    occurred_at: occurredAt,
    org: meta.org,
    topic: slug,
    tags: [],
    title: sanitizeAbsPaths(title),
    body: sanitizeAbsPaths(body),
    raw_ref: file.path,
    status: "ok",
    reward_score: rewardScore,
    signals,
    completeness,
    accuracy,
    clarity,
    quality_gate_result: null,
  };

  return [record];
};
