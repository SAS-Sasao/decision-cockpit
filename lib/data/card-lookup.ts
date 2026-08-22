import "server-only";

// 対象設計: docs/design/detail/card-review.md §2.6
//
// カード起点の CI レビューで「クライアントが送ってきた識別子」から実体を引き当てる。
// クライアントは識別子しか送れないので、質問文に載る値はすべてここで DB から読み直したものになる。
//
// 見つからない理由は区別しない(いずれも null = 存在秘匿)。呼び出し側は not_found に潰す。
// 最新世代の選出式は lib/data/board-override.ts の LATEST_BOARD_CTE を import して使う
// (選出式のコピーを増やさない — 乖離の余地をなくす)。

import { isUuid } from "../review/card-key";
import { query } from "../db";
import { LATEST_BOARD_CTE } from "./board-override";

/** WBS カードの source は固定値。updateBoardState と共有する(コピーを作らない)。 */
export const WBS_SOURCE = "cc-sier-organization";
/** WBS ファイルパスの形式(0009 / 0011 の CHECK と同じ形)。 */
export const FILE_PATH_RE = /^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/;

/** card_title の上限(0011 の CHECK と同値 — 超過すると INSERT が例外になる)。 */
const CARD_TITLE_MAX_CHARS = 500;

const WBS_CARD_SQL = `${LATEST_BOARD_CTE}
     SELECT b.title
       FROM latest l
       JOIN board_items b
         ON b.source = l.source AND b.file_path = l.file_path AND b.item_key = l.item_key
       JOIN generations g
         ON b.source = g.source AND b.file_path = g.file_path AND b.commit = g.commit
      WHERE l.source = $1 AND l.file_path = $2 AND l.item_key = $3
      LIMIT 1`;

const CAPTURE_CARD_SQL = `
  SELECT kind, topic, body
    FROM capture_inbox
   WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
     AND kind IN ('next_move','issue')
   LIMIT 1`;

/** コードポイント単位の切り詰め(サロゲートペアを割らない)。 */
function clipTitle(s: string): string {
  const points = Array.from(s);
  if (points.length <= CARD_TITLE_MAX_CHARS) return s;
  return points.slice(0, CARD_TITLE_MAX_CHARS).join("");
}

/**
 * WBS カードの引き当て(最新世代限定・source 固定・形式検証つき)。
 * title は 500 コードポイントで切り詰めて返す — board_items.title は無制限なので、
 * 501 字以上をそのまま渡すと 0011 の card_title_len に触れて INSERT が例外になる。
 */
export async function findWbsCardForReview(
  filePath: string,
  itemKey: string
): Promise<{ title: string } | null> {
  if (!FILE_PATH_RE.test(filePath) || filePath.includes("..")) return null;
  if (itemKey === "" || itemKey.length > 200) return null;

  const result = await query<{ title: string }>(WBS_CARD_SQL, [WBS_SOURCE, filePath, itemKey]);
  const row = result.rows[0];
  if (!row) return null;
  return { title: clipTitle(row.title) };
}

/**
 * capture カードの引き当て(本人所有・生存行・盤面に出る2種別のみ)。
 * **先に UUID 形式を検証する** — 不正な文字列をそのまま渡すと 22P02 例外になり、
 * 「存在しない」と「形式が不正」が応答で区別できてしまう(存在秘匿が破れる)。
 */
export async function findCaptureCardForReview(
  userId: string,
  captureId: string
): Promise<{ captureKind: "next_move" | "issue"; topic: string | null; body: string } | null> {
  if (!isUuid(captureId)) return null;

  const result = await query<{ kind: "next_move" | "issue"; topic: string | null; body: string }>(
    CAPTURE_CARD_SQL,
    [userId, captureId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { captureKind: row.kind, topic: row.topic, body: row.body };
}
