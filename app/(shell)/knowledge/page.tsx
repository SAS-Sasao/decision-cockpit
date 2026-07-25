// SC-04 ナレッジ検索: pgvector 類似検索 + 判断後の組織実績(時間軸で紐づけ)。
// 対象設計: docs/design/detail/search-foundation.md §2.7(SC-04)・§4(受け入れ条件)・§5(禁止事項)
//          docs/design/ui/moc/decision-cockpit.dc.html(isKnowledge ブロック)
//          docs/design/ui/screen-design.md §5(SC-04)
//          docs/design/detail/org-docs-ingestion.md §2.7 rev.5/6/7(type チップ・recent 経路修正)
//
// データは lib/data/knowledge.ts の getKnowledgeData() のみを読む。重い処理(埋め込み・pgvector
// 検索・集計)はこの画面では行わない。チャートは components/charts/line-chart を再利用する。
import { requireUser } from "../../../lib/auth/user";
import { getKnowledgeData, type KnowledgeHit } from "../../../lib/data/knowledge";
import { LineChart } from "../../../components/charts/line-chart";
import { Markdown } from "../../../components/markdown";
import { stripMarkdown } from "../../../lib/ui/markdown";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string | string[];
  sel?: string | string[];
  tag?: string | string[];
  type?: string | string[];
};

/** 種別チップ(decision が既定・knowledge / all で解除)。 */
const TYPE_CHIPS = [
  { value: "decision", label: "判断" },
  { value: "knowledge", label: "ナレッジ" },
  { value: "all", label: "すべて" },
];

function paramStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

/** q / tag / sel / type から画面内リンクの href を組み立てる(空値は省略)。 */
function qs(params: { q?: string; tag?: string; sel?: string; type?: string }): string {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.tag) usp.set("tag", params.tag);
  if (params.sel) usp.set("sel", params.sel);
  if (params.type) usp.set("type", params.type);
  const s = usp.toString();
  return s ? `/knowledge?${s}` : "/knowledge";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** reward の 0-1 スコアを小数2桁で表示する。null は "—"。 */
function formatScore(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(2);
}

/** 前6週比の差分(小数2桁・符号付き)。null は "—"。 */
function formatDelta(value: number | null): string {
  if (value === null) return "—";
  const s = value.toFixed(2);
  return value > 0 ? `+${s}` : s;
}

/** スコア閾値(≥0.80 良 / ≥0.65 注意 / それ未満 不良)に応じた文字色。 */
function scoreColor(value: number | null): string {
  if (value === null) return "var(--text-sub)";
  if (value >= 0.8) return "var(--good)";
  if (value >= 0.65) return "var(--warn)";
  return "var(--bad)";
}

/** 左リストの見出しラベル(q 空時)を種別に追随させる。 */
function recentLabel(type: string): string {
  if (type === "knowledge") return "最近のナレッジ";
  if (type === "all") return "最近の記録";
  return "最近の判断";
}

function sourceHref(source: string, filePath: string): string {
  return `https://github.com/SAS-Sasao/${source}/blob/main/${filePath}`;
}

/** タグチップ(トップタグ・active はクリックでトグル)のスタイル。 */
function chipStyle(active: boolean) {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: active ? "var(--accent)" : "var(--text-sub)",
    background: active ? "color-mix(in oklch, var(--accent) 10%, transparent)" : "transparent",
    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
    borderRadius: 20,
    padding: "4px 11px",
    textDecoration: "none",
    display: "inline-block",
  };
}

const statCardStyle = {
  background: "var(--panel-row)",
  border: "1px solid var(--line-row)",
  borderRadius: 9,
  padding: "11px 12px",
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  const rawParams = await searchParams;
  const q = paramStr(rawParams.q);
  const tagParam = paramStr(rawParams.tag) || undefined;
  const selParam = paramStr(rawParams.sel) || undefined;
  const typeParam = paramStr(rawParams.type) || undefined;
  const currentType = typeParam ?? "decision";

  const data = await getKnowledgeData({ q, tag: tagParam, sel: selParam, type: typeParam });

  const trimmedQ = q.trim();
  const isSearching = trimmedQ !== "";
  const listLabel = isSearching ? `類似する過去の判断 · ${data.hits.length}件` : recentLabel(currentType);
  const listItems: KnowledgeHit[] = data.searchError ? data.recent : isSearching ? data.hits : data.recent;

  return (
    <section style={{ maxWidth: 1180 }}>
      <h1 style={{ marginTop: 0 }}>ナレッジ検索</h1>
      <p style={{ color: "var(--text-sub)" }}>
        過去の判断を pgvector 類似検索し、判断後の組織実績を時間軸で紐づけて確認する。
      </p>

      <div className="panel" style={{ marginBottom: 18 }}>
        <form method="GET" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--text-sub)", fontSize: 15 }}>⌕</span>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="テーマ・キーワードで過去の判断を検索(pgvector類似検索)…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          {tagParam ? <input type="hidden" name="tag" value={tagParam} /> : null}
          {typeParam ? <input type="hidden" name="type" value={typeParam} /> : null}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-sub)",
              border: "1px solid var(--line)",
              borderRadius: 5,
              padding: "2px 7px",
            }}
          >
            pgvector
          </span>
        </form>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: 13,
            paddingBottom: 11,
            borderBottom: "1px dashed var(--line)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-sub)", marginRight: 2 }}>
            種別
          </span>
          {TYPE_CHIPS.map((c) => {
            const active = c.value === currentType;
            const href = qs({ q, tag: tagParam, sel: selParam, type: c.value === "decision" ? undefined : c.value });
            return (
              <a key={c.value} href={href} style={chipStyle(active)}>
                {c.label}
              </a>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 7, marginTop: 13, flexWrap: "wrap" }}>
          {data.topTags.map((t) => {
            const active = t.tag === tagParam;
            const href = qs({ q, tag: active ? undefined : t.tag, sel: selParam, type: typeParam });
            return (
              <a key={t.tag} href={href} style={chipStyle(active)}>
                {t.tag}
              </a>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, overflowWrap: "anywhere" }}>
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-sub)",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            {listLabel}
          </div>
          {data.searchError ? (
            <p style={{ color: "var(--bad)", fontSize: 12.5, marginBottom: 12 }}>
              検索エラー: 埋め込み API に接続できませんでした。索引の閲覧は可能です。
            </p>
          ) : null}
          {listItems.length === 0 ? (
            <p style={{ color: "var(--text-sub)" }}>該当する判断はありません。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {listItems.map((hit) => (
                <a
                  key={hit.id}
                  href={qs({ q, tag: tagParam, sel: hit.id, type: typeParam })}
                  style={{
                    display: "block",
                    background: "var(--panel-row)",
                    border: "1px solid var(--line-row)",
                    borderRadius: 9,
                    padding: "12px 14px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 9,
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-sub)" }}>
                      {formatDate(hit.occurredAt)}
                      {hit.org ? ` · ${hit.org}` : ""}
                    </span>
                    {hit.similarity !== null ? (
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          padding: "2px 7px",
                          borderRadius: 20,
                          background: "color-mix(in oklch, var(--accent) 14%, transparent)",
                          color: "var(--accent)",
                        }}
                      >
                        類似 {hit.similarity.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
                    {hit.title ?? "(タイトルなし)"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6, marginBottom: 10 }}>
                    {stripMarkdown(hit.excerpt)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {hit.tags.map((tag) => (
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
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-sub)",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            判断後の組織実績(時間軸で紐づけ)
          </div>
          <div className="panel">
            {data.selected === null ? (
              <p style={{ color: "var(--text-sub)", margin: 0 }}>判断を選択してください。</p>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>
                  {data.selected.title ?? "(タイトルなし)"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-sub)",
                    marginBottom: 16,
                  }}
                >
                  {formatDate(data.selected.occurredAt)}
                  {data.selected.org ? ` · ${data.selected.org}` : ""}
                  {" · "}
                  <a
                    href={sourceHref(data.selected.source, data.selected.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                  >
                    出典
                  </a>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text)", marginBottom: 18 }}>
                  <Markdown text={data.selected.body} />
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--text-sub)",
                    letterSpacing: "0.06em",
                    marginBottom: 8,
                  }}
                >
                  判断後6週の報酬スコア推移
                </div>
                {data.outcome === null ? (
                  <p style={{ color: "var(--text-sub)", fontSize: 12 }}>実績データがありません。</p>
                ) : (
                  <LineChart
                    series={[{ label: "報酬スコア", color: "var(--good)", values: data.outcome.reward, area: true }]}
                    xLabels={data.outcome.labels}
                    domain={[0, 1]}
                    formatTick={(v) => v.toFixed(1)}
                    width={520}
                    height={170}
                  />
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 16 }}>
                  <div style={statCardStyle}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 18,
                        fontWeight: 600,
                        color: scoreColor(data.outcome?.stats.avgAfter ?? null),
                      }}
                    >
                      {formatScore(data.outcome?.stats.avgAfter ?? null)}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-sub)", marginTop: 2 }}>平均報酬(後6週)</div>
                  </div>
                  <div style={statCardStyle}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 }}>
                      {formatDelta(data.outcome?.stats.delta ?? null)}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-sub)", marginTop: 2 }}>Δ 前6週比</div>
                  </div>
                  <div style={statCardStyle}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 }}>
                      {data.outcome ? data.outcome.stats.count : 0}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-sub)", marginTop: 2 }}>記録件数</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
