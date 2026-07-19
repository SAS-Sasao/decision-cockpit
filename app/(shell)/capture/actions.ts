"use server";

// 対象設計: docs/design/detail/capture-spar.md §2.2(app/(shell)/capture/actions.ts)
//
// capture_inbox への保存 Server Action。user_id はセッション由来のみ(input に含めない)。
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
