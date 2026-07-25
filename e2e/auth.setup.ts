// 対象設計: docs/design/basic/front-check.md §1-3(e2e:auth — 認証状態の生成)
//
// headed ブラウザで /login を開き、**ユーザーが手動でログイン**する。/(今日)への到達を検知したら
// storageState を e2e/.auth/state.json に保存して終了する。
// - 資格情報はこのスクリプト・リポジトリ・env のどこにも書かない(ユーザーがブラウザに直接入力)。
// - state.json はセッショントークンの平文保存(gitignore 済み・表示/コピー禁止 — 設計 §1-3)。
// - trace/video/screenshot は config で全 off のため、入力内容が成果物に記録されることはない。
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "@playwright/test";

const STATE_PATH = join(__dirname, ".auth", "state.json");

test("手動ログインして認証状態を保存する", async ({ page }) => {
  test.setTimeout(5 * 60_000); // 手動操作のため5分待つ

  await page.goto("/login", { waitUntil: "load" });
  console.log("[e2e:auth] ブラウザでログインしてください(5分以内)…");

  // ログイン成功 = 保護ページへ遷移(/login 以外の URL になる)を待つ
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 5 * 60_000 });

  await mkdir(dirname(STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STATE_PATH });
  console.log("[e2e:auth] 認証状態を保存しました: e2e/.auth/state.json");
});
