// 対象設計: docs/design/detail/org-docs-ingestion.md §2.5(allowlist 拡張)/ §3(tests/org-docs-sync.test.ts)
// モックアダプタ + モック db(lib/ingestion/store)で実ネットワーク・実 DB なしに検証する
// (tests/ingestion/run-sync.test.ts と同じ M1 様式)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "../lib/ingestion/source";

const fakeDb = vi.hoisted(() => ({
  syncStates: new Map<string, { lastCommit: string | null; progress: unknown }>(),
  tagSynonyms: new Map<string, string>(),
  timelineRecords: new Map<string, unknown>(),
}));

vi.mock("../lib/ingestion/store", () => ({
  getSyncState: vi.fn(async (repo: string) => fakeDb.syncStates.get(repo) ?? null),
  saveSyncState: vi.fn(
    async (repo: string, state: { lastCommit: string | null; progress: unknown }) => {
      fakeDb.syncStates.set(repo, { lastCommit: state.lastCommit, progress: state.progress });
    }
  ),
  getAllTagSynonyms: vi.fn(async () => []),
  upsertTagSynonyms: vi.fn(async () => {}),
  upsertTimelineRecord: vi.fn(async (record: { source: string; file_path: string; item_key: string }) => {
    fakeDb.timelineRecords.set(`${record.source}|${record.file_path}|${record.item_key}`, record);
  }),
}));

const { runSync } = await import("../lib/ingestion/run-sync");

function resetFakeDb(): void {
  fakeDb.syncStates.clear();
  fakeDb.tagSynonyms.clear();
  fakeDb.timelineRecords.clear();
  vi.clearAllMocks();
}

beforeEach(() => {
  resetFakeDb();
  process.env.SYNC_SOURCE = "fixture";
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  delete process.env.SYNC_SOURCE;
  delete process.env.VERCEL_ENV;
});

function decisionContent(): string {
  return "# 2026-07-01 - タイトル\n\n本文\n";
}

// 2つの見出しブロック(各短文) → chunkMarkdown で2チャンクになる汎用ナレッジ内容。
function knowledgeContent(): string {
  return ["# デモ文書", "## 見出しA", "本文A", "", "## 見出しB", "本文B"].join("\n");
}

type DocsPath = { path: string; kind: "decision" | "knowledge" };

const DOCS_PATHS: DocsPath[] = [
  { path: ".companies/demo-org/docs/decisions/2026-07-01-a.md", kind: "decision" },
  { path: ".companies/demo-org/docs/daily-digest/2026-07-01.md", kind: "knowledge" },
  { path: ".companies/demo-org/docs/secretary/learning-notes/note-a.md", kind: "knowledge" },
  { path: ".companies/demo-org/docs/research/note.md", kind: "knowledge" },
  { path: ".companies/demo-org/docs/retail-domain/note.md", kind: "knowledge" },
  { path: ".companies/demo-org/docs/diagrams/note.md", kind: "knowledge" },
  { path: ".companies/demo-org/docs/drawio/note.md", kind: "knowledge" },
  { path: ".companies/demo-org/docs/info-source-master.md", kind: "knowledge" },
];

class FakeAdapter implements SourceAdapter {
  repo: "cc-sier-organization" | "ai-war-room" = "cc-sier-organization";
  private headSha: () => Promise<string>;
  private paths: () => Promise<string[]>;
  private fetchImpl: (path: string) => Promise<string>;

  constructor(opts: {
    head: () => Promise<string>;
    listPaths: () => Promise<string[]>;
    fetch: (path: string) => Promise<string>;
  }) {
    this.headSha = opts.head;
    this.paths = opts.listPaths;
    this.fetchImpl = opts.fetch;
  }

  head(): Promise<string> {
    return this.headSha();
  }
  changedPaths(_base: string | null): Promise<string[] | "full"> {
    return Promise.resolve("full");
  }
  listPaths(): Promise<string[]> {
    return this.paths();
  }
  fetch(path: string): Promise<string> {
    return this.fetchImpl(path);
  }
}

describe("runSync — docs 系 allowlist 8パターンが各マッチする", () => {
  it("8パターン全てが allowlist に一致し、decision/knowledge として ok 計上される", async () => {
    const adapter = new FakeAdapter({
      head: async () => "sha1",
      listPaths: async () => DOCS_PATHS.map((p) => p.path),
      fetch: async (path) => {
        const entry = DOCS_PATHS.find((p) => p.path === path)!;
        return entry.kind === "decision" ? decisionContent() : knowledgeContent();
      },
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]).toMatchObject({
      error: 0,
      skipped: 0,
      hasMore: false,
    });
    // decision 1件(1レコード)+ knowledge 7ファイル × 2チャンク = 1 + 14 = 15
    expect(summary.repos["cc-sier-organization"]!.ok).toBe(15);

    const decisionRecord = fakeDb.timelineRecords.get(
      "cc-sier-organization|.companies/demo-org/docs/decisions/2026-07-01-a.md|"
    ) as { type: string; org: string | null } | undefined;
    expect(decisionRecord?.type).toBe("decision");
    expect(decisionRecord?.org).toBe("demo-org");

    const knowledgeRecord = fakeDb.timelineRecords.get(
      "cc-sier-organization|.companies/demo-org/docs/daily-digest/2026-07-01.md|c0"
    ) as { type: string; org: string | null } | undefined;
    expect(knowledgeRecord?.type).toBe("knowledge");
    expect(knowledgeRecord?.org).toBe("demo-org");
  });
});

describe("runSync — 危険経路の遮断(skipped 計上・fetch 非到達)", () => {
  it("危険経路3種 + 小文字変種が skipped 計上され、取り込みレコードが0件になる", async () => {
    const deniedPaths = [
      ".companies/demo-org/docs/research/CLAUDE.md",
      ".companies/demo-org/docs/research/sub/MEMORY.md",
      ".companies/demo-org/docs/secretary/learning-notes/personality-profile-demo.md",
      ".companies/demo-org/docs/research/claude.md", // 小文字変種
    ];
    const fetchMock = vi.fn(async () => "demo fixture for deny test\n");
    const adapter = new FakeAdapter({
      head: async () => "sha1",
      listPaths: async () => deniedPaths,
      fetch: fetchMock,
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]).toMatchObject({
      ok: 0,
      error: 0,
      skipped: 4,
      hasMore: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeDb.timelineRecords.size).toBe(0);
  });
});

describe("runSync — 冪等(同一ファイル2回同期 → 行数不変・upsert 更新のみ)", () => {
  it("digest ファイルを2回同期しても timeline_records の行数(チャンク数)は変わらない", async () => {
    const path = ".companies/demo-org/docs/daily-digest/2026-07-02.md";
    let currentHead = "sha1";
    const adapter = new FakeAdapter({
      head: async () => currentHead,
      listPaths: async () => [path],
      fetch: async () => knowledgeContent(),
    });

    const first = await runSync([adapter], { maxFiles: 0 });
    expect(first.repos["cc-sier-organization"]).toMatchObject({ ok: 2, hasMore: false });
    expect(fakeDb.timelineRecords.size).toBe(2);

    // head 変化で再処理させる(force なしでも progress 破棄 → 全量再処理される)。
    currentHead = "sha2";
    const second = await runSync([adapter], { maxFiles: 0 });
    expect(second.repos["cc-sier-organization"]).toMatchObject({ ok: 2, hasMore: false });
    expect(fakeDb.timelineRecords.size).toBe(2); // 行数不変(同一 item_key への upsert)
  });
});
