// 対象設計: docs/design/detail/review-loop.md §2.2(app/api/review/route.ts)
//
// 処理順(サーバ強制): POST/GET とも 1) getUser() null → 401 2) isAdmin false → 403。
// POST はさらに 3) validateQuestion → 400 4) PAT 未設定 → 503(fail-closed・INSERT より前)
// 5) sweep 2文 6) 同時1件 → 409 7) 日次上限 → 429 8) INSERT 9) dispatch(204 以外 →
// DISPATCH_FAILED_SQL + 502)。
//
// 一層目は proxy.ts(既定 matcher が /api/review を保護)。ここは二層目。
// 502 は固定形のみを返し、GitHub API のエラーボディ・ステータス詳細を転送しない。
// PAT を含むヘッダ・リクエストはログに出さない(ログは固定文言 + request id のみ)。
import { NextResponse } from "next/server";
import { isAdmin } from "../../../lib/auth/roles";
import { getUser } from "../../../lib/auth/user";
import { query } from "../../../lib/db";
import {
  DAILY_COUNT_SQL,
  DAILY_LIMIT,
  DISPATCH_FAILED_SQL,
  DISPATCH_URL,
  INFLIGHT_SQL,
  INSERT_SQL,
  LIST_SQL,
  SWEEP_PENDING_SQL,
  SWEEP_RUNNING_SQL,
  validateQuestion,
} from "../../../lib/review/api-lib";

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

  const pat = process.env.REVIEW_DISPATCH_PAT;
  if (!pat) return NextResponse.json({ error: "review_not_configured" }, { status: 503 });

  // stale sweep(受理前 — gate off / PAT 失効 / CI 停止での永久ロックを解除する)
  await query(SWEEP_PENDING_SQL);
  await query(SWEEP_RUNNING_SQL);

  const inflight = await query<{ inflight: boolean }>(INFLIGHT_SQL);
  if (inflight.rows[0]?.inflight) return NextResponse.json({ error: "busy" }, { status: 409 });

  const daily = await query<{ n: number }>(DAILY_COUNT_SQL);
  if ((daily.rows[0]?.n ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ error: "daily_limit" }, { status: 429 });
  }

  const inserted = await query<{ id: string }>(INSERT_SQL, [user.id, question]);
  const id = inserted.rows[0]?.id;
  if (!id) return NextResponse.json({ error: "dispatch_failed" }, { status: 502 });

  let ok = false;
  try {
    const res = await fetch(DISPATCH_URL, {
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
    return NextResponse.json({ error: "dispatch_failed" }, { status: 502 });
  }

  return NextResponse.json({ id }, { status: 200 });
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // GET では sweep しない(ポーリング毎の書き込み増幅を避ける — stale 解消は次回 POST 時)
  const rows = await query<ReviewRow>(LIST_SQL);
  return NextResponse.json({ requests: rows.rows }, { status: 200 });
}
