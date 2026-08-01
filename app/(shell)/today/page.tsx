// 「今日」画面(SC-03): オープンな WBS タスクから、今日どれに着手するかを支援する kanban ビュー。
// 対象設計: docs/design/detail/today-view.md §2.5(app/(shell)/today/page.tsx)
//          docs/design/basic/today-board-interactive.md §1(capture カードの合流 + 操作は board.tsx)
//          docs/design/ui/screen-design.md §7.2-5 / §7.4(意匠規範)
//
// データは索引済みの取得関数(getTodayData / listBoardCaptures / getLastSync)を読むのみ。
// 重い処理(パース・集計)はこの画面では行わない。カンバンの操作 UI は client component
// (board.tsx)に委譲(旧「クライアントコンポーネントは使わない」契約は today-board-interactive で改訂)。
import { requireUser } from "../../../lib/auth/user";
import { applyBoardOverrides, getTodayData, laneCounts, laneOfCaptureStatus } from "../../../lib/data/today";
import { listActiveOverrides } from "../../../lib/data/board-override";
import { listBoardCaptures } from "../../../lib/data/capture";
import { getLastSync } from "../../../lib/data/overview";
import { scoreLevel, scoreColorVar } from "../../../lib/ui/score";
import { TodayBoard, type BoardCaptureCard } from "./board";
import { CountUp } from "../../../components/motion/count-up";

export const dynamic = "force-dynamic";

// 3列の定義・カード描画は board.tsx(client)へ移動(today-board-interactive §1-5)。

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

// 完了レーンの capture 表示上限(today-board-interactive §1-1 — WBS の DONE_LIMIT と同じ規範)。
const CAPTURE_DONE_LIMIT = 8;

export default async function TodayPage() {
  const user = await requireUser();
  void user;

  const [data, boardCaptures, overrides, lastSync] = await Promise.all([
    getTodayData(),
    listBoardCaptures(user.id),
    listActiveOverrides(),
    getLastSync(),
  ]);

  // WBS カードへのオーバーレイ合成(wbs-loop §2.4 — 実効レーン + 「PR 反映待ち」バッジ)
  const columns = applyBoardOverrides(data.columns, overrides);

  // capture カードのレーン分配(サーバ側 — board.tsx は分配済み props を受けるのみ。設計 §3)。
  const captureLanes: Record<"todo" | "doing" | "done", BoardCaptureCard[]> = {
    todo: [],
    doing: [],
    done: [],
  };
  for (const row of boardCaptures) {
    captureLanes[laneOfCaptureStatus(row.status)].push({
      id: row.id,
      kind: row.kind,
      topic: row.topic,
      body: row.body,
      status: row.status,
      processedAt: row.processedAt,
    });
  }
  captureLanes.done = captureLanes.done.slice(0, CAPTURE_DONE_LIMIT);

  // チップの件数 = 盤面のカード数(合成後 columns + 表示中の captureLanes — today-summary-sync §1)
  const counts = laneCounts(columns, captureLanes);

  const summaryChips: { label: string; value: number; decimals: number; suffix: string; color: string }[] = [
    { label: "オープン", value: counts.todo, decimals: 0, suffix: "", color: "var(--text)" },
    { label: "着手中", value: counts.doing, decimals: 0, suffix: "", color: "var(--text)" },
    {
      label: "手戻り率(今週)",
      value: data.summary.retryRate === null ? Number.NaN : data.summary.retryRate * 100,
      decimals: 1,
      suffix: "%",
      color: retryRateColor(data.summary.retryRate),
    },
    {
      label: "平均スコア(今週)",
      value: data.summary.rewardAvg === null ? Number.NaN : data.summary.rewardAvg,
      decimals: 2,
      suffix: "",
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
          <div key={chip.label} className="ck-card-in" style={chipStyle}>
            <div style={{ ...chipValue, color: chip.color }}>
              {Number.isFinite(chip.value) ? (
                <CountUp value={chip.value} decimals={chip.decimals} suffix={chip.suffix} />
              ) : (
                "—"
              )}
            </div>
            <div style={chipLabel}>{chip.label}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 4 }}>
        ※ 「手戻り率」は発生率です(低いほど良い指標です)。「オープン」「着手中」は盤面のカード数(WBS の実効状態 + capture)です。
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

      {data.boardEmpty && boardCaptures.length === 0 ? (
        <p>WBS が未同期です(同期後に表示されます)。capture のメモ(次の一手・課題)もここに並びます。</p>
      ) : (
        <>
          {boardCaptures.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>
              💡 動かせるカードはまだありません — WBS カードは読み取り専用です。
              <a href="/capture" style={{ color: "var(--accent)", marginLeft: 4 }}>
                capture
              </a>
              で「次の一手」か「課題」を保存すると、ここにドラッグ&ドロップとボタンで動かせるカードが並びます。
            </p>
          ) : null}
          <TodayBoard columns={columns} captures={captureLanes} />
        </>
      )}
    </section>
  );
}
