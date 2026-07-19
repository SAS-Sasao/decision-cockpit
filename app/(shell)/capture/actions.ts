"use server";

// 対象設計: docs/design/detail/capture-spar.md §2.2(app/(shell)/capture/actions.ts)
//
// capture_inbox への保存 Server Action。user_id はセッション由来のみ(input に含めない)。
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "../../../lib/auth/user";
import { insertCapture, type CaptureKind } from "../../../lib/data/capture";

export type SaveCaptureResult = { ok: true } | { ok: false; error: "unauthorized" | "bad_request" };

const CAPTURE_KIND_VALUES: readonly CaptureKind[] = ["status", "issue", "next_move", "spar_conclusion"];

function isCaptureKind(value: string): value is CaptureKind {
  return (CAPTURE_KIND_VALUES as readonly string[]).includes(value);
}

export async function saveCapture(input: {
  kind: string;
  topic: string;
  body: string;
}): Promise<SaveCaptureResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "unauthorized" };
  }

  if (!isCaptureKind(input.kind)) {
    return { ok: false, error: "bad_request" };
  }

  const body = input.body.trim();
  if (body.length < 1 || body.length > 4000) {
    return { ok: false, error: "bad_request" };
  }

  const topicTrimmed = input.topic.trim();
  if (topicTrimmed.length > 200) {
    return { ok: false, error: "bad_request" };
  }
  const topic = topicTrimmed.length === 0 ? null : topicTrimmed;

  try {
    await insertCapture(user.id, input.kind, topic, body);
  } catch {
    return { ok: false, error: "bad_request" };
  }

  revalidatePath("/capture");
  return { ok: true };
}

/**
 * 画面のフォーム(<form action={...}>)向けアダプタ。FormData を saveCapture の入力形に
 * 詰め替えるだけの薄い層(検証・保存ロジックは saveCapture に一本化)。
 * 失敗時は /capture?error=<code> へ redirect し、画面側で最小限のエラー表示を行う
 * (エラー表示の実装形は裁量 — §5)。
 */
export async function saveCaptureFromForm(formData: FormData): Promise<void> {
  const result = await saveCapture({
    kind: String(formData.get("kind") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    body: String(formData.get("body") ?? ""),
  });

  if (!result.ok) {
    redirect(`/capture?error=${result.error}`);
  }
}
