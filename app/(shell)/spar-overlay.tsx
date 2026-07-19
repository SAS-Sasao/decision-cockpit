"use client";

// 壁打ちスライドオーバー(全画面共通)。
// 対象設計: docs/design/basic/spar-overlay.md §3(IF)/ §5(受け入れ条件)
//
// トップバーの「壁打ち」ボタン(活性)+ 背景ディム(全面クリックで閉)+ 右 420px パネルを
// 1つの client component に閉じる。パネルの中身は既存 SparPanel をそのまま import して
// 再利用する(壁打ちロジックの二重実装禁止)。閉 = 条件レンダで unmount(会話は破棄)。
import { useState } from "react";
import { SparPanel } from "./capture/spar-panel";

export function SparOverlay() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: "transparent",
          border: "1px solid var(--accent-spar)",
          color: "var(--accent-spar)",
          borderRadius: 4,
          padding: "6px 14px",
          fontSize: 13,
          opacity: 1,
          cursor: "pointer",
        }}
      >
        壁打ち
      </button>

      {open ? (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "color-mix(in oklch, oklch(0.1 0.01 255) 55%, transparent)",
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 420,
              zIndex: 41,
              background: "var(--panel)",
              borderLeft: "1px solid color-mix(in oklch, var(--accent-spar) 35%, var(--line))",
              animation: "ckfade 0.25s ease",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              padding: "16px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>✦ 壁打ち</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--line)",
                  color: "var(--text-sub)",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <SparPanel />
          </div>
        </>
      ) : null}
    </>
  );
}
