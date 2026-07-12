// 対象設計: docs/design/detail/ui-polish.md §3(tests/chart.test.ts)
// lib/ui/chart.ts の純関数と lib/ui/score.ts の SIGNAL_DIRECTION を検証する
// (DB/ネットワーク非依存)。
import { describe, expect, it } from "vitest";
import {
  areaPath,
  gaugeDash,
  linePath,
  normalizeLocal,
  qgBreakdown,
  splitSegments,
} from "../lib/ui/chart";
import { SIGNAL_DIRECTION } from "../lib/ui/score";

describe("splitSegments", () => {
  it("null で分割する", () => {
    expect(splitSegments([1, 2, null, 3, 4])).toEqual([
      { startIndex: 0, values: [1, 2] },
      { startIndex: 3, values: [3, 4] },
    ]);
  });

  it("全 null → 空配列", () => {
    expect(splitSegments([null, null, null])).toEqual([]);
  });

  it("単点(前後 null)→ 1要素セグメント", () => {
    expect(splitSegments([null, 5, null])).toEqual([{ startIndex: 1, values: [5] }]);
  });

  it("先頭 null", () => {
    expect(splitSegments([null, 1, 2])).toEqual([{ startIndex: 1, values: [1, 2] }]);
  });

  it("末尾 null", () => {
    expect(splitSegments([1, 2, null])).toEqual([{ startIndex: 0, values: [1, 2] }]);
  });
});

describe("linePath / areaPath", () => {
  it("linePath: 2点で座標を手計算一致させる", () => {
    expect(linePath([0, 10], [5, 15])).toBe("M 0 5 L 10 15");
  });

  it("areaPath: line + 底辺で閉じる(2点)", () => {
    expect(areaPath([0, 10], [5, 15], 34)).toBe("M 0 5 L 10 15 L 10 34 L 0 34 Z");
  });
});

describe("gaugeDash", () => {
  const r = 48;
  const circumference = 2 * Math.PI * r;

  it("pct=0 → dashArray の充填長は0", () => {
    const { dashArray, circumference: c } = gaugeDash(0, r);
    expect(c).toBeCloseTo(circumference);
    expect(dashArray).toBe(`0 ${circumference}`);
  });

  it("pct=0.5 → 充填長は円周の半分", () => {
    const { dashArray, circumference: c } = gaugeDash(0.5, r);
    expect(dashArray).toBe(`${circumference * 0.5} ${c}`);
  });

  it("pct=1 → 充填長は円周全体", () => {
    const { dashArray, circumference: c } = gaugeDash(1, r);
    expect(dashArray).toBe(`${circumference} ${c}`);
  });
});

describe("normalizeLocal", () => {
  it("定数列 → 非 null は全部 0.5", () => {
    expect(normalizeLocal([3, 3, 3])).toEqual([0.5, 0.5, 0.5]);
  });

  it("単調列 → 0-1 に線形正規化", () => {
    expect(normalizeLocal([0, 5, 10])).toEqual([0, 0.5, 1]);
  });

  it("null は null のまま", () => {
    expect(normalizeLocal([0, null, 10])).toEqual([0, null, 1]);
  });
});

describe("qgBreakdown", () => {
  it("通常ケース", () => {
    expect(qgBreakdown(0.8, 10)).toEqual({ pass: 8, fail: 2 });
  });

  it("丸め反例: qgBreakdown(1 / 49, 49) → pass=1(Math.round・floor だと 0 になる反例)", () => {
    expect(qgBreakdown(1 / 49, 49)).toEqual({ pass: 1, fail: 48 });
  });

  it("rate が null → null", () => {
    expect(qgBreakdown(null, 49)).toBeNull();
  });

  it("total が 0 → null", () => {
    expect(qgBreakdown(0.5, 0)).toBeNull();
  });
});

describe("SIGNAL_DIRECTION", () => {
  it("4キーが存在する", () => {
    expect(Object.keys(SIGNAL_DIRECTION).sort()).toEqual(
      ["artifacts_exist", "completed", "excessive_edits", "retry_detected"].sort()
    );
  });

  it("completed / artifacts_exist は high-good", () => {
    expect(SIGNAL_DIRECTION.completed).toBe("high-good");
    expect(SIGNAL_DIRECTION.artifacts_exist).toBe("high-good");
  });

  it("excessive_edits / retry_detected は high-bad", () => {
    expect(SIGNAL_DIRECTION.excessive_edits).toBe("high-bad");
    expect(SIGNAL_DIRECTION.retry_detected).toBe("high-bad");
  });
});
