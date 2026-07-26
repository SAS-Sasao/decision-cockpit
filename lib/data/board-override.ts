import "server-only";

// 対象設計: docs/design/detail/wbs-loop.md §2.1(board-override データ層)
//
// /today の WBS カード移動のオーバーレイ(board_overrides)。SSoT(board_items)には書かない —
// 書き込みはこのファイルの UPSERT / 照合と、CI の scripts/wbs/mark.ts のみ(基本設計 §1-6 の分担)。
// 注意: 本ファイル以外の lib/app にこのテーブルの更新文を書かない(§4 のファイル数ピン)。

import { query } from "../db";

export type BoardState = "todo" | "doing" | "done";
export type OverrideKey = { source: string; filePath: string; itemKey: string };
export type OverrideRow = OverrideKey & {
  desiredState: BoardState;
  baseState: BoardState;
  prRef: string | null;
  updatedAt: string;
};

/**
 * 最新世代選出の SQL 断片(単一定義 — resolve と updateBoardState の実在確認が共用)。
 * 選出式リテラルは lib/data/today.ts の generations CTE と文字同一であること
 * (tests/board-override.test.ts でピン — 3重コピーの乖離防止)。
 */
export const LATEST_BOARD_CTE = `WITH generations AS (
       SELECT source, file_path,
              (array_agg(commit ORDER BY synced_at DESC, commit DESC))[1] AS commit
         FROM board_items
        GROUP BY source, file_path
     ),
     latest AS (
       SELECT b.source, b.file_path, b.item_key, b.state
         FROM board_items b
         JOIN generations g
           ON b.source = g.source AND b.file_path = g.file_path AND b.commit = g.commit
     )`;

/**
 * 移動の記録(UPSERT)。再移動は同一行を更新し pr_ref / resolved_at / resolution をリセットする。
 * base = 「移動直前にユーザーが見ていた実効状態」(呼び出し側 = updateBoardState 手順7で算出)。
 */
export async function upsertBoardOverride(
  userId: string,
  key: OverrideKey,
  desired: BoardState,
  base: BoardState
): Promise<void> {
  await query(
    `INSERT INTO board_overrides
       (source, file_path, item_key, desired_state, base_state, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source, file_path, item_key) DO UPDATE SET
       desired_state = $4, base_state = $5, user_id = $6, updated_at = now(),
       pr_ref = NULL, resolved_at = NULL, resolution = NULL`,
    [key.source, key.filePath, key.itemKey, desired, base, userId]
  );
}

type OverrideQueryRow = {
  source: string;
  file_path: string;
  item_key: string;
  desired_state: BoardState;
  base_state: BoardState;
  pr_ref: string | null;
  updated_at: Date;
};

/**
 * アクティブ行(resolved_at IS NULL)。user_id 非スコープは意図的(単一ユーザー前提 —
 * 破れの検知は CI 側の DISTINCT user_id ガード。基本設計 §1-5 / 詳細 §0-5)。
 */
export async function listActiveOverrides(): Promise<OverrideRow[]> {
  const result = await query<OverrideQueryRow>(
    `SELECT source, file_path, item_key, desired_state, base_state, pr_ref, updated_at
       FROM board_overrides
      WHERE resolved_at IS NULL
      ORDER BY updated_at DESC`
  );
  return result.rows.map((row) => ({
    source: row.source,
    filePath: row.file_path,
    itemKey: row.item_key,
    desiredState: row.desired_state,
    baseState: row.base_state,
    prRef: row.pr_ref,
    updatedAt: row.updated_at.toISOString(),
  }));
}

/**
 * 照合(基本設計 §1-7 の前2出口)。比較対象 = 最新世代(LATEST_BOARD_CTE)。
 * - applied: 最新世代の state = desired(PR マージが同期で還った = ループ完了)
 * - superseded: 最新世代の state が base とも desired とも異なる(SSoT 側の別変更 — SSoT 優先)
 * 不在(最新世代に item が無い)はここでは解決しない — CI の checkout 実物基準(scripts/wbs)。
 */
export async function resolveOverridesAfterSync(): Promise<{ applied: number; superseded: number }> {
  const result = await query<{ resolution: "applied" | "superseded" }>(
    `${LATEST_BOARD_CTE}
     UPDATE board_overrides o
        SET resolved_at = now(),
            resolution = CASE WHEN l.state = o.desired_state THEN 'applied' ELSE 'superseded' END
       FROM latest l
      WHERE o.resolved_at IS NULL
        AND l.source = o.source AND l.file_path = o.file_path AND l.item_key = o.item_key
        AND (l.state = o.desired_state
             OR (l.state <> o.base_state AND l.state <> o.desired_state))
      RETURNING o.resolution`
  );
  let applied = 0;
  let superseded = 0;
  for (const row of result.rows) {
    if (row.resolution === "applied") applied += 1;
    else superseded += 1;
  }
  return { applied, superseded };
}

/**
 * 実在確認 + 実効状態の取得(updateBoardState 用)。最新世代に item が存在すれば
 * { state, 実効状態(アクティブ override の desired があればそれ) } を返す。無ければ null。
 */
export async function getEffectiveBoardState(
  key: OverrideKey
): Promise<{ latestState: BoardState; effectiveState: BoardState } | null> {
  const result = await query<{ state: BoardState; desired_state: BoardState | null }>(
    `${LATEST_BOARD_CTE}
     SELECT l.state, o.desired_state
       FROM latest l
       LEFT JOIN board_overrides o
         ON o.source = l.source AND o.file_path = l.file_path AND o.item_key = l.item_key
        AND o.resolved_at IS NULL
      WHERE l.source = $1 AND l.file_path = $2 AND l.item_key = $3`,
    [key.source, key.filePath, key.itemKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { latestState: row.state, effectiveState: row.desired_state ?? row.state };
}
