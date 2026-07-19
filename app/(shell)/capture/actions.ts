"use server";

// 対象設計: docs/design/detail/capture-spar.md §2.2(app/(shell)/capture/actions.ts)
//          docs/design/basic/capture-triage.md §1(updateCaptureStatus)
//
// capture_inbox への保存 Server Action。user_id はセッション由来のみ(input に含めない)。
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "../../../lib/auth/user";
import { insertCapture, setCaptureStatus, type CaptureKind, type CaptureStatus } from "../../../lib/data/capture";

export type SaveCaptureResult = { ok: true } | { ok: false; error: "unauthorized" | "bad_request" };

const CAPTURE_KIND_VALUES: readonly CaptureKind[] = ["status", "issue", "next_move", "spar_conclusion"];

function isCaptureKind(value: string): value is CaptureKind {
  return (CAPTURE_KIND_VALUES as readonly string[]).includes(value);
}

const CAPTURE_STATUS_VALUES: readonly CaptureStatus[] = ["open", "in_progress", "done"];

function isCaptureStatus(value: string): value is CaptureStatus {
  return (CAPTURE_STATUS_VALUES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
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

export type UpdateCaptureStatusResult = SaveCaptureResult;

/**
 * capture_inbox.status の更新(本人行のみ — capture-triage)。status 3語彙・UUID 形式の id を
 * 検証してから setCaptureStatus(status 単列の更新)を呼ぶ。rowCount 0(他人の行・不存在)は
 * bad_request に潰す(存在の秘匿 — 列挙オラクルなし)。
 */
export async function updateCaptureStatus(input: {
  id: string;
  status: string;
}): Promise<UpdateCaptureStatusResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "unauthorized" };
  }

  if (!isCaptureStatus(input.status)) {
    return { ok: false, error: "bad_request" };
  }

  if (!isValidUuid(input.id)) {
    return { ok: false, error: "bad_request" };
  }

  let rowCount: number;
  try {
    rowCount = await setCaptureStatus(user.id, input.id, input.status);
  } catch {
    return { ok: false, error: "bad_request" };
  }

  if (rowCount === 0) {
    return { ok: false, error: "bad_request" };
  }

  revalidatePath("/capture");
  return { ok: true };
}
