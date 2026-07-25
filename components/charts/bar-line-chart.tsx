// 対象設計: docs/design/detail/ui-polish.md §2.2(components/charts/bar-line-chart.tsx)
//
// 報酬×QG 複合チャート。棒(0-1・スロット幅42%・rx3・不透明度45%)+
// 線(strokeWidth 2.2 + hollow ドット)。y 目盛は描画しない(MoC 踏襲)。
// bar が null の棒は描画をスキップする。line は splitSegments で分割する。
import { linePath, scaleLinear, splitSegments } from "../../lib/ui/chart";
import type { TokenColor } from "../../lib/ui/chart";

type BarLineChartProps = {
  bars: (number | null)[];
  line: (number | null)[];
  barColor: TokenColor;
  lineColor: TokenColor;
  xLabels: string[];
};

const WIDTH = 520;
const HEIGHT = 190;
const PAD_TOP = 12;
const PAD_RIGHT = 10;
const PAD_BOTTOM = 22;
const PAD_LEFT = 10;
const GRID_LINES = 5;
const BAR_SLOT_RATIO = 0.42;

export function BarLineChart({ bars, line, barColor, lineColor, xLabels }: BarLineChartProps) {
  const plotLeft = PAD_LEFT;
  const plotRight = WIDTH - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = HEIGHT - PAD_BOTTOM;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const n = xLabels.length;
  const slotWidth = n > 0 ? plotWidth / n : plotWidth;
  const barWidth = slotWidth * BAR_SLOT_RATIO;
  const xCenter = (i: number) => plotLeft + slotWidth * (i + 0.5);
  const yScale = scaleLinear([0, 1], [plotBottom, plotTop]);

  const gridYs = Array.from({ length: GRID_LINES }, (_, i) => plotTop + (plotHeight * i) / (GRID_LINES - 1));
  const lineSegments = splitSegments(line);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      style={{ maxWidth: "100%", height: "auto" }}
      role="img"
      aria-label="報酬とQG合格率の複合チャート"
    >
      {gridYs.map((y, i) => (
        <line key={`grid-${i}`} x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--grid)" strokeWidth={1} />
      ))}
      {bars.map((v, i) => {
        if (v === null) return null;
        const clamped = Math.max(0, Math.min(1, v));
        const y = yScale(clamped);
        const cx = xCenter(i);
        return (
          <rect
            key={`bar-${i}`}
            x={cx - barWidth / 2}
            y={y}
            width={barWidth}
            height={plotBottom - y}
            rx={3}
            fill={barColor}
            fillOpacity={0.45}
          />
        );
      })}
      {lineSegments.map((seg, i) => {
        const xs = seg.values.map((_, j) => xCenter(seg.startIndex + j));
        const ys = seg.values.map((v) => yScale(v));
        return <path key={`line-${i}`} d={linePath(xs, ys)} fill="none" stroke={lineColor} strokeWidth={2.2} />;
      })}
      {lineSegments.flatMap((seg) =>
        seg.values.map((v, j) => {
          const idx = seg.startIndex + j;
          return (
            <circle
              key={`dot-${idx}`}
              cx={xCenter(idx)}
              cy={yScale(v)}
              r={2.6}
              fill="var(--panel)"
              stroke={lineColor}
              strokeWidth={1.6}
            />
          );
        })
      )}
      {xLabels.map((label, i) => (
        <text
          key={`x-${i}`}
          x={xCenter(i)}
          y={HEIGHT - 6}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize={9}
          fill="var(--text-sub)"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
