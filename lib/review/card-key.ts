// 対象設計: docs/design/detail/card-review.md §2.5b(純関数のみ・server-only を付けない)
//
// /today のカードと review_requests の行を突き合わせるための内部表記と、表示側で使う純粋な判定。
// client component からも import するため server-only を付けず、DB・環境変数・秘密に触れない。
//
// 本ファイルには §4 の計数ピンが掛かっている(識別子のみ受理という性質の担保)。
// 受け渡す情報を増やす改訂は性質そのものを変えるため、設計 §2.5b の決着を先に読むこと。

import { STALE_PENDING_MINUTES, STALE_RUNNING_MINUTES } from "./api-lib";

export type CardRef =
  | { kind: "wbs"; filePath: string; itemKey: string }
  | { kind: "capture"; captureId: string };

/** 突き合わせ用の内部表記(画面には出さない)。同一入力に対して安定であること。 */
export function cardKeyOf(ref: CardRef): string {
  if (ref.kind === "wbs") {
    return `wbs|${ref.filePath}|${ref.itemKey}`;
  }
  return `capture|${ref.captureId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * capture 識別子の形式検証(DB を叩く前段)。scripts/review/sql.ts に同名の実装があるが、
 * App 層が CI スクリプト層に依存する向きを作らないため import しない。
 * 意図的な重複なので、**挙動の同値をテストでアサート**する(CI 側は正規表現を export していない)。
 */
export function isUuid(v: string | undefined | null): boolean {
  if (typeof v !== "string") return false;
  return UUID_RE.test(v);
}

const MS_PER_MINUTE = 60_000;

/**
 * 実行が滞留しているかの判定(表示とボタン再有効化に使う)。
 * 境界は「**経過 >= 閾値で stale**」= SQL の sweep(経過 > 閾値)とちょうど1点だけずれる。
 * UI 側を stale 寄りに倒すのは意図的で、境界の瞬間は「中断」表示になるがボタンは無効のまま
 * = 安全側に倒れる(設計 §3 の決着)。
 */
export function isStaleReview(
  r: { status: string; createdAt: string; startedAt: string | null },
  nowMs: number
): boolean {
  if (r.status === "pending") {
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t)) return false;
    return nowMs - t >= STALE_PENDING_MINUTES * MS_PER_MINUTE;
  }
  if (r.status === "running") {
    if (r.startedAt === null) return false;
    const t = Date.parse(r.startedAt);
    if (Number.isNaN(t)) return false;
    return nowMs - t >= STALE_RUNNING_MINUTES * MS_PER_MINUTE;
  }
  return false;
}
