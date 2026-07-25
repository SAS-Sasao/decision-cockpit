"use client";

// 対象設計: docs/design/basic/today-board-interactive.md §1-6/§3(components/motion/count-up.tsx)
//
// 数値のカウントアップ表示(依存なし・rAF・450ms 以内)。
// - hydration 対策(設計 §4): 初期レンダは最終値を出し、マウント後にアニメを開始する
//   (SSR/CSR の DOM が一致 — hydration mismatch を出さない)。
// - prefers-reduced-motion 時はアニメせず即時値。
// - 対象は HTML 数値(SVG text ではない)= front-check の重なり検出対象外。中間値の桁数は
//   最終値以下のため overflow 判定も動かさない(設計 §1-7)。
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 400; // 設計 §1-7 の総時間 450ms 上限内

type CountUpProps = {
  /** 表示する最終値(数値のみ受ける — 関数は server→client 境界を越えて渡さない。設計 §3)。 */
  value: number;
  /** 小数桁数(既定 0)。 */
  decimals?: number;
  /** 接尾辞(例 "%")。 */
  suffix?: string;
};

export function CountUp({ value, decimals = 0, suffix = "" }: CountUpProps) {
  // 初期値 = 最終値(SSR と一致)。マウント後に 0 からのアニメへ切り替える。
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !Number.isFinite(value)) {
      setDisplay(value);
      return;
    }
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / DURATION_MS);
      const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
      setDisplay(value * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return (
    <span>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}
