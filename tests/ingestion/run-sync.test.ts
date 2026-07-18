// 対象設計: docs/design/detail/ingestion-foundation.md §2.3(同期オーケストレーション・進行保証)/ §3
//          docs/design/detail/org-docs-ingestion.md §0-1(第3の凍結例外)/ §3(新期待値 ok:13/skipped:3)
// モックアダプタ + モック db(lib/ingestion/store)で実ネットワーク・実 DB なしに検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceNotFoundError, type SourceAdapter } from "../../lib/ingestion/source";

// lib/ingestion/store を丸ごとモックし、インメモリの疑似 DB として振る舞わせる。
const fakeDb = vi.hoisted(() => ({
  syncStates: new Map<string, { lastCommit: string | null; progress: unknown }>(),
  tagSynonyms: new Map<string, string>(),
  timelineRecords: new Map<string, unknown>(),
}));

vi.mock("../../lib/ingestion/store", () => ({
  getSyncState: vi.fn(async (repo: string) => fakeDb.syncStates.get(repo) ?? null),
  saveSyncState: vi.fn(
    async (repo: string, state: { lastCommit: string | null; progress: unknown }) => {
      fakeDb.syncStates.set(repo, { lastCommit: state.lastCommit, progress: state.progress });
    }
  ),
  getAllTagSynonyms: vi.fn(async () =>
    Array.from(fakeDb.tagSynonyms.entries()).map(([synonym, canonical]) => ({ synonym, canonical }))
  ),
  upsertTagSynonyms: vi.fn(async (entries: { synonym: string; canonical: string }[]) => {
    for (const e of entries) fakeDb.tagSynonyms.set(e.synonym, e.canonical);
  }),
  upsertTimelineRecord: vi.fn(async (record: { source: string; file_path: string; item_key: string }) => {
    fakeDb.timelineRecords.set(`${record.source}|${record.file_path}|${record.item_key}`, record);
  }),
}));

const { runSync } = await import("../../lib/ingestion/run-sync");
const store = await import("../../lib/ingestion/store");

function resetFakeDb(): void {
  fakeDb.syncStates.clear();
  fakeDb.tagSynonyms.clear();
  fakeDb.timelineRecords.clear();
  vi.clearAllMocks();
}

function decisionContent(title: string): string {
  return `# 2026-06-01 - ${title}\n\n本文\n`;
}

type AdapterOverrides = Partial<{
  head: () => Promise<string>;
  changedPaths: (base: string | null) => Promise<string[] | "full">;
  listPaths: () => Promise<string[]>;
  fetch: (path: string) => Promise<string>;
}>;

class FakeAdapter implements SourceAdapter {
  repo: "cc-sier-organization" | "ai-war-room";
  private overrides: AdapterOverrides;

  constructor(repo: "cc-sier-organization" | "ai-war-room", overrides: AdapterOverrides = {}) {
    this.repo = repo;
    this.overrides = overrides;
  }

  head(): Promise<string> {
    return (this.overrides.head ?? (async () => "sha-default"))();
  }
  changedPaths(base: string | null): Promise<string[] | "full"> {
    return (this.overrides.changedPaths ?? (async () => "full" as const))(base);
  }
  listPaths(): Promise<string[]> {
    return (this.overrides.listPaths ?? (async () => []))();
  }
  fetch(path: string): Promise<string> {
    return (this.overrides.fetch ?? (async () => ""))(path);
  }
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

describe("runSync — FixtureSource 集計(単位どおり)", () => {
  it("実 fixtures を用いて ok/error/skipped/deleted/fetch_failed を正しく集計する", async () => {
    const { FixtureSource } = await import("../../lib/ingestion/fixture-source");
    const adapters: SourceAdapter[] = [
      new FixtureSource("cc-sier-organization"),
      new FixtureSource("ai-war-room"),
    ];

    const summary = await runSync(adapters, { maxFiles: 0 });

    // cc-sier: task-log(ok2/error1)+ case-bank(ok2/error1)+ quality-gate(ok2/error1)
    // + org-docs-ingestion(0004・8 type)追加分: 組織 decision(ok1)+ digest チャンク(ok3)
    // + learning-note チャンク(ok3)= ok13。skipped3 は危険経路 fixture(CLAUDE.md /
    // MEMORY.md / personality-profile-demo.md)の denylist 遮断(恒常検証)。
    expect(summary.repos["cc-sier-organization"]).toMatchObject({
      ok: 13,
      error: 3,
      skipped: 3,
      deleted: 0,
      fetch_failed: 0,
      hasMore: false,
      sourceKind: "fixture",
    });

    // docs 系レコードの存在検証(org-docs-ingestion §2.5 の allowlist 拡張の恒常確認)。
    const ccSierRecords: { type: string; org: string | null }[] = [];
    for (const [key, record] of fakeDb.timelineRecords.entries()) {
      if (key.startsWith("cc-sier-organization|")) {
        ccSierRecords.push(record as { type: string; org: string | null });
      }
    }
    expect(ccSierRecords.filter((r) => r.type === "decision")).toHaveLength(1);
    expect(ccSierRecords.filter((r) => r.type === "knowledge")).toHaveLength(6);
    const orgDecision = ccSierRecords.find((r) => r.type === "decision");
    expect(orgDecision?.org).toBe("demo-org");

    // ai-war-room: decisions(ok1/error2)+ logs(ok1/error2)
    expect(summary.repos["ai-war-room"]).toMatchObject({
      ok: 2,
      error: 4,
      skipped: 0,
      deleted: 0,
      fetch_failed: 0,
      hasMore: false,
      sourceKind: "fixture",
    });

    // masters 3ファイルは索引レコードを作らないが tag_synonyms には投入される
    expect(fakeDb.tagSynonyms.size).toBeGreaterThan(0);
  });
});

describe("runSync — maxFiles 超過 → hasMore + last_commit 据え置き → 2回目実行で完了", () => {
  it("1回目は一部だけ処理して hasMore、2回目で残りを処理して完了する", async () => {
    const paths = [
      "docs/decisions/2026-06-01-a.md",
      "docs/decisions/2026-06-01-b.md",
      "docs/decisions/2026-06-01-c.md",
      "docs/decisions/2026-06-01-d.md",
      "docs/decisions/2026-06-01-e.md",
    ];
    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => "sha1",
      listPaths: async () => paths,
      fetch: async (path) => decisionContent(path),
    });

    const first = await runSync([adapter], { maxFiles: 3 });
    expect(first.repos["ai-war-room"]).toMatchObject({ ok: 3, hasMore: true, headCommit: "sha1" });

    const savedAfterFirst = fakeDb.syncStates.get("ai-war-room");
    expect(savedAfterFirst?.lastCommit).toBeNull(); // 据え置き(初回のため null のまま)
    expect((savedAfterFirst?.progress as { done: string[] }).done).toHaveLength(3);

    const second = await runSync([adapter], { maxFiles: 3 });
    expect(second.repos["ai-war-room"]).toMatchObject({ ok: 2, hasMore: false, headCommit: "sha1" });

    const savedAfterSecond = fakeDb.syncStates.get("ai-war-room");
    expect(savedAfterSecond?.lastCommit).toBe("sha1");
    expect(savedAfterSecond?.progress).toBeNull();
  });
});

describe("runSync — head 変化で progress 破棄", () => {
  it("2回目で head が変わると progress.done を無視して再処理する", async () => {
    const paths = ["docs/logs/2026-06-01.md", "docs/logs/2026-06-02.md"];
    let currentHead = "shaA";
    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => currentHead,
      listPaths: async () => paths,
      fetch: async () => "# 日報 — タイトル\n\n本文\n",
    });

    const first = await runSync([adapter], { maxFiles: 1 });
    expect(first.repos["ai-war-room"]).toMatchObject({ ok: 1, hasMore: true, headCommit: "shaA" });

    currentHead = "shaB";
    const second = await runSync([adapter], { maxFiles: 0 });
    // progress が破棄され、両ファイルとも再処理される(1件だけではない)
    expect(second.repos["ai-war-room"]).toMatchObject({ ok: 2, hasMore: false, headCommit: "shaB" });

    const saved = fakeDb.syncStates.get("ai-war-room");
    expect(saved?.lastCommit).toBe("shaB");
    expect(saved?.progress).toBeNull();
  });
});

describe("runSync — 一時 fetch 失敗 → done 非追加で次回再試行", () => {
  it("一時失敗したファイルは done に入らず、次回成功すれば完了する", async () => {
    const okPath = "docs/logs/2026-06-01.md";
    const failPath = "docs/logs/2026-06-02.md";
    let shouldFail = true;

    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => "sha1",
      listPaths: async () => [okPath, failPath],
      fetch: async (path) => {
        if (path === failPath && shouldFail) {
          throw new Error("transient network error");
        }
        return "# 日報 — タイトル\n\n本文\n";
      },
    });

    const first = await runSync([adapter], { maxFiles: 0 });
    expect(first.repos["ai-war-room"]).toMatchObject({
      ok: 1,
      fetch_failed: 1,
      hasMore: true,
      headCommit: "sha1",
    });
    const savedAfterFirst = fakeDb.syncStates.get("ai-war-room");
    expect(savedAfterFirst?.lastCommit).toBeNull();

    shouldFail = false;
    const second = await runSync([adapter], { maxFiles: 0 });
    expect(second.repos["ai-war-room"]).toMatchObject({
      ok: 1,
      fetch_failed: 0,
      hasMore: false,
      headCommit: "sha1",
    });
    const savedAfterSecond = fakeDb.syncStates.get("ai-war-room");
    expect(savedAfterSecond?.lastCommit).toBe("sha1");
  });
});

describe("runSync — 404(削除)→ done 直行・deleted 計上でカーソルが停止しない / no-op", () => {
  it("404 のファイルは即 done + deleted 計上され、完了後の再実行は no-op になる", async () => {
    const deletedPath = "docs/logs/2026-06-01.md";
    const okPath = "docs/logs/2026-06-02.md";

    const fetchMock = vi.fn(async (path: string) => {
      if (path === deletedPath) throw new SourceNotFoundError("gone");
      return "# 日報 — タイトル\n\n本文\n";
    });
    const changedPathsMock = vi.fn(async () => "full" as const);
    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => "sha1",
      changedPaths: changedPathsMock,
      listPaths: async () => [deletedPath, okPath],
      fetch: fetchMock,
    });

    const first = await runSync([adapter], { maxFiles: 0 });
    expect(first.repos["ai-war-room"]).toMatchObject({
      ok: 1,
      deleted: 1,
      hasMore: false,
      headCommit: "sha1",
    });
    const saved = fakeDb.syncStates.get("ai-war-room");
    expect(saved?.lastCommit).toBe("sha1");
    expect(saved?.progress).toBeNull();

    // no-op: head が変わっていないので changedPaths/fetch は再度呼ばれない
    changedPathsMock.mockClear();
    fetchMock.mockClear();
    const second = await runSync([adapter], { maxFiles: 0 });
    expect(second.repos["ai-war-room"]).toMatchObject({
      ok: 0,
      error: 0,
      skipped: 0,
      deleted: 0,
      fetch_failed: 0,
      hasMore: false,
      headCommit: "sha1",
    });
    expect(changedPathsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runSync — denylist 除外(skipped 計上・fetch 前除外)", () => {
  it("allowlist に一致しても denylist 該当パスは fetch されず skipped に計上される", async () => {
    const deniedPath = "docs/decisions/2026-06-01-profile.md"; // allowlist 一致 + denylist 一致('profile')
    const okPath = "docs/decisions/2026-06-01-ok.md";
    const fetchMock = vi.fn(async () => decisionContent("ok"));

    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => "sha1",
      listPaths: async () => [deniedPath, okPath],
      fetch: fetchMock,
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["ai-war-room"]).toMatchObject({ ok: 1, skipped: 1, hasMore: false });
    expect(fetchMock).not.toHaveBeenCalledWith(deniedPath);
  });
});

describe("runSync — production + SYNC_SOURCE=fixture → エラー", () => {
  it("VERCEL_ENV=production かつ SYNC_SOURCE=fixture は同期を実行せずエラーになる", async () => {
    process.env.VERCEL_ENV = "production";
    const adapter = new FakeAdapter("ai-war-room", {});
    await expect(runSync([adapter])).rejects.toThrow();
  });
});

describe("runSync — force で全量再処理 + 完了時 sync_state 更新", () => {
  it("sync_state が最新(no-op 相当)でも force なら全量を再処理する", async () => {
    const paths = ["docs/logs/2026-06-01.md", "docs/logs/2026-06-02.md"];
    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => "sha1",
      listPaths: async () => paths,
      fetch: async () => "# 日報 — タイトル\n\n本文\n",
    });

    // 最新状態を事前に用意(force なしなら no-op になる状態)
    fakeDb.syncStates.set("ai-war-room", { lastCommit: "sha1", progress: null });

    const summary = await runSync([adapter], { maxFiles: 0, force: true });
    expect(summary.repos["ai-war-room"]).toMatchObject({ ok: 2, hasMore: false, headCommit: "sha1" });

    const saved = fakeDb.syncStates.get("ai-war-room");
    expect(saved?.lastCommit).toBe("sha1");
    expect(saved?.progress).toBeNull();
    expect(store.upsertTimelineRecord).toHaveBeenCalled();
  });
});

describe("runSync — masters 3ファイル → tag_synonyms upsert(索引レコードは作らない)", () => {
  it("masters ファイルは tag_synonyms へ反映され、timeline_records には作られない", async () => {
    const mastersPath = ".companies/demo-org/masters/departments.md";
    const adapter = new FakeAdapter("cc-sier-organization", {
      head: async () => "sha1",
      listPaths: async () => [mastersPath],
      fetch: async () => "# 部署\n- テスト部\n",
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]).toMatchObject({
      ok: 0,
      error: 0,
      hasMore: false,
    });
    expect(fakeDb.tagSynonyms.get("テスト部")).toBe("テスト部");
    expect(store.upsertTimelineRecord).not.toHaveBeenCalled();
  });

  it("語彙はラン冒頭のスナップショットを使う(同ランの masters upsert は同ランの他ファイルに反映されない)", async () => {
    const mastersPath = ".companies/demo-org/masters/departments.md";
    const taskPath = ".companies/demo-org/.task-log/20260601-090000-x.md";
    const taskContent = [
      "---",
      'task_id: "20260601-090000-x"',
      'org: "demo-org"',
      'started: "2026-06-01T09:00:00+09:00"',
      'request: "テスト部の話をするタスク"',
      "---",
      "",
      "## reward",
      "```yaml",
      "score: 0.5",
      "```",
      "",
    ].join("\n");

    const adapter = new FakeAdapter("cc-sier-organization", {
      head: async () => "sha1",
      // masters を先に処理させる順序で返す
      listPaths: async () => [mastersPath, taskPath],
      fetch: async (path) => (path === mastersPath ? "# 部署\n- テスト部\n" : taskContent),
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["cc-sier-organization"]).toMatchObject({ ok: 1, error: 0 });

    const record = fakeDb.timelineRecords.get(
      "cc-sier-organization|.companies/demo-org/.task-log/20260601-090000-x.md|"
    ) as { tags: string[] } | undefined;
    expect(record).toBeDefined();
    expect(record?.tags).not.toContain("テスト部");
  });
});

describe("runSync — no-op(head 未変化)", () => {
  it("last_commit と head が一致していれば処理を一切行わない", async () => {
    fakeDb.syncStates.set("ai-war-room", { lastCommit: "sha1", progress: null });
    const changedPathsMock = vi.fn(async () => "full" as const);
    const listPathsMock = vi.fn(async () => []);
    const fetchMock = vi.fn(async () => "");

    const adapter = new FakeAdapter("ai-war-room", {
      head: async () => "sha1",
      changedPaths: changedPathsMock,
      listPaths: listPathsMock,
      fetch: fetchMock,
    });

    const summary = await runSync([adapter], { maxFiles: 0 });
    expect(summary.repos["ai-war-room"]).toMatchObject({
      ok: 0,
      error: 0,
      skipped: 0,
      deleted: 0,
      fetch_failed: 0,
      hasMore: false,
      headCommit: "sha1",
    });
    expect(changedPathsMock).not.toHaveBeenCalled();
    expect(listPathsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
