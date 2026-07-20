// 対象設計: docs/design/detail/organize-loop.md §2.1(job fetch)
//
// tsx 実行用の CLI(job fetch)。capture_inbox の未処理行を読み取り、
// out/rows.json(job generate へ)・state/ids.json・state/run.json(信頼アンカー)を書く。
// DATABASE_URL は organize_bot ロール接続文字列を想定(docs/setup/organize-role.sql)。
// date/slot/allowed_orgs は env をそのまま書き写すのみで、このスクリプト自身は日付を
// 計算しない(権威は workflow の `id: run` step — R4 data G-1/G-2)。
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

// 多ユーザーガード(R3 R-11): 値は取得せず件数のみを見る。単一ユーザー前提が破れたら run を fail する。
export const MULTI_USER_GUARD_SQL =
  "SELECT count(DISTINCT user_id) FROM capture_inbox WHERE processed_at IS NULL AND deleted_at IS NULL";

// 列リスト完全形(SELECT に user_id を含まない)。
export const FETCH_SQL =
  "SELECT id, kind, topic, tags, body, status, created_at FROM capture_inbox WHERE processed_at IS NULL AND deleted_at IS NULL ORDER BY created_at ASC, id ASC LIMIT $1";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

/** ORGANIZE_LIMIT(既定 50)を 1..200 にクランプする。未設定・不正値は既定を使う。 */
export function resolveLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

/** ORGANIZE_ALLOWED_ORGS(カンマ区切り)を配列にする。 */
export function parseAllowedOrgs(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type FetchRow = {
  id: string;
  kind: string;
  topic: string | null;
  tags: string[];
  body: string;
  status: string;
  created_at: string;
};

export type RunMeta = { date: string; slot: string; allowed_orgs: string[] };

export type RowsPayload = { date: string; slot: string; allowed_orgs: string[]; rows: FetchRow[] };

/** job generate へ渡す out/rows.json の形状({ date, slot, allowed_orgs, rows } — env をそのまま書き写す)。 */
export function buildRowsPayload(run: RunMeta, rows: FetchRow[]): RowsPayload {
  return { date: run.date, slot: run.slot, allowed_orgs: run.allowed_orgs, rows };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[organize/fetch] 環境変数 ${name} が未設定です`);
  }
  return value;
}

export async function runFetch(): Promise<void> {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const date = requiredEnv("ORGANIZE_DATE");
  const slot = requiredEnv("ORGANIZE_SLOT");
  const allowedOrgsRaw = requiredEnv("ORGANIZE_ALLOWED_ORGS");
  const out = requiredEnv("ORGANIZE_OUT");
  const state = requiredEnv("ORGANIZE_STATE");
  const limit = resolveLimit(process.env.ORGANIZE_LIMIT);
  const run: RunMeta = { date, slot, allowed_orgs: parseAllowedOrgs(allowedOrgsRaw) };

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const guard = await pool.query(MULTI_USER_GUARD_SQL);
    const distinctUsers = Number(guard.rows[0]?.count ?? 0);
    if (distinctUsers >= 2) {
      throw new Error(
        "[organize/fetch] 複数ユーザーの capture を検知したため run を停止します(単一ユーザー前提の破れ)"
      );
    }

    const result = await pool.query<FetchRow>(FETCH_SQL, [limit]);
    const rows = result.rows;

    mkdirSync(out, { recursive: true });
    mkdirSync(state, { recursive: true });
    writeFileSync(join(out, "rows.json"), JSON.stringify(buildRowsPayload(run, rows)));
    writeFileSync(join(state, "ids.json"), JSON.stringify(rows.map((r) => r.id)));
    writeFileSync(join(state, "run.json"), JSON.stringify(run));

    console.log(`[organize/fetch] rows=${rows.length}`);

    if (rows.length === 0) {
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
    console.error("[organize/fetch] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
