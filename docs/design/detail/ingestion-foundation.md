# 詳細設計: ingestion-foundation(M1 取り込み基盤 + 振り返り)

> 対象基本設計: docs/design/basic/ingestion-foundation.md(design-review 全レンズ PASS)
> 根拠資料: docs/research/m1-ssot-schema.md
> ステータス: **PASS**(design-review: arch/sec = 詳細 Round 2 PASS、data = 詳細 Round 3 PASS — reviews/ingestion-foundation.md 参照)
> 作成: 2026-07-12(主セッション執筆)/ 改訂: 2026-07-12

## 0. 基本設計・レビュー申し送りの決着

| # | 申し送り / 問い | 決着 |
|---|---|---|
| 1 | 負のシグナルの表示反転(data L3) | **ラベルで区分**: 集計値は全シグナル「true 率」で統一(ロジック一義)。/review の表示ラベルを 達成系 = `完了率` `成果物あり率`、発生系 = `過剰編集率` `リトライ率` とし、発生系は低いほど良い旨を UI 注記。値の反転はしない |
| 2 | Route Handler 認可形(arch L3 / sec L1) | **確定**: POST は `getUser()` → null なら `401` / `isAdmin(user.id)` false なら `403`(redirect 不使用)。GET は `CRON_SECRET` 照合のみ(Cookie フォールバックなし)。**fail-closed 契約**: サーバ側 env `CRON_SECRET` が未設定/空なら GET は常に 401(比較以前に拒否)。比較は両値を sha256 してから `crypto.timingSafeEqual`(長さ不一致 throw を構造的に回避しつつ定数時間)。SameSite は実装時に SDK 実挙動を確認し実装ノート(PR 説明)に記録 |
| 3 | 初回フル同期の時間制限(問い#3) | **上限方式 + 進行カーソルで進行保証**(詳細 Round 1 の livelock 指摘への応答): `sync_state.progress` に処理中 head と処理済みパスを永続化し、次回は**未処理分から再開**(§2.3)。`SYNC_MAX_FILES`(env・既定 100・**0 = 無制限**)。初回は `scripts/sync-local.ts`(既定 `SYNC_MAX_FILES=0`)でのローカル実行を推奨 |
| 4 | case-bank `files_written[]`(問い#5) | body に含めるのは**ファイル名のみ**(パス除去)。絶対/相対を問わず §2.2 サニタイズの対象(fixture 作成時に実形式を確認して転記) |
| 5 | 条件1の grep(arch) | §1.2 の**実 DDL 表記に一致させて確定**(§4-1。index 4本・type CHECK も判定対象に含める — 詳細 Round 1 Low 反映) |
| 6 | テストマトリクス(sec L3) | §3 の表に warnings[] / checklists[] 各1ケースを明記 |
| 7 | jutaku-dev-team スキーマ(問い#7) | 変更なし(パス走査型のため org 追加はコード変更不要) |

**詳細 Round 1 での追加決着**(reviews/ingestion-foundation.md 詳細 Round 1 参照):
- **livelock 解消**: §2.3 の進行カーソル(下記)。run-sync テストに「2回目実行で残り分が処理される」ケースを追加。
- **条件9 の /goal 割付分割**: 9-A(ingestion.md / requirements ×2)= M1-A、9-B(proxy.ts / auth-foundation 注記)= M1-B。
- **FixtureSource の head 契約**: fixtures 全ファイル内容から導出する決定的ハッシュ(内容変更 = head 変化)。条件4 は `--force`(sync_state 無視)で ON CONFLICT 経路を確実に通す。
- **条件5(e) の移設理由の記録**: 非 admin の**実セッション**は curl で偽造できない(Cookie は Neon Auth 発行)ため、Route 単体テスト(getUser/isAdmin モック)で判定するのが唯一の実ネットワークなし判定形。
- **条件8 の除外方式変更**: basename `--exclude` の抜け穴を排除し、「ヒットファイル一覧 = 許容1ファイルと完全一致(または空)」判定に変更。
- **SYNC_SOURCE の本番誤有効化防御**(sec Med): production 環境では fixture 指定を**起動時エラー**にし、SyncSummary に `sourceKind` を記録(監査痕跡)。
- **denylist の適用位置確定**(sec Low): **パス列挙段階(fetch 前)**で適用 — 機微ファイルは本文取得すらしない。
- **last_summary の件数単位確定**(data Low): `ok` / `error` = **レコード数**、`skipped` = **ファイル数**(denylist)、`fetch_failed` = **ファイル数**(error と混同しない別キー)。
- server-only 規約の対象拡大(lib/db.ts / lib/auth/roles.ts / lib/data/review.ts / lib/ingestion/*)+ fixtures 匿名の機械判定(条件11 新設)。

---

## 1. スキーマ DDL

### 1.1 ファイル構成と適用経路
- `db/migrations/0002_ingestion_foundation.up.sql` / `.down.sql`
- 適用: ローカル db(0001 適用済み)→ Neon ブランチ検証 → 本番反映は人間承認(M0 と同経路)。
- pgvector: **本マイグレーションに vector 列はない**(埋め込みは M2。EMBEDDING_DIM 未確定のため — search.md 準拠)。

### 1.2 up.sql(確定 DDL)

```sql
-- 0002_ingestion_foundation.up.sql
-- 対象設計: docs/design/detail/ingestion-foundation.md §1

CREATE TABLE IF NOT EXISTS timeline_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  file_path    text NOT NULL,
  item_key     text NOT NULL DEFAULT '',   -- 複数レコードファイル内の識別子(単一レコードは '')
  commit       text NOT NULL,              -- 最終処理コミット(鮮度・stale 判別)
  type         text NOT NULL CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log')),
  occurred_at  timestamptz,                -- status='ok' ではパーサ契約上必須。error は NULL 可
  org          text,
  topic        text,
  tags         text[] NOT NULL DEFAULT '{}',
  title        text,
  body         text,
  raw_ref      text NOT NULL,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
  reward_score double precision,
  signals      jsonb,                      -- 4シグナル bool×4(task-log のみ・他は NULL)
  completeness double precision,           -- judge 3軸(0-1 正規化済み)
  accuracy     double precision,
  clarity      double precision,
  quality_gate_result text,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, file_path, item_key)
);

-- メタフィルタ用(db.md: 近傍検索は M2、通常インデックスを先行)
CREATE INDEX IF NOT EXISTS timeline_records_occurred_at_idx ON timeline_records (occurred_at);
CREATE INDEX IF NOT EXISTS timeline_records_type_idx        ON timeline_records (type);
CREATE INDEX IF NOT EXISTS timeline_records_org_idx         ON timeline_records (org);
CREATE INDEX IF NOT EXISTS timeline_records_tags_idx        ON timeline_records USING gin (tags);

CREATE TABLE IF NOT EXISTS sync_state (
  repo           text PRIMARY KEY,
  last_commit    text,
  last_synced_at timestamptz,
  last_summary   jsonb,                    -- { ok, error, skipped, deleted, fetch_failed, hasMore, sourceKind }
  progress       jsonb                     -- 進行カーソル: { head, done: [path...] } / 完了時 NULL(done は denylist 通過後の相対パスのみ)
);

CREATE TABLE IF NOT EXISTS tag_synonyms (
  synonym   text PRIMARY KEY,
  canonical text NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_aggregates (
  period text NOT NULL,
  metric text NOT NULL,
  org    text NOT NULL DEFAULT '',
  value  double precision,
  PRIMARY KEY (period, metric, org)
);
```

### 1.3 down.sql

```sql
-- 0002_ingestion_foundation.down.sql(設計明示 + design-review + 人間承認済みの down 定義)
DROP TABLE IF EXISTS metric_aggregates;
DROP TABLE IF EXISTS tag_synonyms;
DROP TABLE IF EXISTS sync_state;
DROP TABLE IF EXISTS timeline_records;
```

### 1.4 冪等 upsert(確定)

```sql
INSERT INTO timeline_records (source, file_path, item_key, commit, type, occurred_at, org, topic,
  tags, title, body, raw_ref, status, reward_score, signals, completeness, accuracy, clarity,
  quality_gate_result, synced_at)
VALUES (...)
ON CONFLICT (source, file_path, item_key) DO UPDATE SET
  commit = EXCLUDED.commit, type = EXCLUDED.type, occurred_at = EXCLUDED.occurred_at,
  org = EXCLUDED.org, topic = EXCLUDED.topic, tags = EXCLUDED.tags, title = EXCLUDED.title,
  body = EXCLUDED.body, raw_ref = EXCLUDED.raw_ref, status = EXCLUDED.status,
  reward_score = EXCLUDED.reward_score, signals = EXCLUDED.signals,
  completeness = EXCLUDED.completeness, accuracy = EXCLUDED.accuracy, clarity = EXCLUDED.clarity,
  quality_gate_result = EXCLUDED.quality_gate_result, synced_at = now();
```

- `id` は更新で変わらない(DELETE+INSERT を使わない)。item_key 生成は基本設計 §3.1 のとおり。
- DB クライアント = `pg`。接続プールは `lib/db.ts`(server-only)に一元化。

---

## 2. 関数 / API インターフェース

### 2.1 SourceAdapter(GitHub への唯一の経路)

```ts
// lib/ingestion/source.ts
export type SourceFile = { path: string; content: string };
export interface SourceAdapter {
  repo: 'cc-sier-organization' | 'ai-war-room';
  head(): Promise<string>;                              // HEAD の commit sha
  changedPaths(base: string | null): Promise<string[] | 'full'>; // base=null → 'full'(全量)
  listPaths(): Promise<string[]>;                       // 全量走査時の候補パス列挙
  fetch(path: string): Promise<string>;                 // ファイル本文(text)
}
```

- `lib/ingestion/github-source.ts`(**GET のみ**・`GITHUB_TOKEN`・`import 'server-only'`)。
  実装規約: **`method:` を一切書かない**(fetch 既定 = GET。条件8-b の判定アンカー)。
  - `changedPaths()` の契約: **存在するパスのみ返す**(compare API の `status: removed` は除外 —
    削除ファイルの既存レコードは stale 残置ポリシーどおり放置)。404/409(履歴切断)は 'full' フォールバック。
  - `fetch(path)` は**手順1で取得した head sha に pin** して取得する(run 中の tip 前進で本文と `commit` 列が
    ズレない — 複数回に跨る実行でも同一 head の内容で一貫)。
  - fetch の失敗区分: **404(削除とみなす)→ throw せず「削除スキップ」**として done に直行 + `deleted`(ファイル数)計上
    (恒久 404 でカーソルが停止しない)。**それ以外(ネットワーク/レート制限等の一時失敗)→ throw** → runSync が
    `fetch_failed` に計上(done に入れない = 次回再試行)。
- `lib/ingestion/fixture-source.ts`: `fixtures/<repo>/` 配下を同一 IF で提供。
  **head() = fixtures 配下全ファイルの (path, sha256(content)) を辞書順連結した文字列の sha256**
  (決定的・内容変更で必ず変化)。changedPaths は常に 'full'。
- **denylist はパス列挙段階(fetch 前)で適用**: allowlist 通過後のパス集合から denylist 該当を除外し
  `skipped`(ファイル数)に計上。**機微ファイルは fetch すらしない**(本文がメモリを通過しない)。

### 2.2 パーサ(純関数・5本)+ 共通前処理

```ts
// lib/ingestion/parsers/types.ts
export type ParseMeta = { source: string; commit: string; org: string | null };
export type Parser = (file: SourceFile, meta: ParseMeta) => NormalizedRecord[];
```

- `parsers/task-log.ts` / `case-bank.ts` / `quality-gate.ts` / `decision.ts` / `daily-log.ts`(規則 = 基本設計 §3.2 規範表)。
- `lib/ingestion/normalize.ts`(共通・server-only):
  - org 抽出: パス `.companies/<org>/` セグメント。frontmatter `org` / `state.org_slug` が存在し不一致 → status='error'。
  - `sanitizeAbsPaths(text)`: 絶対パス(`/home/...` 等)をファイル名のみに切り詰め。**ok/error 両パスの
    title / body / raw 由来文字列に適用(不変条件)**。
  - `applyTags(record, vocab)`: tag_synonyms 語彙の包含マッチ(+ case-bank は request_keywords)。
  - 失敗時: throw せず `status='error'`(body = サニタイズ済み元テキスト先頭 2000 字。サニタイズ → 切り詰めの順)。
  - occurred_at: status='ok' では必須(取り出せない場合は error に落とす — case-bank の「started と id 日時部の両方欠損 → error」を含む)。

### 2.3 同期オーケストレーション(進行保証つき)

```ts
// lib/ingestion/run-sync.ts(server-only)
export async function runSync(adapters: SourceAdapter[], opts?: { maxFiles?: number; force?: boolean }): Promise<SyncSummary>
// SyncSummary = { repos: { [repo]: { ok, error, skipped, deleted, fetch_failed, hasMore, headCommit, sourceKind } } }
//   ok/error = レコード数、skipped(denylist)/deleted(404)/fetch_failed(一時失敗) = ファイル数、
//   sourceKind = 'github' | 'fixture'
```

repo ごとの手順(**livelock しない進行カーソル方式**):
1. `head = adapter.head()`。`force` でなく `head == sync_state.last_commit` なら no-op。
2. 候補パス = `changedPaths(last_commit)`(または listPaths)→ allowlist フィルタ → denylist 除外(skipped 計上)。
3. **再開判定**: `sync_state.progress` が非 NULL かつ `progress.head == head` なら、候補から `progress.done` を除外して**未処理分から再開**。`progress.head != head` なら progress を破棄(新しい head で最初から。冪等 upsert のため再処理は無害)。
4. 未処理候補の先頭から **`SYNC_MAX_FILES`(0 = 無制限)** 件を fetch + parse + upsert。
   処理を終えたファイル(ok/error レコード化済み)を `progress.done` に**逐次追記・永続化**(fetch 失敗は done に入れない)。
5. 未処理が残れば `hasMore: true`・`last_commit` 据え置き・progress 保存 → **次回は残りから続行**(進行は単調)。
   全件完了なら `last_commit = head`・`progress = NULL`。
- `force: true`(sync-local.ts の `--force`): sync_state を無視して全量を再 fetch + 再 upsert(ON CONFLICT 経路を確実に通す — 条件4 の判定に使用)。**完了時は通常どおり sync_state を更新**(last_commit = head・progress = NULL)— 運用上のカーソル復旧手段を兼ねる。
- **既知の制約(残置ポリシーの一部として許容・記録)**: (i) 部分処理中に head が変化し、かつファイル内容が旧 base と同一に復元された場合、当該ファイルは compare 差分に現れず部分処理時点の内容が残る(`commit` 列で判別可能。再収束はローカル `--force` で可能)。(ii) 未処理 > SYNC_MAX_FILES の状態で毎 run ごとに head が変化し続ける間は尾部が進まない(静穏1時間で解消。初回はローカル SYNC_MAX_FILES=0 で回避)。
- **SYNC_SOURCE=fixture の本番防御**(sec Med): `VERCEL_ENV === 'production'`(または `NODE_ENV==='production'` かつ Vercel 環境)で `SYNC_SOURCE=fixture` が指定された場合は**同期を実行せず 500(明示エラー)**。summary の `sourceKind` で使用ソースを常時記録(監査痕跡)。
- tag_synonyms 初期投入: masters 3ファイル(allowlist 内・索引化しない)から slug 化して upsert。

### 2.4 Route Handler

```ts
// app/api/sync/route.ts(server-only)
export async function GET(req)  // Cron: Bearer CRON_SECRET。fail-closed(§0-2): env 未設定/空 → 常に 401。
                                // 照合 = sha256 両値 → crypto.timingSafeEqual。不一致/欠落 → 401
export async function POST(req) // 手動: getUser() null → 401 / !isAdmin(user.id) → 403(redirect 不使用)
// 2xx: SyncSummary(JSON)
```

- `lib/auth/roles.ts`(server-only): `isAdmin(userId: string): Promise<boolean>`(user_roles JOIN roles)。
- `proxy.ts`(M0 成果物の拡張): matcher を
  `"/((?!api/auth(?:/|$)|api/sync(?:/|$)|login(?:/|$)|_next/static|_next/image|favicon\\.ico).*)"` に更新。
  `docs/design/detail/auth-foundation.md` §2.1 の matcher 行に「M1 で api/sync 除外を追加(本書参照)」を追記。
- `vercel.json`: `{ "crons": [ { "path": "/api/sync", "schedule": "0 * * * *" } ] }`(GET 起動)。
- **※ 追随注記(search-foundation・2026-07-17)**: M2 で本 Route Handler の runSync **成功後**に埋め込みバッチ(`runEmbedIndex` — lib/search/embed-index.ts)が後続フェーズとして接続され、2xx 応答は `SyncSummary + embed キー`(`{ embedded, failed, remaining }` / 失敗時 `{ error: true }`)に拡張された。認可判定(CRON_SECRET / isAdmin)は不変・embed フェーズは認可の内側・全例外吸収で同期本体の成功を妨げない。正典 = docs/design/detail/search-foundation.md §2.5。
- `scripts/sync-local.ts`: SourceAdapter 経由の CLI(`--force` / env `SYNC_SOURCE` / 既定 `SYNC_MAX_FILES=0`)。

### 2.5 振り返り

```ts
// lib/data/review.ts(server-only・共有データ・userId 引数なし・全クエリ WHERE status='ok' 既定)
export async function getReviewData(granularity: 'week' | 'month'): Promise<ReviewData>
// ReviewData = { buckets: Bucket[], entries: Entry[] }(shape は基本設計 §3.4 の契約どおり)
```

- `app/review/page.tsx`: `requireUser()` → 週/月トグル → 集計テーブル(ラベルは §0-1)+ 並置リスト(GitHub 出典リンク)。チャートなし。
  **注記(ui-shell 拡張)**: 本ページは ui-shell で `app/(shell)/retro/page.tsx`(URL `/retro`)へ移設(ロジック・ラベル・契約は不変。旧 `/review` は 308 redirect — docs/design/detail/ui-shell.md 参照)。

### 2.6 環境変数(.env.example 追記)

```
# --- 同期(M1) ---
CRON_SECRET=__set_me_random_32chars__
SYNC_MAX_FILES=100
# SYNC_SOURCE=fixture   # 受け入れ・ローカル検証時のみ。production では指定するとエラー(§2.3)
```

- `CRON_SECRET` は形式なし秘密クラス(パターン追加不可 — M0 §2.3 の整理どおり記録)。
- **server-only 規約の対象**: `lib/db.ts` / `lib/auth/roles.ts` / `lib/data/review.ts` / `lib/ingestion/*`(条件11 で機械判定)。

---

## 3. テスト観点

ランナー = vitest。**実ネットワーク・実 DB なし**(Route は auth・runSync をモック)。fixture は `fixtures/<repo>/<実パス構造>` に**匿名サンプル**(operator・人名・絶対パスを置換 — 条件11 で機械判定)。
**サニタイズ検証用の「絶対パスを含む入力」は fixtures/ に置かず、テストコード内のインライン文字列で与える**(条件11 の `/home/` grep と衝突させない — 判定器同士の整合)。

| テストファイル | 観点 | 主要ケース |
|---|---|---|
| `tests/parsers/task-log.test.ts` | 規範表 | frontmatter+reward+judge / signals bool×4 / judge (x-1)/4 / judge なし optional / started 欠損→ファイル名日時 / 壊れ frontmatter→error(throw しない) |
| `tests/parsers/case-bank.test.ts` | 規範表 | 複数 case 展開 / item_key=case id / reward・judge null 許容 / **started と id 日時部の両方欠損 → error** / files_written のファイル名化 |
| `tests/parsers/quality-gate.test.ts` | 規範表 + item_key | JSONL 1行=1レコード / **同一内容行×2 → 異なる item_key(#0/#1)** / 決定性 / `target`・`errors[]`・`warnings[]`・`checklists[]` サニタイズ(各1)/ 壊れ行→error + **error body に絶対パス残らない** |
| `tests/parsers/decision.test.ts` `daily-log.test.ts` | 規範表 | ファイル名日付 / H1 タイトル / 規則外命名→error |
| `tests/ingestion/normalize.test.ts` | 共通前処理 | **denylist 6パターン全列挙**(fetch 前除外・skipped 計上)/ org パス抽出・突合不一致→error / タグ包含マッチ |
| `tests/ingestion/tag-vocab.test.ts` | 語彙投入 | masters fixture → slug 化 → tag_synonyms upsert 内容(モック db) |
| `tests/ingestion/run-sync.test.ts` | 進行保証 | FixtureSource で ok/error/skipped/deleted/fetch_failed 集計(単位どおり)/ maxFiles 超過→hasMore + last_commit 据え置き + progress 保存 / **2回目実行で残り分が処理され完了時に last_commit 更新・progress NULL** / head 変化で progress 破棄 / **一時 fetch 失敗 → done 非追加で次回再試行** / **404(削除)→ done 直行・deleted 計上でカーソルが停止しない** / no-op / **production + SYNC_SOURCE=fixture → エラー** / force で全量再処理 + 完了時 sync_state 更新 |
| `tests/api-sync.test.ts` | Route 契約 | GET: Bearer なし/不正→401・**env CRON_SECRET 未設定→401(fail-closed)**・正→2xx(runSync モック)/ POST: セッションなし→401・非 admin→403・admin→2xx |
| `tests/review-data.test.ts` | 集計契約 | 基本設計 §3.4 期待値 / **error 行が入らない** / null 分母除外 / 週・月バケット境界 |
| `tests/proxy.test.ts`(M0 更新) | matcher | 素通し `/api/sync`・保護 `/api/syncx`(既存ケース維持) |

DB 依存(冪等・更新反映)は受け入れ条件4(psql)に分離。

---

## 4. 受け入れ条件(機械判定)

`PSQL="docker compose exec -T db psql -U cockpit -d cockpit -v ON_ERROR_STOP=1"`。すべて exit code 判定。

1. **DDL 必須要素**(exit 0 — §1.2 の実表記に一致):
   ```bash
   set -e
   f=db/migrations/0002_ingestion_foundation.up.sql
   for t in timeline_records sync_state tag_synonyms metric_aggregates; do
     grep -Eq "CREATE TABLE IF NOT EXISTS $t\b" "$f"; done
   grep -q "UNIQUE (source, file_path, item_key)" "$f"
   grep -q "CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log'))" "$f"
   grep -Eq "status .*CHECK \(status IN \('ok','error'\)\)" "$f"
   for ix in occurred_at_idx type_idx org_idx tags_idx; do grep -q "timeline_records_$ix" "$f"; done
   grep -q "USING gin (tags)" "$f"
   grep -q "signals" "$f"
   grep -q "progress" "$f"
   test -f db/migrations/0002_ingestion_foundation.down.sql
   ```
2. **可逆性**: 0001 適用済みローカル db で 0002 の up → down → up がすべて exit 0。
3. **テスト緑**: `npm test` exit 0。§3 の全テストファイル存在(`test -f` 列挙)。実ネットワークなし。
4. **冪等 + 更新反映**(`SYNC_SOURCE=fixture` + `scripts/sync-local.ts`):
   (a) 通常実行 → `--force` 再実行 → `SELECT count(*) FROM timeline_records;` 不変(ON CONFLICT 経路を通した上での不変)
   (b) 内容を変えた fixture に差し替え → `--force` 再実行 → 件数不変 **かつ** 対象行の `body` と `commit` が変化(psql 前後比較)。
   **(b) の差し替え対象は item_key が内容非依存のソース(task-log / decisions / logs / case-bank のフィールド)に限定**
   (quality-gate JSONL は行変更で item_key 自体が変わり件数が動くため対象にしない)。
5. **認可ゲート**(ローカル起動 + curl・`SYNC_SOURCE=fixture`):
   (a) `GET /api/sync` 認証なし → 401 (b) 不正 Bearer → 401 (c) 正 Bearer → 200
   (d) セッションなし `POST` → **401(3xx でない)**。
   (非 admin → 403 は条件3の Route 契約テストで判定 — 実セッションを curl で偽造できないため。§0 記録)
6. **ビルドと統合**: `npm run build` exit 0(ダミー env)。条件3に proxy 境界・review 集計(error 除外)を含む。
7. **秘密実値ゼロ**: `bash scripts/check-no-secrets.sh` exit 0。
8. **SSoT 書き込み禁止(構造判定 — ヒット一覧の完全一致方式)**:
   ```bash
   files=$(for d in app lib scripts tests; do
     [ -d "$d" ] || continue
     grep -RIl -E "api\.github\.com|raw\.githubusercontent\.com" "$d"
   done)
   { test -z "$files" || test "$files" = "lib/ingestion/github-source.ts"; } || exit 1
   grep -n "method:" lib/ingestion/github-source.ts; s=$?
   [ "$s" -ne 1 ] && exit 1
   exit 0
   ```
   (basename 除外の抜け穴なし: 許容は `lib/ingestion/github-source.ts` の完全一致1ファイルのみ。
   **実行は M1-B 以降**(github-source.ts 不在時は2段目の grep が exit 2 → 全体 exit 1 になるため — 条件8 は M1-B 割付)
9. **追随の実在**(exit 0・/goal 割付つき):
   - **9-A(M1-A)**: `grep -q "item_key" .claude/rules/ingestion.md` / `grep -q ".companies" docs/design/requirements.md` / `grep -q "signals" docs/design/requirements.md`
   - **9-B(M1-B)**: `grep -q "api/sync" proxy.ts` / `grep -q "api/sync" docs/design/detail/auth-foundation.md`
10. **env 契約**: `grep -q "CRON_SECRET" .env.example && grep -q "SYNC_MAX_FILES" .env.example && grep -q "SYNC_SOURCE" .env.example` exit 0。
11. **server-only 規約 + fixtures 匿名**(集計型・存在するもののみ):
    ```bash
    fail=0
    for f in lib/db.ts lib/auth/roles.ts lib/data/review.ts lib/ingestion/github-source.ts lib/ingestion/run-sync.ts lib/ingestion/fixture-source.ts lib/ingestion/normalize.ts; do
      [ -f "$f" ] || continue
      grep -q "server-only" "$f"; s=$?; [ "$s" -ne 0 ] && fail=1
    done
    if [ -d fixtures ]; then
      grep -RIn "/home/" fixtures; s=$?
      [ "$s" -ne 1 ] && fail=1     # fixtures に実絶対パス残存なし(匿名化の機械判定)
    fi
    exit "$fail"
    ```

---

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal M1-A「スキーマ + パーサ」(先行)
- **対象設計**: docs/design/detail/ingestion-foundation.md(本書。/goal 発行時に転記)。
- **達成状態**: 受け入れ条件 **1, 2, 3(パーサ/normalize/tag-vocab 分), 7, 9-A, 11(fixtures 分)** が exit 0。
- **成果物**: 0002 マイグレーション / パーサ5本 + normalize / fixtures(匿名)/ 対応テスト / ingestion.md・requirements.md(§5.1/§5.2)の追随。
- **executor**: db-architect(0002)+ backend-engineer(パーサ)。ルール/要件追随は主セッション(M0 前例の意図的例外)。
- **ターン上限**: 30。**節目 commit**: (a) 0002 + 条件1/2 緑 (b) パーサ + テスト緑。

### /goal M1-B「同期 API + 認証境界統合」(M1-A 後)
- **対象設計**: docs/design/detail/ingestion-foundation.md(本書。/goal 発行時に転記)。
- **達成状態**: 受け入れ条件 **4, 5, 8, 9-B** が exit 0 + 条件3(run-sync / api-sync / proxy 分)緑 + 条件11 再実行緑。
- **成果物**: SourceAdapter(GitHub/Fixture)/ run-sync(進行カーソル)/ upsert + lib/db.ts / app/api/sync / lib/auth/roles.ts / proxy.ts 拡張 + tests/proxy.test.ts 更新 / auth-foundation 注記 / scripts/sync-local.ts / vercel.json / .env.example 追記。
- **executor**: backend-engineer。**ターン上限**: 30。**節目 commit**: (a) アダプタ + run-sync + テスト緑 (b) API + proxy + 条件4/5/8 緑。

### /goal M1-C「振り返りビュー」(M1-B 後)
- **対象設計**: docs/design/detail/ingestion-foundation.md(本書。/goal 発行時に転記)。
- **達成状態**: 受け入れ条件 **6, 10** が exit 0 + 条件3(review-data 分)緑 + 条件7/11 再実行緑。
- **成果物**: lib/data/review.ts / app/review/page.tsx 差し替え / 対応テスト。
- **executor**: backend-engineer(集計)+ frontend-engineer(UI)。**ターン上限**: 25。**節目 commit**: (a) 集計 + テスト緑 (b) UI + build 緑。

> 条件3 の「(〜分)」の対象テストファイルは、/goal 発行時に §3 の該当行のファイルパスで `test -f` + vitest 対象として明示列挙する(転記規定)。

### 共通の禁止事項
- SSoT への書き込み一切(GET のみ。GitHub アクセスは github-source.ts 以外に書かない)。
- `.env` / `.env.local` への書き込み(`.env.example` のみ可)。
- `db/migrations/` 外での DROP / TRUNCATE / DELETE(stale レコードの生 DELETE 掃除も禁止)。
- `.claude/settings.json` / hooks の変更。
- テストからの実ネットワーク・実 GitHub アクセス(FixtureSource + fixtures のみ)。
- fixtures への実データ非匿名転記(operator・人名・絶対パスは必ず置換 — 条件11 で判定)。
- 本番(Neon)への 0002 適用(人間承認なしでは不可)。

### 完了後の人間の手動アクション
1. `CRON_SECRET` を生成し `.env` / Vercel に設定。
2. 初回フル同期をローカルで実行(`npx tsx scripts/sync-local.ts` — 既定 SYNC_MAX_FILES=0)し、/review で実データ表示を確認。
3. Neon 本番への 0002 適用(ブランチ検証 → 承認)。

---

## 次の手順

`/design-review ingestion-foundation`(detail)再レビュー → 全 PASS で `/goal M1-A` から実装。
