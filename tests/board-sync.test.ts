// 対象設計: docs/design/detail/today-view.md §2.3(run-sync 拡張)/ §3(tests/board-sync.test.ts)
// モックアダプタ + モック db(lib/ingestion/store)で実ネットワーク・実 DB なしに検証する
// (tests/ingestion/run-sync.test.ts / tests/org-docs-sync.test.ts と同じ M1 様式)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "../lib/ingestion/source";

const fakeDb = vi.hoisted(() => ({
  syncStates: new Map<string, { lastCommit: string | null; progress: unknown }>(),
  tagSynonyms: new Map<string, string>(),
  timelineRecords: new Map<string, unknown>(),
  boardItems: new Map<string, unknown>(),
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
  upsertBoardItems: vi.fn(
    async (
      source: string,
      filePath: string,
      commit: string,
      org: string | null,
      items: { itemKey: string; state: string }[]
    ) => {
      for (const item of items) {
        fakeDb.boardItems.set(`${source}|${filePath}|${item.itemKey}`, {
          ...item,
          source,
          filePath,
          commit,
          org,
        });
      }
    }
  ),
}));

const { runSync } = await import("../lib/ingestion/run-sync");
const store = await import("../lib/ingestion/store");

function resetFakeDb(): void {
  fakeDb.syncStates.clear();
  fakeDb.tagSynonyms.clear();
  fakeDb.timelineRecords.clear();
  fakeDb.boardItems.clear();
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

function boardMarkdown(): string {
  return [
    "## セクション",
    "",
    "| WBS | タスク | ステータス |",
    "|---|---|---|",
    "| W-1 | タスク1 | [ ] |",
    "| W-2 | タスク2 | [~] |",
    "| W-3 | 状態外 | [?] |",
    "",
  ].join("\n");
}

describe("runSync — WBS ファイルが board 経路に乗る(ok/error/skipped 非計上)", () => {
  it("board = { files, items, skippedRows } が計上され、ok/error/skipped は増えない", async () => {
    const path = ".companies/demo-org/docs/secretary/project-wbs.md";
    const adapter = new FakeAdapter({
      head: async () => "sha1",
      listPaths: async () => [path],
      fetch: async () => boardMarkdown(),
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]).toMatchObject({
      ok: 0,
      error: 0,
      skipped: 0,
      hasMore: false,
    });
    expect(summary.repos["cc-sier-organization"]!.board).toEqual({ files: 1, items: 2, skippedRows: 1 });
    expect(fakeDb.timelineRecords.size).toBe(0);
    expect(fakeDb.boardItems.size).toBe(2);
    expect(store.upsertBoardItems).toHaveBeenCalled();
  });
});

describe("runSync — denylist が board より先に効く", () => {
  it("profile-wbs.md 相当は denylist で遮断され、fetch されず board にも計上されない", async () => {
    const deniedPath = ".companies/demo-org/docs/secretary/profile-wbs.md";
    const fetchMock = vi.fn(async () => boardMarkdown());
    const adapter = new FakeAdapter({
      head: async () => "sha1",
      listPaths: async () => [deniedPath],
      fetch: fetchMock,
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]).toMatchObject({
      ok: 0,
      error: 0,
      skipped: 1,
      hasMore: false,
    });
    expect(summary.repos["cc-sier-organization"]!.board).toEqual({ files: 0, items: 0, skippedRows: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.upsertBoardItems).not.toHaveBeenCalled();
  });
});

describe("runSync — board 冪等(2回同期 → 行数不変・state/commit 更新)", () => {
  it("同一ファイルを2回同期しても board_items 相当行の件数は変わらず、state/commit が更新される", async () => {
    const path = ".companies/demo-org/docs/secretary/iter-wbs.md";
    let currentHead = "sha1";
    let content = ["| WBS | タスク | ステータス |", "|---|---|---|", "| W-1 | タスク1 | [ ] |", ""].join(
      "\n"
    );
    const adapter = new FakeAdapter({
      head: async () => currentHead,
      listPaths: async () => [path],
      fetch: async () => content,
    });

    const first = await runSync([adapter], { maxFiles: 0 });
    expect(first.repos["cc-sier-organization"]!.board).toEqual({ files: 1, items: 1, skippedRows: 0 });
    expect(fakeDb.boardItems.size).toBe(1);
    const firstRow = fakeDb.boardItems.get(`cc-sier-organization|${path}|W-1`) as
      | { state: string; commit: string }
      | undefined;
    expect(firstRow?.state).toBe("todo");
    expect(firstRow?.commit).toBe("sha1");

    currentHead = "sha2";
    content = ["| WBS | タスク | ステータス |", "|---|---|---|", "| W-1 | タスク1 | [x] |", ""].join("\n");
    const second = await runSync([adapter], { maxFiles: 0 });
    expect(second.repos["cc-sier-organization"]!.board).toEqual({ files: 1, items: 1, skippedRows: 0 });
    expect(fakeDb.boardItems.size).toBe(1); // 行数不変(同一 item_key への upsert)
    const secondRow = fakeDb.boardItems.get(`cc-sier-organization|${path}|W-1`) as
      | { state: string; commit: string }
      | undefined;
    expect(secondRow?.state).toBe("done");
    expect(secondRow?.commit).toBe("sha2");
  });
});

describe("runSync — 実 fixtures(FixtureSource)統合: demo-plan-wbs.md", () => {
  it("board = { files: 1, items: 4, skippedRows: 4 } を計上する(§2.7 期待値の消費主体)", async () => {
    const { FixtureSource } = await import("../lib/ingestion/fixture-source");
    const adapters: SourceAdapter[] = [
      new FixtureSource("cc-sier-organization"),
      new FixtureSource("ai-war-room"),
    ];

    const summary = await runSync(adapters, { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]!.board).toEqual({ files: 1, items: 4, skippedRows: 4 });
  });
});
