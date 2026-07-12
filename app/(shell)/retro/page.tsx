// 「振り返り」画面: 週次/月次の実スコア集計 + 同期間の判断ログ/日報一覧。
// 対象設計: docs/design/detail/ingestion-foundation.md §0-1(表示ラベル決着)/ §2.5(振り返り)
//          docs/design/basic/ingestion-foundation.md §3.4(振り返りの集計契約)
//          docs/design/detail/ui-shell.md §2.5(app/(shell)/retro/page.tsx — 旧 /review の移設。
//          集計契約・ラベル・requireUser・dynamic は不変。スコア数値に scoreLevel の色付けのみ追加)
//
// データは lib/data/review.ts の索引済み集計(timeline_records, WHERE status='ok')を読むのみ。
// 重い処理(集計・埋め込み等)はこの画面では行わない。チャートライブラリは使わず素の table で表示する。
import Link from "next/link";
import { requireUser } from "../../../lib/auth/user";
import { getReviewData, type Bucket, type Entry, type Granularity } from "../../../lib/data/review";
import { scoreLevel, scoreColorVar } from "../../../lib/ui/score";

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

// counts の内訳として表示する主要 type(M1 で実際に流入する5種)。session/conversation は
// M1 パーサ非対象のため内訳には出さない(合計件数には含まれる)。
const BREAKDOWN_TYPES = ["task", "quality", "score", "decision", "daily_log"] as const;

function sourceHref(source: string, filePath: string): string {
  return `https://github.com/SAS-Sasao/${source}/blob/main/${filePath}`;
}

function totalCount(bucket: Bucket): number {
  return Object.values(bucket.counts).reduce((sum, v) => sum + v, 0);
}

const th = {
  border: "1px solid #ddd",
  padding: "6px 8px",
  textAlign: "left" as const,
  background: "#f7f7f7",
  whiteSpace: "nowrap" as const,
};

const td = {
  border: "1px solid #ddd",
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

          <table style={{ borderCollapse: "collapse", marginBottom: 24, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>期間</th>
                <th style={th}>件数</th>
                {BREAKDOWN_TYPES.map((t) => (
                  <th key={t} style={th}>
                    {t}
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
                    borderBottom: "1px solid #eee",
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
