// 対象設計: docs/design/detail/ui-polish.md §2.2(components/charts/gauge.tsx)
//
// 円形ゲージ。r=48・strokeWidth=9・-90°開始の前景弧で value(0-1)を表現する。
// value が null の場合は中央に「—」を表示し、背景リングのみ描画する。
// 前景弧は pathLength=1 + 比率 dasharray(today-board-interactive §1-6 — ckdraw で描画アニメ。
// 比率は gaugeDash と同じ 0-1 クランプ・見た目の割合は不変)。
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
  const clamped = value === null ? 0 : Math.max(0, Math.min(1, value));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={caption}>
      <circle cx={center} cy={center} r={RADIUS} fill="none" stroke="var(--grid)" strokeWidth={STROKE_WIDTH} />
      {value !== null && (
        <circle
          className="ckdraw"
          pathLength={1}
          cx={center}
          cy={center}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={`${clamped} 1`}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      {/* 値(26px)の bbox 下端とキャプション上端が干渉していたため上下に分離
          (front-check §8 — e2e の重なり検出で確認)。 */}
      <text
        x={center}
        y={center - 6}
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
        y={center + 24}
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
