// 対象設計: docs/design/detail/ui-polish.md §2.2(components/charts/sparkline.tsx)
//
// KPI カード内の小型スパークライン。系列内ローカル正規化(0-1)+ null 分割で
// area(14%)+ line を描画する。全 null の場合は空の SVG を返す。
import { areaPath, linePath, normalizeLocal, scaleLinear, splitSegments } from "../../lib/ui/chart";
import type { TokenColor } from "../../lib/ui/chart";

type SparklineProps = {
  values: (number | null)[];
  color: TokenColor;
  width?: number;
  height?: number;
};

export function Sparkline({ values, color, width = 140, height = 34 }: SparklineProps) {
  const normalized = normalizeLocal(values);
  const hasValue = normalized.some((v) => v !== null);

  if (!hasValue) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="推移データなし"
      />
    );
  }

  const n = values.length;
  const xScale = scaleLinear([0, Math.max(n - 1, 1)], [0, width]);
  const yScale = scaleLinear([0, 1], [height - 1, 1]);
  const segments = splitSegments(normalized);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="推移スパークライン"
    >
      {segments.map((seg, i) => {
        const xs = seg.values.map((_, j) => xScale(seg.startIndex + j));
        const ys = seg.values.map((v) => yScale(v));
        return (
          <path
            key={`area-${i}`}
            d={areaPath(xs, ys, height)}
            fill={color}
            fillOpacity={0.14}
            stroke="none"
          />
        );
      })}
      {segments.map((seg, i) => {
        const xs = seg.values.map((_, j) => xScale(seg.startIndex + j));
        const ys = seg.values.map((v) => yScale(v));
        return (
          <path
            key={`line-${i}`}
            d={linePath(xs, ys)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
