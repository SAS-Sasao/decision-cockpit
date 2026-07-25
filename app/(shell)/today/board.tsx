"use client";

// 対象設計: docs/design/basic/today-board-interactive.md §1-2/§1-3/§3(board.tsx)
//
// /today カンバンの client 部分。操作できるのは capture カード(本人行)のみで、
// **ボタンが正・HTML5 ネイティブ D&D は enhancement**(ライブラリ追加なし)。
// 更新は既存 Server Action updateCaptureStatus 1本に収斂(認可・検証はサーバ側で毎回実施)。
// dataTransfer に載せるのは capture の id のみ(本文・topic は載せない — 設計 §1-3)。
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TodayCard } from "../../../lib/data/today";
import { updateCaptureStatus } from "../capture/actions";

type Lane = "todo" | "doing" | "done";
type CaptureStatus = "open" | "in_progress" | "done";

export type BoardCaptureCard = {
  id: string;
  kind: "next_move" | "issue";
  topic: string | null;
  body: string;
  status: CaptureStatus;
  processedAt: string | null;
};

type BoardProps = {
  columns: { state: Lane; items: TodayCard[] }[];
  captures: Record<Lane, BoardCaptureCard[]>; // サーバ側で laneOfCaptureStatus により分配済み(設計 §3)
};

const LANE_META: Record<Lane, { label: string; dot: string }> = {
  todo: { label: "バックログ", dot: "var(--text-sub)" },
  doing: { label: "着手中", dot: "var(--accent)" },
  done: { label: "完了", dot: "var(--good)" },
};

// レーン → capture status(操作の逆写像。語彙は capture.md の3値のみ)。
const STATUS_OF_LANE: Record<Lane, CaptureStatus> = {
  todo: "open",
  doing: "in_progress",
  done: "done",
};

const KIND_LABEL: Record<BoardCaptureCard["kind"], string> = {
  next_move: "次の一手",
  issue: "課題",
};

const cardStyle = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "13px 14px",
};

const captureCardStyle = {
  ...cardStyle,
  border: "1px solid color-mix(in oklch, var(--accent) 45%, var(--line))",
};

const kindBadgeStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--accent)",
  background: "color-mix(in oklch, var(--accent) 10%, transparent)",
  border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
  padding: "1px 7px",
  borderRadius: 4,
};

const processedBadgeStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--good)",
  background: "color-mix(in oklch, var(--good) 10%, transparent)",
  padding: "1px 7px",
  borderRadius: 4,
};

const moveButtonStyle = {
  fontSize: 10.5,
  color: "var(--text-sub)",
  background: "var(--panel-row)",
  border: "1px solid var(--line-row)",
  borderRadius: 6,
  padding: "3px 9px",
  cursor: "pointer",
};

/** レーンに応じた操作(前へ/次へ)。ボタンが正・全操作がボタンで完結する(設計 §1-3)。 */
function movesFor(lane: Lane): { label: string; to: CaptureStatus }[] {
  switch (lane) {
    case "todo":
      return [{ label: "→ 着手", to: "in_progress" }];
    case "doing":
      return [
        { label: "← 戻す", to: "open" },
        { label: "→ 完了", to: "done" },
      ];
    case "done":
      return [{ label: "← 戻す", to: "in_progress" }];
  }
}

function CaptureCardView({
  card,
  lane,
  onMove,
  pending,
}: {
  card: BoardCaptureCard;
  lane: Lane;
  onMove: (id: string, to: CaptureStatus) => void;
  pending: boolean;
}) {
  return (
    <div
      className="ck-card-in"
      style={captureCardStyle}
      draggable
      onDragStart={(e) => {
        // 設計 §1-3: dataTransfer に載せるのは id のみ(ブラウザ外ドロップでも読めるため本文は禁止)
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <span style={kindBadgeStyle}>{KIND_LABEL[card.kind]}</span>
        {card.processedAt ? <span style={processedBadgeStyle}>整理済み</span> : null}
        {card.topic ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-sub)" }}>
            {card.topic}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 9, whiteSpace: "pre-wrap" }}>
        {card.body}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {movesFor(lane).map((m) => (
          <button
            key={m.to}
            type="button"
            style={{ ...moveButtonStyle, opacity: pending ? 0.5 : 1 }}
            disabled={pending}
            onClick={() => onMove(card.id, m.to)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** WBS カード(読み取り専用 — 操作 UI を付けない。既存 /today の表示契約を維持)。 */
function WbsCardView({ item }: { item: TodayCard }) {
  const hasMetaRow = item.assignee || item.period || item.pri;
  return (
    <div className="ck-card-in" style={cardStyle}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-sub)", marginBottom: 4 }}>
        {item.itemKey}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, marginBottom: 9 }}>{item.title}</div>
      {hasMetaRow ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            marginBottom: item.deliverable || item.section ? 8 : 0,
          }}
        >
          {item.assignee ? (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--accent)",
                background: "color-mix(in oklch, var(--accent) 10%, transparent)",
                padding: "1px 7px",
                borderRadius: 4,
              }}
            >
              {item.assignee}
            </span>
          ) : null}
          {item.period ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-sub)" }}>
              {item.period}
            </span>
          ) : null}
          {item.pri ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--warn)" }}>
              Pri: {item.pri}
            </span>
          ) : null}
        </div>
      ) : null}
      {item.deliverable ? (
        <div style={{ fontSize: 11.5, color: "var(--text-sub)", marginBottom: item.section ? 4 : 0 }}>
          {item.deliverable}
        </div>
      ) : null}
      {item.section ? <div style={{ fontSize: 10.5, color: "var(--text-sub)" }}>{item.section}</div> : null}
    </div>
  );
}

export function TodayBoard({ columns, captures }: BoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<Lane | null>(null);

  const move = (id: string, to: CaptureStatus) => {
    startTransition(async () => {
      await updateCaptureStatus({ id, status: to });
      router.refresh();
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
      {columns.map((col) => {
        const lane = col.state;
        const meta = LANE_META[lane];
        const laneCaptures = captures[lane];
        const total = laneCaptures.length + col.items.length;
        return (
          <div
            key={lane}
            onDragOver={(e) => {
              e.preventDefault(); // drop を許可(enhancement — 設計 §1-3)
              setDragOver(lane);
            }}
            onDragLeave={() => setDragOver((v) => (v === lane ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) move(id, STATUS_OF_LANE[lane]);
            }}
            style={{
              borderRadius: 12,
              outline: dragOver === lane ? "1.5px dashed var(--accent)" : "none",
              outlineOffset: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "0 2px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot }} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{meta.label}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--text-sub)",
                  background: "var(--panel-row)",
                  border: "1px solid var(--line-row)",
                  borderRadius: 999,
                  padding: "1px 8px",
                }}
              >
                {total}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {total === 0 ? <p style={{ fontSize: 12, color: "var(--text-sub)" }}>タスクなし</p> : null}
              {laneCaptures.map((card) => (
                <CaptureCardView key={card.id} card={card} lane={lane} onMove={move} pending={isPending} />
              ))}
              {col.items.map((item) => (
                <WbsCardView key={item.itemKey} item={item} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
