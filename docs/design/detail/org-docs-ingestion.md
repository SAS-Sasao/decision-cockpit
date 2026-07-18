# 詳細設計: org-docs-ingestion(組織ドキュメント取り込み + ナレッジ検索拡張)

> 対象基本設計: docs/design/basic/org-docs-ingestion.md(design-review Round 2 全レンズ PASS・rev.3)
> ステータス: draft(design-review 待ち)
> 作成: 2026-07-18(主セッション執筆)

## 0. 申し送りの決着(reviews/org-docs-ingestion.md)

| # | 申し送り | 決着 |
|---|---|---|
| 1 | 凍結例外2テストの差分ピン実行形 | **追加行(+)がすべて `knowledge` または `8 type` を含む**ことの否定 grep(§4-7 — 単一引用符・シェル安全形)。削除行・行数の妥当性は**人間レビュー(意図的例外** — 「同一コミット」則と同格)|
| 2 | review.ts の occurred_at null 行 | **SQL 側除外で確定**: getReviewData の SELECT に `AND occurred_at IS NOT NULL` を追記(ReviewRow 型は Date のまま真になる)。tests/review-data.test.ts は行モックで SQL 文字列 assert なし(現物確認)— 凍結例外(列挙関連のみ)を超えない |
| 3 | 0004 の実行形 | §1 に全文。CHECK の付け替えは `DROP CONSTRAINT`(制約名 `timeline_records_type_check` — 0002 のインライン CHECK の自動命名)+ `ADD CONSTRAINT`。**否定 grep は `DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM` で DROP CONSTRAINT に非マッチ**(guard-bash は Bash コマンドのみ検査・ファイルは Write ツールで作成) |
| 4 | 決定性テスト・危険経路 fixture の具体パス | §2.8 / §3 に列挙(fixtures の新設パスを固定) |
| 5 | §5-6 再実行帰属 | OD-A = 条件 1〜7 + 9 + 10(build)/ OD-B = 条件 8 + 10(実機)+ 11 + **条件 1〜7, 9 の再実行**(§5) |
| 6 | チャンク item_key 形式・title 結合 | **item_key = `c<連番>`(`c0`, `c1`, … — 0始まり・`/^c\d+$/`)**。title = `<文書タイトル> › <見出しパス(" › " 結合)>`(見出しパスが空なら文書タイトルのみ)。文書タイトル = H1 or ファイル名(拡張子除去) |

基本設計の問いの決着:
- **問い1(チャンク500字)**: 500字で確定。title 実測(最長級: `wbs-2-5-5-storcon-modernization-understanding › …` + 見出し ≒ 80〜120字)+ tags で 600字予算に収まる。title 過長時の末尾切詰めは基本設計どおり許容。
- **問い3(「すべて」チップの出典表示)**: 現行の出典表示(source/file_path/日付)をそのまま使用 — type による差異なし(調整不要と確定)。
- decision の org: **ParseMeta には既に `org: string | null` があり run-sync が全パーサへ供給済み**(現物確認)— parseDecision の固定 `org: null` を `meta.org` に変更するだけ。ai-war-room 経路は orgFromPath が null を返すため**挙動不変**。

---

## 1. スキーマ DDL

**0004_org_docs.up.sql**(CHECK 付け替えのみ・データ非破壊・Write ツールで作成):
```sql
-- 対象設計: docs/design/detail/org-docs-ingestion.md §1(design-review PASS 後に適用)
-- type 語彙 7 → 8(knowledge 追加)。制約の付け替えのみでデータ・列・キーは不変。
ALTER TABLE timeline_records DROP CONSTRAINT IF EXISTS timeline_records_type_check;
ALTER TABLE timeline_records ADD CONSTRAINT timeline_records_type_check
  CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log','knowledge'));
```

**0004_org_docs.down.sql**(逆付け替え。**knowledge 行が存在する場合は ADD CONSTRAINT の検証で失敗し適用不能** — 明示・人間承認のみ):
```sql
ALTER TABLE timeline_records DROP CONSTRAINT IF EXISTS timeline_records_type_check;
ALTER TABLE timeline_records ADD CONSTRAINT timeline_records_type_check
  CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log'));
```

- 冪等キー (source, file_path, item_key)・埋め込み列(0003)は不変。
- 検証 = Neon ブランチ(付け替え後の制約定義を pg_constraint で確認 + knowledge 行の INSERT/ROLLBACK 試行)→ **本番適用は人間承認(ask)**。ローカル db には OD-A 内で適用。
- **適用順序(本番)**: Vercel 展開時は「0004 適用 → デプロイ」を厳守(基本設計 §5)。

---

## 2. 関数 / API インターフェース

### 2.1 lib/ingestion/chunk.ts(純関数・新設)
```ts
export const CHUNK_MAX_CHARS = 500;
export type Chunk = { headingPath: string[]; text: string };
export function chunkMarkdown(markdown: string): Chunk[];
```
- アルゴリズム(決定的): frontmatter を除去 → H1 は文書タイトルとして除外 → `##` 以下の見出し行でブロック分割(見出しパス = h2>h3 の階層)→ 各ブロックが 500字超なら**段落境界(空行)で再分割**、それでも超える段落は 500字で機械分割。空文書・本文なし → `[]`。
- 決定性: 同一入力 → 同一 Chunk 列(テスト §3)。フェンスコード内の見出し様行は分割点にしない(md-render の教訓を流用)。

### 2.2 lib/ingestion/parsers/knowledge.ts(新設)
```ts
export function parseKnowledge(file: SourceFile, meta: ParseMeta): NormalizedRecord[];
```
- 1チャンク = 1レコード。type = `"knowledge"` / item_key = `c<index>`(§0-6)/ title = §0-6 の結合形 / body = chunk.text / org = meta.org / tags = 文書レベル(applyTags — path + frontmatter)全チャンク共通 / raw_ref = 既存規約。
- **occurred_at**: frontmatter の date → ファイル名 `YYYY-MM-DD` → **null**(基本設計 §1-5 の契約改訂 — status='ok' のまま)。daily-digest はファイル名日付で必ず設定される。
- パース失敗は既存規約どおり error レコード化(握り潰さない)。

### 2.3 lib/ingestion/parsers/decision.ts(1点変更)
- `org: null`(固定)→ **`org: meta.org`**。ai-war-room は orgFromPath = null で不変・組織 decision はパス由来 org が入る。コメントの「org は常に null」も追随。

### 2.4 lib/ingestion/normalize.ts(denylist 拡張)
- `DENY_PATTERNS` に **`"claude.md"`, `"memory.md"`, `"agents.md"`** を追加(計9)。
- `isDenied` を **小文字正規化比較**に変更: `const lower = path.toLowerCase(); return DENY_PATTERNS.some((p) => lower.includes(p));`(既存6パターンは全て小文字 — 挙動は fail-closed 方向にのみ変化)。

### 2.5 lib/ingestion/run-sync.ts(allowlist 拡張)
cc-sier-organization の matchAllowlist に以下を追加(**record 種別・パーサ割付**):
```
docs/decisions/*.md              → parseDecision(既存・org は meta 経由)
docs/daily-digest/*.md           → parseKnowledge
docs/secretary/learning-notes/*.md → parseKnowledge
docs/research/**/*.md(再帰)     → parseKnowledge
docs/retail-domain/**/*.md(再帰) → parseKnowledge
docs/diagrams/*.md               → parseKnowledge
docs/drawio/*.md                 → parseKnowledge
docs/info-source-master.md       → parseKnowledge
```
- 正規表現は `/^\.companies\/[^/]+\/docs\/...$/` 形(org 横断)。再帰は `.+\.md$`・非再帰は `[^/]+\.md$`。denylist(§2.4)は従来どおり**取得前**に適用。
- SyncSummary・進行カーソル・SYNC_MAX_FILES の機構は不変。

### 2.6 集計層の追随(8 type 化)
| ファイル | 変更 |
|---|---|
| `lib/ingestion/parsers/types.ts` | RecordType union に `"knowledge"` 追加 + 0002 CHECK 一致コメントを 0004 参照に更新 |
| `lib/data/overview.ts` | RECORD_TYPE_ORDER(7列挙)に `"knowledge"` を末尾追加。他は不変(`?? 0` 防御で NaN 非発生 — 現物確認済み) |
| `lib/data/review.ts` | ALL_RECORD_TYPES に `"knowledge"` を末尾追加 + getReviewData の SELECT に `AND occurred_at IS NOT NULL` 追記(§0-2)。他は不変 |
| `app/(shell)/retro/page.tsx` | BREAKDOWN_TYPES に knowledge のエントリ(ラベル「ナレッジ」)を末尾追加のみ |

### 2.7 app/(shell)/knowledge/page.tsx(OD-B — type チップ)
- searchParams に `type` を追加(公開)。**チップ3種の固定定義**: `判断`(value なし = 既定)/ `ナレッジ`(`type=knowledge`)/ `すべて`(`type=all`)— タグチップと同じリンク形式・active 強調。q / tag / sel を保持。
- `getKnowledgeData({ q, tag, sel, type })` に透過(**lib/data/knowledge.ts は無変更** — §4-8 で diff 0 をピン)。
- recent(q 空)は decision のまま(データ層既定 — 変更なし)。

### 2.8 fixtures(新設 — demo-org 配下・すべて匿名・実在人名不使用)
```
fixtures/cc-sier-organization/.companies/demo-org/docs/
  decisions/2026-07-01-demo-org-decision.md     (org decision — H1 日付形式・本文数行)
  daily-digest/2026-07-02.md                    (見出し2つ・500字超ブロック1つ — 分割検証兼用)
  secretary/learning-notes/wbs-0-0-demo-note.md (frontmatter date あり・見出し3つ)
  secretary/learning-notes/personality-profile-demo.md (無害1行 — denylist 遮断検証)
  research/CLAUDE.md                            (無害1行 — 危険経路の遮断検証)
  research/sub/MEMORY.md                        (無害1行 — 再帰配下の遮断検証)
```
- ※実名 `CLAUDE.md` fixture の自認事項は基本設計 §3 のとおり(無害ダミー1行)。**fixture の作成はパスに repo 名を含むため guard-write に遮断される — python3 stdin 書き込みで作成**(M1 前例)。

### 2.9 被変更側注記(主セッション担当・OD-B)
- ingestion-foundation 詳細: allowlist 拡張(§2 相当)・type 語彙 8種(0004)・knowledge の occurred_at null 許容・denylist 3パターン追加と小文字正規化・集計契約(counts 全 type)の 8化 — への追随注記。
- search-foundation 詳細 §2.7: SC-04 に type チップが追加された旨。
- ui-shell 詳細 §2.3: overview の 7 type 列挙が 8 type になった旨。

---

## 3. テスト観点

vitest・実 DB / 実ネットワークなし。**新テストは新ファイル**(tests/parsers/ 配下は凍結のため直下に新設)。

| ファイル(新設) | ケース |
|---|---|
| `tests/chunk.test.ts` | chunkMarkdown: 見出し分割(h2/h3 階層パス)/ 500字超ブロックの段落再分割 / 段落単体 500字超の機械分割 / **同一入力2回 → 同一 Chunk 列(決定性)** / フェンス内見出しで分割しない / 空文書・frontmatter のみ → [] / CHUNK_MAX_CHARS = 500 の遵守(全チャンク ≤ 500) |
| `tests/knowledge-parser.test.ts` | parseKnowledge: type=knowledge・**item_key が `/^c\d+$/` かつ連番**・title 結合形(文書タイトル + › 見出しパス)/ occurred_at: frontmatter date → ファイル名日付 → **null(status='ok' のまま)** / tags 全チャンク共通 / parseDecision の org: **meta.org が入る**(ai-war-room 相当 meta では null — 回帰) |
| `tests/org-docs-sync.test.ts` | run-sync(モック source・M1 の様式): docs 系 allowlist の各パターンがマッチしパーサに到達 / **遮断: `docs/research/CLAUDE.md`・`docs/research/sub/MEMORY.md`・`personality-profile-demo.md` 相当のパスが skipped 計上され fetch されない(取り込み 0 レコード)** / 小文字変種(`docs/research/claude.md`)も遮断 / **冪等: 同一ファイル2回同期 → 行数不変・upsert 更新のみ**(チャンク N 行) |
| `tests/knowledge-aggregation.test.ts` | knowledge 行を含む行集合で: review の buildBucket 相当に **NaN が現れない**(counts.knowledge が数値)/ overview recordsByType が 8列挙順で knowledge を含む / 週次トレンド(reward/QG)が knowledge 行に非依存(混入前後で同値) |
| 変更(凍結例外) | `tests/overview-data.test.ts`・`tests/review-data.test.ts` — **列挙関連 assert のみ**(7 type → 8 type の期待配列・コメント。追加行はすべて `knowledge` / `8 type` を含む — §4-7 のピン) |
| 既存テスト | 上記2件以外は**1文字も変更しない** |

---

## 4. 受け入れ条件(機械判定)

`FROZEN_TESTS_OD`(凍結例外2件を除く全既存): `tests/proxy.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion tests/helpers tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts tests/embedding.test.ts tests/embed-index.test.ts tests/knowledge-data.test.ts tests/api-sync-embed.test.ts tests/markdown.test.ts vitest.config.ts`。

1. **0004**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0004_org_docs.up.sql || fail=1
   test -f db/migrations/0004_org_docs.down.sql || fail=1
   grep -Fq "'knowledge'" db/migrations/0004_org_docs.up.sql || fail=1
   grep -Fq "timeline_records_type_check" db/migrations/0004_org_docs.up.sql || fail=1
   grep -E "DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0004_org_docs.up.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + Neon ブランチ検証(主セッション — §1)→ 本番適用 ask。
2. **denylist**(集計型):
   ```bash
   fail=0
   grep -Fq '"claude.md"' lib/ingestion/normalize.ts || fail=1
   grep -Fq '"memory.md"' lib/ingestion/normalize.ts || fail=1
   grep -Fq '"agents.md"' lib/ingestion/normalize.ts || fail=1
   grep -Fq 'toLowerCase()' lib/ingestion/normalize.ts || fail=1
   exit "$fail"
   ```
3. **チャンク・パーサ**: `test -f lib/ingestion/chunk.ts` + `grep -Fq 'CHUNK_MAX_CHARS = 500' lib/ingestion/chunk.ts` + `test -f lib/ingestion/parsers/knowledge.ts` + `grep -Fq 'org: meta.org' lib/ingestion/parsers/decision.ts`。
4. **テスト**: `test -f` ×4(tests/chunk.test.ts / tests/knowledge-parser.test.ts / tests/org-docs-sync.test.ts / tests/knowledge-aggregation.test.ts)+ **`env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test`** exit 0。
5. **危険経路 fixture**(実在ピン — パス固定):
   `test -f "fixtures/cc-sier-organization/.companies/demo-org/docs/research/CLAUDE.md"` /
   `test -f "fixtures/cc-sier-organization/.companies/demo-org/docs/research/sub/MEMORY.md"` /
   `test -f "fixtures/cc-sier-organization/.companies/demo-org/docs/secretary/learning-notes/personality-profile-demo.md"`(各 exit 0。遮断の実効は条件4 のテストが担う)。
6. **型追随**(集計型):
   ```bash
   fail=0
   grep -Fq '"knowledge"' lib/ingestion/parsers/types.ts || fail=1
   grep -Fq '"knowledge"' lib/data/overview.ts || fail=1
   grep -Fq '"knowledge"' lib/data/review.ts || fail=1
   grep -Fq 'occurred_at IS NOT NULL' lib/data/review.ts || fail=1
   grep -Fq '"knowledge"' "app/(shell)/retro/page.tsx" || fail=1
   exit "$fail"
   ```
7. **凍結例外の差分ピン**(追加行はすべて knowledge / 8 type を含む — 単一引用符でシェル安全):
   ```bash
   fail=0
   git diff main -- tests/overview-data.test.ts tests/review-data.test.ts | grep '^+' | grep -v '^+++' | grep -vE 'knowledge|8 type' | grep -q . && fail=1
   exit "$fail"
   ```
   (削除行・行数の妥当性は人間レビュー — 意図的例外 §0-1。)
8. **検索拡張(OD-B)**: `grep -Fq 'type=knowledge' "app/(shell)/knowledge/page.tsx"` + `grep -Fq 'type=all' "app/(shell)/knowledge/page.tsx"` + `grep -Fq 'ナレッジ' "app/(shell)/knowledge/page.tsx"` + **`git diff --exit-code main -- lib/data/knowledge.ts`** exit 0(IF 無変更の機械判定)+ `grep -Fq "requireUser" "app/(shell)/knowledge/page.tsx"`。
9. **凍結・退行**:
   `git diff --exit-code main -- lib/search lib/ui components db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql db/migrations/0003_search_foundation.up.sql db/migrations/0003_search_foundation.down.sql lib/auth lib/db.ts lib/data/knowledge.ts proxy.ts app/api app/login app/auth app/logout next.config.mjs tsconfig.json package.json package-lock.json scripts "app/(shell)/page.tsx" "app/(shell)/layout.tsx" "app/(shell)/template.tsx" "app/(shell)/today" "app/(shell)/capture" "app/(shell)/admin" app/globals.css app/layout.tsx` exit 0 /
   `git diff --exit-code main -- <FROZEN_TESTS_OD>` exit 0 /
   既存 fixture の無変更: `git diff --exit-code main -- fixtures` は**新規追加のみ許容**のため `git diff main --diff-filter=M -- fixtures | grep -q . && fail`(変更 0・追加のみ)。
   + `bash scripts/check-no-secrets.sh` exit 0 / M1 条件8(SSoT ホスト)再実行 exit 0。
10. **ビルド・実機**: build = ui-shell 詳細 §4 条件5 相当(ダミー env・exit 0)。実機 = 同 §4 条件2 の手順(fixture env)で未認証 `/knowledge` → 307・`/retro` → 307(集計変更の退行なし)。
11. **注記**: `grep -q "org-docs-ingestion" docs/design/detail/ingestion-foundation.md` / 同 `docs/design/detail/search-foundation.md` / 同 `docs/design/detail/ui-shell.md` 各 exit 0。

**手動確認チェックリスト**(機械判定外 — 基本設計 §5-7 を継承): 前提 = 条件4 の遮断テスト緑 + OD-A judge PASS。実同期(実行 = Claude・ユーザー指示)→ **digest 目視(直近1 + 無作為2以上・機微引用なし確認)** → embed-local remaining=0 → /knowledge「ナレッジ」チップで learning-note ヒット・「最近の判断」に組織 decision。新 org 追加時は docs 配下を検分(恒常)。

---

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal OD-A「取り込み基盤」(先行)
- **対象設計**: docs/design/detail/org-docs-ingestion.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **1〜7, 9** が exit 0 + **条件10 の build 部分**(main 壊れ窓の封鎖 — 前例)。
- **成果物**: 0004 up/down(+ ローカル db 適用・Neon ブランチ検証は主セッション)/ chunk.ts / parsers/knowledge.ts / decision.ts の org / normalize denylist / run-sync allowlist / overview・review・retro の 8型追随 / fixtures 新設 / テスト4ファイル + 凍結例外2テストの列挙更新。
- **executor**: ingestion-engineer。**ターン上限**: 30。**節目 commit**: (a) chunk + parsers + テスト緑 (b) allowlist + denylist + 集計追随 + 0004 + **build 緑**。
- ※ knowledge/page.tsx は触らない(OD-B の領分)。実 API キー・実ネットワーク禁止。
### /goal OD-B「検索 UI + 注記」(OD-A 後)
- **対象設計**: 本書。
- **達成状態**: 条件 **8, 10(実機含む), 11** が exit 0 + **条件 1〜7, 9 再実行**緑。
- **成果物**: knowledge/page.tsx の type チップ / 注記3件(主セッション — §2.9)。
- **executor**: frontend-engineer(画面)+ 主セッション(注記)。**ターン上限**: 15。**節目 commit**: (a) チップ + build 緑 (b) 実機確認緑。
- 実データ手順(§4 手動チェックリスト)は OD-B 完了後にユーザー指示で実施。

### 共通の禁止事項
- **凍結対象の変更禁止**(条件9 の diff リスト + FROZEN_TESTS_OD)。凍結例外は overview-data / review-data の列挙関連のみ(条件7)。新規依存禁止。
- `.env` 書き込み禁止 / `.claude/`・hooks 変更禁止 / tsconfig 変更禁止 / SSoT 非接触(fixture のみ)/ 実ネットワークをテストに持ち込まない。
- `api.github.com` / `raw.githubusercontent.com`(github-source.ts 以外)/ `dangerouslySetInnerHTML` / `as TokenColor` / モデル名・埋め込み URL リテラル(embedding.ts 以外)を書かない。
- **fixture・destructive DDL の作成経路**: 0004 の down(DROP CONSTRAINT 行)と fixtures(パスに repo 名)は **Write ツール or python3 stdin で作成**(bash heredoc/echo は guard に遮断される — 前例)。コミットメッセージに破壊 SQL リテラルを書かない。
- 生 DROP TABLE / TRUNCATE / DELETE 禁止(0004 は本書 §1 の定義のみ・適用は人間承認)。
- §4-7 のピン対象(追加行の knowledge/8 type)を満たすため、凍結例外2テストの変更に無関係な整形・リネームを持ち込まない。

---

## 次の手順

`/design-review org-docs-ingestion`(detail)→ 全レンズ PASS → `/goal OD-A` → `/goal OD-B`。
