// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(decisions 行)
//          docs/design/detail/ingestion-foundation.md §2.2 / §3(tests/parsers/decision.test.ts)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDecision } from "../../lib/ingestion/parsers/decision";
import type { SourceFile } from "../../lib/ingestion/parsers/types";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURE_DIR = join(REPO_ROOT, "fixtures", "ai-war-room", "docs", "decisions");

function loadFixture(name: string): SourceFile {
  return {
    path: `docs/decisions/${name}`,
    content: readFileSync(join(FIXTURE_DIR, name), "utf8"),
  };
}

const META = { source: "ai-war-room", commit: "abc123", org: null };

describe("parseDecision", () => {
  it("ファイル名日付 + H1 タイトルを正しく正規化する", () => {
    const file = loadFixture("2026-06-01-demo-decision.md");
    const records = parseDecision(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.type).toBe("decision");
    expect(record.org).toBeNull();
    expect(record.item_key).toBe("");
    expect(record.occurred_at?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(record.title).toBe("デモ用決定事項のタイトル");
    expect(record.topic).toBe("2026-06-01-demo-decision");
  });

  it("規則外のファイル名命名は error", () => {
    const file = loadFixture("invalid-name-without-date.md");
    const records = parseDecision(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].occurred_at).toBeNull();
  });

  it("H1 が無い(または規則外)場合は error", () => {
    const file = loadFixture("2026-06-03-demo-missing-h1.md");
    const records = parseDecision(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
  });
});
