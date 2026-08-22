import "server-only";

// 対象設計: docs/design/detail/card-review.md §2.1(受理シーケンスの正典)
//
// CI レビュー依頼の受理は**このファイルが唯一の正典**。壁打ちパネル経路(app/api/review/route.ts)と
// カード経路(/today の Server Action)の両方がここを通る。route.ts に残るのは認可・入力検証・
// error 語彙 → HTTP status の写像・レスポンス生成だけ(review-loop 詳細 §2.2 のポインタ)。
//
// 秘密衛生の契約:
// - PAT を含むヘッダ・リクエストをログに出さない(ログは固定文言 + request id のみ)。
// - GitHub のエラーボディ・status を戻り値に載せない(返すのは ReviewSubmitError の4リテラルのみ)。
//
// 差し替えの形(テスト): DB は vi.mock によるモジュール境界の差し替え、dispatch は
// **呼び出し時に globalThis.fetch を参照**する。モジュール評価時に const へ束縛すると
// vi.stubGlobal("fetch", …) が効かず、実ネットワークに出るか秘密衛生のアサートが静かに落ちる。

import { query } from "../db";
import {
  DAILY_COUNT_SQL,
  DAILY_LIMIT,
  DISPATCH_FAILED_SQL,
  DISPATCH_URL,
  INFLIGHT_SQL,
  INSERT_SQL,
  INSERT_WITH_CARD_SQL,
  SWEEP_PENDING_SQL,
  SWEEP_RUNNING_SQL,
} from "./api-lib";

export type ReviewSubmitError =
  | "review_not_configured"
  | "busy"
  | "daily_limit"
  | "dispatch_failed";

export type ReviewCardRef =
  | { kind: "wbs"; source: string; filePath: string; itemKey: string; title: string }
  | { kind: "capture"; captureId: string; title: string | null };

export type ReviewSubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: ReviewSubmitError };

/** 0011 の形状 CHECK が受理する3形のうち、カード有りの2形を組み立てる。 */
function cardParams(card: ReviewCardRef): unknown[] {
  if (card.kind === "wbs") {
    return [card.kind, card.source, card.filePath, card.itemKey, null, card.title];
  }
  return [card.kind, null, null, null, card.captureId, card.title];
}

/**
 * 依頼の受理。**処理順が契約**(テストで順序配列を記録する):
 * PAT → sweep 2文 → 同時1件 → 日次上限 → INSERT → dispatch。
 * question の非空は呼び出し側の責務(DB の btrim(question) <> '' が最終防御)。
 */
export async function submitReview(input: {
  requestedBy: string;
  question: string;
  card?: ReviewCardRef;
}): Promise<ReviewSubmitResult> {
  // 1. fail-closed: 未設定なら DB を1回も触らずに返す(INSERT より前)
  const pat = process.env.REVIEW_DISPATCH_PAT;
  if (!pat) return { ok: false, error: "review_not_configured" };

  // 2. stale sweep(受理前 — gate off / PAT 失効 / CI 停止での永久ロックを解除する)
  await query(SWEEP_PENDING_SQL);
  await query(SWEEP_RUNNING_SQL);

  // 3. 同時1件
  const inflight = await query<{ inflight: boolean }>(INFLIGHT_SQL);
  if (inflight.rows[0]?.inflight) return { ok: false, error: "busy" };

  // 4. 日次上限
  const daily = await query<{ n: number }>(DAILY_COUNT_SQL);
  if ((daily.rows[0]?.n ?? 0) >= DAILY_LIMIT) return { ok: false, error: "daily_limit" };

  // 5. INSERT(カード有無で文を分ける)
  const inserted = input.card
    ? await query<{ id: string }>(INSERT_WITH_CARD_SQL, [
        input.requestedBy,
        input.question,
        ...cardParams(input.card),
      ])
    : await query<{ id: string }>(INSERT_SQL, [input.requestedBy, input.question]);
  const id = inserted.rows[0]?.id;
  if (!id) return { ok: false, error: "dispatch_failed" };

  // 6. dispatch
  let ok = false;
  try {
    const res = await globalThis.fetch(DISPATCH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${pat}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { request_id: id } }),
    });
    ok = res.status === 204;
  } catch {
    ok = false;
  }

  if (!ok) {
    await query(DISPATCH_FAILED_SQL, [id]);
    console.warn(`review dispatch failed: ${id}`);
    return { ok: false, error: "dispatch_failed" };
  }

  return { ok: true, id };
}
