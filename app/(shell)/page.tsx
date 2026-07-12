// SC-02 概観(横断ダッシュボード)。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/page.tsx)
//          docs/design/basic/ui-shell.md §1-4(SC-02 概観)
//
// データは lib/data/overview.ts の索引済み集計(timeline_records / sync_state / capture_inbox)を
// 読むのみ。重い処理(集計・埋め込み等)はこの画面では行わない。チャートライブラリは使わず
// インライン SVG の簡易折れ線で表示する。
import { requireUser } from "../../lib/auth/user";
import { getOverviewData, type OverviewData } from "../../lib/data/overview";
import { scoreLevel, scoreColorVar } from "../../lib/ui/score";

export const dynamic = "force-dynamic";

/** reward / QG の 0-1 スコアを小数2桁で表示する。null は "—"。 */
function formatScore(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

/** 0-1 の率を小数1桁の % 表示にする。null は "—"。 */
function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** reward の前週差分(小数2桁・符号付き)。null は "—"。 */
function formatScoreDelta(value: number | null): string {
  if (value === null) return "—";
  const s = value.toFixed(2);
  return value > 0 ? `+${s}` : s;
}

/** QG合格率の前週差分(pt・符号付き)。null は "—"。 */
function formatPercentDelta(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  const s = `${pct.toFixed(1)}%`;
  return pct > 0 ? `+${s}` : s;
}

function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sourceHref(source: string, filePath: string): string {
  return `https://github.com/SAS-Sasao/${source}/blob/main/${filePath}`;
}

const cardStyle = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: 16,
  minWidth: 0,
};

const cardLabel = { fontSize: 12, color: "var(--text-sub)", marginBottom: 6 };
const cardValue = { fontSize: 26, fontWeight: 700, lineHeight: 1.2 };
const cardSub = { fontSize: 12, color: "var(--text-sub)", marginTop: 6 };

/** 週次トレンド(0-1 の値)を y 座標へスケールする(reward/QG 共通の変換)。 */
function valueToY(value: number, plotTop: number, plotHeight: number): number {
  return plotTop + (1 - value) * plotHeight;
}

type TrendPoint = { x: number; y: number };

/** null 点で分割した連続セグメントの配列にする(polyline を分割して描画するため)。 */
function buildSegments(
  values: (number | null)[],
  xs: number[],
  plotTop: number,
  plotHeight: number
): TrendPoint[][] {
  const segments: TrendPoint[][] = [];
  let current: TrendPoint[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      return;
    }
    current.push({ x: xs[i]!, y: valueToY(v, plotTop, plotHeight) });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function toPointsAttr(points: TrendPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function WeeklyTrendChart({ trend }: { trend: OverviewData["weeklyTrend"] }) {
  const width = 600;
  const height = 120;
  const paddingX = 20;
  const plotTop = 10;
  const plotHeight = 90;
  const plotWidth = width - paddingX * 2;
  const n = trend.length;
  const xs = trend.map((_, i) => paddingX + (n > 1 ? (i * plotWidth) / (n - 1) : plotWidth / 2));

  const rewardSegments = buildSegments(
    trend.map((w) => w.rewardAvg),
    xs,
    plotTop,
    plotHeight
  );
  const qgSegments = buildSegments(
    trend.map((w) => w.qgPassRate),
    xs,
    plotTop,
    plotHeight
  );

  return (
    <div>
      <svg viewBox="0 0 600 120" width="100%" height={160} role="img" aria-label="週次トレンド(reward平均・品質ゲート合格率)">
        {rewardSegments.map((seg, i) => (
          <polyline
            key={`reward-${i}`}
            points={toPointsAttr(seg)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        ))}
        {qgSegments.map((seg, i) => (
          <polyline
            key={`qg-${i}`}
            points={toPointsAttr(seg)}
            fill="none"
            stroke="var(--accent-spar)"
            strokeWidth={2}
          />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 20, fontSize: 12, color: "var(--text-sub)" }}>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--accent)",
              marginRight: 6,
              borderRadius: 2,
            }}
          />
          reward平均(直近6週)
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--accent-spar)",
              marginRight: 6,
              borderRadius: 2,
            }}
          />
          品質ゲート合格率(直近6週)
        </span>
      </div>
    </div>
  );
}

export default async function OverviewPage() {
  const user = await requireUser();
  const data = await getOverviewData(user.id);

  const hasData =
    data.recentDecisions.length > 0 ||
    data.weeklyTrend.some((w) => w.rewardAvg !== null || w.qgPassRate !== null) ||
    data.kpis.recordsThisWeek > 0;

  return (
    <section>
      <h1 style={{ marginTop: 0 }}>概観</h1>
      <p style={{ color: "var(--text-sub)" }}>
        組織メトリクスと判断ログを横断する一望性ダッシュボード。
      </p>

      {!hasData ? (
        <p>同期データがありません(/api/sync 実行後に表示されます)。</p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--text-sub)" }}>
            ※ 「今週」は進行中の部分週の値です(分母が小さい間はぶれやすい点に留意)。
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div style={cardStyle}>
              <div style={cardLabel}>報酬スコア(今週・進行中)</div>
              <div style={{ ...cardValue, color: scoreColorVar(scoreLevel(data.kpis.rewardWeekAvg)) }}>
                {formatScore(data.kpis.rewardWeekAvg)}
              </div>
              <div style={cardSub}>前週差分 {formatScoreDelta(data.kpis.rewardPrevDelta)}</div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabel}>品質ゲート合格率(今週・進行中)</div>
              <div style={{ ...cardValue, color: scoreColorVar(scoreLevel(data.kpis.qgPassRate)) }}>
                {formatPercent(data.kpis.qgPassRate)}
              </div>
              <div style={cardSub}>前週差分 {formatPercentDelta(data.kpis.qgPrevDelta)}</div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabel}>記録件数(今週・進行中)</div>
              <div style={cardValue}>{data.kpis.recordsThisWeek}</div>
              <div style={{ ...cardSub, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {data.kpis.recordsByType.length === 0
                  ? "—"
                  : data.kpis.recordsByType.map((t) => (
                      <span key={t.type}>
                        {t.type}: {t.count}
                      </span>
                    ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardLabel}>未処理 inbox(本人)</div>
              <div style={cardValue}>{data.kpis.unprocessedInbox}</div>
            </div>
          </div>

          <h2 style={{ fontSize: 16 }}>週次トレンド(直近6週)</h2>
          <WeeklyTrendChart trend={data.weeklyTrend} />

          <h2 style={{ fontSize: 16, marginTop: 24 }}>最近の判断ログ</h2>
          {data.recentDecisions.length === 0 ? (
            <p>判断ログはありません。</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {data.recentDecisions.map((entry, i) => (
                <li
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    padding: "8px 0",
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ color: "var(--text-sub)", fontSize: 13 }}>
                    {formatEntryDate(entry.occurredAt)}
                  </span>
                  <span>{entry.title ?? "(タイトルなし)"}</span>
                  {entry.org ? (
                    <span style={{ color: "var(--text-sub)", fontSize: 13 }}>{entry.org}</span>
                  ) : null}
                  <a
                    href={sourceHref(entry.source, entry.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, color: "var(--accent)" }}
                  >
                    出典
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
