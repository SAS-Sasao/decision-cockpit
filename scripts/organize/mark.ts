// 対象設計: docs/design/detail/organize-loop.md §2.3(mark)
//
// tsx 実行用の CLI(job publish・最終ステップ)。out/files.json(検証済みマニフェスト)と
// pr.ts が書いた成功 repo 一覧を突き合わせ、PR 作成に成功した repo のファイルのみを
// ファイル単位で反復し capture_inbox を冪等に更新する。DATABASE_URL は organize_bot
// ロール接続文字列を想定。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

export type ManifestEntry = {
  repo: string;
  path: string;
  file: string;
  capture_ids: string[];
};

// 3列 UPDATE・deleted_at ガード込みの完全形(1行固定)。
export const MARK_SQL =
  "UPDATE capture_inbox SET processed_at = now(), status = 'done', curated_ref = $1 WHERE id = ANY($2) AND processed_at IS NULL AND deleted_at IS NULL";

/** curated_ref の形式(`<repo>:<path>`)。 */
export function buildCuratedRef(repo: string, path: string): string {
  return `${repo}:${path}`;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[organize/mark] 環境変数 ${name} が未設定です`);
  }
  return value;
}

function readSuccessRepos(out: string): string[] {
  try {
    const raw = readFileSync(join(out, "pr-repos.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function runMark(): Promise<void> {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const out = requiredEnv("ORGANIZE_OUT");

  const manifest = JSON.parse(readFileSync(join(out, "files.json"), "utf8")) as ManifestEntry[];
  const successRepos = new Set(readSuccessRepos(out));
  const targets = manifest.filter((entry) => successRepos.has(entry.repo));

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    let filesMarked = 0;
    for (const entry of targets) {
      const ref = buildCuratedRef(entry.repo, entry.path);
      const result = await pool.query(MARK_SQL, [ref, entry.capture_ids]);
      if (typeof result.rowCount === "number" && result.rowCount < entry.capture_ids.length) {
        // run 中に削除された行(deleted_at)がある可能性 — fail にはしない(§2.3・R1 G-3)。
        console.warn(`[organize/mark] rowCount below expected ids for ${ref}`);
      }
      filesMarked += 1;
    }
    console.log(`[organize/mark] files=${filesMarked}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMark().catch((err) => {
    console.error("[organize/mark] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
