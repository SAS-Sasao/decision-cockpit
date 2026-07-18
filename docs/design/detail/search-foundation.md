# 詳細設計: search-foundation(M2 ナレッジ検索 — pgvector + SC-04)

> 対象基本設計: docs/design/basic/search-foundation.md(design-review 全レンズ PASS — arch/sec R3・data R4)
> 根拠資料: docs/research/m2-embedding-model.md / docs/design/ui/moc/decision-cockpit.dc.html(isKnowledge)/ screen-design §5 SC-04・§7.4
> ステータス: **PASS**(design-review 詳細 Round 2 全レンズ PASS — reviews/search-foundation.md 参照。R2 の Low/Info は rev.3 で吸収済み: 条件3 の WHERE ピン延伸(status='ok' 込み)+ error 行非対象テスト / フィルタ params 含有 assert / EMBEDDING_API_KEY 参照一般の禁止文言 / ピン1行維持の注意 / 履歴残留の認知事項)
> 作成: 2026-07-17(主セッション執筆)

## 0. 申し送りの決着(reviews/search-foundation.md Round 4)

| # | 申し送り | 決着 |
|---|---|---|
| 1 | 件数 assert の実行形(モック述語再実装の偽 PASS) | テストは **in-memory 行モック(述語ミラー)** + 受け入れ条件の **SQL 固定表記 grep -F** の二重化(§4-3/§4-4)。ミラーの乖離は SQL ピンが検出する(Round 2 で合意済みのトレードオフ) |
| 2 | gemini 入力上限の公式確認 | **2,048 tokens で確定**(2026-07-17・ai.google.dev/gemini-api/docs/embeddings — research 比較表に反映済み)。切詰め = **連結後 600 文字**(`EMBED_INPUT_MAX_CHARS = 600` — SentencePiece のバイトフォールバック悲観上限 **3 tokens/字**でも 1,800 < 2,048 で安全。rev.2 で 1,000 → 600 に強化: 2 tokens/字仮定に出典がなかったため悲観側へ。切詰めは String.prototype.slice(code unit 基準)) |
| 3 | §5-5 ⊆ 判定の実行形 | §4-5 に確定(grep -RIl の出力を `lib/search/embedding.ts` 単一 or 空と比較) |
| 4 | SQL 全文ピン(embedding_model = $n 束縛形・クランプ) | §2.3/§2.4 で SQL 文字列を固定表記化し §4-3/§4-4 で grep -F ピン。**rev.2: ピンの実行形をシェル展開安全な形に確定**(単一引用符・単一引用符を含む1本のみ `\$2` エスケープの二重引用符 — `$n` が位置パラメータ展開で消える偽 FAIL/偽 PASS を封鎖)。クランプは **`Math.min(1, Math.max(0,`** の grep + テストの範囲 assert(**rev.2: 両側 TS クランプに強化** — 基本 §1-4 の「上限は pgvector 依拠」を廃し自己完結。0〜1 保証という基本の意図の安全側強化・§3 のモック raw 1.2 ケースとの矛盾も解消) |
| 5 | currentEmbeddingModel() / isFixtureMode() の IF ピン | §2.2 で確定(単一述語 `isFixtureMode()` を factory と `currentEmbeddingModel()` が共用・ペアリングテスト §3) |
| 6 | 過渡期の HNSW 候補痩せ(ef_search) | **チューニング不採用**(現規模 331〜数千行では planner の seq scan 選択も実用上問題なし・既定のまま)。実利用で recall 不足を体感したら ef_search / iterative scan を別途調整(機械判定対象外の運用事項) |

基本設計の問いの決着:
- **問い1(6週チャート・統計3カード)**: チャート = **reward 1系列**(週次平均・area・`line-chart` 部品・`domain={[0, 1]}`・xLabels「+1週」〜「+6週」)。統計3カード = **①平均報酬(後6週・行ベース平均)②Δ(後6週平均 − 前6週平均。片側 0 行なら null →「—」)③記録件数(後6週)**。QG 合格率は不採用(合否述語の重複実装を避ける — overview は凍結)。
- **問い4(タグチップ)**: 実データの**上位 8 タグ**(status='ok' 行の tags を unnest して頻度降順・同数はタグ名昇順)。tags は取り込み時に正規化済みのため tag_synonyms の再適用はしない。
- **問い5(足切り)**: **不採用**。上位 8 件(`limit` 既定 8・最大 20)をそのまま表示(similarity 0 も可視 — 「似ていない」ことが判る方が個人用途で有用)。
- **問い6(恒常失敗の後回し)**: **不採用**(行状態を持たない・ORDER BY synced_at ASC のまま)。現規模では EMBED_MAX_ROWS=200 に対し全件 331 で滞留の実害なし。summary の failed で可視化(基本設計どおり既知の制限)。

**詳細 Round 1(全レンズ FAIL)の rev.2 決着**(詳細は reviews/search-foundation.md):
1. **[全レンズ High/Med] SQL ピンのシェル展開欠陥** → §4-3/§4-4 を fenced block + 単一引用符(`'ok'` を含む1本のみ `\$2` エスケープの二重引用符)の実行形に確定。
2. **[arch High-2 / data M-1] クランプ自己矛盾** → similarity = **`Math.min(1, Math.max(0, raw))`** の両側 TS クランプに変更(§2.4・§4-4 ピン・§3 の raw 1.2 モックと整合)。
3. **[data M-2] 検索側の切替シミュレーション欠落** → §3 に復元(混在識別子データ → 現行のみの件数 assert)。
4. **[data M-3] 切詰め根拠** → 600 文字(3 tokens/字悲観上限)に強化。
5. **[data M-4 / arch Low-2] メタフィルタ縮小** → **type(既定 decision・"all" で解除)と org を KnowledgeSearchParams に復元** + フィルタの件数減少 assert を §3 に復元(基本 §5-4 準拠。UI は q/sel/tag のみ公開 — データ層は全契約対応)。
6. **[sec Med-2] URL・キー参照の散在** → 条件5 の ⊆ 判定に `api.openai.com` / `generativelanguage.googleapis.com` / `process.env.EMBEDDING_API_KEY` を追加 + §5 禁止リテラルに編入。
7. **[sec Med-3] 認可後段の機械検証** → tests/api-sync-embed.test.ts に**非認可 GET / 非 admin POST → runEmbedIndex 不呼出(呼び出し回数 0)**を追加。
8. **[arch Med-2] テスト実行環境の DATABASE_URL 混入窓** → 条件2 の実行形を **`env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test`** に固定(実ネットワーク禁止の環境非依存化)。
9. **[arch Med-1] embed-local の「dotenv」記載** → sync-local 同型の**インライン env 渡し**に訂正(dotenv 依存なし)+ 反復終了 = remaining 不減 or 50 回で停止([data L-3])。
10. その他: recent の similarity は null(型 = number | null — [data L-1])/ sel・id の uuid 形式検査(不一致 → null・500 にしない — [data L-2])/ limit クランプのテスト追加([data L-4])/ scripts/sync-local.ts を凍結列挙に追加([data L-5])/ query() 実引数へのピン断片 assert をテストに追加(コメント偽 PASS の残余封鎖 — [data I-1])/ check-no-secrets ヘッダ数詞(5→8クラス)の更新を可変範囲に含める([sec Low-2])/ 0003 down は Write ツールで作成(bash heredoc は guard 遮断 — [sec Low-1])/ `lib/db`・`lib/search` リテラルの knowledge 配下コメント禁止([arch Low-1])。

---

## 1. スキーマ DDL

**0003_search_foundation.up.sql**(列追加のみ・冪等・破壊操作なし):
```sql
-- 対象設計: docs/design/detail/search-foundation.md §1(design-review PASS 後に適用)
-- 埋め込み列: 次元は EMBEDDING_DIM=1536(text-embedding-3-small ネイティブ / gemini 切替時も 1536 固定)
ALTER TABLE timeline_records ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE timeline_records ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE timeline_records ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- HNSW(cosine)。m / ef_construction は pgvector 既定(16 / 64)— WITH 句なし(research §2)
CREATE INDEX IF NOT EXISTS timeline_records_embedding_hnsw_idx
  ON timeline_records USING hnsw (embedding vector_cosine_ops);
```

**0003_search_foundation.down.sql**(設計明示 + 人間承認対象 — 0001/0002 と同方式。**データ行は消さない**):
```sql
DROP INDEX IF EXISTS timeline_records_embedding_hnsw_idx;
ALTER TABLE timeline_records DROP COLUMN IF EXISTS embedded_at;
ALTER TABLE timeline_records DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE timeline_records DROP COLUMN IF EXISTS embedding;
```

- 冪等キー (source, file_path, item_key) は不変。embedding / embedding_model / embedded_at は `commit` と同じ**属性列**(キーに含めない)。
- 検証: **Neon ブランチ**(create_branch → 0003 適用 → 3列 + インデックスの存在を information_schema / pg_indexes で確認 → ブランチ削除)。実施 = 主セッション(または db-architect)。**本番適用(complete)は人間承認(ask)**。ローカル db(pgvector/pg17)にも適用。

---

## 2. 関数 / API インターフェース

### 2.1 env(.env.example の確定値)
```
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
EMBEDDING_API_KEY=__set_me__
EMBED_MAX_ROWS=200
# EMBEDDING_SOURCE=fixture   # テスト・ローカル検証のみ。production では指定するとエラー(SYNC_SOURCE と同契約)
```
- モデル名は非秘密のため実値を記載(§4-5 の走査対象外)。Google 切替時は `EMBEDDING_MODEL=gemini-embedding-001` + キー差し替え(**2変数同時**・手動チェックリスト)。

### 2.2 lib/search/embedding.ts(`import "server-only"`)
```ts
export type EmbeddingClient = { embed(texts: string[]): Promise<number[][]> };

export function isFixtureMode(): boolean;
  // EMBEDDING_SOURCE === "fixture" の厳密等値(SYNC_SOURCE 前例)。VERCEL_ENV==="production" で fixture 指定なら throw(production 拒否)
export function currentEmbeddingModel(): string;
  // 有効モデル識別子(基本設計 §1-1)= isFixtureMode() ? `fixture:${model}` : model。
  // model = process.env.EMBEDDING_MODEL — 未設定・空文字は throw(fixture モードでも必須・対称 fail-closed)
export function createEmbeddingClient(): EmbeddingClient;
  // isFixtureMode() → FixtureEmbedder / それ以外 → ApiEmbedder(選択と識別子は同一述語 — ペアリングテスト §3)
export function l2normalize(v: number[]): number[];   // 純関数(Google 再正規化・Fixture 正規化の共通実装・テスト対象)
```
- **ApiEmbedder の dispatch(fail-closed)**: `EMBEDDING_MODEL` が `text-embedding-` 前方一致 → OpenAI / `gemini-` 前方一致 → Google / **それ以外(`models/` 修飾・未設定・空文字含む)→ throw**。既定フォールバック禁止。
  - OpenAI: `POST https://api.openai.com/v1/embeddings`・`Authorization: Bearer <EMBEDDING_API_KEY>`・body `{ model, input: texts, dimensions: EMBEDDING_DIM }`(**dimensions 常時明示** — 3-large 切替対応)。応答 `data[i].embedding`。
  - Google: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:batchEmbedContents`・`x-goog-api-key`・requests[] 各要素 `{ model: "models/" + model, content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIM }`(**env はベア名・`models/` プレフィクスはリクエスト体内でのみ付与**)。応答 `embeddings[i].values` を **l2normalize で再正規化**(1536 は非正規化で返る — research 確認済み)。
  - **1リクエスト最大 100 テキスト**(両 provider 安全値)で分割送信。
- **FixtureEmbedder**: text の sha256 を種に決定的に EMBEDDING_DIM 個の値を展開([-1,1])→ l2normalize。実ネットワークなし。
- **契約**: 返却は常に EMBEDDING_DIM 次元・単位ノルム。エラーは throw(呼び出し側で握る)。

### 2.3 lib/search/embed-index.ts(`import "server-only"`)
```ts
export type EmbedSummary = { embedded: number; failed: number; remaining: number };
export const EMBED_INPUT_MAX_CHARS = 600;   // §0-2(gemini 2,048 token に対する 3 tokens/字 悲観安全値)
export function buildEmbedInput(row: { title: string | null; tags: string[]; body: string | null }): string;
  // [title, tags.join(" "), body] の非空要素を "\n" 連結 → slice(0, EMBED_INPUT_MAX_CHARS)(code unit 基準・純関数・テスト対象)
export async function runEmbedIndex(client?: EmbeddingClient): Promise<EmbedSummary>;
  // client 省略時 createEmbeddingClient()。lib/db の query() 直呼び(テストは lib/db をモック)
```
- **※ 追随修正(2026-07-18・fix/embed-snapshot-precision)**: SELECT の synced_at は **`synced_at::text` の全精度文字列で読み、UPDATE $3 にその文字列をそのまま渡す**。pg ドライバの Date 変換(ms 精度)で µs が落ちると `synced_at > embedded_at` が恒久成立し全行が再対象化される実バグ(初回バックフィルで発見・µs 回帰テストを tests/embed-index.test.ts に追加)。「$3 = 読取時の行の synced_at 値」の契約自体は不変 — 値の受け渡し表現の精密化。
- **対象 SELECT(固定表記 — §4-3 で grep -F ピン)**。WHERE 句は共有定数1箇所に置く:
  `WHERE status = 'ok' AND (embedding IS NULL OR embedding_model <> $1 OR synced_at > embedded_at)`
  取得列 = id, title, tags, body, synced_at(**コンテンツと synced_at を同一 SELECT** — スナップショット一貫)+ `ORDER BY synced_at ASC` + `LIMIT $2`($2 = EMBED_MAX_ROWS・既定 200)。
- **UPDATE(固定表記 — 同ピン)**: `SET embedding = $1::vector, embedding_model = $2, embedded_at = $3` + `WHERE id = $4`。
  $1 = `"[" + vec.join(",") + "]"`(パラメータとして渡す)/ $2 = `currentEmbeddingModel()` / **$3 = 読取時の行の synced_at 値**(now() 不使用 — 競合窓封鎖)。
- 処理: 対象行を batch(≤100)で embed → 行ごとに UPDATE。embed 失敗バッチは行数分 failed に計上して続行。remaining = 処理後の同 WHERE の COUNT。
- **$1(現行識別子)は currentEmbeddingModel() 経由**。EMBED_MAX_ROWS は本モジュールで env 参照(§4-5 の制限対象は EMBEDDING_MODEL / EMBEDDING_DIM のみ)。

### 2.4 lib/data/knowledge.ts(`import "server-only"`)
```ts
export type KnowledgeHit = {
  id: string; source: string; filePath: string; occurredAt: string | null; type: string;
  org: string | null; title: string | null; excerpt: string; tags: string[];
  similarity: number | null;   // recent(非検索)経路は null → UI は pill 非表示
};
export type KnowledgeSearchParams = {
  q: string; type?: string;    // 既定 "decision"・"all" で type フィルタ解除(基本 §1-4 の全列挙に対応)
  org?: string; tag?: string; source?: string; from?: string; to?: string; limit?: number;
};
export async function searchKnowledge(params: KnowledgeSearchParams): Promise<KnowledgeHit[]>;
export function outcomeWindows(anchor: Date, weeks?: number): { start: Date; end: Date }[];  // occurred_at 起点7日窓×6(UTC)・純関数
export async function decisionOutcome(id: string): Promise<{
  labels: string[]; reward: (number | null)[];              // 「+1週」〜「+6週」・窓内 0 行は null
  stats: { avgAfter: number | null; delta: number | null; count: number };
} | null>;                                                   // id が type='decision' の ok 行でなければ null
export async function topTags(n?: number): Promise<{ tag: string; count: number }[]>;   // 既定 8
export async function getKnowledgeData(params: KnowledgeSearchParams & { sel?: string }): Promise<{
  hits: KnowledgeHit[]; recent: KnowledgeHit[];             // q 空時は recent(最近の decision 8件・similarity なし)
  selected: (KnowledgeHit & { body: string | null }) | null; outcome: Awaited<ReturnType<typeof decisionOutcome>>;
  topTags: { tag: string; count: number }[]; searchError: boolean;   // クエリ埋め込み失敗 → true(検索以外は返す)
}>;
```
- **検索 SQL(固定表記 — §4-4 で grep -F ピン)**:
  - 射影に `1 - (embedding <=> $1::vector)` (raw_similarity)。
  - `WHERE status = 'ok' AND embedding IS NOT NULL AND embedding_model = $2`($2 = currentEmbeddingModel())。
  - 追加フィルタは **$n 追記のみ**(type(既定 'decision'・"all" 指定時は付与しない)/ org / tag = ANY(tags) / source / occurred_at 範囲 — 全て params 配列)。文字列連結によるユーザー値の埋め込み禁止。
  - `ORDER BY embedding <=> $1::vector ASC` + `LIMIT $n`(既定 8・上限 20 に clamp)。
- **similarity = `Math.min(1, Math.max(0, raw_similarity))`**(**両側 TS クランプ** — §4-4 で grep + テストの範囲 assert。降順 assert は非厳密。基本 §1-4 の pgvector 依拠上限を自己完結に強化 — §0 rev.2 決着 2)。
- excerpt = body 先頭 120 文字(表示用・null は '')。
- **id / sel の uuid 形式検査**: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` 不一致は DB へ渡さず null 扱い(Postgres の uuid キャストエラー = 500 を防止)。
- decisionOutcome: 1 クエリで `occurred_at ∈ [anchor−42日, anchor+42日)` の `reward_score IS NOT NULL` ok 行(decision の org が非 null なら org 一致で絞る・null なら全体)を取得し、TS(純関数)で窓割り。avgAfter/avgBefore = 各 42 日区間の行ベース平均・delta = 両側非 null 時のみ。
- クエリ埋め込みは **searchKnowledge 内でのみ** createEmbeddingClient() を使用(呼び出し位置固定)。埋め込み throw は getKnowledgeData が握り `searchError: true`。

### 2.5 app/api/sync/route.ts(可変範囲 — 追記のみ)
- GET / POST の認可判定(CRON_SECRET / getUser+isAdmin)は**不変**(凍結 tests/api-sync.test.ts が実測)。
- `runSync(...)` 成功後: `let embed; try { embed = await runEmbedIndex(); } catch { embed = { error: true }; }` → 応答 `{ ...summary, embed }`(**キー追加のみ**。try/catch は pool 初期化 throw を含む全例外を吸収)。

### 2.6 scripts/embed-local.ts
- sync-local.ts と同型(**インライン env 渡し** — dotenv 依存なし・新規依存禁止と整合)。runEmbedIndex を反復し各回の EmbedSummary を出力。**終了条件 = remaining が 0、または前回から減らない(進捗なし — 恒常失敗の無限ループ防止)、または反復 50 回**。DATABASE_URL 差し替えで Neon 本番バックフィルに使用(本番実行は人間承認)。
- **usage コメント等にモデル名リテラル・送信先 URL を書かない**(§4-5 の ⊆ 判定対象)。

### 2.7 app/(shell)/knowledge/page.tsx(SC-04・M2-B)

> **※ 追随注記(org-docs-ingestion・2026-07-18)**: SC-04 に **type チップ(判断(既定)/ ナレッジ / すべて)** が追加された(knowledge 型の横断検索 — searchKnowledge の IF は無変更・UI の公開のみ)。正典 = docs/design/detail/org-docs-ingestion.md §2.7。
- GET パラメータ: `q` / `sel` / `tag`。`requireUser()` 存置。データは **getKnowledgeData() のみ**(lib/db / lib/search の直 import 禁止 — §4-7 grep)。
- 構成(MoC isKnowledge 準拠): 検索パネル(input name="q"・GET form・タグチップ 8 個 = topTags・active はリンクでトグル)→ 2列グリッド:
  - 左: 「類似する過去の判断 · N件」+ 結果行カード(日付・org・**類似 pill = `類似 {similarity.toFixed(2)}`**・similarity null(recent 経路)は pill 非表示・タイトル・excerpt・タグ pill)。q 空は recent を「最近の判断」として表示。searchError 時はエラーメッセージ + recent。行クリック = `?sel=<id>`(q/tag 保持)。
  - 右: selected(sel 指定 or 先頭ヒット)の詳細(タイトル・日付・org・body)+ 「判断後6週の報酬スコア推移」= **components/charts/line-chart**(reward 1系列・area・`domain={[0, 1]}`・xLabels)+ 統計3カード(§0 問い1 — 値は Mono・null は「—」)。selected なしは空状態表示。
- スタイルは既存トークン・`.panel` を再利用。色は TokenColor のみ・dangerouslySetInnerHTML 禁止(ui-polish 規範の継承)。

### 2.8 scripts/check-no-secrets.sh(可変範囲 — PATTERN 行のみ)
確定 PATTERN(1行・置換後の全文):
```
PATTERN='npg_[A-Za-z0-9]+|napi_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9-]+|sk-proj-[A-Za-z0-9_-]+|sk-svcacct-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{35}'
```
(docs 内の正規表現形式言及は接頭辞直後が `[` のためマッチしない — R3 sec で検証済み。変更は **PATTERN 行 + 冒頭コメントの数詞1箇所(「5クラス」→「8クラス」)のみ**・同一コミット則は人間レビュー判定。)

### 2.9 被変更側注記(主セッション担当・M2-B)
- docs/design/detail/ingestion-foundation.md §2.4: /api/sync の runSync 後に search-foundation の embed フェーズが接続され応答に embed キーが追加された旨。
- docs/design/detail/ui-shell.md §2.5: knowledge プレースホルダが search-foundation で実装化された旨。

---

## 3. テスト観点

vitest・実 DB / 実ネットワークなし(lib/db をモック・FixtureEmbedder のみ)。**新テストは新ファイル**・既存は全凍結。

| ファイル(新設) | ケース |
|---|---|
| `tests/embedding.test.ts` | FixtureEmbedder 決定性(同一入力2回 → 同一ベクトル)・次元 = EMBEDDING_DIM・単位ノルム(|v|−1| < 1e-6)/ `l2normalize` の数理(非正規化入力 → ノルム1・冪等)/ dispatch fail-closed(**不明名・未設定・空文字 → throw** の3ケース)/ 有効識別子(fixture 時 `fixture:` プレフィクス・通常時ベア名・**createEmbeddingClient の種別 ↔ プレフィクスのペアリング一致**)/ production 拒否(EMBEDDING_SOURCE=fixture + VERCEL_ENV=production → throw) |
| `tests/embed-index.test.ts` | in-memory 行モック(述語ミラー — §0-1)で: 初回 → 全 ok 行 embed・**status='error' 行は対象外(モックに error 行を含め非対象を assert — rev.3)**・**2回目 → 対象 0 件** / 識別子変更(fixture:A → fixture:B)→ 全行再対象化 / **embedded_at = 読取時 synced_at**(UPDATE 引数の等値 assert)/ EMBED_MAX_ROWS 上限・remaining 計上 / client.embed throw → failed 計上・UPDATE なし / buildEmbedInput(連結順・**600 文字切詰め**・null 要素スキップ)/ **query() 第1引数(実 SQL 文字列)に §4-3 のピン断片が含まれる assert**(コメント一致の偽 PASS 封鎖) |
| `tests/knowledge-data.test.ts` | searchKnowledge: 類似度降順(**非厳密**)・**全 similarity ∈ [0, 1]**(モックに raw −0.3 / 1.2 相当を含め**両側クランプ**を実効検証)・各 hit に source/filePath/occurredAt/similarity・$1 の vector 文字列形(`/^\[[-0-9.,eE]+\]$/`)・$2 = 有効識別子 / **モデル切替シミュレーション: 混在識別子データ(現行・旧モデル名・fixture: プレフィクス)→ 現行識別子の行のみ返る(件数 assert — ミラーがガードを適用)** / **type(既定 decision・"all" で解除)・org・tag・source・date 各フィルタで件数が減る assert(意味論)+ フィルタ有効時に params 配列へフィルタ値が含まれる assert(rev.3)** / **limit クランプ(既定 8・上限 20)** / **query() 第1引数に §4-4 のピン断片が含まれる assert** / outcomeWindows(境界: anchor ちょうど・+42日直前/直後)/ decisionOutcome(窓割り・0 行窓 null・delta の null 伝播・org 絞り・**不正 uuid → null**)/ topTags(頻度降順・同数タグ名昇順)/ getKnowledgeData(q 空 → recent(similarity null)・embed throw → searchError=true + recent 返却) |
| `tests/api-sync-embed.test.ts` | run-sync / embed-index / auth をモック: GET(正 secret)→ 200 + `embed` キー / **runEmbedIndex throw → 200 + `embed.error`**(同期本体の成功を妨げない)/ POST(admin)同様 / **非認可 GET(不正 secret)・非 admin POST → 401/403 かつ runEmbedIndex 呼び出し回数 0(認可後段配置の機械検証)** |
| 既存テスト | **1文字も変更しない**(§4-8 FROZEN_TESTS) |

---

## 4. 受け入れ条件(機械判定)

`FROZEN_TESTS`(本書で展開): `tests/proxy.test.ts tests/review-data.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion tests/helpers tests/overview-data.test.ts tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts vitest.config.ts`(**tests/chart.test.ts を編入** — 世代管理)。

1. **マイグレーション**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0003_search_foundation.up.sql || fail=1
   test -f db/migrations/0003_search_foundation.down.sql || fail=1
   grep -q "vector(1536)" db/migrations/0003_search_foundation.up.sql || fail=1
   grep -q "USING hnsw" db/migrations/0003_search_foundation.up.sql || fail=1
   grep -q "vector_cosine_ops" db/migrations/0003_search_foundation.up.sql || fail=1
   grep -E "DROP[[:space:]]|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0003_search_foundation.up.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + **Neon ブランチ検証**(§1 — 3列 + インデックス実在確認)を主セッションが実施し結果を /goal 報告に含める。**本番適用は ask**。
2. **テスト**: `test -f` ×4(tests/embedding.test.ts / tests/embed-index.test.ts / tests/knowledge-data.test.ts / tests/api-sync-embed.test.ts)+ **`env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test`** exit 0(実行環境の実接続情報を遮断 — 実ネットワーク禁止の環境非依存化。以降の条件で `npm test` を再実行する場合も同形)。
3. **embed-index の SQL ピン**(実行形 — **単一引用符でシェル展開を遮断**):
   ```bash
   fail=0
   grep -Fq "WHERE status = 'ok' AND (embedding IS NULL OR embedding_model <> \$1 OR synced_at > embedded_at)" lib/search/embed-index.ts || fail=1
   grep -Fq 'ORDER BY synced_at ASC' lib/search/embed-index.ts || fail=1
   grep -Fq 'SET embedding = $1::vector, embedding_model = $2, embedded_at = $3' lib/search/embed-index.ts || fail=1
   grep -Fq 'EMBED_INPUT_MAX_CHARS = 600' lib/search/embed-index.ts || fail=1
   exit "$fail"
   ```
   (1本目は `'ok'` を含むため `\$1` エスケープの二重引用符 — status='ok' 前提込みの全 WHERE をピン。rev.3 で延伸)
4. **検索の SQL ピン**(実行形 — 1本目のみパターン内に `'ok'` の単一引用符を含むため **`\$2` エスケープの二重引用符**、他は単一引用符):
   ```bash
   fail=0
   grep -Fq "WHERE status = 'ok' AND embedding IS NOT NULL AND embedding_model = \$2" lib/data/knowledge.ts || fail=1
   grep -Fq 'ORDER BY embedding <=> $1::vector ASC' lib/data/knowledge.ts || fail=1
   grep -Fq '1 - (embedding <=> $1::vector)' lib/data/knowledge.ts || fail=1
   grep -Fq 'Math.min(1, Math.max(0,' lib/data/knowledge.ts || fail=1
   exit "$fail"
   ```
5. **モデル固定(⊆ 判定・空集合可)**:
   ```bash
   fail=0
   hits=$(grep -RIlE "text-embedding|gemini-embedding" app components lib scripts 2>/dev/null | sort)
   { [ -z "$hits" ] || [ "$hits" = "lib/search/embedding.ts" ]; } || fail=1
   envs=$(grep -RIlE "process\.env\.EMBEDDING_(MODEL|DIM)" app components lib scripts 2>/dev/null | sort)
   { [ -z "$envs" ] || [ "$envs" = "lib/search/embedding.ts" ]; } || fail=1
   urls=$(grep -RIlE "api\.openai\.com|generativelanguage\.googleapis\.com|process\.env\.EMBEDDING_API_KEY" app components lib scripts 2>/dev/null | sort)
   { [ -z "$urls" ] || [ "$urls" = "lib/search/embedding.ts" ]; } || fail=1
   exit "$fail"
   ```
6. **秘密・env**(集計型):
   ```bash
   fail=0
   grep -q "^EMBEDDING_MODEL=" .env.example || fail=1
   grep -q "^EMBEDDING_DIM=1536$" .env.example || fail=1
   grep -q "^EMBED_MAX_ROWS=" .env.example || fail=1
   grep -Fq "sk-proj-" scripts/check-no-secrets.sh || fail=1
   grep -Fq "sk-svcacct-" scripts/check-no-secrets.sh || fail=1
   grep -Fq "AIza" scripts/check-no-secrets.sh || fail=1
   bash scripts/check-no-secrets.sh || fail=1
   exit "$fail"
   ```
   (PATTERN 変更 = §2.8 の1行のみ・env 確定と同一コミットは人間レビュー判定。)
7. **境界・非送信**(集計型):
   ```bash
   fail=0
   grep -RIn "capture_inbox" lib/search lib/data/knowledge.ts "app/(shell)/knowledge"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn -E "lib/db|lib/search" "app/(shell)/knowledge"; s=$?; [ "$s" -ne 1 ] && fail=1
   for f in lib/search/embedding.ts lib/search/embed-index.ts lib/data/knowledge.ts; do
     grep -Fq 'import "server-only"' "$f" || fail=1; done
   grep -Fq "requireUser" "app/(shell)/knowledge/page.tsx" || fail=1
   grep -Fq 'components/charts/line-chart"' "app/(shell)/knowledge/page.tsx" || fail=1
   git diff --exit-code main -- proxy.ts || fail=1
   exit "$fail"
   ```
   + `bash scripts/check-no-secrets.sh` exit 0 / M1 条件8(SSoT ホスト禁止 grep)exit 0(前例どおり再実行)。
8. **凍結・退行**:
   `git diff --exit-code main -- lib/ingestion db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql lib/auth lib/db.ts app/login app/auth app/logout next.config.mjs lib/data/review.ts lib/data/overview.ts lib/ui components "app/(shell)/page.tsx" "app/(shell)/retro" "app/(shell)/layout.tsx" "app/(shell)/template.tsx" "app/(shell)/today" "app/(shell)/capture" "app/(shell)/admin" app/globals.css app/layout.tsx fixtures scripts/sync-local.ts tsconfig.json package.json package-lock.json` exit 0 /
   `git diff --exit-code main -- <FROZEN_TESTS>` exit 0。
9. **/api/sync 接続**: `grep -Fq "runEmbedIndex" app/api/sync/route.ts` + `grep -q "timingSafeEqual" app/api/sync/route.ts` + `grep -q "isAdmin" app/api/sync/route.ts`(認可コード存置)+ 凍結 tests/api-sync.test.ts 緑(条件2 に含む — 認可挙動の実測)。
10. **ビルド・実機**: build = ui-shell 詳細 §4 条件5 相当(app 停止 → .next 掃除 → ダミー env build exit 0 → 復帰)。実機 = ui-shell 詳細 §4 条件2 の手順(port 3300・SYNC_SOURCE=fixture + **EMBEDDING_SOURCE=fixture**・ダミー env)で未認証 `/knowledge` → **307**・`/` → 307(退行なし)。
11. **注記**: `grep -q "search-foundation" docs/design/detail/ingestion-foundation.md` exit 0 / `grep -q "search-foundation" docs/design/detail/ui-shell.md` exit 0。

**手動確認チェックリスト**(機械判定外 — 基本設計 §5 末尾を継承): MoC 目視比較 / 実キーでの初回バックフィル(scripts/embed-local.ts)と日本語クエリの体感品質 / OpenAI キーは **sk-proj- 形式・embeddings 限定 restricted key** で発行 / 切替時はモデル名・キーの**同時交換** + Google 有償枠/データ利用設定の確認 + remaining=0 確認 / 0003 本番適用(ask)と本番バックフィルの時期判断 / **本番バックフィル実行時はコマンドラインの DATABASE_URL 実値がシェル履歴に残らないよう配慮**(先頭スペース実行等 — sync-local 前例と同じ認知事項)。

---

## 5. 実装の分割(/goal 単位)と禁止事項

基本設計 §5 の方向性(M2-A 基盤 → M2-B 画面)を次のとおり確定する。**knowledge.ts は M2-A に編入**(search-engineer の職掌 = 埋め込み + pgvector 検索。条件4 の SQL ピンを基盤側で早期確定するため — 方向性からの変更点として明記)。

### /goal M2-A「埋め込み・検索基盤」(先行)
- **対象設計**: docs/design/detail/search-foundation.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **1, 2, 3, 4, 5, 6, 8, 9** が exit 0 + **条件10 の build 部分**(main 壊れ窓の封鎖 — 前例)+ 条件7 のうち page 系 grep(requireUser / line-chart)を**除く**全項目。
- **成果物**: 0003 up/down(+ ローカル db 適用・**Neon ブランチ検証は主セッション**)/ lib/search/embedding.ts / lib/search/embed-index.ts / lib/data/knowledge.ts / app/api/sync/route.ts 接続 / scripts/embed-local.ts / .env.example / check-no-secrets PATTERN / テスト4ファイル。
- **executor**: search-engineer。**ターン上限**: 30。**節目 commit**: (a) 0003 + embedding.ts + テスト緑 (b) embed-index + knowledge.ts + route 接続 + **build 緑**。
- ※ app/(shell)/knowledge/page.tsx は触らない(雛形のまま — B の領分)。
### /goal M2-B「SC-04 画面 + 注記」(M2-A 後)
- **対象設計**: docs/design/detail/search-foundation.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **7(全体), 10(実機含む), 11** が exit 0 + 条件 1〜6, 8, 9 再実行緑。
- **成果物**: app/(shell)/knowledge/page.tsx(SC-04)/ 注記2件(主セッション — §2.9)。
- **executor**: frontend-engineer(画面)+ 主セッション(注記)。**ターン上限**: 20。**節目 commit**: (a) SC-04 + build 緑 (b) 実機確認緑。

### 共通の禁止事項
- **凍結対象の変更禁止**(条件8 の diff リスト + FROZEN_TESTS)。新規依存の追加禁止(SDK 含む — package* 凍結)。
- `.env` 書き込み禁止 / `.claude/` 変更禁止 / tsconfig 変更禁止 / SSoT 非接触 / 実ネットワークをテストに持ち込まない。
- `api.github.com` / `raw.githubusercontent.com` / `fonts.googleapis.com` 系 / `next/font/google` / `dangerouslySetInnerHTML` / `as TokenColor` の文字列を書かない。
- **`capture_inbox` のリテラルを lib/search / lib/data/knowledge.ts / app/(shell)/knowledge 配下に書かない(コメント含む — 条件7)**。**`lib/db` / `lib/search` のリテラルも app/(shell)/knowledge 配下に書かない(コメント含む — 条件7 の否定 grep は全文一致)**。
- **モデル名リテラル(`text-embedding` / `gemini-embedding`)・送信先 URL(`api.openai.com` / `generativelanguage.googleapis.com`)・**EMBEDDING_API_KEY への参照一般(member access・分割代入・ブラケット記法のいずれの形でも)**を lib/search/embedding.ts 以外の app/components/lib/scripts 配下に書かない(embed-local の usage コメント含む — 条件5。機械判定は member access 形のみだが禁止は参照一般)**。
- **§4-3/§4-4 のピン対象文字列(SQL 断片・クランプ式)は実装ファイル内で1行に書く**(フォーマッタの改行で grep -F が偽 FAIL するため)。
- SQL の文字列連結によるユーザー値埋め込み禁止($n 束縛のみ)。生 DROP/TRUNCATE/DELETE 禁止(0003 down は本書 §1 の定義のみ・適用は人間承認)。
- **0003 の down ファイル(DROP 行を含む)は Write ツールで作成する**(bash heredoc / echo は guard-bash に遮断される — 前例どおり)。コミットメッセージにも破壊 SQL リテラルを書かない。
- 実 API キーでの実行・実画面スクリーンショットの保存禁止。

---

## 次の手順

`/design-review search-foundation`(detail)→ 全レンズ PASS → `/goal M2-A` → `/goal M2-B`。
