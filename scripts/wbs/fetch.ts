// 対象設計: docs/design/detail/wbs-loop.md §2.5(fetch — 2集合の取得)
//
// tsx 実行用 CLI。board_overrides から送信集合(active AND pr_ref IS NULL)と
// 監査集合(全アクティブ — 不在検査・多ユーザーガードの母集団)を読み、out/overrides.json に書く。
// overrides.json に user_id は収録しない(値は取得しない — COUNT(DISTINCT) のみ)。ログは件数のみ。
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

// 多ユーザーガード(M5 R3 R-11 と同型・母集団 = 監査集合 = 全アクティブ行)。
export const MULTI_USER_GUARD_SQL =
  "SELECT count(DISTINCT user_id) FROM board_overrides WHERE resolved_at IS NULL";

// 送信集合(user_id 非収録 — SELECT 列に含めない)。
export const SEND_SQL =
  "SELECT source, file_path, item_key, desired_state FROM board_overrides WHERE resolved_at IS NULL AND pr_ref IS NULL ORDER BY file_path ASC, item_key ASC";

// 監査集合(pr_ref の有無に関わらず全アクティブ — 基本設計 R2 G-R2-1 の決着)。
export const AUDIT_SQL =
  "SELECT source, file_path, item_key FROM board_overrides WHERE resolved_at IS NULL ORDER BY file_path ASC, item_key ASC";

export type SendRow = { source: string; file_path: string; item_key: string; desired_state: string };
export type AuditRow = { source: string; file_path: string; item_key: string };
export type OverridesPayload = { send: SendRow[]; audit: AuditRow[] };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[wbs/fetch] 環境変数 ${name} が未設定です`);
  }
  return value;
}

export async function runFetch(): Promise<void> {
  const databaseUrl = requiredEnv("WBS_DATABASE_URL");
  const out = requiredEnv("WBS_OUT");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const guard = await pool.query(MULTI_USER_GUARD_SQL);
    const distinctUsers = Number(guard.rows[0]?.count ?? 0);
    if (distinctUsers >= 2) {
      throw new Error(
        "[wbs/fetch] 複数ユーザーの override を検知したため run を停止します(単一ユーザー前提の破れ)"
      );
    }

    const send = (await pool.query<SendRow>(SEND_SQL)).rows;
    const audit = (await pool.query<AuditRow>(AUDIT_SQL)).rows;

    mkdirSync(out, { recursive: true });
    const payload: OverridesPayload = { send, audit };
    writeFileSync(join(out, "overrides.json"), JSON.stringify(payload));

    console.log(`[wbs/fetch] send=${send.length} audit=${audit.length}`);

    if (send.length === 0 && audit.length === 0) {
      const ghOutput = process.env.GITHUB_OUTPUT;
      if (ghOutput) {
        appendFileSync(ghOutput, "empty=true\n");
      }
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runFetch().catch((err) => {
    console.error("[wbs/fetch] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
