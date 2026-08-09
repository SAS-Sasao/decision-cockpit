"use client";

// 壁打ちパネル(SC-06 — M4-B)。
// 対象設計: docs/design/detail/capture-spar.md §2.6(spar-panel.tsx)/ §4 条件5b
//
// 会話状態は useState のみで保持する(サーバ側に永続化しない)。送信は同一オリジンの
// /api/spar へ fetch(Cookie 認証)。応答は React 既定エスケープの素テキストで表示する
// (生 HTML 差し込みはしない)。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCapture } from "./actions";
import { latestSparConclusion, sparHistory, type SparMode } from "./spar-panel-lib";
import { isSafeRunRef } from "../../../lib/review/api-lib";
import { Markdown } from "../../../components/markdown";

// review-loop §2.5: パネルのモードは3値(UI 状態)。ChatTurn.mode は "spar"|"codex" のまま不変
// (ci モードは ChatTurn を生成せず専用ビューを描く — codex-spar 契約の凍結)。
type PanelMode = SparMode | "ci";

type ReviewRowView = {
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

const REVIEW_STATUS_LABEL: Record<ReviewRowView["status"], string> = {
  pending: "依頼中",
  running: "実行中",
  done: "完了",
  error: "失敗",
};

function reviewErrorText(error: string | null): string {
  switch (error) {
    case "dispatch_failed":
      return "CI の起動に失敗しました";
    case "stale":
      return "時間切れ(CI が応答しませんでした)";
    case "ci_failed":
      return "CI の実行に失敗しました";
    default:
      return "失敗しました";
  }
}

// spar-navigate §1-4: API 由来の検証済み提案(href は固定リテラル起点の相対パスのみ)
type SparNavView = { label: string; href: string };

type SparRefView = {
  title: string | null;
  date: string | null;
  score: number | null;
  source: string;
  filePath: string;
};

// codex-spar §3: mode を持たせ、結論保存・SPAR history から codex ターンを除外する
type ChatTurn =
  | { role: "user"; content: string; mode: SparMode }
  | { role: "assistant"; content: string; mode: SparMode; refs: SparRefView[]; degraded: boolean; navs: SparNavView[] };

type SparApiError =
  | "unauthorized"
  | "bad_request"
  | "spar_not_configured"
  | "spar_upstream"
  | "network"
  | "codex_down"
  | "codex_busy"
  | "codex_timeout"
  | "codex_forbidden"
  | "codex_failed";

function errorText(error: SparApiError): string {
  switch (error) {
    case "unauthorized":
      return "認証が切れました。ページを再読み込みしてください。";
    case "spar_not_configured":
      return "壁打ちは未設定です(SPAR env を設定してください)。";
    case "bad_request":
      return "入力を確認してください(空・上限超過・形式不正)。";
    case "spar_upstream":
      return "壁打ちの応答取得に失敗しました。しばらくして再試行してください。";
    case "codex_down":
      return "Codex ランナー未起動(npm run codex:serve で起動。アプリは localhost:3000 で開くこと)。";
    case "codex_busy":
      return "Codex は実行中です(同時1件)。完了を待って再送してください。";
    case "codex_timeout":
      return "Codex の実行が時間上限を超えました。質問を絞って再試行してください。";
    case "codex_forbidden":
      return "アクセスが拒否されました。アプリを http://localhost:3000 で開いているか確認してください。";
    case "codex_failed":
      return "Codex の実行に失敗しました。ランナーのログを確認してください。";
    case "network":
    default:
      return "通信に失敗しました。ネットワークを確認してください。";
  }
}

function formatScore(score: number | null): string {
  if (score === null) return "類似度 -";
  return `類似度 ${Math.round(score * 100)}%`;
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

const buttonStyle = {
  border: "none",
  borderRadius: 8,
  padding: "9px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

export function SparPanel({ canCiReview = false }: { canCiReview?: boolean } = {}) {
  const router = useRouter();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SparApiError | null>(null);

  const [conclusionOpen, setConclusionOpen] = useState(false);
  const [conclusionTopic, setConclusionTopic] = useState("");
  const [conclusionBody, setConclusionBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // codex-spar §1 やる-2: フラグ未設定(本番)ではチップごと非表示(fail-closed)
  const codexEnabled = process.env.NEXT_PUBLIC_CODEX_SPAR === "1";
  const [panelMode, setPanelMode] = useState<PanelMode>("spar");
  // 会話生成に使うのは spar/codex のみ(ci は ChatTurn を作らない)
  const mode: SparMode = panelMode === "ci" ? "spar" : panelMode;

  // review-loop §2.5: CI レビュー(admin 限定・非同期)
  const [ciQuestion, setCiQuestion] = useState("");
  const [ciRows, setCiRows] = useState<ReviewRowView[]>([]);
  const [ciSending, setCiSending] = useState(false);
  const [ciError, setCiError] = useState<string | null>(null);

  async function loadCiRows() {
    try {
      const res = await fetch("/api/review", { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as { requests: ReviewRowView[] };
      setCiRows(data.requests ?? []);
    } catch {
      // ポーリングの失敗は無視(次回に再試行)
    }
  }

  useEffect(() => {
    if (panelMode !== "ci" || !canCiReview) return;
    void loadCiRows();
    const timer = setInterval(() => void loadCiRows(), 5000);
    return () => clearInterval(timer);
  }, [panelMode, canCiReview]);

  async function handleCiSend() {
    const trimmed = ciQuestion.trim();
    if (trimmed.length === 0 || ciSending) return;
    setCiSending(true);
    setCiError(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setCiError(
          payload.error === "busy"
            ? "実行中の依頼があります(同時1件)。完了を待ってください。"
            : payload.error === "daily_limit"
              ? "本日の依頼上限(10件)に達しました。"
              : payload.error === "review_not_configured"
                ? "CI レビューは未設定です(REVIEW_DISPATCH_PAT)。"
                : payload.error === "forbidden"
                  ? "権限がありません(admin 限定)。"
                  : payload.error === "bad_request"
                    ? "入力を確認してください(空・2000字超)。"
                    : "依頼に失敗しました。"
        );
        return;
      }
      setCiQuestion("");
      await loadCiRows();
    } catch {
      setCiError("通信に失敗しました。");
    } finally {
      setCiSending(false);
    }
  }

  // codex-spar §1 やる-2: 結論保存の対象は SPAR 応答のみ(codex ターンはスキップ・無ければボタン非表示)
  const lastSparAssistant = latestSparConclusion(turns);

  async function handleSend() {
    const trimmed = message.trim();
    if (trimmed.length === 0 || sending) return;

    setSending(true);
    setSendError(null);

    // codex-spar §1 やる-2: SPAR へ送る history は SPAR ターンのみ(codex ターンを外部 API へ送らない)
    const history = sparHistory(turns);
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: trimmed, mode }];
    setTurns(nextTurns);
    setMessage("");

    try {
      if (mode === "codex") {
        // codex-spar §1 やる-2: 127.0.0.1 のホストランナーへ直接 fetch(/api/spar は経由しない)
        const res = await fetch("http://127.0.0.1:8788/review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          setSendError(
            payload.error === "busy"
              ? "codex_busy"
              : payload.error === "timeout"
                ? "codex_timeout"
                : payload.error === "forbidden"
                  ? "codex_forbidden"
                  : "codex_failed"
          );
          return;
        }

        const data = (await res.json()) as { reply: string };
        setTurns([
          ...nextTurns,
          { role: "assistant", content: data.reply, mode: "codex", refs: [], degraded: false, navs: [] },
        ]);
        return;
      }

      const res = await fetch("/api/spar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        const code = payload.error;
        setSendError(
          code === "unauthorized" || code === "bad_request" || code === "spar_not_configured" || code === "spar_upstream"
            ? code
            : "network"
        );
        return;
      }

      const data = (await res.json()) as {
        reply: string;
        refs: SparRefView[];
        degraded: boolean;
        navs?: SparNavView[];
      };
      setTurns([
        ...nextTurns,
        { role: "assistant", content: data.reply, mode: "spar", refs: data.refs, degraded: data.degraded, navs: data.navs ?? [] },
      ]);
    } catch {
      setSendError(mode === "codex" ? "codex_down" : "network");
    } finally {
      setSending(false);
    }
  }

  function openConclusionEditor() {
    if (!lastSparAssistant) return;
    setConclusionTopic("");
    setConclusionBody(lastSparAssistant.content);
    setConclusionOpen(true);
    setSaveError(null);
    setSaveOk(false);
  }

  async function handleSaveConclusion() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);

    try {
      const result = await saveCapture({ kind: "spar_conclusion", topic: conclusionTopic, body: conclusionBody });
      if (!result.ok) {
        setSaveError(result.error === "unauthorized" ? "認証が切れました。再読み込みしてください。" : "保存できませんでした。入力を見直してください。");
        return;
      }
      setSaveOk(true);
      setConclusionOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>壁打ち</div>
      {codexEnabled || canCiReview ? (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {(["spar", "codex", "ci"] as const)
            .filter((m) => (m === "codex" ? codexEnabled : m === "ci" ? canCiReview : true))
            .map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPanelMode(m)}
                disabled={sending}
                style={{
                  ...buttonStyle,
                  padding: "4px 12px",
                  fontSize: 11,
                  background: panelMode === m ? "var(--accent-spar)" : "var(--panel-row)",
                  color: panelMode === m ? "var(--bg)" : "var(--text-sub)",
                  border: "1px solid var(--line)",
                }}
              >
                {m === "spar" ? "SPAR" : m === "codex" ? "Codex" : "CI レビュー"}
              </button>
            ))}
        </div>
      ) : null}
      <p style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 0, marginBottom: 14 }}>
        {panelMode === "ci"
          ? "質問は CI(GitHub Actions)の Claude に送られます。機微情報(実名・秘密)を書かないこと。結果は参考意見(設計レビュー・受け入れ判定の代替にしない)。"
          : mode === "codex"
            ? "Codex モードでは repo の追跡ファイル全文が外部(OpenAI)に送信されます。対象はコミット済み(HEAD)の内容のみ。質問に秘密・未コミット diff を貼らないでください。"
            : "壁打ちの入力は外部 API に送信されます。機微情報(実名・秘密情報)は書かないでください。"}
      </p>

      {panelMode === "ci" ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <textarea
              value={ciQuestion}
              onChange={(e) => setCiQuestion(e.target.value)}
              placeholder="レビューしてほしい内容(例: lib/spar のエラー処理を見て)…"
              style={{ ...inputStyle, height: 60, lineHeight: 1.5, resize: "vertical" }}
              disabled={ciSending}
              maxLength={2000}
            />
            <button
              type="button"
              onClick={handleCiSend}
              disabled={ciSending || ciQuestion.trim().length === 0}
              style={{
                ...buttonStyle,
                background: "var(--accent-spar)",
                color: "var(--bg)",
                opacity: ciSending || ciQuestion.trim().length === 0 ? 0.6 : 1,
                alignSelf: "flex-end",
              }}
            >
              {ciSending ? "依頼中…" : "依頼"}
            </button>
          </div>
          {ciError ? <p style={{ color: "var(--bad)", fontSize: 11.5, marginBottom: 10 }}>{ciError}</p> : null}
          {ciRows.length === 0 ? (
            <p style={{ color: "var(--text-sub)", fontSize: 12 }}>まだ依頼はありません(結果まで数分かかります)。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ciRows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 9,
                    padding: "9px 12px",
                    background: "var(--panel-row)",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 20,
                        background:
                          row.status === "done"
                            ? "color-mix(in oklch, var(--good) 18%, transparent)"
                            : row.status === "error"
                              ? "color-mix(in oklch, var(--bad) 18%, transparent)"
                              : "color-mix(in oklch, var(--accent-spar) 15%, transparent)",
                        color:
                          row.status === "done"
                            ? "var(--good)"
                            : row.status === "error"
                              ? "var(--bad)"
                              : "var(--accent-spar)",
                      }}
                    >
                      {REVIEW_STATUS_LABEL[row.status]}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--text-sub)" }}>{row.created_at.slice(0, 16).replace("T", " ")}</span>
                    {isSafeRunRef(row.run_ref) ? (
                      <a href={row.run_ref ?? "#"} style={{ fontSize: 10.5, color: "var(--accent-spar)" }}>
                        run
                      </a>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 6 }}>{row.question}</div>
                  {row.status === "error" ? (
                    <div style={{ fontSize: 11.5, color: "var(--bad)" }}>{reviewErrorText(row.error_kind)}</div>
                  ) : null}
                  {row.result ? (
                    <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.55 }}>
                      {/* CI レビュー結果は Markdown。既存の安全レンダラ(HTML 文字列を生成せず
                          トークン木を JSX 化・href は allowlist)で描画する — md-render の契約 */}
                      <Markdown text={row.result} />
                      {row.result_truncated ? (
                        <div style={{ color: "var(--warn)", marginTop: 6 }}>(切り詰め)</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {turns.length === 0 ? (
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>まだ会話はありません。下から話しかけてください。</p>
        ) : (
          turns.map((turn, i) => (
            <div
              key={i}
              style={{
                alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
                background: turn.role === "user" ? "var(--panel-row)" : "color-mix(in oklch, var(--accent-spar) 10%, transparent)",
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "9px 12px",
              }}
            >
              {turn.role === "assistant" && turn.mode === "codex" ? (
                <div style={{ fontSize: 10, color: "var(--text-sub)", marginBottom: 4 }}>Codex(参考意見)</div>
              ) : null}
              <div style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                {turn.content}
              </div>
              {turn.role === "assistant" ? (
                <div style={{ marginTop: 8 }}>
                  {turn.degraded ? (
                    <div style={{ fontSize: 10.5, color: "var(--warn)", marginBottom: 6 }}>文脈なし(検索が縮退しました)</div>
                  ) : null}
                  {turn.navs.length > 0 ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      {turn.navs.map((nav, j) => (
                        <a
                          key={j}
                          href={nav.href}
                          style={{
                            fontSize: 11,
                            padding: "3px 10px",
                            borderRadius: 8,
                            border: "1px solid color-mix(in oklch, var(--accent-spar) 40%, var(--line))",
                            color: "var(--accent-spar)",
                            textDecoration: "none",
                          }}
                        >
                          {nav.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {turn.refs.length > 0 ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {turn.refs.map((ref, j) => (
                        <span
                          key={j}
                          title={`${ref.source} / ${ref.filePath}`}
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 9.5,
                            padding: "2px 8px",
                            borderRadius: 20,
                            background: "color-mix(in oklch, var(--accent-spar) 15%, transparent)",
                            color: "var(--accent-spar)",
                            cursor: "help",
                          }}
                        >
                          {ref.title ?? "(no title)"} / {ref.date ?? "-"} / {formatScore(ref.score)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {sendError ? (
        <p style={{ color: "var(--bad)", fontSize: 11.5, marginBottom: 10 }}>{errorText(sendError)}</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="壁打ち相手に話しかける…"
          style={{ ...inputStyle, height: 60, lineHeight: 1.5, resize: "vertical" }}
          disabled={sending}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || message.trim().length === 0}
          style={{
            ...buttonStyle,
            background: "var(--accent-spar)",
            color: "var(--bg)",
            opacity: sending || message.trim().length === 0 ? 0.6 : 1,
            alignSelf: "flex-end",
          }}
        >
          {sending ? "送信中…" : "送信"}
        </button>
      </div>

      {lastSparAssistant ? (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {!conclusionOpen ? (
            <button
              type="button"
              onClick={openConclusionEditor}
              style={{ ...buttonStyle, background: "var(--panel-row)", color: "var(--text)", border: "1px solid var(--line)" }}
            >
              結論として保存
            </button>
          ) : (
            <div>
              <input
                type="text"
                value={conclusionTopic}
                onChange={(e) => setConclusionTopic(e.target.value)}
                placeholder="トピック(任意)"
                style={{ ...inputStyle, marginBottom: 8 }}
                disabled={saving}
              />
              <textarea
                value={conclusionBody}
                onChange={(e) => setConclusionBody(e.target.value)}
                style={{ ...inputStyle, height: 100, lineHeight: 1.6, resize: "vertical", marginBottom: 8 }}
                disabled={saving}
              />
              {saveError ? (
                <p style={{ color: "var(--bad)", fontSize: 11.5, marginBottom: 8 }}>{saveError}</p>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleSaveConclusion}
                  disabled={saving || conclusionBody.trim().length === 0}
                  style={{
                    ...buttonStyle,
                    background: "var(--good)",
                    color: "var(--bg)",
                    opacity: saving || conclusionBody.trim().length === 0 ? 0.6 : 1,
                  }}
                >
                  {saving ? "保存中…" : "INBOX へ保存"}
                </button>
                <button
                  type="button"
                  onClick={() => setConclusionOpen(false)}
                  disabled={saving}
                  style={{ ...buttonStyle, background: "transparent", color: "var(--text-sub)", border: "1px solid var(--line)" }}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
          {saveOk ? <p style={{ color: "var(--good)", fontSize: 11.5, marginTop: 8 }}>INBOX に保存しました。</p> : null}
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}
