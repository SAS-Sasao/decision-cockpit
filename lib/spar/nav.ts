import "server-only";

// 対象設計: docs/design/basic/spar-navigate.md §1-2/§1-3/§1-4(nav — 画面操作提案の検証と組み立て)
//
// モデル出力(```nav フェンスの JSON)をホワイトリスト検証し、検証済みパラメータから
// **固定リテラル起点の href** とサーバテンプレートのラベルを組み立てる(モデルの生 URL・生 href・
// 生ラベルは使わない。事後検証型の接頭辞チェックは使わない — 組み立てで構造的に保証する)。
// 本文契約(§1-3): 有効 nav が1件以上のときだけフェンスを除去(除去後 trim 空なら元 reply 維持)。
// 全滅(パース失敗含む)ならフェンスを除去しない = 無効 nav による本文隠蔽は構造的に不可能。

export type SparNav = { label: string; href: string };

const MAX_NAVS = 3;
const MAX_Q_LEN = 100;
const KNOWLEDGE_TYPES = ["decision", "knowledge", "all"] as const;
const RETRO_GRANULARITIES = ["week", "month"] as const;

// 制御文字(改行・bidi 制御・ゼロ幅を含む Unicode カテゴリ C)を含む q は破棄(§1-2)。
const CONTROL_RE = /\p{C}/u;

// 末尾の完全な ```nav フェンス1個のみ(§1-3): 開始行は行全体一致(```nav の後は行末まで空白のみ)・
// 閉止行は ``` ・閉止後は空白/改行のみ。候補は**最後の ```nav 行頭出現**のみ(先行フェンスは温存 —
// leftmost 優先の正規表現だと2個のフェンスを跨いで捕捉するため、開始位置を自前で確定する)。
const NAV_FENCE_TAIL_RE = /^```nav[ \t]*\n([\s\S]*?)\n```[ \t]*(?:\n[\s\n]*)?$/;

/** 最後の「行頭 ```nav」の位置を返す(無ければ -1)。 */
function lastFenceStart(reply: string): number {
  let idx = reply.lastIndexOf("```nav");
  while (idx !== -1) {
    if (idx === 0 || reply[idx - 1] === "\n") return idx;
    idx = reply.lastIndexOf("```nav", idx - 1);
  }
  return -1;
}

/** 応答末尾の nav フェンスを検出する。候補が無ければ rawJson=null・body=reply(原文のまま)。 */
export function extractNavBlock(reply: string): { body: string; rawJson: string | null } {
  const start = lastFenceStart(reply);
  if (start === -1) return { body: reply, rawJson: null };
  const match = reply.slice(start).match(NAV_FENCE_TAIL_RE);
  if (!match) return { body: reply, rawJson: null };
  return { body: reply.slice(0, start), rawJson: match[1] ?? null };
}

type NavCandidate = { kind?: unknown; q?: unknown; type?: unknown; g?: unknown };

function buildKnowledgeNav(c: NavCandidate): SparNav | null {
  if (typeof c.q !== "string") return null;
  const q = c.q.trim();
  if (q.length < 1 || q.length > MAX_Q_LEN || CONTROL_RE.test(q)) return null;
  let type: (typeof KNOWLEDGE_TYPES)[number] | undefined;
  if (c.type !== undefined) {
    if (typeof c.type !== "string" || !KNOWLEDGE_TYPES.includes(c.type as never)) return null;
    type = c.type as (typeof KNOWLEDGE_TYPES)[number];
  }
  // href は固定リテラル起点(§1-2)。モデル文字列はクエリ値としてのみ encodeURIComponent 経由で入る。
  const href = "/knowledge?q=" + encodeURIComponent(q) + (type ? "&type=" + type : "");
  const typeLabel = type ?? "decision";
  return { label: `🔍 ${typeLabel} で「${q}」を検索`, href };
}

function buildRetroNav(c: NavCandidate): SparNav | null {
  if (typeof c.g !== "string" || !RETRO_GRANULARITIES.includes(c.g as never)) return null;
  const g = c.g as (typeof RETRO_GRANULARITIES)[number];
  const href = "/retro?g=" + g;
  return { label: g === "month" ? "📅 振り返りを月粒度で表示" : "📅 振り返りを週粒度で表示", href };
}

/** rawJson をホワイトリスト検証し、検証済み nav のみ返す(語彙外・超過長・文字種違反・4件目以降は破棄)。 */
export function buildNavs(rawJson: string): SparNav[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const navs: SparNav[] = [];
  for (const item of list) {
    if (navs.length >= MAX_NAVS) break; // 4件目以降は破棄
    if (typeof item !== "object" || item === null) continue;
    const c = item as NavCandidate;
    if (c.kind === "knowledge") {
      const nav = buildKnowledgeNav(c);
      if (nav) navs.push(nav);
    } else if (c.kind === "retro") {
      const nav = buildRetroNav(c);
      if (nav) navs.push(nav);
    }
    // 語彙外 kind は破棄(無音)
  }
  return navs;
}

/**
 * 合成(§1-3 の本文契約を単独で満たす公開 IF — route.ts はこれを呼ぶだけ):
 * - 有効 nav 1件以上 → フェンス除去済み本文(trim 空なら元 reply)+ navs
 * - 全滅・フェンス無し → 元の reply + navs=[]
 */
export function applyNavExtraction(reply: string): { body: string; navs: SparNav[] } {
  const { body, rawJson } = extractNavBlock(reply);
  if (rawJson === null) return { body: reply, navs: [] };
  const navs = buildNavs(rawJson);
  if (navs.length === 0) return { body: reply, navs: [] }; // 全滅 → フェンスを除去しない(本文復元)
  return { body: body.trim() === "" ? reply : body, navs };
}
