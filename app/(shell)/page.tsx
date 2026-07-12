// SC-02 概観(横断ダッシュボード)。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/page.tsx)
//          docs/design/basic/ui-shell.md §1-4(SC-02 概観)
//          docs/design/detail/ui-polish.md §2.3(app/(shell)/page.tsx — SC-02 リッチ化)
//
// データは lib/data/overview.ts の索引済み集計(timeline_records / sync_state / capture_inbox)を
// 読むのみ。重い処理(集計・埋め込み等)はこの画面では行わない。チャートは components/charts の
// 共通部品(sparkline / line-chart / gauge)を用いる。
import { requireUser } from "../../lib/auth/user";
import { getOverviewData, type OverviewData } from "../../lib/data/overview";
import { scoreLevel, type ScoreLevel } from "../../lib/ui/score";
import { qgBreakdown } from "../../lib/ui/chart";
import type { TokenColor } from "../../lib/ui/chart";
import { Sparkline } from "../../components/charts/sparkline";
import { LineChart } from "../../components/charts/line-chart";
import { Gauge } from "../../components/charts/gauge";

export const dynamic = "force-dynamic";

/** レベル → チャート部品向けの TokenColor(色 props は var(--…) のみ)。 */
function levelToTokenColor(level: ScoreLevel): TokenColor {
  switch (level) {
    case "good":
      return "var(--good)";
    case "warn":
      return "var(--warn)";
    case "bad":
      return "var(--bad)";
    case "na":
      return "var(--text-sub)";
  }
}

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

/** 横断タイムラインの x 軸ラベル("MM/DD")。 */
function formatWeekLabel(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${m}/${day}`;
}

function sourceHref(source: string, filePath: string): string {
  return `https://github.com/SAS-Sasao/${source}/blob/main/${filePath}`;
}

const cardStyle = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: "16px 17px",
  minWidth: 0,
};

const cardTopRow = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 };
const cardLabel = { fontSize: 12, color: "var(--text-sub)" };
const cardValueRow = { display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 };
const cardValue = { fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 600, lineHeight: 1.2 };
const cardUnit = { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-sub)" };

/** delta の正負に応じた pill スタイル(色 14% アルファ — 正のみ good・それ以外は muted)。 */
function pillStyle(positive: boolean) {
  const base = positive ? "var(--good)" : "var(--text-sub)";
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    padding: "2px 7px",
    borderRadius: 20,
    background: `color-mix(in oklch, ${base} 14%, transparent)`,
    color: base,
  };
}

/** 品質ゲート内訳(pass/非pass)の1行(ラベル + 件数 + 小バー)。 */
function BreakdownRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: TokenColor;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 11.5, color: "var(--text-sub)" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text)" }}>{value}件</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--grid)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
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

  const rewardColor = levelToTokenColor(scoreLevel(data.kpis.rewardWeekAvg));
  const qgColor = levelToTokenColor(scoreLevel(data.kpis.qgPassRate));
  const rewardTrend = data.weeklyTrend.map((w) => w.rewardAvg);
  const qgTrend = data.weeklyTrend.map((w) => w.qgPassRate);
  const weekLabels = data.weeklyTrend.map((w) => formatWeekLabel(w.weekStart));

  const qualityEntry = data.kpis.recordsByType.find((t) => t.type === "quality");
  const qgTotal = qualityEntry?.count ?? 0;
  const breakdown = qgBreakdown(data.kpis.qgPassRate, qgTotal);

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
              marginBottom: 16,
            }}
          >
            <div style={cardStyle}>
              <div style={cardTopRow}>
                <span style={cardLabel}>報酬スコア(今週・進行中)</span>
                <span style={pillStyle(data.kpis.rewardPrevDelta !== null && data.kpis.rewardPrevDelta > 0)}>
                  {formatScoreDelta(data.kpis.rewardPrevDelta)}
                </span>
              </div>
              <div style={cardValueRow}>
                <span style={{ ...cardValue, color: rewardColor }}>{formatScore(data.kpis.rewardWeekAvg)}</span>
                <span style={cardUnit}>/1.0</span>
              </div>
              <div style={{ height: 34 }}>
                <Sparkline values={rewardTrend} color={rewardColor} />
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardTopRow}>
                <span style={cardLabel}>品質ゲート合格率(今週・進行中)</span>
                <span style={pillStyle(data.kpis.qgPrevDelta !== null && data.kpis.qgPrevDelta > 0)}>
                  {formatPercentDelta(data.kpis.qgPrevDelta)}
                </span>
              </div>
              <div style={cardValueRow}>
                <span style={{ ...cardValue, color: qgColor }}>{formatPercent(data.kpis.qgPassRate)}</span>
              </div>
              <div style={{ height: 34 }}>
                <Sparkline values={qgTrend} color={qgColor} />
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardTopRow}>
                <span style={cardLabel}>記録件数(今週・進行中)</span>
              </div>
              <div style={cardValueRow}>
                <span style={cardValue}>{data.kpis.recordsThisWeek}</span>
                <span style={cardUnit}>件</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--text-sub)" }}>
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
              <div style={cardTopRow}>
                <span style={cardLabel}>未処理 inbox(本人)</span>
              </div>
              <div style={cardValueRow}>
                <span style={cardValue}>{data.kpis.unprocessedInbox}</span>
                <span style={cardUnit}>件</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="panel">
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 16 }}>横断タイムライン(直近6週)</div>
              <LineChart
                series={[
                  { label: "reward平均", color: "var(--good)", values: rewardTrend, area: true },
                  { label: "品質ゲート合格率", color: "var(--accent)", values: qgTrend },
                ]}
                xLabels={weekLabels}
                domain={[0, 1]}
                formatTick={(v) => v.toFixed(2)}
              />
            </div>

            <div className="panel">
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 16 }}>品質ゲート合格率</div>
              <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ flexShrink: 0 }}>
                  <Gauge value={data.kpis.qgPassRate} color={qgColor} caption="今週・進行中" />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                  {breakdown === null ? (
                    <p style={{ fontSize: 12, color: "var(--text-sub)" }}>内訳データなし(—)</p>
                  ) : (
                    <>
                      <BreakdownRow label="合格" value={breakdown.pass} total={qgTotal} color="var(--good)" />
                      <BreakdownRow label="非合格" value={breakdown.fail} total={qgTotal} color="var(--bad)" />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 14 }}>最近の判断ログ</div>
            {data.recentDecisions.length === 0 ? (
              <p>判断ログはありません。</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.recentDecisions.map((entry, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "11px 12px",
                      borderRadius: 9,
                      background: "var(--panel-row)",
                      border: "1px solid var(--line-row)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "var(--text-sub)",
                        paddingTop: 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatEntryDate(entry.occurredAt)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>
                        {entry.title ?? "(タイトルなし)"}
                        {entry.org ? (
                          <span style={{ color: "var(--text-sub)", fontWeight: 400 }}> · {entry.org}</span>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {entry.tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              color: "var(--accent)",
                              background: "color-mix(in oklch, var(--accent) 10%, transparent)",
                              padding: "1px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <a
                      href={sourceHref(entry.source, entry.filePath)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11.5, color: "var(--accent)", whiteSpace: "nowrap" }}
                    >
                      出典
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
