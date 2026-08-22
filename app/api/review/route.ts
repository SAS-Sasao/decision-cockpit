// 対象設計: docs/design/detail/card-review.md §2.3(受理シーケンス抽出後の route)
// 元の設計: docs/design/detail/review-loop.md §2.2(認可と GET はそのまま)
//
// このファイルが持つのは4点だけ: ①認可 ②本文のパースと validateQuestion
// ③ error 語彙 → HTTP status の写像 ④レスポンス生成。
// **受理シーケンス(PAT 検査・sweep・同時1件・日次上限・INSERT・dispatch)は
// lib/review/submit.ts が正典**。ここに再実装しない — 同じ手順が2箇所にあると、
// 次に順序を変える人がどちらを直すか決まらなくなる。
//
// 一層目は proxy.ts(既定 matcher が /api/review を保護)。ここは二層目。
// 502 は固定形のみを返し、GitHub API のエラーボディ・ステータス詳細を転送しない。
import { NextResponse } from "next/server";
import { isAdmin } from "../../../lib/auth/roles";
import { getUser } from "../../../lib/auth/user";
import { query } from "../../../lib/db";
import { LIST_SQL, validateQuestion } from "../../../lib/review/api-lib";
import { submitReview, type ReviewSubmitError } from "../../../lib/review/submit";

/** 受理シーケンスの error 語彙 → HTTP status。route の責務はこの写像に閉じる。 */
const STATUS_BY_ERROR: Record<ReviewSubmitError, number> = {
  review_not_configured: 503,
  busy: 409,
  daily_limit: 429,
  dispatch_failed: 502,
};

export type ReviewRow = {
  id: string;
  question: string;
  status: "pending" | "running" | "done" | "error";
  result: string | null;
  result_truncated: boolean;
  error_kind: string | null;
  run_ref: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const question = validateQuestion(rawBody);
  if (question === null) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const submitted = await submitReview({ requestedBy: user.id, question });
  if (!submitted.ok) {
    return NextResponse.json({ error: submitted.error }, { status: STATUS_BY_ERROR[submitted.error] });
  }

  return NextResponse.json({ id: submitted.id }, { status: 200 });
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // GET では sweep しない(ポーリング毎の書き込み増幅を避ける — stale 解消は次回 POST 時)
  const rows = await query<ReviewRow>(LIST_SQL);
  return NextResponse.json({ requests: rows.rows }, { status: 200 });
}
