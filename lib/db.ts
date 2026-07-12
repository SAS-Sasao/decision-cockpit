import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §1.4(冪等 upsert)/ §2.6(server-only 規約)
//
// pg Pool を DATABASE_URL から一元管理する(唯一のデータアクセス経由)。
// 接続は遅延生成(モジュール読み込み時に throw しない)。実際にクエリを実行する
// タイミングで DATABASE_URL 未設定なら明示的にエラーにする(fail-fast)。

import { Pool, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

/** プロセス内で単一の Pool インスタンスを共有する(遅延初期化)。 */
export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "[lib/db] 環境変数 DATABASE_URL が未設定です。.env(.env.example を参照)に設定してください。"
    );
  }

  pool = new Pool({ connectionString });
  return pool;
}

/** SQL 実行の唯一の経路。テストからはこのモジュールごとモックする。 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, params);
}
