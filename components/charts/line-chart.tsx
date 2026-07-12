// 対象設計: docs/design/detail/ui-polish.md §2.2(components/charts/line-chart.tsx)
//
// 横断タイムライン用の複数系列折れ線チャート。水平グリッド5本 + y目盛(Mono)+
// hollow ドット + 凡例(SVG 外)。null は splitSegments でセグメント分割して描画する。
import { areaPath, linePath, scaleLinear, splitSegments } from "../../lib/ui/chart";
import type { TokenColor } from "../../lib/ui/chart";

type Series = {
  label: string;
  color: TokenColor;
  values: (number | null)[];
  area?: boolean;
};

type LineChartProps = {
  series: Series[];
  xLabels: string[];
  domain?: [number, number];
  width?: number;
  height?: number;
  formatTick?: (v: number) => string;
};

const GRID_LINES = 5;
const PAD_TOP = 34;
const PAD_RIGHT = 8;
const PAD_BOTTOM = 8;
const PAD_LEFT = 34;

function defaultFormatTick(v: number): string {
  return v.toFixed(2);
}

export function LineChart({
  series,
  xLabels,
  domain,
  width = 640,
  height = 200,
  formatTick = defaultFormatTick,
}: LineChartProps) {
  const plotLeft = PAD_LEFT;
  const plotRight = width - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = height - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;

  const allValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const [dMin, dMax]: [number, number] =
    domain ?? (allValues.length > 0 ? [Math.min(...allValues), Math.max(...allValues)] : [0, 1]);

  const yScale = scaleLinear([dMin, dMax], [plotBottom, plotTop]);
  const n = xLabels.length;
  const xScale = scaleLinear([0, Math.max(n - 1, 1)], [plotLeft, plotRight]);

  const gridYs = Array.from({ length: GRID_LINES }, (_, i) => plotTop + (plotHeight * i) / (GRID_LINES - 1));
  const tickValues = Array.from({ length: GRID_LINES }, (_, i) => {
    const t = i / (GRID_LINES - 1);
    return dMax - t * (dMax - dMin);
  });

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="横断タイムライン"
      >
        {gridYs.map((y, i) => (
          <line key={`grid-${i}`} x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--grid)" strokeWidth={1} />
        ))}
        {gridYs.map((y, i) => (
          <text
            key={`tick-${i}`}
            x={plotLeft - 6}
            y={y}
            textAnchor="end"
            dominantBaseline="middle"
            fontFamily="var(--font-mono)"
            fontSize={9}
            fill="var(--text-sub)"
          >
            {formatTick(tickValues[i]!)}
          </text>
        ))}
        {series.map((s, si) => {
          const segments = splitSegments(s.values);
          return (
            <g key={`series-${si}`}>
              {s.area &&
                segments.map((seg, i) => {
                  const xs = seg.values.map((_, j) => xScale(seg.startIndex + j));
                  const ys = seg.values.map((v) => yScale(v));
                  return (
                    <path
                      key={`area-${si}-${i}`}
                      d={areaPath(xs, ys, plotBottom)}
                      fill={s.color}
                      fillOpacity={0.13}
                      stroke="none"
                    />
                  );
                })}
              {segments.map((seg, i) => {
                const xs = seg.values.map((_, j) => xScale(seg.startIndex + j));
                const ys = seg.values.map((v) => yScale(v));
                return (
                  <path
                    key={`line-${si}-${i}`}
                    d={linePath(xs, ys)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                  />
                );
              })}
              {segments.flatMap((seg) =>
                seg.values.map((v, j) => {
                  const idx = seg.startIndex + j;
                  return (
                    <circle
                      key={`dot-${si}-${idx}`}
                      cx={xScale(idx)}
                      cy={yScale(v)}
                      r={2.6}
                      fill="var(--panel)"
                      stroke={s.color}
                      strokeWidth={1.6}
                    />
                  );
                })
              )}
            </g>
          );
        })}
        {xLabels.map((label, i) => (
          <text
            key={`x-${i}`}
            x={xScale(i)}
            y={height - 2}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={9}
            fill="var(--text-sub)"
          >
            {label}
          </text>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "var(--text-sub)" }}>
        {series.map((s, i) => (
          <span key={`legend-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
