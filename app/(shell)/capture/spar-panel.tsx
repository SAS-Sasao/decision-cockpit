"use client";

// 壁打ちパネル(SC-06 — M4-B)。
// 対象設計: docs/design/detail/capture-spar.md §2.6(spar-panel.tsx)/ §4 条件5b
//
// 会話状態は useState のみで保持する(サーバ側に永続化しない)。送信は同一オリジンの
// /api/spar へ fetch(Cookie 認証)。応答は React 既定エスケープの素テキストで表示する
// (生 HTML 差し込みはしない)。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCapture } from "./actions";

type SparRefView = {
  title: string | null;
  date: string | null;
  score: number | null;
  source: string;
  filePath: string;
};

type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; refs: SparRefView[]; degraded: boolean };

type SparApiError = "unauthorized" | "bad_request" | "spar_not_configured" | "spar_upstream" | "network";

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

export function SparPanel() {
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

  const lastAssistant = [...turns].reverse().find((t): t is Extract<ChatTurn, { role: "assistant" }> => t.role === "assistant");

  async function handleSend() {
    const trimmed = message.trim();
    if (trimmed.length === 0 || sending) return;

    setSending(true);
    setSendError(null);

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(nextTurns);
    setMessage("");

    try {
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

      const data = (await res.json()) as { reply: string; refs: SparRefView[]; degraded: boolean };
      setTurns([...nextTurns, { role: "assistant", content: data.reply, refs: data.refs, degraded: data.degraded }]);
    } catch {
      setSendError("network");
    } finally {
      setSending(false);
    }
  }

  function openConclusionEditor() {
    if (!lastAssistant) return;
    setConclusionTopic("");
    setConclusionBody(lastAssistant.content);
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
      <p style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 0, marginBottom: 14 }}>
        壁打ちの入力は外部 API に送信されます。機微情報(実名・秘密情報)は書かないでください。
      </p>

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
              <div style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                {turn.content}
              </div>
              {turn.role === "assistant" ? (
                <div style={{ marginTop: 8 }}>
                  {turn.degraded ? (
                    <div style={{ fontSize: 10.5, color: "var(--warn)", marginBottom: 6 }}>文脈なし(検索が縮退しました)</div>
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

      {lastAssistant ? (
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
    </div>
  );
}
