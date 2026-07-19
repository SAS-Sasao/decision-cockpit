// 「キャプチャ + 壁打ち」画面(SC-06): 作業メモ・課題・次の一手を capture_inbox へ記録する
// フォームと、本人の INBOX(未処理/処理済み混在・直近50件)を表示する。壁打ちパネルは M4-B で追加する
// (本 M4-A ではフォーム + INBOX のみ)。
// 対象設計: docs/design/detail/capture-spar.md §2.6(app/(shell)/capture/page.tsx)/ §4 条件5a
//          docs/design/basic/capture-spar.md §1〜§2(認可モデル・外部送信/注意書き)
//          docs/design/ui/moc/decision-cockpit.dc.html(isCapture ブロック — 左カラム + INBOX)
//
// データは lib/data 経由のみ(listInbox / getUnprocessedInboxCount)。重い処理はこの画面では行わない。
// 表示はすべて React 既定エスケープの素テキスト(md レンダラ不使用・生 HTML 差し込みはしない)。
import { requireUser } from "../../../lib/auth/user";
import { listInbox, type CaptureKind, type InboxRow } from "../../../lib/data/capture";
import { getUnprocessedInboxCount } from "../../../lib/data/overview";
import { saveCaptureFromForm } from "./actions";
import { SparPanel } from "./spar-panel";

export const dynamic = "force-dynamic";

const CAPTURE_KINDS = [
  { kind: "status", label: "status" },
  { kind: "issue", label: "issue" },
  { kind: "next_move", label: "next_move" },
];

// kind バッジ/チップの色(MoC kindMeta 準拠 — トークン近似。spar_conclusion は "spar" 表示)。
const KIND_META: Record<CaptureKind, { label: string; color: string }> = {
  status: { label: "status", color: "var(--accent)" },
  issue: { label: "issue", color: "var(--warn)" },
  next_move: { label: "next_move", color: "var(--good)" },
  spar_conclusion: { label: "spar", color: "var(--accent-spar)" },
};

type SearchParams = { error?: string | string[] };

/** ISO 文字列 → "YYYY-MM-DD HH:mm"(UTC)。today/page.tsx と同一フォーマット。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/** INBOX 1行(未処理は琥珀枠 --warn・処理済みはミュート)。素テキスト表示のみ。 */
function InboxCard({ row }: { row: InboxRow }) {
  const meta = KIND_META[row.kind];
  const unprocessed = row.processedAt === null;
  return (
    <div
      style={{
        background: "var(--panel-row)",
        border: `1px solid ${unprocessed ? "var(--warn)" : "var(--line-row)"}`,
        borderRadius: 9,
        padding: "12px 14px",
        opacity: unprocessed ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            padding: "1px 7px",
            borderRadius: 20,
            background: `color-mix(in oklch, ${meta.color} 15%, transparent)`,
            color: meta.color,
          }}
        >
          {meta.label}
        </span>
        {row.topic ? <span style={{ fontSize: 11.5, color: "var(--text-sub)" }}>{row.topic}</span> : null}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-sub)" }}>
          {unprocessed ? "未処理" : "処理済み"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        {row.body}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-sub)", marginTop: 8 }}>
        {formatDateTime(row.createdAt)}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "var(--panel-row)",
  border: "1px solid var(--line)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
} as const;

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();

  const rawParams = await searchParams;
  const errorParam = Array.isArray(rawParams.error) ? rawParams.error[0] : rawParams.error;

  const [inbox, unprocessedCount] = await Promise.all([
    listInbox(user.id),
    getUnprocessedInboxCount(user.id),
  ]);

  return (
    <section style={{ maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>キャプチャ + 壁打ち</h1>
      <p style={{ color: "var(--text-sub)" }}>
        作業メモ・課題・次の一手を capture_inbox へ記録する(user_id 所有・個人別)。
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 20 }}>
        <div className="panel">
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>キャプチャ</div>
          <div style={{ fontSize: 11.5, color: "var(--text-sub)", marginBottom: 16 }}>
            メモ・課題・次の一手を capture_inbox へ(user_id 所有・個人別)
          </div>

          {errorParam ? (
            <p style={{ color: "var(--bad)", fontSize: 12, marginBottom: 12 }}>
              保存できませんでした({errorParam})。入力内容を見直してください。
            </p>
          ) : null}

          <form action={saveCaptureFromForm}>
            <div style={{ display: "flex", gap: 16, marginBottom: 13, flexWrap: "wrap" }}>
              {CAPTURE_KINDS.map((k, i) => {
                const color = KIND_META[k.kind as CaptureKind].color;
                return (
                  <label
                    key={k.kind}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={k.kind}
                      defaultChecked={i === 0}
                      style={{ accentColor: color }}
                    />
                    {k.label}
                  </label>
                );
              })}
            </div>
            <input type="text" name="topic" placeholder="トピック(例: pgvector検索精度)" style={{ ...inputStyle, marginBottom: 10 }} />
            <textarea
              name="body"
              required
              placeholder="いま考えていること・詰まっている点・次にやること…"
              style={{ ...inputStyle, height: 120, lineHeight: 1.6, resize: "vertical", marginBottom: 12 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="submit"
                style={{
                  background: "var(--accent)",
                  color: "var(--bg)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                保存
              </button>
              <span style={{ fontSize: 11, color: "var(--text-sub)" }}>
                整理ループが朝昼夜深夜に自動処理 → ai-war-room へ PR
              </span>
            </div>
          </form>

          <p style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 16, marginBottom: 0 }}>
            ※ 機微情報(実名・秘密情報)は書かない。
          </p>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-sub)",
                letterSpacing: "0.06em",
              }}
            >
              INBOX
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-sub)" }}>
              {unprocessedCount} 未処理
            </span>
          </div>
          {inbox.length === 0 ? (
            <p style={{ color: "var(--text-sub)" }}>INBOX は空です。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {inbox.map((row) => (
                <InboxCard key={row.id} row={row} />
              ))}
            </div>
          )}

          <SparPanel />
        </div>
      </div>
    </section>
  );
}
