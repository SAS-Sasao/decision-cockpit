"use server";

// 対象設計: docs/design/detail/wbs-loop.md §2.3(updateBoardState)
//
// /today の WBS カード移動を board_overrides に記録する(SSoT = board_items には書かない)。
// 検証は7段(§2.3 の順序どおり)。upsert に渡す base = 手順7で算出した実効状態
// (最新世代 state を素で渡さない — CHECK board_overrides_not_noop と同値になる唯一の導出)。
import { revalidatePath } from "next/cache";
import { isAdmin } from "../../../lib/auth/roles";
import { getUser } from "../../../lib/auth/user";
import {
  getEffectiveBoardState,
  upsertBoardOverride,
  type BoardState,
} from "../../../lib/data/board-override";
import {
  FILE_PATH_RE,
  WBS_SOURCE,
  findCaptureCardForReview,
  findWbsCardForReview,
} from "../../../lib/data/card-lookup";
import { buildCardQuestion, type CardForPrompt } from "../../../lib/review/card-prompt";
import type { CardRef } from "../../../lib/review/card-key";
import { submitReview, type ReviewCardRef, type ReviewSubmitError } from "../../../lib/review/submit";

export type UpdateBoardStateResult = { ok: true } | { ok: false; error: "unauthorized" | "bad_request" };

const BOARD_STATES: readonly string[] = ["todo", "doing", "done"];

export async function updateBoardState(input: {
  source: string;
  filePath: string;
  itemKey: string;
  desired: string;
}): Promise<UpdateBoardStateResult> {
  // (1) 認証
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "unauthorized" };
  }

  // (2) desired の語彙
  if (!BOARD_STATES.includes(input.desired)) {
    return { ok: false, error: "bad_request" };
  }
  const desired = input.desired as BoardState;

  // (3) source は固定値
  if (input.source !== WBS_SOURCE) {
    return { ok: false, error: "bad_request" };
  }

  // (4) filePath の形式(DB CHECK と同じ regex + '..' 不含)
  if (!FILE_PATH_RE.test(input.filePath) || input.filePath.includes("..")) {
    return { ok: false, error: "bad_request" };
  }

  // (5) itemKey 非空・上限
  if (input.itemKey === "" || input.itemKey.length > 200) {
    return { ok: false, error: "bad_request" };
  }

  // (6) 実在確認(最新世代)+ (7) no-op 拒否(実効状態基準)
  const key = { source: input.source, filePath: input.filePath, itemKey: input.itemKey };
  let effective: Awaited<ReturnType<typeof getEffectiveBoardState>>;
  try {
    effective = await getEffectiveBoardState(key);
  } catch {
    return { ok: false, error: "bad_request" };
  }
  if (!effective) {
    return { ok: false, error: "bad_request" }; // 最新世代に無い item は受理しない(存在秘匿)
  }
  if (effective.effectiveState === desired) {
    return { ok: false, error: "bad_request" }; // no-op
  }

  try {
    await upsertBoardOverride(user.id, key, desired, effective.effectiveState);
  } catch {
    return { ok: false, error: "bad_request" };
  }

  revalidatePath("/today");
  return { ok: true };
}

// --- card-review(対象設計: docs/design/detail/card-review.md §2.7)---
//
// 2段(確認 → 送信)。クライアントから受け取るのは**識別子だけ**で、質問文・タイトル・本文は
// 受け取らない。確認時の文字列も受け取らない(送信時に再 lookup・再生成した結果が正)。
// 確認ステップを飛ばして送信を呼ぶことはサーバでは防げない(Server Action は単独で呼べる)—
// 脅威モデルが「admin 本人のみ」なので受容する。基本設計の「確認ステップ必須」は UI 上の必須の意。

export type CardReviewError = "unauthorized" | "not_found" | ReviewSubmitError;
export type PrepareCardReviewResult =
  | { ok: true; question: string }
  | { ok: false; error: CardReviewError };
export type SubmitCardReviewResult = { ok: true } | { ok: false; error: CardReviewError };

/** 識別子から実体を引き当てる(見つからない理由は区別しない = 存在秘匿)。 */
async function lookupCard(userId: string, ref: CardRef): Promise<CardForPrompt | null> {
  try {
    if (ref.kind === "wbs") {
      const found = await findWbsCardForReview(ref.filePath, ref.itemKey);
      if (!found) return null;
      return { kind: "wbs", title: found.title, filePath: ref.filePath, itemKey: ref.itemKey };
    }
    if (ref.kind === "capture") {
      const found = await findCaptureCardForReview(userId, ref.captureId);
      if (!found) return null;
      return {
        kind: "capture",
        captureKind: found.captureKind,
        topic: found.topic,
        body: found.body,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** DB へ渡すカード参照(0011 の形状 CHECK が受理する2形のいずれか)。 */
function toReviewCardRef(ref: CardRef, card: CardForPrompt): ReviewCardRef {
  if (ref.kind === "wbs" && card.kind === "wbs") {
    return {
      kind: "wbs",
      source: WBS_SOURCE,
      filePath: ref.filePath,
      itemKey: ref.itemKey,
      title: card.title,
    };
  }
  const topic = card.kind === "capture" ? card.topic : null;
  return { kind: "capture", captureId: ref.kind === "capture" ? ref.captureId : "", title: topic };
}

export async function prepareCardReview(ref: CardRef): Promise<PrepareCardReviewResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "unauthorized" };
  }
  if (!(await isAdmin(user.id))) {
    return { ok: false, error: "unauthorized" };
  }
  const card = await lookupCard(user.id, ref);
  if (!card) {
    return { ok: false, error: "not_found" };
  }
  return { ok: true, question: buildCardQuestion(card) };
}

export async function submitCardReview(ref: CardRef): Promise<SubmitCardReviewResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "unauthorized" };
  }
  if (!(await isAdmin(user.id))) {
    return { ok: false, error: "unauthorized" };
  }
  const card = await lookupCard(user.id, ref);
  if (!card) {
    return { ok: false, error: "not_found" };
  }
  const submitted = await submitReview({
    requestedBy: user.id,
    question: buildCardQuestion(card),
    card: toReviewCardRef(ref, card),
  });
  if (!submitted.ok) {
    return { ok: false, error: submitted.error };
  }
  revalidatePath("/today");
  return { ok: true };
}
