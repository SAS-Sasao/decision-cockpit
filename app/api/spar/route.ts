// 対象設計: docs/design/detail/capture-spar.md §2.5(app/api/spar/route.ts)
//
// 処理順(サーバ強制 — §0-7): 1) getUser() null → 401 2) getSparConfig() throw → 400
// spar_not_configured 3) 入力検証(bad_request・history はサーバ側で切詰め) 4) searchKnowledge
// throw → ctx=[] + degraded=true で継続(5xx にしない) 5) callChat → SparUpstreamError は
// 502 spar_upstream(本文非転送) 6) 200 { reply, refs, degraded }。
//
// 未認証 POST はそもそも proxy.ts(一層目)が /capture 保護パスと同様に 307 redirect_login する
// ため、ここでの 401 は二層目(Cookie を偽装できても getUser() が null を返すケース)。
import { NextResponse } from "next/server";
import { getUser } from "../../../lib/auth/user";
import { searchKnowledge, type KnowledgeHit } from "../../../lib/data/knowledge";
import { callChat, getSparConfig, getSparGuards, SparUpstreamError, type SparGuards } from "../../../lib/spar/llm";
import { buildSparMessages, type SparCtx } from "../../../lib/spar/prompt";

export type SparRef = {
  title: string | null;
  date: string | null;
  score: number | null; // null 透過(§0-5)
  source: string;
  filePath: string;
};

type HistoryTurn = { role: "user" | "assistant"; content: string };

const HISTORY_CONTENT_MAX_CHARS = 8000;

function isHistoryRole(value: unknown): value is "user" | "assistant" {
  return value === "user" || value === "assistant";
}

/**
 * 入力検証(サーバ側で強制 — client 供給値を信頼しない):
 * message は trim 後 1..guards.maxInputChars。history は role/content の型を検証し
 * (不正なら null = bad_request)、末尾 guards.maxTurns 件に切詰め、各 content は8000文字に切詰める
 * (超過はエラーにしない)。
 */
function parseInput(
  body: unknown,
  guards: SparGuards
): { message: string; history: HistoryTurn[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { message?: unknown; history?: unknown };

  if (typeof raw.message !== "string") return null;
  const message = raw.message.trim();
  if (message.length < 1 || message.length > guards.maxInputChars) return null;

  let rawHistory: unknown[] = [];
  if (raw.history !== undefined) {
    if (!Array.isArray(raw.history)) return null;
    rawHistory = raw.history;
  }

  const history: HistoryTurn[] = [];
  for (const item of rawHistory) {
    if (typeof item !== "object" || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (!isHistoryRole(role) || typeof content !== "string") return null;
    history.push({ role, content: content.slice(0, HISTORY_CONTENT_MAX_CHARS) });
  }

  const truncated = history.slice(Math.max(0, history.length - guards.maxTurns));
  return { message, history: truncated };
}

function toSparCtx(hit: KnowledgeHit): SparCtx {
  return {
    title: hit.title,
    date: hit.occurredAt,
    score: hit.similarity,
    source: hit.source,
    filePath: hit.filePath,
    excerpt: hit.excerpt,
  };
}

function toSparRef(ctx: SparCtx): SparRef {
  return {
    title: ctx.title,
    date: ctx.date,
    score: ctx.score,
    source: ctx.source,
    filePath: ctx.filePath,
  };
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let config;
  try {
    config = getSparConfig();
  } catch {
    return NextResponse.json({ error: "spar_not_configured" }, { status: 400 });
  }
  const guards = getSparGuards();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const input = parseInput(rawBody, guards);
  if (!input) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let ctx: SparCtx[] = [];
  let degraded = false;
  try {
    const hits = await searchKnowledge({ q: input.message, type: "decision", limit: guards.ctxTopK });
    ctx = hits.map(toSparCtx);
  } catch {
    ctx = [];
    degraded = true;
  }

  let reply: string;
  try {
    reply = await callChat(config, guards, buildSparMessages(ctx, input.history, input.message));
  } catch (err) {
    if (err instanceof SparUpstreamError) {
      return NextResponse.json({ error: "spar_upstream", status: err.status }, { status: 502 });
    }
    throw err;
  }

  const refs = ctx.map(toSparRef);
  return NextResponse.json({ reply, refs, degraded }, { status: 200 });
}
