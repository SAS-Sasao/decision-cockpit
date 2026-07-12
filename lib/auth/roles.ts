import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.1(POST /api/sync の認可)
//
// user_roles JOIN roles で admin ロール保有を判定する。

import { query } from "../db";

export async function isAdmin(userId: string): Promise<boolean> {
  const result = await query<{ is_admin: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name = 'admin'
     ) AS is_admin`,
    [userId]
  );
  return result.rows[0]?.is_admin === true;
}
