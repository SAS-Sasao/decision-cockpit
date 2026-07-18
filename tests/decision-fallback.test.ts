// 対象設計: docs/design/detail/org-docs-ingestion.md §2.3(rev.8 H1 フォールバック・rev.9 明確化)
//
// parseDecision の H1 3分岐(日付付き H1 / 日付なし H1 フォールバック / H1 なし)を
// インライン SourceFile のみで検証する(fixtures 追加なし — run-sync.test.ts の件数ピン不変)。
import { describe, expect, it } from "vitest";
import { parseDecision } from "../lib/ingestion/parsers/decision";
import type { SourceFile } from "../lib/ingestion/parsers/types";

const META_DEMO_ORG = { source: "cc-sier-organization", commit: "abc123", org: "demo-org" };
const META_NULL_ORG = { source: "ai-war-room", commit: "abc123", org: null };

describe("parseDecision: H1 フォールバック(OD-DEC)", () => {
  it("日付なし H1 + 日付ファイル名 → ok・title = H1 全文・occurred_at = ファイル名日付・org = meta.org", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/decisions/2026-07-01-undated-h1.md",
      content: "# 組織判断のタイトル\n\n本文。",
    };
    const records = parseDecision(file, META_DEMO_ORG);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.type).toBe("decision");
    expect(record.title).toBe("組織判断のタイトル");
    expect(record.occurred_at?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(record.org).toBe("demo-org");
    expect(record.topic).toBe("2026-07-01-undated-h1");
    expect(record.body).toBe(file.content);
  });

  it("日付付き H1(従来経路)→ ok・title = 日付以降(回帰)", () => {
    const file: SourceFile = {
      path: "docs/decisions/2026-06-01-dated-h1.md",
      content: "# 2026-06-01 - デモ用決定事項のタイトル\n\n本文。",
    };
    const records = parseDecision(file, META_NULL_ORG);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.title).toBe("デモ用決定事項のタイトル");
    expect(record.occurred_at?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(record.org).toBeNull();
  });

  it("H1 が無い(先頭行がプレーン文)→ error(回帰)", () => {
    const file: SourceFile = {
      path: "docs/decisions/2026-06-03-no-h1.md",
      content: "これはH1見出しが無いデモファイルです。\n\n## 決定事項\n本文のみ。",
    };
    const records = parseDecision(file, META_NULL_ORG);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].occurred_at).toBeNull();
  });

  it("ファイル名が規則外 → error(回帰)", () => {
    const file: SourceFile = {
      path: "docs/decisions/invalid-name-without-date.md",
      content: "# 2026-06-01 - タイトル\n\n本文。",
    };
    const records = parseDecision(file, META_NULL_ORG);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].occurred_at).toBeNull();
  });

  it("タブ空白 H1(`#\\t…`)が分岐2(日付なしフォールバック)に正しく乗る(rev.9 の /^#\\s+/ 規約)", () => {
    const file: SourceFile = {
      path: ".companies/demo-org/docs/decisions/2026-07-05-tab-h1.md",
      content: "#\tタブ区切りのタイトル\n\n本文。",
    };
    const records = parseDecision(file, META_DEMO_ORG);
    expect(records).toHaveLength(1);
    const record = records[0];

    expect(record.status).toBe("ok");
    expect(record.title).toBe("タブ区切りのタイトル");
    expect(record.occurred_at?.toISOString()).toBe("2026-07-05T00:00:00.000Z");
    expect(record.org).toBe("demo-org");
  });
});
