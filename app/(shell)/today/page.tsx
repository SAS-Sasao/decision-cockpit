// 「今日」画面(SC-03): オープンな WBS タスクから、今日どれに着手するかを支援する kanban ビュー。
// 対象設計: docs/design/detail/today-view.md §2.5(app/(shell)/today/page.tsx)
//          docs/design/ui/screen-design.md §7.2-5(SC-03 の読み替え — 3列kanban・手戻り↺n非表示・
//          ソース = WBS のみ)/ §7.4(意匠規範)
//          MoC(docs/design/ui/moc/decision-cockpit.dc.html)の isToday ブロック
//
// データは索引済みの取得関数(getTodayData / getLastSync)を読むのみ。重い処理(パース・集計)は
// この画面では行わない。チャート部品・状態変更 UI・クライアントコンポーネントは使わない
// (静的表示のみ)。
import { requireUser } from "../../../lib/auth/user";
import { getTodayData, type TodayCard } from "../../../lib/data/today";
import { getLastSync } from "../../../lib/data/overview";
import { scoreLevel, scoreColorVar } from "../../../lib/ui/score";

export const dynamic = "force-dynamic";

// 3列kanbanの列定義(固定 — 実データの状態3値。MoC の4列目「レビュー」は実データに無いため不採用。
// screen-design.md §7.2-5 の読み替えに準拠)。
const BOARD_COLUMNS: { state: "todo" | "doing" | "done"; label: string }[] = [
  { state: "todo", label: "バックログ" },
  { state: "doing", label: "着手中" },
  { state: "done", label: "完了" },
];

const COLUMN_DOT_COLOR: Record<"todo" | "doing" | "done", string> = {
  todo: "var(--text-sub)",
  doing: "var(--accent)",
  done: "var(--good)",
};

/** 0-1 の率を「小数1桁の %」表示にする。null は "—"。 */
function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** reward の 0-1 スコアを小数2桁で表示する。null は "—"。 */
function formatScore(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

/** 手戻り率(発生系・低いほど良い)の色 — retro の signalColor と同じ方向補正(1-value)。 */
function retryRateColor(value: number | null): string {
  if (value === null) return scoreColorVar("na");
  return scoreColorVar(scoreLevel(1 - value));
}

/** 平均スコア(高いほど良い)の色。 */
function rewardAvgColor(value: number | null): string {
  return scoreColorVar(scoreLevel(value));
}

/** ISO 文字列 → "YYYY-MM-DD HH:mm"(UTC)。layout.tsx の同期表示と同一フォーマット。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

const chipStyle = {
  flex: 1,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "12px 15px",
  minWidth: 0,
};

const chipValue = { fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, lineHeight: 1.2 };
const chipLabel = { fontSize: 11.5, color: "var(--text-sub)", marginTop: 2 };

const cardStyle = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "13px 14px",
};

const assigneePillStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  color: "var(--accent)",
  background: "color-mix(in oklch, var(--accent) 10%, transparent)",
  padding: "1px 7px",
  borderRadius: 4,
};

/** タスクカード(WBS ID・タイトル・担当 pill・period・Pri・成果物・section — null 項目は非表示)。 */
function TaskCard({ item }: { item: TodayCard }) {
  const hasMetaRow = item.assignee || item.period || item.pri;
  return (
    <div style={cardStyle}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--text-sub)",
          marginBottom: 4,
        }}
      >
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
          {item.assignee ? <span style={assigneePillStyle}>{item.assignee}</span> : null}
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

export default async function TodayPage() {
  const user = await requireUser();
  void user;

  const [data, lastSync] = await Promise.all([getTodayData(), getLastSync()]);

  const summaryChips: { label: string; value: string; color: string }[] = [
    { label: "オープン", value: String(data.summary.open), color: "var(--text)" },
    { label: "着手中", value: String(data.summary.doing), color: "var(--text)" },
    {
      label: "手戻り率(今週)",
      value: formatPercent(data.summary.retryRate),
      color: retryRateColor(data.summary.retryRate),
    },
    {
      label: "平均スコア(今週)",
      value: formatScore(data.summary.rewardAvg),
      color: rewardAvgColor(data.summary.rewardAvg),
    },
  ];

  return (
    <section>
      <h1 style={{ marginTop: 0 }}>今日</h1>
      <p style={{ color: "var(--text-sub)" }}>
        オープンな WBS タスクから、今日どれに着手するかを支援する kanban ビュー。
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        {summaryChips.map((chip) => (
          <div key={chip.label} style={chipStyle}>
            <div style={{ ...chipValue, color: chip.color }}>{chip.value}</div>
            <div style={chipLabel}>{chip.label}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 4 }}>
        ※ 「手戻り率」は発生率です(低いほど良い指標です)。「オープン」「着手中」は現在の WBS 世代の件数です。
      </p>

      <p style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 18 }}>
        最終同期:{" "}
        {lastSync.map((s, i) => (
          <span key={s.repo}>
            {i > 0 ? " / " : ""}
            {s.repo} {s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : "未同期"}
          </span>
        ))}
      </p>

      {data.boardEmpty ? (
        <p>WBS が未同期です(同期後に表示されます)。</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
          {data.columns.map((col) => {
            const meta = BOARD_COLUMNS.find((c) => c.state === col.state)!;
            return (
              <div key={col.state}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 12,
                    padding: "0 2px",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: COLUMN_DOT_COLOR[col.state],
                    }}
                  />
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
                    {col.items.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {col.items.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--text-sub)" }}>タスクなし</p>
                  ) : (
                    col.items.map((item) => <TaskCard key={item.itemKey} item={item} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
