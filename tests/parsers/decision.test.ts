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

// 追加(M5-A・organize-loop §2.4): frontmatter 剥離(凍結例外への追加のみ)。
describe("parseDecision: M5 整理ループ生成物(frontmatter 剥離)", () => {
  it("frontmatter + 分岐1 H1(日付付き)→ ok・occurred_at = ファイル名日付・body 剥離済み", () => {
    const file: SourceFile = {
      path: "docs/decisions/2026-07-20-morning-d01.md",
      content:
        '---\ndate: "2026-07-20"\nslot: "morning"\nsource: "decision-cockpit"\ncapture_ids: ["11111111-1111-1111-1111-111111111111"]\nkind: "issue"\nstatus: "curated"\ntags: []\n---\n\n# 2026-07-20 - 生成された決定事項\n\n本文',
    };
    const records = parseDecision(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.status).toBe("ok");
    expect(record.title).toBe("生成された決定事項");
    expect(record.occurred_at?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(record.body).not.toContain("---");
    expect(record.body).not.toContain("capture_ids");
    expect(record.tags).toEqual([]);
  });

  it("error 行(H1 なし)の body にも frontmatter が残らない", () => {
    const file: SourceFile = {
      path: "docs/decisions/2026-07-20-morning-d01.md",
      content: '---\ndate: "2026-07-20"\nslot: "morning"\n---\n\nH1 見出しがない本文のみ。',
    };
    const records = parseDecision(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].body).not.toContain("date:");
    expect(records[0].body).not.toContain("---");
  });
});
