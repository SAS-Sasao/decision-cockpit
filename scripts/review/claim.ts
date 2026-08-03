// 対象設計: docs/design/detail/review-loop.md §2.3(claim.ts)
//
// pending → running の CAS を単一文で行い(started_at / run_ref を同時設定)、質問を artifact 用に
// 書き出す。0行更新・不正 request_id はいずれも理由コードを1行ログして green skip(exit 0)。
// 質問文そのものはログに出さない(件数・理由コードのみ)。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { Client } from "pg";
import { CLAIM_SQL, isUuid } from "./sql";

/** GITHUB_OUTPUT へ1行そのまま書く(後続 job の if 条件が読む値)。 */
function setOutput(line: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  appendFileSync(out, `${line}\n`);
}

async function main(): Promise<void> {
  const requestId = process.env.REVIEW_REQUEST_ID;
  const runUrl = process.env.REVIEW_RUN_URL ?? "";
  const outDir = process.env.REVIEW_OUT ?? "out";

  if (!isUuid(requestId)) {
    console.log("skip: invalid_request_id");
    setOutput("claimed=false");
    return;
  }

  const connectionString = process.env.REVIEW_DATABASE_URL;
  if (!connectionString) {
    throw new Error("[review/claim] REVIEW_DATABASE_URL が未設定です");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query<{ question: string }>(CLAIM_SQL, [requestId, runUrl]);
    if (res.rowCount === 0) {
      console.log("skip: not_pending");
      setOutput("claimed=false");
      return;
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "question.md"), res.rows[0].question, "utf8");
    console.log("claimed: 1");
    setOutput("claimed=true");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[review/claim] 失敗:", err instanceof Error ? err.message : "unknown");
  process.exit(1);
});
