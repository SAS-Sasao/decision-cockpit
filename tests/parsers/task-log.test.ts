// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(task-log 行)
//          docs/design/detail/ingestion-foundation.md §2.2 / §3(tests/parsers/task-log.test.ts)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTaskLog } from "../../lib/ingestion/parsers/task-log";
import type { SourceFile } from "../../lib/ingestion/parsers/types";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURE_DIR = join(
  REPO_ROOT,
  "fixtures",
  "cc-sier-organization",
  ".companies",
  "demo-org",
  ".task-log"
);

function loadFixture(name: string): SourceFile {
  const path = `.companies/demo-org/.task-log/${name}`;
  const content = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return { path, content };
}

const META = { source: "cc-sier-organization", commit: "abc123", org: "demo-org" };

describe("parseTaskLog", () => {
  it("frontmatter + reward + judge を正しく正規化する", () => {
    const file = loadFixture("20260601-090000-demo-full-reward-judge.md");
    const records = parseTaskLog(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.type).toBe("task");
    expect(record.item_key).toBe("");
    expect(record.org).toBe("demo-org");
    expect(record.topic).toBe("20260601-090000-demo-full-reward-judge");
    expect(record.occurred_at?.toISOString()).toBe("2026-06-01T00:00:00.000Z");

    // request 先頭120字への切り詰め
    const requestMatch = file.content.match(/request: "([\s\S]*?)"\n/);
    const requestRaw = requestMatch ? requestMatch[1] : "";
    expect(record.title).toBe(requestRaw.slice(0, 120));
    expect(record.title?.length).toBeLessThanOrEqual(120);

    // reward
    expect(record.reward_score).toBe(0.9);
    expect(record.signals).toEqual({
      completed: true,
      artifacts_exist: true,
      excessive_edits: false,
      retry_detected: false,
    });

    // judge (x-1)/4 正規化: completeness=4→0.75, accuracy=5→1.0, clarity=3→0.5
    expect(record.completeness).toBeCloseTo(0.75, 10);
    expect(record.accuracy).toBeCloseTo(1.0, 10);
    expect(record.clarity).toBeCloseTo(0.5, 10);
  });

  it("judge が無いファイルでは completeness/accuracy/clarity が null になる(optional)", () => {
    const file = loadFixture("20260602-100000-demo-reward-only.md");
    const records = parseTaskLog(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.reward_score).toBe(0.6);
    expect(record.signals).toEqual({
      completed: true,
      artifacts_exist: false,
      excessive_edits: true,
      retry_detected: true,
    });
    expect(record.completeness).toBeNull();
    expect(record.accuracy).toBeNull();
    expect(record.clarity).toBeNull();
  });

  it("壊れた frontmatter は throw せず status='error' レコードになる", () => {
    const file = loadFixture("20260603-100000-demo-broken-frontmatter.md");
    const records = parseTaskLog(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("error");
    expect(record.type).toBe("task");
    expect(record.occurred_at).toBeNull();
    // error body にもサニタイズ(先頭2000字切り詰め)が適用されている
    expect(record.body).toBe(file.content.slice(0, 2000));
    expect(record.body!.length).toBeLessThanOrEqual(2000);
  });

  it("started が欠損している場合はファイル名日時をフォールバックに使う", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/.task-log/20260604-113000-fallback-datetime.md",
      content: [
        "---",
        'task_id: "20260604-113000-fallback-datetime"',
        'org: "demo-org"',
        'request: "started フィールドが無いケース"',
        "---",
        "",
        "## reward",
        "```yaml",
        "score: 1.0",
        "signals:",
        "    completed: true",
        "    artifacts_exist: true",
        "    excessive_edits: false",
        "    retry_detected: false",
        "```",
        "",
      ].join("\n"),
    };
    const records = parseTaskLog(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("ok");
    expect(records[0].occurred_at?.toISOString()).toBe("2026-06-04T11:30:00.000Z");
  });

  it("frontmatter の org と meta.org が不一致なら error", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/.task-log/20260605-090000-org-mismatch.md",
      content: [
        "---",
        'task_id: "20260605-090000-org-mismatch"',
        'org: "other-org"',
        'started: "2026-06-05T09:00:00+09:00"',
        'request: "org 不一致のテスト"',
        "---",
        "",
        "本文",
        "",
      ].join("\n"),
    };
    const records = parseTaskLog(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
  });
});
