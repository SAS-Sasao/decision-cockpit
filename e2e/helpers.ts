// 対象設計: docs/design/basic/front-check.md §3(e2e/helpers.ts)
import type { Page } from "@playwright/test";

/**
 * console error の allowlist(設計 §1-4)。
 * - メッセージ**全文アンカー**の正規表現のみ許可(/hydration/i のような無限定パターンは禁止 —
 *   アプリ本体の hydration バグを握り潰すため)。
 * - 初期エントリは Neon Auth SDK 0.4.2-beta の既知事象2件のみ(next-actions 記録済み):
 *   (1) NeonAuthUIProvider がテーマ FOUC 防止の <script> を描画することへの React 警告
 *   (2) それに起因する hydration mismatch 警告
 * - 抑制した件数と一致パターンは必ずサマリ(suppressed)に出力する(握り潰しの可視化)。
 */
export const CONSOLE_ALLOWLIST: RegExp[] = [
  /^Warning: A future version of React will block javascript: URLs[\s\S]*$/,
  /^In HTML, <script> cannot be a descendant of[\s\S]*$/,
  /^A tree hydrated but some attributes of the server rendered HTML didn't match[\s\S]*$/,
  /^Warning: Extra attributes from the server[\s\S]*$/,
];

export type OverlapPair = {
  svgLabel: string;
  a: string;
  b: string;
};

export type PageSummary = {
  path: string;
  overlapPairs: OverlapPair[];
  overflow: boolean;
  consoleErrors: string[];
  suppressed: { pattern: string; count: number }[];
};

/**
 * 同一 <svg> 内の <text> 要素ペアの矩形交差(許容 0.5px)を列挙する(設計 §1-4)。
 * 戻り値 0 件で PASS。要素の識別にはテキスト内容(目盛りラベル等)を使う。
 */
export async function collectSvgTextOverlaps(page: Page): Promise<OverlapPair[]> {
  return page.evaluate(() => {
    const TOLERANCE = 0.5;
    const pairs: { svgLabel: string; a: string; b: string }[] = [];
    const svgs = Array.from(document.querySelectorAll("svg"));
    for (const svg of svgs) {
      const svgLabel = svg.getAttribute("aria-label") ?? "(no aria-label)";
      const texts = Array.from(svg.querySelectorAll("text"));
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const ra = texts[i]!.getBoundingClientRect();
          const rb = texts[j]!.getBoundingClientRect();
          const intersects =
            ra.left < rb.right - TOLERANCE &&
            rb.left < ra.right - TOLERANCE &&
            ra.top < rb.bottom - TOLERANCE &&
            rb.top < ra.bottom - TOLERANCE;
          if (intersects) {
            pairs.push({
              svgLabel,
              a: texts[i]!.textContent ?? "",
              b: texts[j]!.textContent ?? "",
            });
          }
        }
      }
    }
    return pairs;
  });
}

/** 横はみ出し検知(設計 §1-4): scrollWidth が clientWidth + 1 を超えたら true。 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
}

/** console の error レベルを収集し、allowlist で抑制分を分離する(設計 §1-4)。 */
export function createConsoleCollector(page: Page): {
  errors: string[];
  suppressed: Map<string, number>;
} {
  const errors: string[] = [];
  const suppressed = new Map<string, number>();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return; // error レベルのみ数える(warning は数えない)
    const text = msg.text();
    const matched = CONSOLE_ALLOWLIST.find((re) => re.test(text));
    if (matched) {
      suppressed.set(matched.source, (suppressed.get(matched.source) ?? 0) + 1);
      return;
    }
    errors.push(text);
  });
  return { errors, suppressed };
}

/** サマリを人間可読 + 機械可読(JSON)で stdout に出す。 */
export function printSummary(summary: PageSummary): void {
  console.log(`[front-check] ${JSON.stringify(summary)}`);
}
