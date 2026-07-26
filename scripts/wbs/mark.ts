// 対象設計: docs/design/detail/wbs-loop.md §2.5(mark — pr_ref 更新と不在 superseded)
//
// - out/pr.json の created=true の場合のみ、送信集合(applied.json 由来)の pr_ref を更新する。
//   PR 失敗時(pr.json 不在・created=false)は pr_ref を書かない(次回再送)。
// - 不在集合(absent.json)は pr の成否に関わらず resolved_at + resolution='superseded' にする
//   (送信0件・不在ありの run でも実行される — 基本設計 R2 G-R2-1 の出口)。
// wbs_bot の UPDATE 3列(pr_ref / resolved_at / resolution)のみを使う。ログは件数のみ。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

export type AppliedItem = { item_key: string; from: string; to: string };
export type AppliedFile = { path: string; items: AppliedItem[] };
export type AuditRow = { source: string; file_path: string; item_key: string };
export type PrResult = { created: boolean; number?: string; branch?: string };

export const MARK_PR_SQL =
  "UPDATE board_overrides SET pr_ref = $1 WHERE source = $2 AND file_path = $3 AND item_key = $4 AND resolved_at IS NULL AND pr_ref IS NULL";

export const MARK_ABSENT_SQL =
  "UPDATE board_overrides SET resolved_at = now(), resolution = 'superseded' WHERE source = $1 AND file_path = $2 AND item_key = $3 AND resolved_at IS NULL";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[wbs/mark] 環境変数 ${name} が未設定です`);
  }
  return value;
}

export async function runMark(): Promise<void> {
  const databaseUrl = requiredEnv("WBS_DATABASE_URL");
  const out = requiredEnv("WBS_OUT");

  const prPath = join(out, "pr.json");
  const pr: PrResult = existsSync(prPath)
    ? (JSON.parse(readFileSync(prPath, "utf8")) as PrResult)
    : { created: false };
  const applied = JSON.parse(readFileSync(join(out, "applied.json"), "utf8")) as AppliedFile[];
  const absent = JSON.parse(readFileSync(join(out, "absent.json"), "utf8")) as AuditRow[];

  const pool = new Pool({ connectionString: databaseUrl });
  let marked = 0;
  let superseded = 0;
  try {
    if (pr.created && pr.branch) {
      for (const file of applied) {
        for (const item of file.items) {
          const result = await pool.query(MARK_PR_SQL, [
            pr.branch,
            "cc-sier-organization",
            file.path,
            item.item_key,
          ]);
          marked += result.rowCount ?? 0;
        }
      }
    }
    for (const row of absent) {
      const result = await pool.query(MARK_ABSENT_SQL, [row.source, row.file_path, row.item_key]);
      superseded += result.rowCount ?? 0;
    }
  } finally {
    await pool.end();
  }
  console.log(`[wbs/mark] pr_ref=${marked} superseded=${superseded}`);
}

if (require.main === module) {
  runMark().catch((err) => {
    console.error("[wbs/mark] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
