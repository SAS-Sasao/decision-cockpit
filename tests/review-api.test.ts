// 対象設計: docs/design/detail/review-loop.md §3(テスト観点 — 純関数と SQL 定数のみ。
// DB 実接続・GitHub API 実呼び出しはしない)
import { describe, expect, it } from "vitest";
import {
  DAILY_COUNT_SQL,
  DISPATCH_FAILED_SQL,
  INFLIGHT_SQL,
  INSERT_SQL,
  LIST_SQL,
  QUESTION_MAX_CHARS,
  RUN_REF_PREFIX,
  SWEEP_PENDING_SQL,
  SWEEP_RUNNING_SQL,
  isSafeRunRef,
  validateQuestion,
} from "../lib/review/api-lib";

describe("validateQuestion(入力検証)", () => {
  it("正常な質問文を trim して返す(INSERT にはこの戻り値をバインドする)", () => {
    expect(validateQuestion({ question: "  設計をレビューして  " })).toBe("設計をレビューして");
  });

  it("上限 2000 文字ちょうどは受理する", () => {
    expect(validateQuestion({ question: "a".repeat(QUESTION_MAX_CHARS) })).toBe("a".repeat(QUESTION_MAX_CHARS));
  });

  it("2001 文字は拒否する(null)", () => {
    expect(validateQuestion({ question: "a".repeat(QUESTION_MAX_CHARS + 1) })).toBeNull();
  });

  it("空白のみ・非文字列・欠落・非オブジェクトはすべて拒否する", () => {
    expect(validateQuestion({ question: "   " })).toBeNull();
    expect(validateQuestion({ question: 42 })).toBeNull();
    expect(validateQuestion({})).toBeNull();
    expect(validateQuestion(null)).toBeNull();
    expect(validateQuestion("plain string")).toBeNull();
  });
});

describe("isSafeRunRef(run_ref の前置一致検証)", () => {
  it("正規の Actions run URL のみ true", () => {
    expect(isSafeRunRef(`${RUN_REF_PREFIX}runs/12345`)).toBe(true);
  });

  it("他ホスト・偽ホスト・javascript:・http・null はすべて false", () => {
    expect(isSafeRunRef("https://evil.example/actions/runs/1")).toBe(false);
    expect(isSafeRunRef("https://github.com.evil/SAS-Sasao/decision-cockpit/actions/runs/1")).toBe(false);
    expect(isSafeRunRef("javascript:alert(1)")).toBe(false);
    expect(isSafeRunRef("http://github.com/SAS-Sasao/decision-cockpit/actions/runs/1")).toBe(false);
    expect(isSafeRunRef(null)).toBe(false);
    expect(isSafeRunRef(undefined)).toBe(false);
  });
});

describe("SQL 定数の CAS 句 + SET 列 + SET 値(整合制約の load-bearing)", () => {
  it("SWEEP_PENDING は pending の CAS・15分・error/stale・completed_at を設定する", () => {
    expect(SWEEP_PENDING_SQL).toContain("status = 'pending'");
    expect(SWEEP_PENDING_SQL).toContain("15 minutes");
    expect(SWEEP_PENDING_SQL).toContain("status = 'error'");
    expect(SWEEP_PENDING_SQL).toContain("error_kind = 'stale'");
    expect(SWEEP_PENDING_SQL).toContain("completed_at = now()");
  });

  it("SWEEP_RUNNING は running の CAS・60分・error/stale・completed_at を設定する(略記しない)", () => {
    expect(SWEEP_RUNNING_SQL).toContain("status = 'running'");
    expect(SWEEP_RUNNING_SQL).toContain("60 minutes");
    expect(SWEEP_RUNNING_SQL).toContain("status = 'error'");
    expect(SWEEP_RUNNING_SQL).toContain("error_kind = 'stale'");
    expect(SWEEP_RUNNING_SQL).toContain("completed_at = now()");
  });

  it("DISPATCH_FAILED は pending の CAS・dispatch_failed・completed_at を設定する", () => {
    expect(DISPATCH_FAILED_SQL).toContain("status = 'pending'");
    expect(DISPATCH_FAILED_SQL).toContain("error_kind = 'dispatch_failed'");
    expect(DISPATCH_FAILED_SQL).toContain("completed_at = now()");
  });

  it("DAILY_COUNT は JST を両辺に適用する(status は不問)", () => {
    expect(DAILY_COUNT_SQL.match(/Asia\/Tokyo/g)).toHaveLength(2);
    expect(DAILY_COUNT_SQL).not.toContain("status");
  });

  it("INFLIGHT は pending/running のみを見る", () => {
    expect(INFLIGHT_SQL).toContain("status IN ('pending','running')");
  });

  it("INSERT は requested_by と question の2列のみ", () => {
    expect(INSERT_SQL).toContain("(requested_by, question)");
    expect(INSERT_SQL).toContain("RETURNING id");
  });

  it("LIST は直近20件で requested_by を返さない", () => {
    expect(LIST_SQL).toContain("LIMIT 20");
    expect(LIST_SQL).toContain("ORDER BY created_at DESC");
    expect(LIST_SQL).not.toContain("requested_by");
  });
});
