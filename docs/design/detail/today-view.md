# 詳細設計: today-view(M3 今日ビュー — SC-03・WBS kanban)

> 対象基本設計: docs/design/basic/today-view.md(design-review Round 2 全レンズ PASS・rev.3)
> ステータス: rev.3(詳細 Round 2(arch Med: §3 の rev.1 残骸)反映済み → arch 最終確認待ち。data は Round 2 PASS)
> 作成: 2026-07-18(主セッション執筆)

## 0. 申し送りの決着(reviews/today-view.md)

| # | 申し送り | 決着 |
|---|---|---|
| 1 | 世代フィルタの SQL 実行形・索引 | §2.4 に固定表記(`array_agg(commit ORDER BY synced_at DESC, commit DESC)` — max(synced_at) 行の commit を世代代表・辞書順タイブレーク)。**(file_path, synced_at) 索引は採用**(§1) |
| 2 | run-sync.test 件数ピンの不変 | **rev.2 改訂: tests/ingestion/run-sync.test.ts を凍結例外に編入**(R1 で3レンズが同一検出 — 同テストの `vi.mock` store factory は既存5関数のみで、store.ts への `upsertBoardItems` 追加 + 実 fixtures 全量走査により「モックに無い export」エラーで赤になる。件数ピン(ok:13 等)・toMatchObject の非波及論拠は正しいが**モック契約の次元**が第3の破壊経路)。変更範囲 = **モック factory へ `upsertBoardItems: vi.fn()` の追加(+任意で board フィールドの assert)のみ** — 差分ピン §4-3b(追加行はすべて `upsertBoardItems` か `board` を含む)+ 件数ピン(ok:13/error:3/skipped:3)の**不変 grep 維持**。FROZEN_TESTS_M3 の `tests/ingestion` は normalize / tag-vocab の個別列挙に変更 |
| 3 | board フィールドの型位置 | **RepoSyncSummary(repo 別)に必須フィールド** `board: { files: number; items: number; skippedRows: number }`(全 repo で常に存在 — ai-war-room は全て 0)。/api/sync 応答・sync_state.last_summary へは既存経路で自然に流れる(加法拡張・読み手なしを基本設計 R2 で現物確認済み) |
| 4 | mutation 経路否定チェック | **採用**: `grep -RIn '"use server"' "app/(shell)/today"` exit 1(§4-5) |
| 5 | 完了列上限・並び順・3列 grep | 完了列 = **直近 8 件**(synced_at 世代内で item_key 降順は意味が無いため **WBS ID 文字列降順**)。todo/doing 列 = **WBS ID 文字列昇順**(数値階層ソートはしない — 宣言)。3列は **BOARD_COLUMNS 配列リテラルのピン**(§4-5 — 「レビュー」の否定 grep は本文語と誤爆するため不採用) |
| 6 | FROZEN_TESTS 全列挙 | §4 冒頭(前 goal までの全テストファイル + helpers + vitest.config.ts。**rev.2: 凍結例外 = tests/ingestion/run-sync.test.ts のみ** — §0-2) |

基本設計の問いの決着:
- **問い1(完了列 N・並び順)**: 上記 #5。
- **問い2(複数 WBS ファイル)**: **ファイル横断で1つの kanban に合流**(v1 — file_path はキーとして共存。スイムレーン分割は実利用後)。
- **問い5(鮮度提示)**: サマリ帯の下に**最終同期の注記1行**(lastSync は既存 getLastSync を再利用 — layout と同一データ。ファイル単位の commit 日付表示は見送り)。
- **問い6(セクションのスイムレーン)**: 見送り(カードに section をテキスト表示するのみ)。

---

## 1. スキーマ DDL

**0005_today_board.up.sql**(新テーブルのみ・既存テーブル不変・Write ツールで作成):
```sql
-- 対象設計: docs/design/detail/today-view.md §1(design-review PASS 後に適用)
CREATE TABLE IF NOT EXISTS board_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  file_path    text NOT NULL,
  item_key     text NOT NULL,               -- WBS ID(冪等キーの一部)
  commit       text NOT NULL,               -- 世代識別子(基本設計 §1-2)
  title        text NOT NULL,
  assignee     text,
  period       text,
  deliverable  text,
  iter         text,
  pri          text,
  task_type    text,
  issue_ref    text,
  state        text NOT NULL CHECK (state IN ('todo','doing','done')),
  org          text,
  section      text,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, file_path, item_key)
);
CREATE INDEX IF NOT EXISTS board_items_state_idx ON board_items (state);
CREATE INDEX IF NOT EXISTS board_items_org_idx ON board_items (org);
CREATE INDEX IF NOT EXISTS board_items_file_synced_idx ON board_items (file_path, synced_at);
```

**0005_today_board.down.sql**(テーブル削除 — 設計明示・人間承認のみ。Write ツールで作成):
```sql
DROP TABLE IF EXISTS board_items;
```

- 検証 = Neon ブランチ(テーブル・UNIQUE・CHECK・索引3本の実在確認 + INSERT/ROLLBACK 試行)→ **本番適用は ask**。ローカル db は M3-A 内で `psql < ファイル` リダイレクト形で適用。
- timeline_records・既存テーブルは不変。

## 2. 関数 / API インターフェース

### 2.1 lib/ingestion/parsers/board.ts(新設)
```ts
export type BoardItem = {
  itemKey: string;                // WBS ID(trim 済み・非空)
  title: string;
  assignee: string | null; period: string | null; deliverable: string | null;
  iter: string | null; pri: string | null; taskType: string | null; issueRef: string | null;
  state: "todo" | "doing" | "done";
  section: string | null;         // 直近の ##/### 見出しテキスト
};
export function parseBoard(file: SourceFile): { items: BoardItem[]; skippedRows: number };
```
- **列同定 = ヘッダ名ベース**(md テーブルのヘッダ行から「WBS」「タスク」「担当」「期間」「成果物」「Iter」「Pri」「Type」「Issue」「ステータス」の列位置を解決 — 並び替え・列追加に頑健)。**一致規則(rev.2 確定): ヘッダセルの trim 後・完全一致**(部分一致はしない — 「WBS番号」等は不一致)。**同名セルが複数ある場合は先勝ち**。**対象テーブル = ヘッダに「WBS」と「ステータス」を両方含むもののみ**(それ以外の表(マイルストーン表等)・地の文は対象外 = skippedRows 非計上)。**必須列 = WBS・タスク・ステータス**(欠けるテーブルは対象外)。
- 状態写像: セル値を trim して **`[ ]` / `[~]` / `[x]` の完全一致のみ** → todo / doing / done。
- **skippedRows 計上(対象テーブル内の不正行のみ・1行 = 1計上(最初に該当したカテゴリ))**: 状態3値外 / WBS ID 空 / **同一ファイル内の重複 WBS ID の2件目以降(行順 — 重複判定の seen 集合には有効行として採用した ID のみを登録・スキップ行の ID は登録しない)** / **必須セル欠落(= 列数不足 or 必須列(WBS/タスク/ステータス)のセルが trim 後空)**。ヘッダ行・区切り行(`|---|`)は行としてカウントしない。
- sanitizeAbsPaths を **title / assignee / period / deliverable / section / issueRef** に適用(iter / pri / taskType は制約的な短値だが同様に適用して良い — 実装裁量)。
- 決定的(同一入力 → 同一出力)。パース例外は投げず、解釈不能テーブルは対象外として素通し(fail-soft)。

### 2.2 store(lib/ingestion/store.ts に追加)
```ts
export async function upsertBoardItems(
  source: string, filePath: string, commit: string, org: string | null, items: BoardItem[]
): Promise<void>;
```
- 行ごとに `INSERT ... ON CONFLICT (source, file_path, item_key) DO UPDATE`(全属性列 + `commit` + `synced_at = now()` を更新)。$n 束縛のみ。

### 2.3 lib/ingestion/run-sync.ts(拡張)
- allowlist(cc-sier-organization)に **`/^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/`** → `{ kind: "board" }` を追加。
- board 分岐(masters 分岐と同型): fetch → parseBoard → upsertBoardItems → **`board.files += 1`・`board.items += items.length`・`board.skippedRows += skippedRows`** → doneSet 追加。ok/error/skipped は増やさない。
- `RepoSyncSummary` に **`board: { files: number; items: number; skippedRows: number }`** を必須追加(初期値全 0 — ai-war-room 含む全 repo に存在)。

### 2.4 lib/data/today.ts(新設・`import "server-only"`)
```ts
export type TodayCard = {
  itemKey: string; title: string; assignee: string | null; period: string | null;
  deliverable: string | null; pri: string | null; org: string | null; section: string | null;
};
export type TodayData = {
  summary: { open: number; doing: number; retryRate: number | null; rewardAvg: number | null };
  columns: { state: "todo" | "doing" | "done"; items: TodayCard[] }[];
  boardEmpty: boolean;            // board_items が 0 行(未同期)— 空状態表示用
};
export async function getTodayData(): Promise<TodayData>;
```
- **世代フィルタ SQL(固定表記 — §4-4 で grep -F ピン)**: 世代代表の選出に
  `array_agg(commit ORDER BY synced_at DESC, commit DESC)`
  を用いる(file_path ごとに GROUP BY し先頭要素 = 世代代表 commit。その (source, file_path, commit) に一致する行のみ表示 — JOIN/IN の組み立ては実装裁量・全て $n 束縛)。
- 列の並び: todo / doing = item_key 文字列昇順・done = item_key 文字列降順の**直近 8 件**(§0-5)。**世代の GROUP BY は (source, file_path)**(キー規約と対称 — 現状 board 経路は cc-sier のみだが将来の複数 source 化に備える)。**既知の制限(rev.2 明記)**: parseBoard が既存ファイルで **0 items** を返した場合(表ヘッダ変更・全行不正化)、upsert が発生せず旧世代が表示され続ける — 観測 = summary の board.files > 0 かつ items 減少(手動チェックリストに含める)。
- summary: open / doing = 世代フィルタ後の件数。retryRate / rewardAvg = timeline_records の**今週**(`weekBucketBoundaries` を lib/data/review.ts から import — 週境界の二重実装禁止。§4-4 で import ピン)集計: rewardAvg = REWARD_TYPES(task/score)の reward_score 平均・retryRate = signals 非 null 行のうち retry_detected true の率(分母 0 は null)。`WHERE status = 'ok'`・**週窓は occurred_at 列で切る**(既存規約 — review.ts と同一)。

### 2.5 app/(shell)/today/page.tsx(M3-B — プレースホルダ → SC-03)
- async Server Component・`requireUser()` 存置・`dynamic = "force-dynamic"`。データは **lib/data 層(getTodayData / getLastSync)経由のみ**(lib/db・lib/ingestion の直 import 禁止 — §4-5 grep)。
- **列定義の固定リテラル(§4-5 ピン — 1行ずつ)**:
  ```ts
  const BOARD_COLUMNS = [
    { state: "todo", label: "バックログ" },
    { state: "doing", label: "着手中" },
    { state: "done", label: "完了" },
  ];
  ```
- 構成(MoC isToday 準拠): サマリ帯×4(チップ形 — 手戻り率・平均スコアは scoreLevel 色)→ 最終同期の注記1行(getLastSync 再利用)→ **kanban 3列グリッド**(列ヘッダ = label + 件数バッジ・タスクカード = WBS ID(Mono)・タイトル・担当 pill・period・Pri・成果物・section 小字)。boardEmpty → 「WBS が未同期です(同期後に表示されます)」。
- 既存トークン・`.panel` 再利用。チャート部品・状態変更 UI なし。

### 2.6 被変更側注記(主セッション担当・M3-B — **各注記本文に `today-view` のリテラルを含める**(条件8 の grep ゲートの前提))
- ingestion-foundation 詳細: allowlist 追加・AllowMatch "board"・RepoSyncSummary の board フィールド。
- ui-shell 詳細 §2.5: today プレースホルダの実装化。
- **screen-design: §7.2 に読み替え項目を追加(正)+ §5 SC-03 に §7.2 へのポインタ注記**(基本設計 §読み替え5)。

### 2.7 fixtures(新設 — 完全創作・実名/実案件名不使用)
```
fixtures/cc-sier-organization/.companies/demo-org/docs/secretary/demo-plan-wbs.md
```
- 内容(設計固定 — テスト期待値の根拠): frontmatter なし・見出し2つ(section 検証)・**対象テーブル1つ**(ヘッダ10列)に **有効行4**(todo 2 / doing 1 / done 1)+ **スキップ行4(先勝ち計上で各行1計上 — skippedRows:4 の一意導出。空 ID 行は必須欠落にも該当するが先勝ちで一意)**: 状態外 `[?]` / WBS ID 空 / 重複 ID の2件目 / タスクセル空(必須セル欠落)+ **対象外テーブル1つ**(マイルストーン表 — ヘッダに WBS なし・skippedRows 非計上の検証)。
- 期待値: `board = { files: 1, items: 4, skippedRows: 4 }`。**run-sync.test.ts の件数ピン(ok:13 / error:3 / skipped:3)は不変**。
- fixture 作成は python3 stdin(パスに repo 名 — guard 回避の前例)。

## 3. テスト観点

vitest・実 DB / 実ネットワークなし。新テストは新ファイル。既存テストは**凍結(例外 = tests/ingestion/run-sync.test.ts のみ — §0-2)**。

| ファイル(新設) | ケース |
|---|---|
| `tests/board-parser.test.ts` | parseBoard: 状態3値変換 / ヘッダ名ベースの列同定(並び替え耐性)/ 対象外テーブル非計上 / スキップ4種(状態外・空 ID・**重複 ID 2件目(行順)**・必須セル欠落)+ skippedRows 計上 / section 追跡 / sanitizeAbsPaths(絶対パス入力)/ 決定性(同一入力2回) |
| `tests/board-sync.test.ts` | run-sync(モック source): `-wbs.md` が board 経路に乗る / **ok/error/skipped が増えない** / board = {files, items, skippedRows} の計上 / denylist が board より先に効く(`profile-wbs.md` 相当は遮断)/ 冪等(2回同期 → 行数不変・state/commit 更新)/ **実 fixtures(FixtureSource)の統合ケース: demo-plan-wbs.md で `board = { files: 1, items: 4, skippedRows: 4 }` を assert(fixture 形骸化の防止 — §2.7 期待値の消費主体)** |
| `tests/today-data.test.ts` | getTodayData(モック db): **世代フィルタ(旧 commit 行が結果に現れない・(synced_at, commit) タイブレーク)** / 列並び(todo 昇順・done 降順 8 件)/ summary 4値(retryRate 分母 0 → null・rewardAvg)/ boardEmpty / **weekBucketBoundaries の import 使用**(週境界の自前実装がないこと — import ピンは §4-4)/ SQL 固定表記断片が query() 実引数に含まれる assert |
| `tests/ingestion/run-sync.test.ts`(**凍結例外** — §0-2) | 変更 = **store モック factory へ `upsertBoardItems: vi.fn()` の追加のみ**(+任意で board フィールド assert)。**追加行は1行完結で書き、設計参照コメント等の無関係行を追加しない**(§4-3b の語彙制限ピンが割れる)。件数ピン(ok:13/error:3/skipped:3)は不変 |
| 上記以外の既存テスト | **1文字も変更しない** |

## 4. 受け入れ条件(機械判定)

`FROZEN_TESTS_M3`(凍結例外 = tests/ingestion/run-sync.test.ts のみ — §0-2): `tests/proxy.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion/normalize.test.ts tests/ingestion/tag-vocab.test.ts tests/helpers tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts tests/embedding.test.ts tests/embed-index.test.ts tests/knowledge-data.test.ts tests/api-sync-embed.test.ts tests/markdown.test.ts tests/chunk.test.ts tests/knowledge-parser.test.ts tests/org-docs-sync.test.ts tests/knowledge-aggregation.test.ts tests/knowledge-recent.test.ts tests/decision-fallback.test.ts tests/overview-data.test.ts tests/review-data.test.ts vitest.config.ts`。

1. **0005**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0005_today_board.up.sql || fail=1
   test -f db/migrations/0005_today_board.down.sql || fail=1
   grep -Fq 'CREATE TABLE IF NOT EXISTS board_items' db/migrations/0005_today_board.up.sql || fail=1
   grep -Fq 'UNIQUE (source, file_path, item_key)' db/migrations/0005_today_board.up.sql || fail=1
   grep -Fq "CHECK (state IN ('todo','doing','done'))" db/migrations/0005_today_board.up.sql || fail=1
   grep -Fq 'board_items_file_synced_idx' db/migrations/0005_today_board.up.sql || fail=1
   grep -E "DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0005_today_board.up.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + Neon ブランチ検証(主セッション)→ 本番適用 ask。
2. **パーサ・経路**(集計型):
   ```bash
   fail=0
   test -f lib/ingestion/parsers/board.ts || fail=1
   grep -Fq 'sanitizeAbsPaths' lib/ingestion/parsers/board.ts || fail=1
   grep -Fq 'docs\/secretary\/[^/]+-wbs\.md' lib/ingestion/run-sync.ts || fail=1   # 正典 = 既存コード規約のクラス内非エスケープ形 [^/]
   grep -Fq 'upsertBoardItems' lib/ingestion/store.ts || fail=1
   grep -Fq 'skippedRows' lib/ingestion/run-sync.ts || fail=1
   exit "$fail"
   ```
3. **テスト**: `test -f` ×3(tests/board-parser.test.ts / tests/board-sync.test.ts / tests/today-data.test.ts)+ `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test` exit 0(**FROZEN_TESTS_M3 は無変更のまま緑**)。
   **3b. 凍結例外(run-sync.test.ts)の差分ピン**(fenced — シェル安全):
   ```bash
   fail=0
   git diff main -- tests/ingestion/run-sync.test.ts | grep '^+' | grep -v '^+++' | grep -vE 'upsertBoardItems|board' | grep -q . && fail=1
   grep -Fq 'ok: 13' tests/ingestion/run-sync.test.ts || fail=1
   grep -Fq 'error: 3' tests/ingestion/run-sync.test.ts || fail=1
   grep -Fq 'skipped: 3' tests/ingestion/run-sync.test.ts || fail=1
   exit "$fail"
   ```
   (追加行はすべて upsertBoardItems / board 関連・既存の件数ピンは不変。削除行の妥当性は人間レビュー — 前例どおりの意図的例外。)
4. **世代フィルタ・週境界ピン**(集計型):
   ```bash
   fail=0
   grep -Fq 'array_agg(commit ORDER BY synced_at DESC, commit DESC)' lib/data/today.ts || fail=1
   grep -Fq 'weekBucketBoundaries' lib/data/today.ts || fail=1
   grep -Fq 'import "server-only"' lib/data/today.ts || fail=1
   exit "$fail"
   ```
5. **SC-03(M3-B)**(集計型):
   ```bash
   fail=0
   grep -Fq '{ state: "todo", label: "バックログ" }' "app/(shell)/today/page.tsx" || fail=1
   grep -Fq '{ state: "doing", label: "着手中" }' "app/(shell)/today/page.tsx" || fail=1
   grep -Fq '{ state: "done", label: "完了" }' "app/(shell)/today/page.tsx" || fail=1
   grep -Fq 'requireUser' "app/(shell)/today/page.tsx" || fail=1
   grep -RIn -E "lib/db|lib/ingestion" "app/(shell)/today"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn '"use server"' "app/(shell)/today"; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + 実機(ui-shell 詳細 §4 条件2 の手順・fixture env)で未認証 `/today` → 307。
6. **fixture・凍結・恒久ガード**:
   `test -f "fixtures/cc-sier-organization/.companies/demo-org/docs/secretary/demo-plan-wbs.md"` /
   `git diff --exit-code main -- <FROZEN_TESTS_M3>` exit 0 /
   凍結パス diff exit 0: `git diff --exit-code main -- lib/search lib/ui lib/data/knowledge.ts lib/data/overview.ts lib/data/review.ts components db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql db/migrations/0003_search_foundation.up.sql db/migrations/0003_search_foundation.down.sql db/migrations/0004_org_docs.up.sql db/migrations/0004_org_docs.down.sql lib/auth lib/db.ts proxy.ts app/api app/login app/auth app/logout next.config.mjs tsconfig.json package.json package-lock.json scripts "app/(shell)/page.tsx" "app/(shell)/layout.tsx" "app/(shell)/template.tsx" "app/(shell)/knowledge" "app/(shell)/retro" "app/(shell)/capture" "app/(shell)/admin" app/globals.css app/layout.tsx lib/ingestion/github-source.ts lib/ingestion/fixture-source.ts lib/ingestion/source.ts lib/ingestion/normalize.ts lib/ingestion/chunk.ts lib/ingestion/parsers/knowledge.ts lib/ingestion/parsers/decision.ts lib/ingestion/parsers/daily-log.ts lib/ingestion/parsers/task-log.ts lib/ingestion/parsers/case-bank.ts lib/ingestion/parsers/quality-gate.ts lib/ingestion/parsers/types.ts lib/ingestion/tag-vocab.ts` /
   **fixtures は追加のみ**(fail-closed 形): `out=$(git -c diff.renames=false diff --name-status main -- fixtures) || fail=1; printf '%s' "$out" | grep -v '^A' | grep -q . && fail=1` /
   **埋め込み恒久ガード**: `grep -RIn 'board_items' lib/search; s=$?; [ "$s" -ne 1 ] && fail=1` /
   `bash scripts/check-no-secrets.sh` exit 0 / M1 条件8(SSoT ホスト)再実行 exit 0。
7. **ビルド**: ui-shell 詳細 §4 条件5 相当(ダミー env・exit 0・app 復帰 /login 200 まで)。
8. **注記**: `grep -q "today-view" docs/design/detail/ingestion-foundation.md` / 同 `docs/design/detail/ui-shell.md` / 同 `docs/design/ui/screen-design.md` 各 exit 0。

**手動確認チェックリスト**(機械判定外): 実同期(WBS 未変更なら `--force`)→ /today で実 WBS の kanban 表示・MoC isToday 目視比較・board.items / skippedRows の観測(恒常パース失敗の検知 — 手動依存で確定済み)。埋め込みバックフィル不要。

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal M3-A「WBS 取り込み基盤」(先行)
- **対象設計**: docs/design/detail/today-view.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **1, 2, 3, 4, 6** が exit 0 + **条件7(build)**。
- **成果物**: 0005 up/down(+ ローカル db 適用・Neon ブランチ検証は主セッション)/ parsers/board.ts / store.ts の upsertBoardItems / run-sync 拡張(allowlist・board 分岐・RepoSyncSummary)/ **lib/data/today.ts** / fixtures / テスト3ファイル。
- **executor**: ingestion-engineer。**ターン上限**: 30。**節目 commit**: (a) parser + store + テスト緑 (b) run-sync + today.ts + 0005 + fixtures + **build 緑**。
- ※ app/(shell)/today/page.tsx は触らない(M3-B)— **機械判定: `git diff --exit-code main -- "app/(shell)/today"` exit 0 を M3-A 達成状態に含める**。実ネットワーク・実 API キー禁止。
### /goal M3-B「SC-03 画面 + 注記」(M3-A 後)
- **対象設計**: 本書。
- **達成状態**: 条件 **5(実機 307 含む), 8** が exit 0 + 条件 **1〜4, 6, 7 再実行**緑。
- **成果物**: today/page.tsx(SC-03)/ 注記3件(主セッション — §2.6)。
- **executor**: frontend-engineer(画面)+ 主セッション(注記)。**ターン上限**: 15。**節目 commit**: (a) SC-03 + build 緑 (b) 実機確認緑。

### 共通の禁止事項
- 凍結対象の変更禁止(条件6 の diff リスト + FROZEN_TESTS_M3 — **例外なし**)。新規依存禁止。
- `.env` 書き込み禁止 / `.claude/`・hooks 変更禁止 / tsconfig 変更禁止 / SSoT 非接触(fixture のみ)/ 実ネットワークをテストに持ち込まない。
- `api.github.com` / `raw.githubusercontent.com`(github-source.ts 以外)/ `dangerouslySetInnerHTML` / `as TokenColor` / モデル名・埋め込み URL リテラル / `board_items` リテラル(lib/search 配下)/ `capture_inbox` リテラル(today 配下)を書かない。
- **`lib/db` / `lib/ingestion` / `"use server"` の文言を app/(shell)/today 配下に書かない(コメント含む — 条件5 の否定 grep は全文一致)**。`'use server'`(単一引用符形)の非検知は本 repo の引用符規約(double)への依存として受容。
- **作成経路**: 0005 の down(DROP TABLE 行)は **Write ツール**・fixtures は **python3 stdin**(python コード内の `->` 等 `>` を含む形は guard 誤爆に注意 — スクリプトを scratchpad に置いて実行)・ローカル 0005 適用は `psql < ファイル` リダイレクト形。コミットメッセージに破壊 SQL リテラルを書かない。ピン対象文字列(§4 の grep -F 断片)は実装内で1行に保つ。
- 生 DROP/TRUNCATE/DELETE 禁止(0005 down は本書 §1 の定義のみ・適用は人間承認)。

---

## 次の手順

`/design-review today-view`(detail)→ 全レンズ PASS → `/goal M3-A` → `/goal M3-B`。
