// 「振り返り」画面: 週次/月次の実スコア集計 + 同期間の判断ログ/日報一覧。
// 対象設計: docs/design/detail/ingestion-foundation.md §0-1(表示ラベル決着)/ §2.5(振り返り)
//          docs/design/basic/ingestion-foundation.md §3.4(振り返りの集計契約)
//          docs/design/detail/ui-shell.md §2.5(app/(shell)/retro/page.tsx — 旧 /review の移設。
//          集計契約・ラベル・requireUser・dynamic は不変。スコア数値に scoreLevel の色付けのみ追加)
//          docs/design/detail/ui-polish.md §2.3(app/(shell)/retro/page.tsx — SC-05 チャート追加)
//
// データは lib/data/review.ts の索引済み集計(timeline_records, WHERE status='ok')を読むのみ。
// 重い処理(集計・埋め込み等)はこの画面では行わない。上部チャートは components/charts の
// 共通部品(line-chart / h-bar / bar-line-chart)、既存テーブル・一覧は素の table のまま不変。
import Link from "next/link";
import { requireUser } from "../../../lib/auth/user";
import { getReviewData, type Bucket, type Entry, type Granularity } from "../../../lib/data/review";
import { scoreLevel, scoreColorVar, type ScoreLevel } from "../../../lib/ui/score";
import { SIGNAL_DIRECTION } from "../../../lib/ui/score";
import type { TokenColor } from "../../../lib/ui/chart";
import { LineChart } from "../../../components/charts/line-chart";
import { HBar } from "../../../components/charts/h-bar";
import { BarLineChart } from "../../../components/charts/bar-line-chart";

export const dynamic = "force-dynamic";

type SearchParams = { g?: string | string[] };

function resolveGranularity(value: string | string[] | undefined): Granularity {
  return value === "month" ? "month" : "week";
}

/** 0-1 の率を「小数1桁の %」表示にする。null は "—"。 */
function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** reward / judge の 0-1 スコアを小数2桁で表示する。null は "—"。 */
function formatScore(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

/** scoreLevel に応じた文字色(reward 平均・judge 3軸・QG 率のみに適用)。 */
function scoreColorStyle(value: number | null): { color: string } {
  return { color: scoreColorVar(scoreLevel(value)) };
}

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

type SignalKey = keyof typeof SIGNAL_DIRECTION;

/** 4シグナルの色(SIGNAL_DIRECTION で方向補正 — high-bad は 1-value を scoreLevel に通す)。 */
function signalColor(key: SignalKey, value: number | null): TokenColor {
  if (value === null) return "var(--text-sub)";
  const directed = SIGNAL_DIRECTION[key] === "high-bad" ? 1 - value : value;
  return levelToTokenColor(scoreLevel(directed));
}

const SIGNAL_ITEMS: { key: SignalKey; label: string; note?: string }[] = [
  { key: "completed", label: "完了率" },
  { key: "artifacts_exist", label: "成果物あり率" },
  { key: "excessive_edits", label: "過剰編集率", note: "低いほど良い" },
  { key: "retry_detected", label: "リトライ率", note: "低いほど良い" },
];

/** 週バケット: 開始日 "MM/DD〜"。月バケット: "YYYY-MM"。 */
function formatPeriodLabel(bucket: Bucket, granularity: Granularity): string {
  if (granularity === "month") {
    const y = bucket.start.getUTCFullYear();
    const m = String(bucket.start.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  const mm = String(bucket.start.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(bucket.start.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}〜`;
}

function formatEntryDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ENTRY_TYPE_LABEL: Record<Entry["type"], string> = {
  decision: "判断ログ",
  daily_log: "日報",
};

// counts の内訳として表示する主要 type(M1 の5種 + org-docs-ingestion の knowledge で6種)。
// session/conversation は M1 パーサ非対象のため内訳には出さない(合計件数には含まれる)。
const BREAKDOWN_TYPES = ["task", "quality", "score", "decision", "daily_log", "knowledge"] as const;

// 内訳ヘッダ用ラベルマップ(knowledge のみ和名表示。他 type は生キーのまま — 意匠の現状維持)。
const BREAKDOWN_LABELS: Record<string, string> = { knowledge: "ナレッジ" };

function sourceHref(source: string, filePath: string): string {
  return `https://github.com/SAS-Sasao/${source}/blob/main/${filePath}`;
}

function totalCount(bucket: Bucket): number {
  return Object.values(bucket.counts).reduce((sum, v) => sum + v, 0);
}

const th = {
  border: "1px solid var(--line)",
  padding: "6px 8px",
  textAlign: "left" as const,
  background: "var(--line-row)",
  whiteSpace: "nowrap" as const,
};

const td = {
  border: "1px solid var(--line)",
  padding: "6px 8px",
  textAlign: "right" as const,
  whiteSpace: "nowrap" as const,
};

const tdLeft = { ...td, textAlign: "left" as const };

export default async function RetroPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  void user;

  const params = await searchParams;
  const granularity = resolveGranularity(params.g);

  const { buckets, entries } = await getReviewData(granularity);

  const hasData = buckets.some((b) => totalCount(b) > 0) || entries.length > 0;
  const periodLabels = buckets.map((b) => formatPeriodLabel(b, granularity));
  const latestBucket = buckets[buckets.length - 1];
  const currentNote = granularity === "month" ? "今月(進行中)" : "今週(進行中)";

  return (
    <section>
      <h1>振り返り</h1>
      <p>期間サマリ(実スコア集計)と同期間の判断ログ / 日報。</p>

      <nav style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Link
          href="/retro?g=week"
          style={{ fontWeight: granularity === "week" ? "bold" : "normal" }}
        >
          週
        </Link>
        <Link
          href="/retro?g=month"
          style={{ fontWeight: granularity === "month" ? "bold" : "normal" }}
        >
          月
        </Link>
      </nav>

      {!hasData ? (
        <p>同期データがありません(/api/sync 実行後に表示されます)。</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#555" }}>
            ※ 「過剰編集率」「リトライ率」は発生率です。低いほど良い指標です(他は高いほど良い)。
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="panel">
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 16 }}>LLM-as-Judge 3軸トレンド</div>
              <LineChart
                series={[
                  { label: "完全性", color: "var(--accent)", values: buckets.map((b) => b.judgeAvg.completeness) },
                  { label: "正確性", color: "var(--good)", values: buckets.map((b) => b.judgeAvg.accuracy) },
                  { label: "明瞭性", color: "var(--accent-spar)", values: buckets.map((b) => b.judgeAvg.clarity) },
                ]}
                xLabels={periodLabels}
                domain={[0, 1]}
                formatTick={(v) => v.toFixed(2)}
              />
            </div>
            <div className="panel">
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 16 }}>報酬スコア & 品質ゲート合格率</div>
              <BarLineChart
                bars={buckets.map((b) => b.qualityGatePassRate)}
                line={buckets.map((b) => b.rewardAvg)}
                barColor="var(--accent)"
                lineColor="var(--good)"
                xLabels={periodLabels}
              />
            </div>
          </div>

          <div style={{ marginBottom: 8, fontSize: 13.5, fontWeight: 600 }}>4シグナル({currentNote})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
            {SIGNAL_ITEMS.map((item) => {
              const value = latestBucket ? latestBucket.signalRates[item.key] : null;
              return (
                <div key={item.key} className="panel">
                  <HBar label={item.label} value={value} color={signalColor(item.key, value)} />
                  {item.note ? (
                    <p style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 8, marginBottom: 0 }}>
                      {item.note}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <table style={{ borderCollapse: "collapse", marginBottom: 24, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>期間</th>
                <th style={th}>件数</th>
                {BREAKDOWN_TYPES.map((t) => (
                  <th key={t} style={th}>
                    {BREAKDOWN_LABELS[t] ?? t}
                  </th>
                ))}
                <th style={th}>reward平均</th>
                <th style={th}>完了率</th>
                <th style={th}>成果物あり率</th>
                <th style={th}>過剰編集率</th>
                <th style={th}>リトライ率</th>
                <th style={th}>完全性</th>
                <th style={th}>正確性</th>
                <th style={th}>明瞭性</th>
                <th style={th}>品質ゲート合格率</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, i) => (
                <tr key={i}>
                  <td style={tdLeft}>{formatPeriodLabel(bucket, granularity)}</td>
                  <td style={td}>{totalCount(bucket)}</td>
                  {BREAKDOWN_TYPES.map((t) => (
                    <td key={t} style={td}>
                      {bucket.counts[t]}
                    </td>
                  ))}
                  <td style={{ ...td, ...scoreColorStyle(bucket.rewardAvg) }}>
                    {formatScore(bucket.rewardAvg)}
                  </td>
                  <td style={td}>{formatPercent(bucket.signalRates.completed)}</td>
                  <td style={td}>{formatPercent(bucket.signalRates.artifacts_exist)}</td>
                  <td style={td}>{formatPercent(bucket.signalRates.excessive_edits)}</td>
                  <td style={td}>{formatPercent(bucket.signalRates.retry_detected)}</td>
                  <td style={{ ...td, ...scoreColorStyle(bucket.judgeAvg.completeness) }}>
                    {formatScore(bucket.judgeAvg.completeness)}
                  </td>
                  <td style={{ ...td, ...scoreColorStyle(bucket.judgeAvg.accuracy) }}>
                    {formatScore(bucket.judgeAvg.accuracy)}
                  </td>
                  <td style={{ ...td, ...scoreColorStyle(bucket.judgeAvg.clarity) }}>
                    {formatScore(bucket.judgeAvg.clarity)}
                  </td>
                  <td style={{ ...td, ...scoreColorStyle(bucket.qualityGatePassRate) }}>
                    {formatPercent(bucket.qualityGatePassRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ fontSize: 16 }}>同期間の判断ログ / 日報</h2>
          {entries.length === 0 ? (
            <p>該当する判断ログ / 日報はありません。</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {entries.map((entry, i) => (
                <li
                  key={i}
                  style={{
                    borderBottom: "1px solid var(--line-faint)",
                    padding: "8px 0",
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ color: "#555", fontSize: 13 }}>
                    {formatEntryDate(entry.occurred_at)}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      padding: "1px 6px",
                    }}
                  >
                    {ENTRY_TYPE_LABEL[entry.type]}
                  </span>
                  <span>{entry.title ?? "(タイトルなし)"}</span>
                  {entry.org ? <span style={{ color: "#555", fontSize: 13 }}>{entry.org}</span> : null}
                  <a
                    href={sourceHref(entry.source, entry.file_path)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13 }}
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
