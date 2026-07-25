import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.3(同期オーケストレーション・進行カーソル)
//          docs/design/basic/ingestion-foundation.md §2.1(allowlist)
//          docs/design/detail/org-docs-ingestion.md §2.5(docs 系 allowlist 拡張)
//
// repo ごとに「進行カーソル方式」で livelock せず前進する同期オーケストレーション。
// SourceAdapter 経由でのみ GitHub(または FixtureSource)にアクセスする。

import { applyTags, isDenied, orgFromPath } from "./normalize";
import { buildTagVocab, mergeTagVocab } from "./tag-vocab";
import { parseBoard } from "./parsers/board";
import { parseCaseBank } from "./parsers/case-bank";
import { parseDailyLog } from "./parsers/daily-log";
import { parseDecision } from "./parsers/decision";
import { parseKnowledge } from "./parsers/knowledge";
import { parseQualityGate } from "./parsers/quality-gate";
import { parseTaskLog } from "./parsers/task-log";
import type { NormalizedRecord, ParseMeta, Parser, SourceFile } from "./parsers/types";
import { SourceNotFoundError, type SourceAdapter } from "./source";
import {
  getAllTagSynonyms,
  getSyncState,
  saveSyncState,
  upsertBoardItems,
  upsertTagSynonyms,
  upsertTimelineRecord,
  type SyncProgress,
} from "./store";

export type SourceKind = "github" | "fixture";

export type RepoSyncSummary = {
  ok: number;
  error: number;
  skipped: number;
  deleted: number;
  fetch_failed: number;
  hasMore: boolean;
  headCommit: string;
  sourceKind: SourceKind;
  board: { files: number; items: number; skippedRows: number };
};

export type SyncSummary = { repos: Record<string, RepoSyncSummary> };

export type RunSyncOptions = { maxFiles?: number; force?: boolean };

// ---------------------------------------------------------------------------
// allowlist(基本設計 §2.1 の6パターン + org-docs-ingestion §2.5 の docs 系8パターン・repo スコープ)
// ---------------------------------------------------------------------------

type AllowMatch =
  | { kind: "record"; parser: Parser }
  | { kind: "masters" }
  | { kind: "board" };

const TASK_LOG_RE = /^\.companies\/[^/]+\/\.task-log\/[^/]+\.md$/;
const CASE_BANK_RE = /^\.companies\/[^/]+\/\.case-bank\/index\.json$/;
const QUALITY_GATE_RE = /^\.companies\/[^/]+\/\.quality-gate-log\/[^/]+\.jsonl$/;
const MASTERS_RE = /^\.companies\/[^/]+\/masters\/(?:departments|roles|workflows)\.md$/;
const DECISIONS_RE = /^docs\/decisions\/[^/]+\.md$/;
const LOGS_RE = /^docs\/logs\/[^/]+\.md$/;

// org-docs-ingestion §2.5: cc-sier-organization の `.companies/<org>/docs/...` 配下。
const ORG_DECISIONS_RE = /^\.companies\/[^/]+\/docs\/decisions\/[^/]+\.md$/;
const ORG_DAILY_DIGEST_RE = /^\.companies\/[^/]+\/docs\/daily-digest\/[^/]+\.md$/;
const ORG_LEARNING_NOTES_RE = /^\.companies\/[^/]+\/docs\/secretary\/learning-notes\/[^/]+\.md$/;
const ORG_RESEARCH_RE = /^\.companies\/[^/]+\/docs\/research\/.+\.md$/;
const ORG_RETAIL_DOMAIN_RE = /^\.companies\/[^/]+\/docs\/retail-domain\/.+\.md$/;
const ORG_DIAGRAMS_RE = /^\.companies\/[^/]+\/docs\/diagrams\/[^/]+\.md$/;
const ORG_DRAWIO_RE = /^\.companies\/[^/]+\/docs\/drawio\/[^/]+\.md$/;
const ORG_INFO_SOURCE_MASTER_RE = /^\.companies\/[^/]+\/docs\/info-source-master\.md$/;

// today-view §2.3: WBS 表(kanban 取り込み基盤)。org-docs 系と同じ repo スコープ。
const BOARD_RE = /^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/;

function matchAllowlist(repo: string, path: string): AllowMatch | null {
  if (repo === "cc-sier-organization") {
    if (TASK_LOG_RE.test(path)) return { kind: "record", parser: parseTaskLog };
    if (CASE_BANK_RE.test(path)) return { kind: "record", parser: parseCaseBank };
    if (QUALITY_GATE_RE.test(path)) return { kind: "record", parser: parseQualityGate };
    if (MASTERS_RE.test(path)) return { kind: "masters" };
    if (ORG_DECISIONS_RE.test(path)) return { kind: "record", parser: parseDecision };
    if (ORG_DAILY_DIGEST_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (ORG_LEARNING_NOTES_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (ORG_RESEARCH_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (ORG_RETAIL_DOMAIN_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (ORG_DIAGRAMS_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (ORG_DRAWIO_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (ORG_INFO_SOURCE_MASTER_RE.test(path)) return { kind: "record", parser: parseKnowledge };
    if (BOARD_RE.test(path)) return { kind: "board" };
    return null;
  }
  if (repo === "ai-war-room") {
    if (DECISIONS_RE.test(path)) return { kind: "record", parser: parseDecision };
    if (LOGS_RE.test(path)) return { kind: "record", parser: parseDailyLog };
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

function resolveMaxFiles(explicit: number | undefined): number {
  if (typeof explicit === "number") return explicit;
  const raw = process.env.SYNC_MAX_FILES;
  if (raw === undefined || raw === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 100;
}

function resolveSourceKind(): SourceKind {
  return process.env.SYNC_SOURCE === "fixture" ? "fixture" : "github";
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export async function runSync(
  adapters: SourceAdapter[],
  opts: RunSyncOptions = {}
): Promise<SyncSummary> {
  const sourceKind = resolveSourceKind();
  const isProduction = process.env.VERCEL_ENV === "production";
  if (sourceKind === "fixture" && isProduction) {
    throw new Error(
      "[lib/ingestion/run-sync] SYNC_SOURCE=fixture is not allowed when VERCEL_ENV=production"
    );
  }

  const maxFiles = resolveMaxFiles(opts.maxFiles);
  const force = opts.force ?? false;

  // 語彙 = tag_synonyms 全件をラン冒頭に一度だけロードする。ラン中の masters upsert は
  // mergeTagVocab でこの配列にも即時反映し、同ランの後続ファイルに反映する
  // (コールドスタートでも初回ランからタグが付く — tag-cold-start 設計 §3)。
  // 配列は adapters 間で参照共有され、先頭 repo(cc-sier-organization = 語彙の供給源)で
  // 取り込んだ語彙が後続 repo にも効く(buildAdapters の順序が前提)。
  const vocab = await getAllTagSynonyms();

  const repos: Record<string, RepoSyncSummary> = {};
  for (const adapter of adapters) {
    repos[adapter.repo] = await syncRepo(adapter, { maxFiles, force, sourceKind, vocab });
  }
  return { repos };
}

async function syncRepo(
  adapter: SourceAdapter,
  ctx: {
    maxFiles: number;
    force: boolean;
    sourceKind: SourceKind;
    vocab: { synonym: string; canonical: string }[];
  }
): Promise<RepoSyncSummary> {
  const { maxFiles, force, sourceKind, vocab } = ctx;
  const repo = adapter.repo;

  const head = await adapter.head();

  // force でも実際に永続化されている値は読む(hasMore 時に据え置く last_commit の
  // 復元元として使う。force は「処理対象の決定」にのみ sync_state を無視する)。
  const actualState = await getSyncState(repo);
  const effectiveState = force ? null : actualState;

  if (!force && effectiveState && effectiveState.lastCommit === head) {
    // no-op: 前回と HEAD が変わっていない
    return {
      ok: 0,
      error: 0,
      skipped: 0,
      deleted: 0,
      fetch_failed: 0,
      hasMore: false,
      headCommit: head,
      sourceKind,
      board: { files: 0, items: 0, skippedRows: 0 },
    };
  }

  const base = effectiveState?.lastCommit ?? null;
  const changed = await adapter.changedPaths(base);
  const candidatePaths = changed === "full" ? await adapter.listPaths() : changed;

  // allowlist → denylist(パス列挙段階で除外・skipped 計上)
  let skipped = 0;
  const filtered: { path: string; match: AllowMatch }[] = [];
  for (const path of candidatePaths) {
    const match = matchAllowlist(repo, path);
    if (!match) continue; // allowlist に無いパスは対象外(計上なし)
    if (isDenied(path)) {
      skipped += 1;
      continue;
    }
    filtered.push({ path, match });
  }

  // 再開判定: progress.head == head の時だけ done を引き継ぐ。違えば破棄。
  let doneSet: Set<string>;
  if (!force && effectiveState?.progress && effectiveState.progress.head === head) {
    doneSet = new Set(effectiveState.progress.done);
  } else {
    doneSet = new Set();
  }

  const pending = filtered.filter((f) => !doneSet.has(f.path));

  // masters を先頭に安定パーティションしてからスライスする(各グループ内の相対順は維持)。
  // 語彙の供給源を必ず先に処理することで、コールドスタートの初回バッチでも
  // レコード処理時に語彙が揃う(tag-cold-start 設計 §3)。
  const ordered = [
    ...pending.filter((f) => f.match.kind === "masters"),
    ...pending.filter((f) => f.match.kind !== "masters"),
  ];
  const toProcess = maxFiles === 0 ? ordered : ordered.slice(0, maxFiles);

  let ok = 0;
  let error = 0;
  let deleted = 0;
  let fetchFailed = 0;
  let boardFiles = 0;
  let boardItems = 0;
  let boardSkippedRows = 0;

  for (const { path, match } of toProcess) {
    let content: string;
    try {
      content = await adapter.fetch(path);
    } catch (err) {
      if (err instanceof SourceNotFoundError) {
        // 削除とみなす: done 直行 + deleted 計上(カーソルを止めない)
        deleted += 1;
        doneSet.add(path);
        continue;
      }
      // 一時失敗: done に入れない(次回再試行)
      fetchFailed += 1;
      continue;
    }

    if (match.kind === "masters") {
      const entries = buildTagVocab([{ path, content }]);
      if (entries.length > 0) {
        await upsertTagSynonyms(entries);
        mergeTagVocab(vocab, entries);
      }
      doneSet.add(path);
      continue;
    }

    if (match.kind === "board") {
      const { items, skippedRows } = parseBoard({ path, content });
      await upsertBoardItems(repo, path, head, orgFromPath(path), items);
      boardFiles += 1;
      boardItems += items.length;
      boardSkippedRows += skippedRows;
      doneSet.add(path);
      continue;
    }

    const meta: ParseMeta = { source: repo, commit: head, org: orgFromPath(path) };
    const file: SourceFile = { path, content };
    const records = match.parser(file, meta);
    for (const record of records) {
      const tagInput = `${record.title ?? ""} ${record.body ?? ""}`;
      const tagged: NormalizedRecord = { ...record, tags: applyTags(tagInput, vocab) };
      await upsertTimelineRecord(tagged);
      if (tagged.status === "ok") ok += 1;
      else error += 1;
    }
    doneSet.add(path);
  }

  const notYetDone = filtered.filter((f) => !doneSet.has(f.path));
  const hasMore = notYetDone.length > 0;

  const summary: RepoSyncSummary = {
    ok,
    error,
    skipped,
    deleted,
    fetch_failed: fetchFailed,
    hasMore,
    headCommit: head,
    sourceKind,
    board: { files: boardFiles, items: boardItems, skippedRows: boardSkippedRows },
  };

  if (hasMore) {
    const progress: SyncProgress = { head, done: Array.from(doneSet) };
    await saveSyncState(repo, {
      lastCommit: actualState?.lastCommit ?? null, // 据え置き
      lastSummary: summary,
      progress,
    });
  } else {
    await saveSyncState(repo, {
      lastCommit: head,
      lastSummary: summary,
      progress: null,
    });
  }

  return summary;
}
