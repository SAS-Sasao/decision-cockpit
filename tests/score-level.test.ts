// 対象設計: docs/design/detail/ui-shell.md §2.1(lib/ui/score.ts)/ §3(tests/score-level.test.ts)
// scoreLevel の境界値を検証する純関数テスト(DB/ネットワーク非依存)。
import { describe, expect, it } from "vitest";
import { scoreLevel } from "../lib/ui/score";

describe("scoreLevel — 閾値境界", () => {
  it("0.80 → good(SCORE_GOOD ちょうど)", () => {
    expect(scoreLevel(0.8)).toBe("good");
  });

  it("0.7999 → warn(SCORE_GOOD 未満)", () => {
    expect(scoreLevel(0.7999)).toBe("warn");
  });

  it("0.65 → warn(SCORE_WARN ちょうど)", () => {
    expect(scoreLevel(0.65)).toBe("warn");
  });

  it("0.6499 → bad(SCORE_WARN 未満)", () => {
    expect(scoreLevel(0.6499)).toBe("bad");
  });

  it("null → na", () => {
    expect(scoreLevel(null)).toBe("na");
  });

  it("undefined → na", () => {
    expect(scoreLevel(undefined)).toBe("na");
  });
});
