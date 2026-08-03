// 対象設計: docs/design/detail/review-loop.md §2.3(writeback.ts)
//
// review job が success かつ結果ファイルが実在するときのみ done。それ以外(未知値・空・欠落・
// 失敗)はすべて ci_failed に倒す(fail-safe)。いずれも CAS(running のみ遷移)で、0行更新 =
// no-op の exit 0(先勝ち — stale 確定後の遅着は破棄する)。結果本文はログに出さない。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { CI_FAILED_SQL, DONE_SQL, isUuid, truncateResult } from "./sql";

async function main(): Promise<void> {
  const requestId = process.env.REVIEW_REQUEST_ID;
  const jobResult = process.env.REVIEW_JOB_RESULT ?? "";
  const outDir = process.env.REVIEW_OUT ?? "out";

  if (!isUuid(requestId)) {
    console.log("skip: invalid_request_id");
    return;
  }

  const connectionString = process.env.REVIEW_DATABASE_URL;
  if (!connectionString) {
    throw new Error("[review/writeback] REVIEW_DATABASE_URL が未設定です");
  }

  const resultPath = join(outDir, "review.md");
  const succeeded = jobResult === "success" && existsSync(resultPath);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (succeeded) {
      const { text, truncated } = truncateResult(readFileSync(resultPath, "utf8"));
      const res = await client.query(DONE_SQL, [requestId, text, truncated]);
      console.log(`done: ${res.rowCount} (truncated=${truncated})`);
      return;
    }
    const res = await client.query(CI_FAILED_SQL, [requestId]);
    console.log(`ci_failed: ${res.rowCount}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[review/writeback] 失敗:", err instanceof Error ? err.message : "unknown");
  process.exit(1);
});
