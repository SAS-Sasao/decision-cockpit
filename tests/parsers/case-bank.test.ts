// 対象設計: docs/design/basic/ingestion-foundation.md §3.2(case-bank 行)/ §3.1(item_key)
//          docs/design/detail/ingestion-foundation.md §2.2 / §3(tests/parsers/case-bank.test.ts)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCaseBank } from "../../lib/ingestion/parsers/case-bank";
import type { SourceFile } from "../../lib/ingestion/parsers/types";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIXTURE_PATH = join(
  REPO_ROOT,
  "fixtures",
  "cc-sier-organization",
  ".companies",
  "demo-org",
  ".case-bank",
  "index.json"
);

function loadFixture(): SourceFile {
  return {
    path: ".companies/demo-org/.case-bank/index.json",
    content: readFileSync(FIXTURE_PATH, "utf8"),
  };
}

const META = { source: "cc-sier-organization", commit: "abc123", org: "demo-org" };

describe("parseCaseBank", () => {
  it("cases[] を1 case = 1 レコードに展開する(複数 case 展開)", () => {
    const file = loadFixture();
    const records = parseCaseBank(file, META);
    expect(records).toHaveLength(3);
  });

  it("item_key = case.id / raw_ref = file_path#case-id", () => {
    const file = loadFixture();
    const records = parseCaseBank(file, META);
    const ok = records.find((r) => r.item_key === "20260601-090000-demo-case-ok");
    expect(ok).toBeDefined();
    expect(ok?.raw_ref).toBe(`${file.path}#20260601-090000-demo-case-ok`);
    expect(ok?.type).toBe("score");
    expect(ok?.status).toBe("ok");
    expect(ok?.topic).toBe("20260601-090000-demo-case-ok");
    expect(ok?.occurred_at?.toISOString()).toBe("2026-06-01T09:00:00.000Z");
    expect(ok?.reward_score).toBe(0.85);
    expect(ok?.completeness).toBe(0.8);
    expect(ok?.accuracy).toBe(0.9);
    expect(ok?.clarity).toBe(1.0);
    // files_written はファイル名のみ化される
    expect(ok?.body).toContain("example-output.md");
    expect(ok?.body).not.toContain(".companies/demo-org/docs/");
  });

  it("reward・judge が null のケースを許容する", () => {
    const file = loadFixture();
    const records = parseCaseBank(file, META);
    const sparse = records.find((r) => r.item_key === "20260602-100000-demo-case-sparse");
    expect(sparse).toBeDefined();
    expect(sparse?.status).toBe("ok");
    expect(sparse?.reward_score).toBeNull();
    expect(sparse?.completeness).toBeNull();
    expect(sparse?.accuracy).toBeNull();
    expect(sparse?.clarity).toBeNull();
  });

  it("outcome.started と id の日時部の両方が欠損している場合は error", () => {
    const file = loadFixture();
    const records = parseCaseBank(file, META);
    const noDate = records.find((r) => r.item_key === "demo-case-no-date");
    expect(noDate).toBeDefined();
    expect(noDate?.status).toBe("error");
    expect(noDate?.occurred_at).toBeNull();
  });

  it("同一入力から同一キーが得られる(決定性)", () => {
    const file = loadFixture();
    const a = parseCaseBank(file, META);
    const b = parseCaseBank(file, META);
    expect(a.map((r) => r.item_key)).toEqual(b.map((r) => r.item_key));
  });

  it("state.org_slug が meta.org と不一致なら error", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/.case-bank/index.json",
      content: JSON.stringify({
        cases: [
          {
            id: "20260601-120000-org-mismatch-case",
            state: { request_keywords: [], request_head: "org 不一致", org_slug: "other-org" },
            action: { subagent: "demo", mode: "direct", artifact_count: 0 },
            reward: null,
            judge: null,
            outcome: { files_written: [], started: "2026-06-01T12:00:00" },
          },
        ],
      }),
    };
    const records = parseCaseBank(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
  });

  it("壊れた JSON はファイル単位の error レコードになる", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/.case-bank/index.json",
      content: "{ this is not valid json",
    };
    const records = parseCaseBank(file, META);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
  });
});
