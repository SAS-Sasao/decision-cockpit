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
