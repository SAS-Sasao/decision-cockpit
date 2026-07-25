// 対象設計: docs/design/detail/ui-polish.md §2.2(components/charts/h-bar.tsx)
//
// ラベル付き横棒。value は 0-1 の比率としてトラック幅に対する塗り幅%に変換する。
// null の場合は長さ0・色 var(--text-sub)・値表示「—」とする。
import type { TokenColor } from "../../lib/ui/chart";

type HBarProps = {
  label: string;
  value: number | null;
  color: TokenColor;
};

const TRACK_HEIGHT = 7;
const RADIUS = 4;

export function HBar({ label, value, color }: HBarProps) {
  const isNull = value === null;
  const pct = isNull ? 0 : Math.max(0, Math.min(1, value));
  const barColor: TokenColor = isNull ? "var(--text-sub)" : color;
  const displayValue = isNull ? "—" : value.toFixed(2);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--text-sub)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            color: isNull ? "var(--text-sub)" : "var(--text)",
          }}
        >
          {displayValue}
        </span>
      </div>
      <svg
        viewBox="0 0 100 7"
        width="100%"
        height={TRACK_HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${displayValue}`}
      >
        <rect x={0} y={0} width={100} height={TRACK_HEIGHT} rx={RADIUS} fill="var(--grid)" />
        <rect className="ckgrowx" x={0} y={0} width={pct * 100} height={TRACK_HEIGHT} rx={RADIUS} fill={barColor} />
      </svg>
    </div>
  );
}
