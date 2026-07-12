// 対象設計: docs/design/detail/ui-shell.md §2.1(lib/ui/score.ts)
//          docs/design/basic/ui-shell.md §3.2(スコア閾値の一元化)
//
// スコア閾値 → 表示レベル / 色変数名の純関数(クライアント/サーバ共用可・DB/ネットワーク非依存)。
// /retro と SC-02 概観の数値表示から共通利用する。

export const SCORE_GOOD = 0.8;
export const SCORE_WARN = 0.65;

export type ScoreLevel = "good" | "warn" | "bad" | "na";

/** v >= 0.80 → 'good' / v >= 0.65 → 'warn' / v < 0.65 → 'bad' / null・undefined → 'na'。 */
export function scoreLevel(v: number | null | undefined): ScoreLevel {
  if (v === null || v === undefined) return "na";
  if (v >= SCORE_GOOD) return "good";
  if (v >= SCORE_WARN) return "warn";
  return "bad";
}

/** レベル → globals.css の CSS カスタムプロパティ参照。 */
export function scoreColorVar(level: ScoreLevel): string {
  switch (level) {
    case "good":
      return "var(--good)";
    case "warn":
      return "var(--warn)";
    case "bad":
      return "var(--bad)";
    case "na":
      return "var(--text-sub)";
  }
}
