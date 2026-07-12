// 対象設計: docs/design/detail/ui-polish.md §2.1(lib/ui/chart.ts)
//
// チャート描画用の純関数群(React 非依存・DB/ネットワーク非依存)。
// SVG 座標の線形写像・null 分割・パス文字列組み立て・丸め処理などを
// components/charts/ の各部品と tests/chart.test.ts から共通利用する。

/** デザイントークンの CSS カスタムプロパティ参照のみを許容する型。 */
export type TokenColor = `var(--${string})`;

/** domain の実数域を range の実数域へ線形写像する関数を返す。 */
export function scaleLinear(
  domain: [number, number],
  range: [number, number]
): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** null で区切られた連続区間ごとに { startIndex, values } を返す(polyline/area の分割描画用)。 */
export function splitSegments(
  values: (number | null)[]
): { startIndex: number; values: number[] }[] {
  const segments: { startIndex: number; values: number[] }[] = [];
  let current: number[] = [];
  let startIndex = -1;
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) {
        segments.push({ startIndex, values: current });
        current = [];
      }
      return;
    }
    if (current.length === 0) startIndex = i;
    current.push(v);
  });
  if (current.length > 0) segments.push({ startIndex, values: current });
  return segments;
}

/** 座標列から折れ線パス文字列を組み立てる("M x0 y0 L x1 y1 …")。 */
export function linePath(xs: number[], ys: number[]): string {
  if (xs.length === 0 || ys.length === 0) return "";
  const parts: string[] = [`M ${xs[0]} ${ys[0]}`];
  for (let i = 1; i < xs.length; i++) {
    parts.push(`L ${xs[i]} ${ys[i]}`);
  }
  return parts.join(" ");
}

/** 折れ線パス + 底辺(baselineY)で閉じた面パス文字列を組み立てる。 */
export function areaPath(xs: number[], ys: number[], baselineY: number): string {
  if (xs.length === 0 || ys.length === 0) return "";
  const line = linePath(xs, ys);
  const lastX = xs[xs.length - 1];
  const firstX = xs[0];
  return `${line} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
}

/** 円弧ゲージの stroke-dasharray とその全周長(circumference = 2πr)を返す(pct は 0-1 に丸め込む)。 */
export function gaugeDash(
  pct: number,
  r: number
): { dashArray: string; circumference: number } {
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const filled = circumference * clamped;
  return { dashArray: `${filled} ${circumference}`, circumference };
}

/** 系列内のローカル min/max で 0-1 へ正規化する(null は null のまま・min=max は 0.5 に写像)。 */
export function normalizeLocal(values: (number | null)[]): (number | null)[] {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length === 0) return values.map(() => null);
  const min = Math.min(...nonNull);
  const max = Math.max(...nonNull);
  if (min === max) {
    return values.map((v) => (v === null ? null : 0.5));
  }
  const scale = scaleLinear([min, max], [0, 1]);
  return values.map((v) => (v === null ? null : scale(v)));
}

/** 品質ゲート合格率(0-1)と母数から pass/fail 件数を導出する(丸めは Math.round・floor 禁止)。 */
export function qgBreakdown(
  rate: number | null,
  total: number
): { pass: number; fail: number } | null {
  if (rate === null || total === 0) return null;
  const pass = Math.round(rate * total);
  const fail = total - pass;
  return { pass, fail };
}
