// 対象設計: docs/design/detail/ui-polish.md §2.2(components/charts/gauge.tsx)
//
// 円形ゲージ。r=48・strokeWidth=9・-90°開始の前景弧で value(0-1)を表現する。
// value が null の場合は中央に「—」を表示し、背景リングのみ描画する。
import { gaugeDash } from "../../lib/ui/chart";
import type { TokenColor } from "../../lib/ui/chart";

type GaugeProps = {
  value: number | null;
  color: TokenColor;
  caption: string;
  size?: number;
};

const RADIUS = 48;
const STROKE_WIDTH = 9;

export function Gauge({ value, color, caption, size = 118 }: GaugeProps) {
  const center = size / 2;
  const centerLabel = value === null ? "—" : `${Math.round(value * 100)}%`;
  const dashArray = value === null ? undefined : gaugeDash(value, RADIUS).dashArray;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={caption}>
      <circle cx={center} cy={center} r={RADIUS} fill="none" stroke="var(--grid)" strokeWidth={STROKE_WIDTH} />
      {value !== null && (
        <circle
          cx={center}
          cy={center}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={dashArray}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text
        x={center}
        y={center - 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-mono)"
        fontSize={26}
        fontWeight={600}
        fill="var(--text)"
      >
        {centerLabel}
      </text>
      <text
        x={center}
        y={center + 20}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize={9}
        fill="var(--text-sub)"
      >
        {caption}
      </text>
    </svg>
  );
}
