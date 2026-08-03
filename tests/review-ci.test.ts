// 対象設計: docs/design/detail/review-loop.md §3(CI 側の純関数 + SQL 定数 — DB 実接続はしない)
import { describe, expect, it } from "vitest";
import {
  CI_FAILED_SQL,
  CLAIM_SQL,
  DONE_SQL,
  RESULT_MAX_CHARS,
  isUuid,
  truncateResult,
} from "../scripts/review/sql";

describe("isUuid(不正 request_id は green skip に丸める)", () => {
  it("正規の UUID を受理する", () => {
    expect(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("不正な文字列・空・null は拒否する", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c33")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("truncateResult(コードポイント単位・サロゲート非分断)", () => {
  it("上限以下はそのまま返す", () => {
    expect(truncateResult("abc")).toEqual({ text: "abc", truncated: false });
  });

  it("上限ちょうどは切り詰めない", () => {
    const s = "a".repeat(RESULT_MAX_CHARS);
    expect(truncateResult(s)).toEqual({ text: s, truncated: false });
  });

  it("超過分を切り詰めて truncated=true を返す", () => {
    const r = truncateResult("a".repeat(RESULT_MAX_CHARS + 10));
    expect(r.truncated).toBe(true);
    expect(Array.from(r.text)).toHaveLength(RESULT_MAX_CHARS);
  });

  it("サロゲートペア(絵文字)を割らない", () => {
    // 全て 2 code unit / 1 code point の絵文字。境界で分断されると壊れた文字になる。
    const r = truncateResult("😀".repeat(RESULT_MAX_CHARS + 5));
    expect(r.truncated).toBe(true);
    expect(Array.from(r.text)).toHaveLength(RESULT_MAX_CHARS);
    expect(r.text.endsWith("😀")).toBe(true);
    expect(r.text).not.toContain("�");
  });

  it("RESULT_MAX_CHARS は DDL の CHECK と同値", () => {
    expect(RESULT_MAX_CHARS).toBe(30000);
  });
});

describe("SQL 定数(CAS 句 + SET 列 + SET 値)", () => {
  it("CLAIM は単一文で CAS・started_at・run_ref・RETURNING question を持つ", () => {
    expect(CLAIM_SQL).not.toContain(";");
    expect(CLAIM_SQL).toContain("status = 'running'");
    expect(CLAIM_SQL).toContain("status = 'pending'");
    expect(CLAIM_SQL).toContain("started_at = now()");
    expect(CLAIM_SQL).toContain("run_ref = $2");
    expect(CLAIM_SQL).toContain("RETURNING question");
  });

  it("DONE は running の CAS・result・result_truncated・completed_at を設定する", () => {
    expect(DONE_SQL).toContain("status = 'done'");
    expect(DONE_SQL).toContain("status = 'running'");
    expect(DONE_SQL).toContain("result = $2");
    expect(DONE_SQL).toContain("result_truncated = $3");
    expect(DONE_SQL).toContain("completed_at = now()");
  });

  it("CI_FAILED は running の CAS・ci_failed・completed_at を設定する", () => {
    expect(CI_FAILED_SQL).toContain("status = 'error'");
    expect(CI_FAILED_SQL).toContain("status = 'running'");
    expect(CI_FAILED_SQL).toContain("error_kind = 'ci_failed'");
    expect(CI_FAILED_SQL).toContain("completed_at = now()");
  });
});
