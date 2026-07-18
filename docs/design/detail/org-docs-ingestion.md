# 詳細設計: org-docs-ingestion(組織ドキュメント取り込み + ナレッジ検索拡張)

> 対象基本設計: docs/design/basic/org-docs-ingestion.md(design-review Round 2 全レンズ PASS・rev.3)
> ステータス: rev.8(**OD-DEC** — 組織 decision の H1 フォールバック追加 → 差分レビュー待ち)。rev.7 まで = OD-FIX 含め PASS(OD-FIX 差分レビュー Round 2 で data レンズ PASS(arch 指摘の決着検証込み)。Info 3件は rev.7 で吸収済み。rev.4 まで = 詳細 Round 3 全レンズ PASS — reviews/org-docs-ingestion.md 参照。R3 の Low/Info は rev.4 で吸収済み: qs() type 引数明示 / コメント追随の明記 / digest fixture の構成指定 / 見出し行は chunk.text 非包含 / 残骸チャンクの機微残存受容)
> 作成: 2026-07-18(主セッション執筆)。Round 決着一覧 = docs/design/reviews/org-docs-ingestion.md

## 0. 申し送りの決着 + 詳細 Round 1 の決着

**基本設計からの申し送り(6件)**:

| # | 申し送り | 決着 |
|---|---|---|
| 1 | 凍結例外テストの差分ピン実行形 | overview-data / review-data: **追加行(+)がすべて `knowledge` または `8 type` を含む**否定 grep(§4-7)。run-sync.test.ts(R1 で第3の例外に編入 — 下記)は**設計固定の新期待値のピン**(`ok: 13` / `skipped: 3` — §4-7b)。削除行・行数の妥当性は人間レビュー(意図的例外) |
| 2 | review.ts の occurred_at null 行 | **SQL 側除外で確定**: getReviewData の SELECT に `AND occurred_at IS NOT NULL` を追記(ReviewRow 型は Date のまま真)。tests/review-data.test.ts は行モックで SQL 文字列 assert なし(現物確認) |
| 3 | 0004 の実行形 | §1 に全文(**BEGIN/COMMIT で原子化** — R1 data L-1)。制約名 = `timeline_records_type_check`(0002 のインライン CHECK の自動命名 — PostgreSQL 規約・critic 検証済み)。否定 grep は `DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM`(DROP CONSTRAINT 非マッチ)を **up/down 両方**に適用。ローカル適用 = `docker compose exec -T db psql … < ファイル`(リダイレクト形 — コマンド文字列に破壊語が現れず guard 非干渉・0003 前例) |
| 4 | 決定性テスト・危険経路 fixture | §2.8 / §3。fixture 内容は**固定1行 `demo fixture for deny test`**(§4-5 で内容ピン — 無害性の機械判定) |
| 5 | §5-6 再実行帰属 | OD-A = 条件 1〜7, 9 + 10(build)/ OD-B = 条件 8 + 10(実機)+ 11 + 条件 1〜7, 9 再実行(§5) |
| 6 | チャンク item_key・title | item_key = `c<連番>`(`c0`〜・`/^c\d+$/`)。title = `<文書タイトル> › <見出しパス(" › " 結合)>`(見出しパス空なら文書タイトルのみ)。文書タイトル = H1 or ファイル名(拡張子除去) |

**詳細 Round 1(全レンズ FAIL)の rev.2 決着**:
1. **[全レンズ High] 凍結テスト×fixture の充足不能** → **tests/ingestion/run-sync.test.ts を第3の凍結例外に編入**。同テストは実 fixtures 全量走査 + 厳密件数 assert のため、fixture 追加と構造的に不可分(テスト世代管理の一般則の適用対象)。**新期待値を本設計で固定**: cc-sier-organization = **ok: 13**(既存6 + decision 1 + digest チャンク3 + learning-note チャンク3)・error: 3(不変)・**skipped: 3**(危険経路3件 — 遮断の実効がこの凍結例外テスト自体で恒常検証される形になる)。FROZEN_TESTS_OD の `tests/ingestion` を **normalize.test.ts / tag-vocab.test.ts の個別列挙**に変更。変更範囲 = 件数オブジェクトと docs 系検証の追加のみ(§4-7b ピン + 人間レビュー)。
2. **[arch/data Med] tags「全チャンク共通」の層矛盾** → **主張を改訂: tags はチャンク単位**。run-sync の既存機構(レコード単位に `applyTags(title + body)` を上書き)を不変のまま採用 — チャンク title に文書タイトル・見出しパスを含むため文書レベル語彙は title 経由で反映され、チャンク本文に即したタグは検索到達性でむしろ有利。基本設計 §1-2 の「全チャンク共通」はこの形に上書き(§2.9 の注記対象に含めない — 本書が正典)。§3 の共通性テストは削除。
3. **[arch Med] 条件8 のリテラル形** → チップを**固定配列リテラルでピン**(§2.7 — `{ value: "knowledge", label: "ナレッジ" }` の1行固定表記。リンクは既存 qs() で組む — `type=knowledge` リテラル要求を撤回)。
4. **[arch/data/sec Med] fixtures 差分判定** → **`git -c diff.renames=false diff --name-status main -- fixtures` の出力に `^A` 以外の行があれば fail**(追加のみを直接表現 — M/D/R すべて捕捉。§4-9)。
5. その他: `path.toLowerCase()` の固定表記ピン(恒真回避 — §2.4/§4-2)/ 実機 307 の括弧書きを「認証境界のみ」に修正(§4-10)/ lib/ingestion の非変更ファイル(github-source / fixture-source / source / store / tag-vocab)を凍結列挙に個別追加(§4-9)/ チャンク再分割規則の明文(貪欲 500字再結合・h4 以深は内包・前文 = headingPath 空 — §2.1)/ frontmatter date の受理形式(`date:` キー・`YYYY-MM-DD` のみ — §2.2)/ retro ラベルの着地先(TYPE_LABELS — §2.6)。

---

## 1. スキーマ DDL

**0004_org_docs.up.sql**(CHECK 付け替えのみ・データ非破壊・**Write ツールで作成**):
```sql
-- 対象設計: docs/design/detail/org-docs-ingestion.md §1(design-review PASS 後に適用)
-- type 語彙 7 → 8(knowledge 追加)。制約の付け替えのみでデータ・列・キーは不変。
BEGIN;
ALTER TABLE timeline_records DROP CONSTRAINT IF EXISTS timeline_records_type_check;
ALTER TABLE timeline_records ADD CONSTRAINT timeline_records_type_check
  CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log','knowledge'));
COMMIT;
```

**0004_org_docs.down.sql**(逆付け替え・**BEGIN/COMMIT で原子化** — knowledge 行存在時は ADD の検証失敗で全体ロールバックし旧状態が保たれる。適用は人間承認のみ):
```sql
BEGIN;
ALTER TABLE timeline_records DROP CONSTRAINT IF EXISTS timeline_records_type_check;
ALTER TABLE timeline_records ADD CONSTRAINT timeline_records_type_check
  CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log'));
COMMIT;
```

- 検証 = Neon ブランチ(pg_constraint で制約定義確認 + knowledge 行 INSERT/ROLLBACK 試行)→ **本番適用は人間承認(ask)**。ローカル db は OD-A 内で `docker compose exec -T db psql -U cockpit -d cockpit < db/migrations/0004_org_docs.up.sql` 形(リダイレクト — guard 非干渉)。
- **適用順序(本番)**: Vercel 展開時は「0004 適用 → デプロイ」を厳守(基本設計 §5)。

---

## 2. 関数 / API インターフェース

### 2.1 lib/ingestion/chunk.ts(純関数・新設)
```ts
export const CHUNK_MAX_CHARS = 500;
export type Chunk = { headingPath: string[]; text: string };
export function chunkMarkdown(markdown: string): Chunk[];
```
- アルゴリズム(決定的・rev.2 で規則を明文化):
  1. frontmatter(`---` 囲み)を除去。H1 行は文書タイトルとして除外(§0-6)。
  2. **分割点 = `##`・`###` の見出し行のみ**(h4 以深は分割点にせずブロックに内包)。見出しパス = h2 > h3 の階層(h3 単独出現時は h3 のみ)。
  3. **H1 直後〜最初の分割点の前文 = headingPath 空(`[]`)のチャンク**(空なら生成しない)。
  4. 各ブロックが 500字超の場合: **段落(空行区切り)を先頭から貪欲に再結合**して順次チャンク化 — **連結は `\n\n`(空行込みでカウント)し、連結後長 ≤ 500 を条件とする(決定的)**。単一段落が 500字超なら 500字で機械分割。
  5. フェンスコード(``` 内)の見出し様行・空行は分割点にしない(md-render の教訓)。
  6. **見出し行自体は chunk.text に含めない**(headingPath にのみ反映 — title 経由の重複を避ける)。ブロック長判定は本文のみ(rev.4)。
- 空文書・frontmatter のみ → `[]`。同一入力 → 同一 Chunk 列(テスト §3)。

### 2.2 lib/ingestion/parsers/knowledge.ts(新設)
```ts
export function parseKnowledge(file: SourceFile, meta: ParseMeta): NormalizedRecord[];
```
- 1チャンク = 1レコード。type = `"knowledge"` / item_key = `c<index>` / title = §0-6 の結合形 / body = chunk.text / org = meta.org / raw_ref = 既存規約。**title・body とも `sanitizeAbsPaths` を適用**(rev.3 — 既存5パーサ全てが守る ok パスの機微不変条件を継承。§4-3 でピン・§3 でテスト)。
- **tags**: パーサ出力は空配列でよい — **最終形は run-sync の既存機構(レコード単位 applyTags(title + body))が付与**(§0 決着2 — チャンク単位タグが正)。
- **occurred_at**: frontmatter の **`date:` キー(`YYYY-MM-DD` 形式のみ受理)** → ファイル名 `YYYY-MM-DD.md` → **null**(基本設計 §1-5 の契約改訂 — status='ok' のまま)。ヘルパは既存流用可(受理形式はテストで固定)。
- パース失敗は既存規約どおり error レコード化。

### 2.3 lib/ingestion/parsers/decision.ts(org 帰属 + rev.8: H1 フォールバック)
- `org: null`(固定)→ **`org: meta.org`**(ParseMeta.org は実在・run-sync が供給済み — 現物確認)。ai-war-room 経路は orgFromPath = null で不変(凍結 tests/parsers/decision.test.ts は META org:null のため無傷)。コメントも追随。
- **rev.8(OD-DEC・2026-07-18)— H1 形式差異のフォールバック**: 実データ検証で組織 decision(docs/decisions/2026-06-13-….md)の H1 が日付なし形式(`# <タイトル>`)であり error レコード化されて「最近の判断」に合流しないことが判明(error 10件中1件・今後の組織判断も同形式なら全部落ちる)。**3分岐の契約に拡張**:
  1. **日付付き H1**(`# YYYY-MM-DD - タイトル`)→ 従来どおり(title = 日付以降)。
  2. **H1 はあるが日付なし**(先頭行が `# ` で始まり 1 に不一致)→ **フォールバック: title = H1 全文(`# ` 除去・sanitizeAbsPaths)・occurred_at = ファイル名日付(既存の必須検査済み)**。ok レコード化。
  3. **H1 なし**(先頭行が `# ` で始まらない)→ error(**不変** — 凍結テストの missing-h1 fixture は先頭行がプレーン文のため挙動不変)。
  - ファイル名の日付検査(`YYYY-MM-DD-<slug>.md` 必須)は全分岐の前提として**不変**。**凍結 tests/parsers/decision.test.ts の3ケースはすべて挙動不変**(dated H1 = 分岐1 / 規則外ファイル名 = 前提検査 / H1 なし = 分岐3)。
  - **回帰テスト = 新ファイル tests/decision-fallback.test.ts**(インライン SourceFile のみ — **fixtures 追加なし** = run-sync.test.ts の件数ピン(ok:13 等)不変)。ケース: 日付なし H1 + 日付ファイル名 → ok・title = H1 全文・occurred_at = ファイル名日付・org = meta.org / dated H1 の従来経路(回帰)/ H1 なし → error(回帰)/ ファイル名規則外 → error(回帰)。
  - **実データ反映手順(手動 — OD-DEC 完了後にユーザー指示で)**: 対象ファイルは未変更のため増分同期に乗らない → `--force` 全量同期 → 全行 synced_at 更新により**全行再埋め込み(3-large・概算 $0.4)**が発生(設計 §1-2 の既知挙動・許容)→「最近の判断」に組織 decision が出現・decision 13件。

### 2.4 lib/ingestion/normalize.ts(denylist 拡張)
- `DENY_PATTERNS` に **`"claude.md"`, `"memory.md"`, `"agents.md"`** を追加(計9)。
- `isDenied` を小文字正規化に変更 — **固定表記(§4-2 ピン)**: `const lower = path.toLowerCase();` を用い `DENY_PATTERNS.some((p) => lower.includes(p))`。既存6パターンは全小文字のため fail-closed 方向のみの変化。

### 2.5 lib/ingestion/run-sync.ts(allowlist 拡張)
cc-sier-organization の matchAllowlist に以下を追加(record 種別・パーサ割付):
```
/^\.companies\/[^/]+\/docs\/decisions\/[^/]+\.md$/            → parseDecision
/^\.companies\/[^/]+\/docs\/daily-digest\/[^/]+\.md$/         → parseKnowledge
/^\.companies\/[^/]+\/docs\/secretary\/learning-notes\/[^/]+\.md$/ → parseKnowledge
/^\.companies\/[^/]+\/docs\/research\/.+\.md$/                → parseKnowledge
/^\.companies\/[^/]+\/docs\/retail-domain\/.+\.md$/           → parseKnowledge
/^\.companies\/[^/]+\/docs\/diagrams\/[^/]+\.md$/             → parseKnowledge
/^\.companies\/[^/]+\/docs\/drawio\/[^/]+\.md$/               → parseKnowledge
/^\.companies\/[^/]+\/docs\/info-source-master\.md$/          → parseKnowledge
```
- denylist(§2.4)は従来どおり**取得前**に適用(skipped 計上)。タグ付与・SyncSummary・進行カーソル・SYNC_MAX_FILES の機構は不変。

### 2.6 集計層の追随(8 type 化)
| ファイル | 変更 |
|---|---|
| `lib/ingestion/parsers/types.ts` | RecordType union に `"knowledge"` 追加 + CHECK 一致コメントを 0004 参照に更新 |
| `lib/data/overview.ts` | RECORD_TYPE_ORDER に `"knowledge"` を末尾追加。他は不変 |
| `lib/data/review.ts` | ALL_RECORD_TYPES に `"knowledge"` を末尾追加 + getReviewData の SELECT に `AND occurred_at IS NOT NULL` 追記。**隣接コメント(0002 参照・type 数)の追随更新を含む**。他は不変 |
| `app/(shell)/retro/page.tsx` | BREAKDOWN_TYPES に knowledge を末尾追加 + **内訳ヘッダ用ラベルマップ `BREAKDOWN_LABELS: Record<string, string>` を新設**(rev.3 — 現物にラベルマップは無く内訳ヘッダは生 type キー描画。`BREAKDOWN_LABELS = { knowledge: "ナレッジ" }` のみ定義し描画を `BREAKDOWN_LABELS[t] ?? t` に — 他 type は生キーのまま(意匠の現状維持・意図的非対称)。既存 ENTRY_TYPE_LABEL(decision/daily_log 限定)には触らない)。**隣接コメント(「5種」等の数詞)の追随更新を含む**。他は不変 |

### 2.7 app/(shell)/knowledge/page.tsx(OD-B — type チップ)
- searchParams に `type` を追加(公開)。チップは**固定配列リテラル(1行ずつ — §4-8 ピン)**:
  ```ts
  const TYPE_CHIPS = [
    { value: "decision", label: "判断" },
    { value: "knowledge", label: "ナレッジ" },
    { value: "all", label: "すべて" },
  ];
  ```
  リンクは `qs()` で構築 — **qs() に type 引数を追加する(page 内ローカル関数の拡張 — OD-B 可変範囲。rev.4 明示)**。decision = 既定のため type param なし URL。active 強調はタグチップと同形。q / tag / sel を保持。
- `getKnowledgeData({ q, tag, sel, type })` に透過。
- **rev.5(バグ修正改訂・2026-07-18 ユーザー報告)**: 実データ検証で2欠陥が判明 — (a) **recent 経路(q 空)が type・tag を無視**(recentDecisions が decision 固定・tag なし)→ タグ・type チップが無反応 (b) **検索フォームに type の hidden input がなく送信で type が消える**。決着:
  - **recent 契約の改訂(rev.6 で精密化)**: q 空のときの一覧 = `recentRecords(type, tag)` — `WHERE status = 'ok'` + type フィルタ(既定 decision・"all" で解除)+ tag フィルタ(指定時 `= ANY(tags)`)+ **`ORDER BY occurred_at DESC NULLS LAST, id`(タイブレーク = id — 同時刻・null 同値群でも全順序・LIMIT 8 の切断が決定的)**。**SQL/パラメータ形の固定: `LIMIT $1` が第1パラメータ(params[0] = limit)・追加フィルタは $2 以降の $n 束縛のみ**(凍結 tests/knowledge-data.test.ts の recent モックが「dispatch キー = `ORDER BY occurred_at DESC` 部分一致・params[0] = limit・decision 固定ミラー」を前提とするため — この形なら凍結テストは既定経路で緑のまま。type は3語彙(decision/knowledge/all)検証後に使用・文字列連結禁止)。見出しラベルも type に追随(判断 =「最近の判断」/ ナレッジ =「最近のナレッジ」/ すべて =「最近の記録」)。**タグチップ・結果行リンク・type チップの qs() 呼び出しで q/tag/sel/type を相互保持**(rev.7: タグチップの sel 落ちも含めて解消 — 全リンクの保持が範囲)。**不正 type 値(3語彙外)は既定 decision 扱い**(rev.7 — テスト観点に含める)。**新ピン対象文字列(ORDER BY 全文等)は実装内1行**(search-foundation §5 の規則を継承)。
  - **lib/data/knowledge.ts の diff 0 ピンを撤回**(条件9 の凍結リストからも除外 — rev.6 で §4-9 に反映)。可変範囲 = recentDecisions → recentRecords の置換のみ。**searchKnowledge の不変 = search-foundation 詳細 §4-4 の SQL ピン4本 re-run + 凍結 tests/knowledge-data.test.ts の挙動検証**、**decisionOutcome / topTags の不変 = 同凍結テストの挙動検証**(機械ピンなしの残余は人間レビュー — 意図的)。
  - **page.tsx のフォームに type の hidden input を追加**(tag と対称)。
  - 回帰テスト = **新ファイル tests/knowledge-recent.test.ts**(type/tag 反映・NULLS LAST とタイブレーク・既定 decision の後方互換・**LIMIT 8・status='ok'(error 行排除)・params[0] = limit の束縛形 assert**。凍結 tests/knowledge-data.test.ts は不変 — 上記 SQL 形の固定により既定経路で緑維持)。
  - 被変更側 = search-foundation 詳細 §2.4(recent = decision 固定の記述)へ追随注記。

### 2.8 fixtures(新設 — demo-org 配下・すべて匿名・実在人名不使用)
```
fixtures/cc-sier-organization/.companies/demo-org/docs/
  decisions/2026-07-01-demo-org-decision.md      (org decision — 既存 decision 契約の H1 形式・本文数行 → ok +1)
  daily-digest/2026-07-02.md                     (**前文なし**(H1 直後に最初の `##`)+ 見出し2ブロック・うち1ブロックが500字超 = **段落2つ(各 ≤500字・`\n\n` 連結後 >500字)で構成**(貪欲再結合で必ず2分割)→ **1 + 2 = チャンク3** = ok +3 — §2.1 規則から一意に導出)
  secretary/learning-notes/wbs-0-0-demo-note.md  (frontmatter date + **前文なし** + 見出し3ブロック(各500字以下)→ チャンク3 = ok +3)
  secretary/learning-notes/personality-profile-demo.md (遮断 — skipped +1)
  research/CLAUDE.md                             (遮断 — skipped +1)
  research/sub/MEMORY.md                         (遮断 — skipped +1)
```
- **遮断3ファイルの内容は固定1行 `demo fixture for deny test`**(§4-5 で内容ピン — 無害性の機械判定。実名 CLAUDE.md の自動読込は基本設計 §3 の認識済み判断)。
- **残骸チャンクの機微残存(受容明記 — rev.4)**: SSoT 側で文書が縮んだ場合、旧チャンク行(旧本文 + 埋め込み)が索引に残る — 既存マルチレコードパーサ(case-bank / quality-gate)と同一の受容済み特性。SSoT から機微文言を消しても索引に残る経路であることを認識し、消し込みが必要になったら db.md の枠(設計 + マイグレーション + 人間承認)で扱う。
- **チャンク数は §2.1 の規則から一意に導出**(上記の構造指定が正典 — run-sync.test.ts の新期待値 `ok: 13` の根拠。構造と数値が食い違う実装は §2.1 違反)。
- fixture 作成は**パスに repo 名を含むため python3 stdin で作成**(guard-write 回避 — M1 前例)。

### 2.9 被変更側注記(主セッション担当・OD-B)
- ingestion-foundation 詳細: allowlist 拡張・type 語彙 8種(0004)・knowledge の occurred_at null 許容・denylist 3パターン追加と小文字正規化・集計契約(counts 全 type)の 8化。
- search-foundation 詳細 §2.7: SC-04 に type チップ追加。
- ui-shell 詳細 §2.3: overview の 7 type 列挙が 8 type 化。

---

## 3. テスト観点

vitest・実 DB / 実ネットワークなし。**新テストは新ファイル**(tests/parsers/ 配下は凍結のため直下に新設)。

| ファイル | ケース |
|---|---|
| `tests/chunk.test.ts`(新設) | 見出し分割(h2/h3 階層パス・**h4 は分割点にならない**)/ 前文(headingPath 空)/ 500字超ブロックの**貪欲段落再結合** / 単一段落500字超の機械分割 / **同一入力2回 → 同一 Chunk 列** / フェンス内見出しで分割しない / 空文書・frontmatter のみ → [] / 全チャンク ≤ 500字 |
| `tests/knowledge-parser.test.ts`(新設) | parseKnowledge: type=knowledge・item_key `/^c\d+$/` 連番・title 結合形 / occurred_at: frontmatter `date:`(YYYY-MM-DD)→ ファイル名日付 → null(ok のまま)/ **絶対パス入力の title・body がサニタイズされる(sanitizeAbsPaths 継承)** / parseDecision の org = meta.org(ai-war-room 相当 meta では null — 回帰) |
| `tests/org-docs-sync.test.ts`(新設) | run-sync(モック source — M1 様式): docs 系 allowlist 8パターンの各マッチ / **遮断: 危険経路3種 + 小文字変種(`docs/research/claude.md`)が skipped 計上され fetch 非到達(取り込み 0 レコード)** / **冪等: 同一ファイル2回同期 → 行数不変・upsert 更新のみ**(チャンク N 行) |
| `tests/knowledge-aggregation.test.ts`(新設) | knowledge 行を含む集合で: review 集計に NaN 非出現 / overview recordsByType 8列挙順 / 週次トレンド(reward/QG)が knowledge 混入前後で同値 |
| `tests/overview-data.test.ts`・`tests/review-data.test.ts`(凍結例外) | **列挙関連 assert のみ**(7→8 の期待・コメント。追加行はすべて `knowledge`/`8 type` を含む — §4-7) |
| `tests/ingestion/run-sync.test.ts`(**第3の凍結例外** — §0 決着1) | 実 fixtures 走査の厳密件数を**設計固定の新期待値に更新**: cc-sier-organization = `ok: 13`・`error: 3`・**`skipped: 3`**(遮断3件の恒常検証を凍結テスト自身が担う形)。変更は件数オブジェクト(+必要なら docs 系レコードの存在検証追加)のみ |
| 既存テスト | 上記3件以外は**1文字も変更しない**(tests/ingestion/normalize.test.ts の describe 文言「6パターン」は陳腐化するが assert は緑のまま — 既知・放置) |

---

## 4. 受け入れ条件(機械判定)

`FROZEN_TESTS_OD`(凍結例外3件を除く全既存): `tests/proxy.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion/normalize.test.ts tests/ingestion/tag-vocab.test.ts tests/helpers tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts tests/embedding.test.ts tests/embed-index.test.ts tests/knowledge-data.test.ts tests/api-sync-embed.test.ts tests/markdown.test.ts vitest.config.ts`。

1. **0004**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0004_org_docs.up.sql || fail=1
   test -f db/migrations/0004_org_docs.down.sql || fail=1
   grep -Fq "'knowledge'" db/migrations/0004_org_docs.up.sql || fail=1
   grep -Fq "timeline_records_type_check" db/migrations/0004_org_docs.up.sql || fail=1
   grep -Fq "BEGIN;" db/migrations/0004_org_docs.up.sql || fail=1
   grep -E "DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0004_org_docs.up.sql db/migrations/0004_org_docs.down.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + Neon ブランチ検証(主セッション — §1)→ 本番適用 ask。
2. **denylist**(集計型):
   ```bash
   fail=0
   grep -Fq '"claude.md"' lib/ingestion/normalize.ts || fail=1
   grep -Fq '"memory.md"' lib/ingestion/normalize.ts || fail=1
   grep -Fq '"agents.md"' lib/ingestion/normalize.ts || fail=1
   grep -Fq 'path.toLowerCase()' lib/ingestion/normalize.ts || fail=1
   exit "$fail"
   ```
3. **チャンク・パーサ**: `test -f lib/ingestion/chunk.ts` + `grep -Fq 'CHUNK_MAX_CHARS = 500' lib/ingestion/chunk.ts` + `test -f lib/ingestion/parsers/knowledge.ts` + `grep -Fq 'sanitizeAbsPaths' lib/ingestion/parsers/knowledge.ts`(機微不変条件の継承ピン)+ `grep -Fq 'org: meta.org' lib/ingestion/parsers/decision.ts`。
4. **テスト**: `test -f` ×4(tests/chunk.test.ts / tests/knowledge-parser.test.ts / tests/org-docs-sync.test.ts / tests/knowledge-aggregation.test.ts)+ **`env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test`** exit 0。
5. **危険経路 fixture**(実在 + 無害性の内容ピン):
   ```bash
   fail=0
   for f in "fixtures/cc-sier-organization/.companies/demo-org/docs/research/CLAUDE.md" \
            "fixtures/cc-sier-organization/.companies/demo-org/docs/research/sub/MEMORY.md" \
            "fixtures/cc-sier-organization/.companies/demo-org/docs/secretary/learning-notes/personality-profile-demo.md"; do
     test -f "$f" || fail=1
     test "$(cat "$f")" = "demo fixture for deny test" || fail=1   # 全内容一致(無害性の機械判定)
   done
   exit "$fail"
   ```
6. **型追随**(集計型):
   ```bash
   fail=0
   grep -Fq '"knowledge"' lib/ingestion/parsers/types.ts || fail=1
   grep -Fq '"knowledge"' lib/data/overview.ts || fail=1
   grep -Fq '"knowledge"' lib/data/review.ts || fail=1
   grep -Fq 'occurred_at IS NOT NULL' lib/data/review.ts || fail=1
   grep -Fq '"knowledge"' "app/(shell)/retro/page.tsx" || fail=1
   grep -Fq 'ナレッジ' "app/(shell)/retro/page.tsx" || fail=1
   exit "$fail"
   ```
7. **凍結例外の差分ピン**:
   (a) overview-data / review-data(追加行はすべて knowledge / 8 type):
   ```bash
   fail=0
   git diff main -- tests/overview-data.test.ts tests/review-data.test.ts | grep '^+' | grep -v '^+++' | grep -vE 'knowledge|8 type' | grep -q . && fail=1
   exit "$fail"
   ```
   (b) run-sync.test.ts(設計固定の新期待値):
   ```bash
   fail=0
   grep -Fq 'ok: 13' tests/ingestion/run-sync.test.ts || fail=1
   grep -Fq 'error: 3' tests/ingestion/run-sync.test.ts || fail=1
   grep -Fq 'skipped: 3' tests/ingestion/run-sync.test.ts || fail=1
   exit "$fail"
   ```
   (削除行・その他の妥当性は人間レビュー — 意図的例外 §0-1。)
8. **検索拡張(OD-B・rev.5 改訂)**: `grep -Fq '{ value: "knowledge", label: "ナレッジ" }' "app/(shell)/knowledge/page.tsx"` + `grep -Fq '{ value: "all", label: "すべて" }' "app/(shell)/knowledge/page.tsx"` + `grep -Fq "requireUser" "app/(shell)/knowledge/page.tsx"`。
   **rev.5/6 追加(OD-FIX)**: `grep -Fq 'recentRecords' lib/data/knowledge.ts` / `grep -Fq 'ORDER BY occurred_at DESC NULLS LAST, id' lib/data/knowledge.ts`(タイブレーク込み全文)/ `grep -Fq 'name="type"' "app/(shell)/knowledge/page.tsx"`(hidden input)/ `grep -Fq '最近のナレッジ' "app/(shell)/knowledge/page.tsx"`(ラベル追随)/ `test -f tests/knowledge-recent.test.ts` / **M2 由来の検索 SQL ピン(search-foundation 詳細 §4-4 の4本)re-run exit 0**(searchKnowledge 不変の担保 — diff 0 ピンの代替)。
9. **凍結・退行**:
   `git diff --exit-code main -- lib/search lib/ui components lib/ingestion/github-source.ts lib/ingestion/fixture-source.ts lib/ingestion/source.ts lib/ingestion/store.ts lib/ingestion/tag-vocab.ts db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql db/migrations/0003_search_foundation.up.sql db/migrations/0003_search_foundation.down.sql lib/auth lib/db.ts proxy.ts app/api app/login app/auth app/logout next.config.mjs tsconfig.json package.json package-lock.json scripts "app/(shell)/page.tsx" "app/(shell)/layout.tsx" "app/(shell)/template.tsx" "app/(shell)/today" "app/(shell)/capture" "app/(shell)/admin" app/globals.css app/layout.tsx` exit 0 /
   (**rev.6: lib/data/knowledge.ts は凍結リストから除外** — OD-FIX の可変対象。不変担保は §2.7 rev.5/6 の代替ピンと凍結テスト)/
   `git diff --exit-code main -- <FROZEN_TESTS_OD>` exit 0 /
   **fixtures は追加のみ**(fail-closed 形): `out=$(git -c diff.renames=false diff --name-status main -- fixtures) || fail=1; printf '%s' "$out" | grep -v '^A' | grep -q . && fail=1`(M/D/R すべて捕捉・git 失敗も fail)/
   `bash scripts/check-no-secrets.sh` exit 0 / M1 条件8(SSoT ホスト)再実行 exit 0。
10. **ビルド・実機**: build = ui-shell 詳細 §4 条件5 相当(ダミー env・exit 0)。実機 = 同 §4 条件2 の手順(fixture env)で未認証 `/knowledge` → 307・`/retro` → 307(**認証境界のみの判定** — 集計退行は条件4 が担う)。
11. **注記**: `grep -q "org-docs-ingestion" docs/design/detail/ingestion-foundation.md` / 同 `docs/design/detail/search-foundation.md` / 同 `docs/design/detail/ui-shell.md` 各 exit 0。

**手動確認チェックリスト**(機械判定外 — 基本設計 §5-7 を継承): 前提 = 条件4 の遮断テスト緑 + OD-A judge PASS。実同期(実行 = Claude・ユーザー指示)→ **digest 目視(直近1 + 無作為2以上・機微引用なし確認)** → embed-local remaining=0 → /knowledge「ナレッジ」チップで learning-note ヒット・「最近の判断」に組織 decision。新 org 追加時は docs 配下を検分(恒常)。

---

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal OD-A「取り込み基盤」(先行)
- **対象設計**: docs/design/detail/org-docs-ingestion.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **1〜7, 9** が exit 0 + **条件10 の build 部分**。
- **成果物**: 0004 up/down(+ ローカル db 適用・Neon ブランチ検証は主セッション)/ chunk.ts / parsers/knowledge.ts / decision.ts の org / normalize denylist / run-sync allowlist / overview・review・retro の 8型追随 / fixtures 新設 / 新テスト4ファイル + 凍結例外3テストの更新(§3)。
- **executor**: ingestion-engineer。**ターン上限**: 30。**節目 commit**: (a) chunk + parsers + テスト緑 (b) allowlist + denylist + 集計追随 + 0004 + **build 緑**。
- ※ knowledge/page.tsx は触らない(OD-B)。実 API キー・実ネットワーク禁止。
### /goal OD-B「検索 UI + 注記」(OD-A 後)
- **対象設計**: 本書。
- **達成状態**: 条件 **8, 10(実機含む), 11** が exit 0 + **条件 1〜7, 9 再実行**緑。
- **成果物**: knowledge/page.tsx の type チップ / 注記3件(主セッション — §2.9)。
- **executor**: frontend-engineer(画面)+ 主セッション(注記)。**ターン上限**: 15。**節目 commit**: (a) チップ + build 緑 (b) 実機確認緑。
- 実データ手順(§4 手動チェックリスト)は OD-B 完了後にユーザー指示で実施。

### /goal OD-FIX「recent 経路の type/tag 反映」(OD-B 後の修正 goal — rev.5/6)
- **対象設計**: 本書 §2.7 rev.5/6。
- **達成状態**: 条件 **8(rev.5/6 追加ピン込み)** + **条件4(npm test — tests/knowledge-recent.test.ts 込み)** + **条件9(rev.6 改訂後リスト)** が exit 0 + build exit 0 + 実機 未認証 `/knowledge` 307。
- **成果物**: lib/data/knowledge.ts(recentRecords 置換のみ)/ app/(shell)/knowledge/page.tsx(hidden type input・**全リンクの q/tag/sel/type 相互保持**・見出しラベル追随)/ tests/knowledge-recent.test.ts(不正 type → 既定 decision のケース含む)。
- **executor**: frontend-engineer。**ターン上限**: 15。**節目 commit**: 1回(fix + テスト + build 緑)。judge = acceptance-judge(独立)。

### /goal OD-DEC「組織 decision の H1 フォールバック」(rev.8)
- **対象設計**: 本書 §2.3 rev.8。
- **達成状態**: `test -f tests/decision-fallback.test.ts` + `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test` exit 0(**凍結 tests/parsers/decision.test.ts が無変更で緑**)+ **git diff の変更対象が lib/ingestion/parsers/decision.ts と tests/decision-fallback.test.ts の2ファイルのみ**(git diff --stat main で判定)+ build exit 0。
- **成果物**: decision.ts のフォールバック分岐 / tests/decision-fallback.test.ts。fixtures・他ファイルは不変。
- **executor**: ingestion-engineer。**ターン上限**: 10。**節目 commit**: 1回。judge = acceptance-judge(独立)。

### 共通の禁止事項
- **凍結対象の変更禁止**(条件9 の diff リスト + FROZEN_TESTS_OD)。凍結例外は3テストの §3 記載範囲のみ(条件7 のピン + 人間レビュー)。新規依存禁止。
- `.env` 書き込み禁止 / `.claude/`・hooks 変更禁止 / tsconfig 変更禁止 / SSoT 非接触(fixture のみ)/ 実ネットワークをテストに持ち込まない。
- `api.github.com` / `raw.githubusercontent.com`(github-source.ts 以外)/ `dangerouslySetInnerHTML` / `as TokenColor` / モデル名・埋め込み URL リテラル(embedding.ts 以外)を書かない。
- **作成経路**: 0004(DROP CONSTRAINT 行)は **Write ツール**・fixtures(パスに repo 名)は **python3 stdin**(bash heredoc/echo は guard に遮断 — 前例)。ローカル 0004 適用は `< ファイル` リダイレクト形。コミットメッセージに破壊 SQL リテラルを書かない。
- 生 DROP TABLE / TRUNCATE / DELETE 禁止(0004 は本書 §1 の定義のみ・適用は人間承認)。
- 凍結例外3テストの変更に無関係な整形・リネームを持ち込まない(条件7 のピンを崩さない)。

---

## 次の手順

`/design-review org-docs-ingestion`(detail 再レビュー)→ 全レンズ PASS → `/goal OD-A` → `/goal OD-B`。
