// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(logs 行)
//          docs/design/detail/ingestion-foundation.md §2.2 / §3(tests/parsers/daily-log.test.ts)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDailyLog } from "../../lib/ingestion/parsers/daily-log";
import type { SourceFile } from "../../lib/ingestion/parsers/types";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURE_DIR = join(REPO_ROOT, "fixtures", "ai-war-room", "docs", "logs");

function loadFixture(name: string): SourceFile {
  return {
    path: `docs/logs/${name}`,
    content: readFileSync(join(FIXTURE_DIR, name), "utf8"),
  };
}

const META = { source: "ai-war-room", commit: "abc123", org: null };

describe("parseDailyLog", () => {
  it("ファイル名日付 + H1 全体を正しく正規化する", () => {
    const file = loadFixture("2026-06-01.md");
    const records = parseDailyLog(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.type).toBe("daily_log");
    expect(record.org).toBeNull();
    expect(record.item_key).toBe("");
    expect(record.occurred_at?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(record.title).toBe("日報 — 2026-06-01 (月)");
    expect(record.topic).toBe("daily");
  });

  it("規則外のファイル名命名は error", () => {
    const file = loadFixture("not-a-date.md");
    const records = parseDailyLog(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].occurred_at).toBeNull();
  });

  it("H1 が無い場合は error", () => {
    const file = loadFixture("2026-06-02.md");
    const records = parseDailyLog(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
  });
});

// 追加(M5-A・organize-loop §2.4): slot 付きファイル名 + frontmatter 剥離(凍結例外への追加のみ)。
describe("parseDailyLog: M5 整理ループ生成物(FILENAME_RE 拡張 + frontmatter 剥離)", () => {
  it("slot 付きファイル名(YYYY-MM-DD-<slot>.md)は ok", () => {
    const file: SourceFile = {
      path: "docs/logs/2026-07-20-morning.md",
      content: "# 2026-07-20 morning 整理ログ\n\n## [status] トピック\n本文",
    };
    const records = parseDailyLog(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("ok");
    expect(records[0].occurred_at?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("frontmatter + 空行 + H1 の生成物 → status ok・body に frontmatter が含まれない", () => {
    const file: SourceFile = {
      path: "docs/logs/2026-07-20-morning.md",
      content:
        '---\ndate: "2026-07-20"\nslot: "morning"\nsource: "decision-cockpit"\ncapture_ids: ["11111111-1111-1111-1111-111111111111"]\nkind: "mixed"\nstatus: "curated"\ntags: []\n---\n\n# 2026-07-20 morning 整理ログ\n\n## [status] トピック\n本文',
    };
    const records = parseDailyLog(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.status).toBe("ok");
    expect(record.title).toBe("2026-07-20 morning 整理ログ");
    expect(record.body).not.toContain("---");
    expect(record.body).not.toContain("capture_ids");
    expect(record.tags).toEqual([]);
  });

  it("frontmatter + H1 なし(`##` のみ)→ status error(還流の必要条件を固定)", () => {
    const file: SourceFile = {
      path: "docs/logs/2026-07-20-morning.md",
      content: '---\ndate: "2026-07-20"\nslot: "morning"\n---\n\n## H1 でない見出し\n本文',
    };
    const records = parseDailyLog(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].body).not.toContain("date:");
  });
});
