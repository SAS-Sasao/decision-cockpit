// 対象設計: docs/design/detail/ingestion-foundation.md §2.4(Route Handler)
//          docs/design/detail/search-foundation.md §2.5(runSync 後の embed フェーズ接続)
//
// GET: Vercel Cron 用。認可 = `Authorization: Bearer ${CRON_SECRET}` 単独(Cookie 不使用)。
//      fail-closed: CRON_SECRET が未設定/空なら常に 401(比較以前に拒否)。
//      比較は両値を sha256 してから crypto.timingSafeEqual(定数時間・長さ不一致を回避)。
// POST: 手動トリガ用。getUser() が null なら 401 / admin でなければ 403(redirect 不使用)。
//
// runSync 成功後に埋め込みバッチ(runEmbedIndex)を後続フェーズとして呼ぶ。失敗は全例外を吸収し
// 応答に embed キーを追加するのみ(同期本体の成功を妨げない — search-foundation §1-3)。
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdmin } from "../../../lib/auth/roles";
import { getUser } from "../../../lib/auth/user";
import { FixtureSource } from "../../../lib/ingestion/fixture-source";
import { GithubSource } from "../../../lib/ingestion/github-source";
import { runSync } from "../../../lib/ingestion/run-sync";
import type { SourceAdapter } from "../../../lib/ingestion/source";
import { runEmbedIndex } from "../../../lib/search/embed-index";
import type { EmbedSummary } from "../../../lib/search/embed-index";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

function buildAdapters(): SourceAdapter[] {
  if (process.env.SYNC_SOURCE === "fixture") {
    return [new FixtureSource("cc-sier-organization"), new FixtureSource("ai-war-room")];
  }
  return [new GithubSource("cc-sier-organization"), new GithubSource("ai-war-room")];
}

async function runEmbedPhase(): Promise<EmbedSummary | { error: true }> {
  let embed: EmbedSummary | { error: true };
  try {
    embed = await runEmbedIndex();
  } catch {
    embed = { error: true };
  }
  return embed;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // fail-closed: env 未設定/空は比較以前に常に 401
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  const provided = match?.[1];

  if (!provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await runSync(buildAdapters());
  const embed = await runEmbedPhase();
  return NextResponse.json({ ...summary, embed }, { status: 200 });
}

export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(user.id);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const summary = await runSync(buildAdapters());
  const embed = await runEmbedPhase();
  return NextResponse.json({ ...summary, embed }, { status: 200 });
}
