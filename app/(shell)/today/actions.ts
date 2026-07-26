"use server";

// 対象設計: docs/design/detail/wbs-loop.md §2.3(updateBoardState)
//
// /today の WBS カード移動を board_overrides に記録する(SSoT = board_items には書かない)。
// 検証は7段(§2.3 の順序どおり)。upsert に渡す base = 手順7で算出した実効状態
// (最新世代 state を素で渡さない — CHECK board_overrides_not_noop と同値になる唯一の導出)。
import { revalidatePath } from "next/cache";
import { getUser } from "../../../lib/auth/user";
import {
  getEffectiveBoardState,
  upsertBoardOverride,
  type BoardState,
} from "../../../lib/data/board-override";

export type UpdateBoardStateResult = { ok: true } | { ok: false; error: "unauthorized" | "bad_request" };

const BOARD_STATES: readonly string[] = ["todo", "doing", "done"];
const WBS_SOURCE = "cc-sier-organization";
const FILE_PATH_RE = /^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/;

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
