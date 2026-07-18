import "server-only";

// 対象設計: docs/design/detail/search-foundation.md §2.4(検索クエリ・decisionOutcome・topTags)
//          docs/design/basic/search-foundation.md §1-4 / §1-5(similarity 契約・SC-04 データ契約)
//          docs/design/detail/org-docs-ingestion.md §2.7 rev.5/6(recentRecords — type/tag 反映)
//
// EmbeddingClient を呼ぶのは searchKnowledge 内のみ(呼び出し位置固定)。
// SQL は全て $n プレースホルダ束縛(文字列連結によるユーザー値の埋め込み禁止)。

import { query } from "../db";
import { createEmbeddingClient, currentEmbeddingModel } from "../search/embedding";

export type KnowledgeHit = {
  id: string;
  source: string;
  filePath: string;
  occurredAt: string | null;
  type: string;
  org: string | null;
  title: string | null;
  excerpt: string;
  tags: string[];
  similarity: number | null; // recent(非検索)経路は null
};

export type KnowledgeSearchParams = {
  q: string;
  type?: string; // 既定 "decision"・"all" で解除
  org?: string;
  tag?: string;
  source?: string;
  from?: string;
  to?: string;
  limit?: number; // 既定 8・上限 20
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const OUTCOME_WEEKS = 6;
const OUTCOME_WINDOW_DAYS = 42; // 7日 × 6週
const DAY_MS = 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function excerptOf(body: string | null): string {
  return body ? body.slice(0, 120) : "";
}

type RecordRow = {
  id: string;
  source: string;
  file_path: string;
  occurred_at: Date | null;
  type: string;
  org: string | null;
  title: string | null;
  body: string | null;
  tags: string[];
};

function toHit(row: RecordRow, similarity: number | null): KnowledgeHit {
  return {
    id: row.id,
    source: row.source,
    filePath: row.file_path,
    occurredAt: row.occurred_at ? row.occurred_at.toISOString() : null,
    type: row.type,
    org: row.org,
    title: row.title,
    excerpt: excerptOf(row.body),
    tags: row.tags,
    similarity,
  };
}

// ---------------------------------------------------------------------------
// searchKnowledge — pgvector 近傍検索 + メタフィルタ + 同一モデルガード
// ---------------------------------------------------------------------------

type SearchQueryRow = RecordRow & { raw_similarity: number };

export async function searchKnowledge(params: KnowledgeSearchParams): Promise<KnowledgeHit[]> {
  const client = createEmbeddingClient();
  const [qvecValues] = await client.embed([params.q]);
  const qvec = "[" + qvecValues.join(",") + "]";
  const currentModel = currentEmbeddingModel();

  const sqlParams: unknown[] = [qvec, currentModel];
  const filters: string[] = [];

  const type = params.type ?? "decision";
  if (type !== "all") {
    sqlParams.push(type);
    filters.push(`AND type = $${sqlParams.length}`);
  }
  if (params.org) {
    sqlParams.push(params.org);
    filters.push(`AND org = $${sqlParams.length}`);
  }
  if (params.tag) {
    sqlParams.push(params.tag);
    filters.push(`AND $${sqlParams.length} = ANY(tags)`);
  }
  if (params.source) {
    sqlParams.push(params.source);
    filters.push(`AND source = $${sqlParams.length}`);
  }
  if (params.from) {
    sqlParams.push(params.from);
    filters.push(`AND occurred_at >= $${sqlParams.length}`);
  }
  if (params.to) {
    sqlParams.push(params.to);
    filters.push(`AND occurred_at < $${sqlParams.length}`);
  }

  sqlParams.push(clampLimit(params.limit));
  const limitParam = `$${sqlParams.length}`;
  const filterSql = filters.length > 0 ? " " + filters.join(" ") : "";

  const result = await query<SearchQueryRow>(
    `SELECT id, source, file_path, occurred_at, type, org, title, body, tags,
            1 - (embedding <=> $1::vector) AS raw_similarity
       FROM timeline_records
      WHERE status = 'ok' AND embedding IS NOT NULL AND embedding_model = $2${filterSql}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT ${limitParam}`,
    sqlParams
  );

  return result.rows.map((row) => toHit(row, Math.min(1, Math.max(0, row.raw_similarity))));
}

// ---------------------------------------------------------------------------
// outcomeWindows / decisionOutcome — occurred_at 起点7日窓×6(UTC・純関数部分は窓割りのみ)
// ---------------------------------------------------------------------------

/** anchor 起点の7日窓を weeks 個作る(純関数・UTC ミリ秒演算のためタイムゾーン非依存)。 */
export function outcomeWindows(anchor: Date, weeks: number = OUTCOME_WEEKS): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = [];
  for (let i = 0; i < weeks; i += 1) {
    const start = new Date(anchor.getTime() + i * 7 * DAY_MS);
    const end = new Date(anchor.getTime() + (i + 1) * 7 * DAY_MS);
    windows.push({ start, end });
  }
  return windows;
}

type DecisionAnchorRow = {
  id: string;
  type: string;
  status: string;
  occurred_at: Date | null;
  org: string | null;
};

type RewardRow = { occurred_at: Date; reward_score: number };

export async function decisionOutcome(id: string): Promise<{
  labels: string[];
  reward: (number | null)[];
  stats: { avgAfter: number | null; delta: number | null; count: number };
} | null> {
  if (!isValidUuid(id)) return null;

  const anchorResult = await query<DecisionAnchorRow>(
    `SELECT id, type, status, occurred_at, org FROM timeline_records WHERE id = $1`,
    [id]
  );
  const decision = anchorResult.rows[0];
  if (!decision || decision.type !== "decision" || decision.status !== "ok" || !decision.occurred_at) {
    return null;
  }

  const anchor = decision.occurred_at;
  const rangeStart = new Date(anchor.getTime() - OUTCOME_WINDOW_DAYS * DAY_MS);
  const rangeEnd = new Date(anchor.getTime() + OUTCOME_WINDOW_DAYS * DAY_MS);

  const rewardParams: unknown[] = [rangeStart, rangeEnd];
  let orgFilter = "";
  if (decision.org !== null) {
    rewardParams.push(decision.org);
    orgFilter = ` AND org = $${rewardParams.length}`;
  }

  const rewardResult = await query<RewardRow>(
    `SELECT occurred_at, reward_score
       FROM timeline_records
      WHERE status = 'ok' AND reward_score IS NOT NULL
        AND occurred_at >= $1 AND occurred_at < $2${orgFilter}`,
    rewardParams
  );

  const beforeRows = rewardResult.rows.filter((r) => r.occurred_at < anchor);
  const afterRows = rewardResult.rows.filter((r) => r.occurred_at >= anchor);

  const avgBefore = average(beforeRows.map((r) => r.reward_score));
  const avgAfter = average(afterRows.map((r) => r.reward_score));
  const delta = avgBefore !== null && avgAfter !== null ? avgAfter - avgBefore : null;

  const windows = outcomeWindows(anchor, OUTCOME_WEEKS);
  const labels = windows.map((_, i) => `+${i + 1}週`);
  const reward = windows.map(({ start, end }) =>
    average(afterRows.filter((r) => r.occurred_at >= start && r.occurred_at < end).map((r) => r.reward_score))
  );

  return { labels, reward, stats: { avgAfter, delta, count: afterRows.length } };
}

// ---------------------------------------------------------------------------
// topTags — status='ok' 行の tags 頻度降順(同数はタグ名昇順)
// ---------------------------------------------------------------------------

export async function topTags(n: number = 8): Promise<{ tag: string; count: number }[]> {
  const result = await query<{ tags: string[] }>(`SELECT tags FROM timeline_records WHERE status = 'ok'`);

  const counts = new Map<string, number>();
  for (const row of result.rows) {
    for (const tag of row.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, n)
    .map(([tag, count]) => ({ tag, count }));
}

// ---------------------------------------------------------------------------
// getKnowledgeData — 画面向け集約(検索 / recent / selected / outcome / topTags)
// ---------------------------------------------------------------------------

const RECENT_LIMIT = 8;
const RECENT_TYPES = ["decision", "knowledge", "all"];

/**
 * q 空(または検索エラー時)の一覧: status='ok' + type フィルタ(既定 decision・
 * 3語彙外の不正値も decision 扱い・"all" で解除)+ tag 指定時 ANY(tags)。
 * ORDER BY occurred_at DESC NULLS LAST, id(タイブレーク = id)・LIMIT $1(params[0] = limit)。
 */
async function recentRecords(type: string | undefined, tag: string | undefined): Promise<KnowledgeHit[]> {
  const normalizedType = type && RECENT_TYPES.includes(type) ? type : "decision";

  const sqlParams: unknown[] = [RECENT_LIMIT];
  const filters: string[] = [];

  if (normalizedType !== "all") {
    sqlParams.push(normalizedType);
    filters.push(`AND type = $${sqlParams.length}`);
  }
  if (tag) {
    sqlParams.push(tag);
    filters.push(`AND $${sqlParams.length} = ANY(tags)`);
  }

  const filterSql = filters.length > 0 ? " " + filters.join(" ") : "";

  const result = await query<RecordRow>(
    `SELECT id, source, file_path, occurred_at, type, org, title, body, tags
       FROM timeline_records
      WHERE status = 'ok'${filterSql}
      ORDER BY occurred_at DESC NULLS LAST, id
      LIMIT $1`,
    sqlParams
  );
  return result.rows.map((row) => toHit(row, null));
}

async function fetchSelected(
  id: string,
  hits: KnowledgeHit[]
): Promise<(KnowledgeHit & { body: string | null }) | null> {
  if (!isValidUuid(id)) return null;

  const result = await query<RecordRow & { status: string }>(
    `SELECT id, source, file_path, occurred_at, type, org, title, body, tags, status
       FROM timeline_records
      WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row || row.status !== "ok") return null;

  const fromHits = hits.find((h) => h.id === id);
  return { ...toHit(row, fromHits ? fromHits.similarity : null), body: row.body };
}

export async function getKnowledgeData(
  params: KnowledgeSearchParams & { sel?: string }
): Promise<{
  hits: KnowledgeHit[];
  recent: KnowledgeHit[];
  selected: (KnowledgeHit & { body: string | null }) | null;
  outcome: Awaited<ReturnType<typeof decisionOutcome>>;
  topTags: { tag: string; count: number }[];
  searchError: boolean;
}> {
  const tags = await topTags();

  let hits: KnowledgeHit[] = [];
  let recent: KnowledgeHit[] = [];
  let searchError = false;

  if (params.q.trim() === "") {
    recent = await recentRecords(params.type, params.tag);
  } else {
    try {
      hits = await searchKnowledge(params);
    } catch {
      searchError = true;
      recent = await recentRecords(params.type, params.tag);
    }
  }

  const selectedId = params.sel ?? hits[0]?.id ?? recent[0]?.id ?? null;
  const selected = selectedId ? await fetchSelected(selectedId, hits) : null;
  const outcome = selected ? await decisionOutcome(selected.id) : null;

  return { hits, recent, selected, outcome, topTags: tags, searchError };
}
