// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(quality-gate 行)/ §3.1(item_key = 行ハッシュ + 出現順序)
//          docs/design/detail/ingestion-foundation.md §2.2 / §3(tests/parsers/quality-gate.test.ts)
//
// サニタイズ検証用の絶対パス入力は fixtures/ に置かず、本ファイル内のインライン文字列で与える
// (条件11 の /home/ grep と衝突させないため)。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseQualityGate } from "../../lib/ingestion/parsers/quality-gate";
import type { SourceFile } from "../../lib/ingestion/parsers/types";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURE_PATH = join(
  REPO_ROOT,
  "fixtures",
  "cc-sier-organization",
  ".companies",
  "demo-org",
  ".quality-gate-log",
  "2026-06-01.jsonl"
);

function loadFixture(): SourceFile {
  return {
    path: ".companies/demo-org/.quality-gate-log/2026-06-01.jsonl",
    content: readFileSync(FIXTURE_PATH, "utf8"),
  };
}

const META = { source: "cc-sier-organization", commit: "abc123", org: "demo-org" };

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("parseQualityGate", () => {
  it("JSONL の1行を1レコードとして展開する(2正常行+1壊れ行 = 3レコード)", () => {
    const file = loadFixture();
    const records = parseQualityGate(file, META);
    expect(records).toHaveLength(3);
    expect(records.filter((r) => r.status === "ok")).toHaveLength(2);
    expect(records.filter((r) => r.status === "error")).toHaveLength(1);
    for (const r of records) {
      expect(r.type).toBe("quality");
      expect(r.occurred_at?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    }
  });

  it("同一内容行×2 は異なる item_key(#0/#1)を持つ(出現順序 suffix)", () => {
    const file = loadFixture();
    const records = parseQualityGate(file, META);
    const okRecords = records.filter((r) => r.status === "ok");
    expect(okRecords[0].item_key).not.toBe(okRecords[1].item_key);
    const rawLine = file.content.split("\n")[0];
    const hash = sha256(rawLine);
    expect(okRecords[0].item_key).toBe(`${hash}#0`);
    expect(okRecords[1].item_key).toBe(`${hash}#1`);
  });

  it("決定性: 同一入力から同一 item_key 列が得られる", () => {
    const file = loadFixture();
    const a = parseQualityGate(file, META);
    const b = parseQualityGate(file, META);
    expect(a.map((r) => r.item_key)).toEqual(b.map((r) => r.item_key));
  });

  it("target 内の絶対パスをサニタイズする", () => {
    const line = JSON.stringify({
      status: "pass",
      error_count: 0,
      warning_count: 0,
      errors: [],
      warnings: [],
      target: "/home/demo-user/repo/.companies/demo-org/docs/example.md",
      checklists: [],
    });
    const file: SourceFile = {
      path: ".companies/demo-org/.quality-gate-log/2026-06-02.jsonl",
      content: line,
    };
    const records = parseQualityGate(file, META);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.status).toBe("ok");
    expect(record.title).toBe("QG pass: example.md");
    expect(record.topic).toBe("example.md");
    expect(record.body).not.toContain("/home/");
    expect(record.body).toContain("example.md");
  });

  it("errors[] 内の絶対パスをサニタイズする", () => {
    const line = JSON.stringify({
      status: "fail",
      error_count: 1,
      warning_count: 0,
      errors: [{ check: "必須項目", path: "/home/demo-user/repo/docs/broken.md" }],
      warnings: [],
      target: "docs/target.md",
      checklists: [],
    });
    const file: SourceFile = {
      path: ".companies/demo-org/.quality-gate-log/2026-06-03.jsonl",
      content: line,
    };
    const records = parseQualityGate(file, META);
    expect(records[0].body).not.toContain("/home/");
    expect(records[0].body).toContain("broken.md");
  });

  it("warnings[] 内の絶対パスをサニタイズする", () => {
    const line = JSON.stringify({
      status: "pass",
      error_count: 0,
      warning_count: 1,
      errors: [],
      warnings: [{ check: "推奨項目", path: "/Users/demo-user/repo/docs/warn.md" }],
      target: "docs/target.md",
      checklists: [],
    });
    const file: SourceFile = {
      path: ".companies/demo-org/.quality-gate-log/2026-06-04.jsonl",
      content: line,
    };
    const records = parseQualityGate(file, META);
    expect(records[0].body).not.toContain("/Users/");
    expect(records[0].body).toContain("warn.md");
  });

  it("checklists[] 内の絶対パスをサニタイズする", () => {
    const line = JSON.stringify({
      status: "pass",
      error_count: 0,
      warning_count: 0,
      errors: [],
      warnings: [],
      target: "docs/target.md",
      checklists: ["C:\\Users\\demo-user\\repo\\checklists\\_default.md"],
    });
    const file: SourceFile = {
      path: ".companies/demo-org/.quality-gate-log/2026-06-05.jsonl",
      content: line,
    };
    const records = parseQualityGate(file, META);
    expect(records[0].body).not.toContain("C:\\");
    expect(records[0].body).toContain("_default.md");
  });

  it("壊れた JSON 行は error レコードになり、body に絶対パスが残らない", () => {
    const brokenLine = '{"status": "fail", "target": "/home/demo-user/repo/broken.md"';
    const file: SourceFile = {
      path: ".companies/demo-org/.quality-gate-log/2026-06-06.jsonl",
      content: brokenLine,
    };
    const records = parseQualityGate(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].body).not.toContain("/home/");
    expect(records[0].body).toContain("broken.md");
  });

  it("ファイル名が YYYY-MM-DD.jsonl に一致しない場合は error", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/.quality-gate-log/not-a-date.jsonl",
      content: '{"status": "pass", "target": "docs/target.md"}',
    };
    const records = parseQualityGate(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
  });
});
