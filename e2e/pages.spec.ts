// 対象設計: docs/design/basic/front-check.md §1-4 / §3(e2e/pages.spec.ts)
//
// 5画面のフロント整合性チェック。操作系イベント(クリック・フォーム送信・入力)は行わない。
// 認証済みページは e2e/.auth/state.json(ユーザーが npm run e2e:auth で生成)を再利用する。
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  collectSvgTextOverlaps,
  createConsoleCollector,
  hasHorizontalOverflow,
  printSummary,
  type PageSummary,
} from "./helpers";

const STATE_PATH = join(__dirname, ".auth", "state.json");
const SCREENSHOT_DIR = join(__dirname, "screenshots");

const AUTHED_PAGES: { path: string; name: string; readySelector: string }[] = [
  { path: "/", name: "overview", readySelector: "main" }, // "/" = SC-02 概観(FC-1 時の誤名 "today" を修正)
  { path: "/today", name: "today", readySelector: "main" }, // today-board-interactive §1-8 で追加(5→6画面)
  { path: "/knowledge", name: "knowledge", readySelector: "main" },
  { path: "/retro", name: "retro", readySelector: "main" },
  { path: "/capture", name: "capture", readySelector: "main" },
];

async function checkPage(
  page: import("@playwright/test").Page,
  path: string,
  name: string,
  readySelector: string
): Promise<PageSummary> {
  const collector = createConsoleCollector(page);
  const response = await page.goto(path, { waitUntil: "load" });
  expect(response, `${path} への到達`).not.toBeNull();
  expect(response!.status(), `${path} の HTTP ステータス`).toBeLessThan(300);

  // 認証済みページが /login に飛ばされた場合は state 失効を明示して fail(設計 §1-3)
  if (path !== "/login" && page.url().includes("/login")) {
    throw new Error(
      `state 失効 — ${path} が /login にリダイレクトされました。npm run e2e:auth を再実行してください`
    );
  }

  await page.waitForSelector(readySelector, { state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500); // チャート等のクライアント描画の静定待ち

  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });

  const summary: PageSummary = {
    path,
    overlapPairs: await collectSvgTextOverlaps(page),
    overflow: await hasHorizontalOverflow(page),
    consoleErrors: collector.errors,
    suppressed: Array.from(collector.suppressed.entries()).map(([pattern, count]) => ({
      pattern,
      count,
    })),
  };
  printSummary(summary);
  return summary;
}

test.describe("front-check: 未認証", () => {
  test("/login が表示され console error / はみ出しが無い", async ({ page }) => {
    const summary = await checkPage(page, "/login", "login", "form, main, body");
    expect(summary.consoleErrors, "console error").toEqual([]);
    expect(summary.overflow, "横はみ出し").toBe(false);
    expect(summary.overlapPairs, "SVG テキスト重なり").toEqual([]);
  });
});

test.describe("front-check: 認証済み5画面", () => {
  test.skip(!existsSync(STATE_PATH), "e2e/.auth/state.json 未生成 — npm run e2e:auth を先に実行");
  test.use({ storageState: STATE_PATH });

  for (const { path, name, readySelector } of AUTHED_PAGES) {
    test(`${path} の整合性(console / はみ出し / SVG 重なり)`, async ({ page }) => {
      const summary = await checkPage(page, path, name, readySelector);
      expect(summary.consoleErrors, "console error").toEqual([]);
      expect(summary.overflow, "横はみ出し").toBe(false);
      expect(summary.overlapPairs, "SVG テキスト重なり").toEqual([]);
    });
  }
});
