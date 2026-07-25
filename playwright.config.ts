// 対象設計: docs/design/basic/front-check.md §3(playwright.config.ts)
//
// フロント整合性チェック(ローカル専用の運用ツール — CI・npm test には組み込まない)。
// セキュリティ上の要点(設計 §1-1・sec レビュー R1):
// - trace / video / screenshot は全 off(trace・video・HAR には Cookie やログイン POST の
//   ボディが記録され得るため。e2e:auth も同一 config で走るので録画は構造的に発生しない)。
// - reporter は list のみ(playwright-report/ の HTML レポートを生成しない)。
// - baseURL は localhost 固定(env 上書き機構は意図的に不採用 — 本番セッション cookie の
//   平文保存・本番実データのスクリーンショット保存を防ぐ)。
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results", // gitignore 済み
  reporter: [["list"]],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1, // dev サーバの初回コンパイル遅延と競合しないよう直列
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    video: "off",
    screenshot: "off",
    browserName: "chromium",
  },
  projects: [
    // 通常実行(npm run e2e)— 認証状態の生成(auth.setup)は testIgnore で除外
    { name: "check", testIgnore: "**/auth.setup.ts" },
    // 認証状態の生成(npm run e2e:auth)— auth.setup のみ・headed で手動ログイン
    { name: "auth", testMatch: "**/auth.setup.ts" },
  ],
});
