# 詳細設計: ui-shell(画面シェル + 概観ダッシュボード + ルート再編)

> 対象基本設計: docs/design/basic/ui-shell.md(design-review Round 2 全レンズ PASS)
> ステータス: **PASS**(design-review 詳細 Round 2 全レンズ PASS — reviews/ui-shell.md 参照。R2 の Low/Info は rev.3 で反映済み)
> 作成: 2026-07-12(主セッション執筆)

## 0. 申し送りの決着(reviews/ui-shell.md Round 2)

| # | 申し送り | 決着 |
|---|---|---|
| 1 | tests/proxy.test.ts への新 URL 追加の帰属 | **本トピックでは無変更を維持**。次に proxy matcher を変更する設計(M2 以降)の受け入れ条件に「保護集合へ /today 等6 URL を追加」を含めることを申し送る(reviews に記録済み) |
| 2 | 週境界共有の形 | **`lib/data/review.ts` に export を追加**: `export function weekBucketBoundaries(now: Date, weeks: number): { start: Date; end: Date }[]`(月曜起点 UTC・古→新・**末尾 = now を含む進行中の部分週**)。既存の内部利用は `weeks=8` で呼び出し(出力不変 — 既存 review-data テスト無変更で緑が退行網)。overview は `weeks=6` で利用し、**KPI(今週/前週)はトレンド6週の末尾2バケットから導出**(バケット生成は1回)。**条件4(a) の期待値の正 = テストコード自体**(期待値表は設計に持たず、テスト内コメントで手計算根拠を示す — 明示的決定) |
| 3 | 分母極小時の差分 | na 抑制閾値は**設けない**(基本設計 rev.3 で決定済み。「今週(進行中)」注記で許容) |
| 4 | バッジ件数関数 | **専用軽量関数**: `getUnprocessedInboxCount(userId): Promise<number>`(overview.ts 内・layout から毎リクエスト呼ばれるため count 1本に限定)。`getOverviewData` は SC-02 用にこれを内包して呼ぶ |

---

## 1. スキーマ DDL

**変更なし(マイグレーション不要)**。0001/0002 の既存スキーマのみを読む。pgvector 次元にも関与しない。

読み取り対象(参照列の確定):

| テーブル | 参照列 | 用途 |
|---|---|---|
| `timeline_records` | type / occurred_at / reward_score / quality_gate_result / status / title / source / file_path / org | SC-02 集計(`WHERE status='ok'`)・recentDecisions |
| `sync_state` | repo / last_synced_at | トップバー同期ステータス(**固定 repo リスト起点**・行不在 = 未同期) |
| `capture_inbox` | user_id / processed_at | 未処理バッジ(`WHERE user_id=$1 AND processed_at IS NULL` — 本人のみ) |

---

## 2. 関数 / API インターフェース

### 2.1 lib/ui/score.ts(純関数・クライアント/サーバ共用可)

```ts
export const SCORE_GOOD = 0.8;
export const SCORE_WARN = 0.65;
export type ScoreLevel = "good" | "warn" | "bad" | "na";
export function scoreLevel(v: number | null | undefined): ScoreLevel;
export function scoreColorVar(level: ScoreLevel): string;  // 'var(--good)' | 'var(--warn)' | 'var(--bad)' | 'var(--text-sub)'
```

### 2.2 lib/data/review.ts(変更 — export 追加のみ)

- `weekBucketBoundaries(now, weeks)` を **private → export に変更し週数をパラメータ化**(§0-2)。
  月バケット・集計ロジック・`getReviewData` の入出力は**不変**。

### 2.3 lib/data/overview.ts(新設・`import 'server-only'`)

```ts
export type OverviewRow = { /* §1 の timeline_records 参照列(status 含む) */ };
export type OverviewData = {
  kpis: {
    rewardWeekAvg: number | null;  rewardPrevDelta: number | null;   // 片側 null → delta null(§0-3)
    qgPassRate: number | null;     qgPrevDelta: number | null;
    recordsThisWeek: number;       recordsByType: { type: string; count: number }[];  // count>0 のみ。表示順は7 type 全列挙で固定: task/quality/score/session/conversation/decision/daily_log(recordsThisWeek は全 type 合計。**基本設計の5 type 列挙を全列挙に意図的詳細化**)※ org-docs-ingestion(2026-07-18)で **8 type(knowledge 追加)** に拡張 — 正典 = docs/design/detail/org-docs-ingestion.md §2.6
    unprocessedInbox: number;
  };
  weeklyTrend: { weekStart: string; rewardAvg: number | null; qgPassRate: number | null }[];  // 6週・古→新・末尾=部分週
  recentDecisions: { occurredAt: string; title: string | null; source: string; filePath: string; org: string | null }[];  // 5件
  lastSync: { repo: string; lastSyncedAt: string | null }[];  // REPOS 定数起点(§0)。日時を string(ISO)にするのは RSC への直列化都合(基本設計の Date | null からの意図的詳細化)
};
export const REPOS = ["cc-sier-organization", "ai-war-room"] as const;  // lastSync 構築の固定リスト
export type OverviewAggregates = { kpis: Omit<OverviewData["kpis"], "unprocessedInbox">; weeklyTrend: OverviewData["weeklyTrend"] };
export function aggregateOverview(rows: OverviewRow[], now: Date): OverviewAggregates;  // 純関数(inbox は getOverviewData が合成)
export function buildLastSync(stateRows: { repo: string; last_synced_at: Date | null }[]): OverviewData["lastSync"];  // REPOS 突合の純関数
export async function getLastSync(): Promise<OverviewData["lastSync"]>;  // layout 用(sync_state 全行 → buildLastSync)
export async function getUnprocessedInboxCount(userId: string): Promise<number>;
export async function getOverviewData(userId: string): Promise<OverviewData>;
```

- 集計規範は基本設計 §3.1(§3.4 完全継承・部分週・null 分母除外・error 防御・delta null 伝播)。
- クエリ: (a) `WHERE status='ok' AND occurred_at >= <6週窓の開始>`(集計用)
  (b) `WHERE status='ok' AND type='decision' ORDER BY occurred_at DESC LIMIT 5`
  (c) sync_state 全行 → REPOS へ突合(行不在 = null) (d) inbox count(§0-4)。

### 2.4 app/globals.css(デザイントークン — 実値確定・画面設計書 §4.2 の転記)

```css
:root {
  --bg: oklch(0.15 0.012 255);      --panel: oklch(0.185 0.013 255);
  --line: oklch(0.26 0.014 255);    --text: oklch(0.93 0.006 255);
  --text-sub: oklch(0.66 0.012 255); --accent: oklch(0.78 0.11 195);
  --accent-spar: oklch(0.72 0.11 290);
  --good: oklch(0.75 0.14 150);     --warn: oklch(0.80 0.13 75);
  --bad: oklch(0.68 0.16 25);
}
body { background: var(--bg); color: var(--text);
  font-family: "IBM Plex Sans JP", system-ui, sans-serif; }  /* Web フォント配信なし(基本設計 §1) */
```

### 2.5 シェルと画面

| ファイル | 契約 |
|---|---|
| `app/(shell)/layout.tsx` | async Server Component。`requireUser()` → `isAdmin(user.id)` / `getUnprocessedInboxCount(user.id)` / `getLastSync()`(overview.ts 内 export・REPOS 突合)を取得。サイドバー(230px・ナビ配列 `NAV: {href,label,adminOnly?}[]` 6項目・admin 項目は isAdmin 時のみ描画・inbox バッジ)+ トップバー(56px・同期ステータス・壁打ちボタン `disabled`)+ ログアウト(`<form action={signOutAction}>`)。`export const dynamic = "force-dynamic"` |
| `components/nav-link.tsx`(client) | `usePathname()` でアクティブ強調(`--accent` 縁取り)。シェル専用の小物 |
| `app/(shell)/page.tsx` | SC-02。`requireUser()` → `getOverviewData(user.id)`。KPI カード×4(scoreLevel 色・**「今週(進行中)」注記**・delta は ±表示 / null は na)/ 週次トレンドの**インライン SVG**(polyline 2本: reward・QG。null 点はスキップ。viewBox 固定・依存追加なし)/ 最近の判断ログ5件(`https://github.com/SAS-Sasao/${source}/blob/main/${filePath}` — api.github.com / raw.githubusercontent.com は書かない)。`dynamic = "force-dynamic"` |
| `app/(shell)/today/page.tsx` | 旧 app/page.tsx の骨格移設 + `requireUser()` + 「M3 で実装予定」注記 |
| `app/(shell)/knowledge/page.tsx` | 旧 /search 移設 + `requireUser()` + 「M2 で実装予定」注記。**※ 追随注記(search-foundation・2026-07-17): M2 で SC-04(pgvector 類似検索 + 判断後6週実績)として実装化** — データ取得は lib/data/knowledge.ts 経由のみ・requireUser 存置。正典 = docs/design/detail/search-foundation.md §2.7 |
| `app/(shell)/retro/page.tsx` | 旧 /review 移設(ロジック・ラベル・**requireUser・dynamic とも不変**)。スコア数値に `scoreLevel` の色付けのみ追加 |
| `app/(shell)/capture/page.tsx` | `requireUser()` + 準備中(M4) |
| `app/(shell)/admin/users/page.tsx` | `requireUser()` → `!isAdmin` なら **`notFound()`** + 準備中 |
| `app/layout.tsx` | 最小化(html/body + globals.css import + **`@neondatabase/auth/ui/css` import と suppressHydrationWarning は維持** — ログイン画面のスタイル崩れ防止)。旧ナビ削除 |
| `next.config.mjs` | `redirects()`: `/search→/knowledge`・`/review→/retro`(permanent: true)。**あわせて Next 16 非対応の `eslint` キーを削除**(積み残し #3 の消化 — 同ファイル編集のため) |
| 削除 | `app/page.tsx` / `app/search/page.tsx` / `app/review/page.tsx`(移設完了後) |

- ingestion-foundation 詳細設計 §2.5 に「/review は ui-shell で /retro へ移設(本書参照)」の注記を追随(主セッション・条件8)。

---

## 3. テスト観点

vitest(既存基盤)。**DOM テストはしない**(jsdom 等の新規依存を追加しない — 画面はビルド + 実機 curl で担保)。実ネットワーク・実 DB なし。

| テストファイル | ケース |
|---|---|
| `tests/overview-data.test.ts` | aggregateOverview を now 固定(例: 2026-07-15T10:00:00Z 水曜)で: KPI 手計算一致(根拠はテスト内コメント — §0-2)/ **delta 通常 + 片側 null → null** / 6週トレンド長・古→新・末尾=部分週 / 週境界の両側(**月曜 00:00:00Z → 今週・日曜 23:59:59.999Z → 前週**)/ **weekBucketBoundaries(now, weeks) を weeks=6/8 で直接 assert**(公開 IF の契約)/ **status='error' 混入行が現れない** / null 分母除外 / recordsByType が count>0 のみ・**7 type 全列挙順** / **buildLastSync**: 行不在 repo → lastSyncedAt=null・行在 repo → ISO 文字列化・REPOS 外の余剰行は無視 |
| `tests/score-level.test.ts` | 0.80→good / 0.7999→warn / 0.65→warn / 0.6499→bad / null・undefined→na |
| `tests/redirects.test.ts` | next.config.mjs を import → `redirects()` を await → 2エントリの source/destination/permanent を assert |
| 既存テスト | **1文字も変更しない**(条件4-d。review-data が weekBucketBoundaries 互換の退行網) |

---

## 4. 受け入れ条件(機械判定)

基本設計 §5 の8条件を実行可能形に確定。

1. **ルート構成**: 基本設計 §5-1 のスクリプト**そのまま**(7ファイル実在 / 旧3ファイル非存在 / next.config grep)。**eslint キー非存在の grep は条件1本体には含めず、UI-A 固有の達成状態とする**(§5 — 正典の二重定義を避ける)。
2. **保護 + 後方互換(実機)**: `docker compose stop app` → ダミー env(`NEON_AUTH_BASE_URL=http://localhost:9 NEON_AUTH_COOKIE_SECRET=00000000000000000000000000000000`)+ `SYNC_SOURCE=fixture DATABASE_URL=postgres://cockpit:cockpit@localhost:5432/cockpit`(ローカル dev db — 実データ同期済みだが判定は**ステータスコードのみ**でデータ非露出)で `npx next dev -p 3300` 起動 →
   未認証 curl: `/` `/today` `/knowledge` `/retro` `/capture` `/admin/users` → **307** / `/login` → **200** / `/search` → **308**(Location: /knowledge)/ `/review` → **308**(Location: /retro)→ サーバ停止・`docker compose start app`。
3. **トークン**(出現数ベース — 整形非依存): `test "$(grep -o 'oklch(' app/globals.css | wc -l)" -ge 9` && `grep -q "0.8" lib/ui/score.ts` && `grep -q "0.65" lib/ui/score.ts`。
4. **テスト**: `npm test` exit 0 + `test -f` ×3(overview-data / score-level / redirects)+
   **既存テスト無変更**: `git diff --exit-code main -- tests/proxy.test.ts tests/review-data.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion tests/helpers vitest.config.ts` exit 0(**テスト基盤 stub・vitest 設定も凍結**)。
5. **ビルド**: ダミー env で `npm run build` exit 0。出力ログに `/today` `/knowledge` `/retro` `/capture` `/admin/users` の各ルート行が存在(grep。ベア `/` は grep 判定不能のため対象外 — SC-02 の実在は条件1/2/6 が担う。「現れない」判定はしない — 条件1が担う)。
6. **シェル契約**: 基本設計 §5-6 のスクリプトそのまま(ナビ6 href / signOutAction / isAdmin / 全6ページ requireUser / admin ページの isAdmin+notFound)。
7. **境界の再実行**: `bash scripts/check-no-secrets.sh` exit 0 / M1 条件8スクリプト exit 0 / server-only 検査対象に `lib/data/overview.ts` を追加した M1 条件11 exit 0 / **`git diff --exit-code main -- proxy.ts` exit 0** / `git diff --exit-code main -- lib/ingestion db/migrations lib/auth app/logout app/api app/login app/auth` exit 0(不可侵の機械判定 — 認可の土台・ログアウト・認証 UI ビューを含む。§2「login / auth / api 変更なし」宣言との対称)/ **`git diff --exit-code main -- package.json package-lock.json` exit 0**(新規依存なしの機械判定)。
8. **設計追随**: `grep -q "retro" docs/design/detail/ingestion-foundation.md` exit 0。

---

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal UI-A「集計・トークン基盤」(先行)
- **対象設計**: docs/design/detail/ui-shell.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **3, 4, 7** が exit 0 + 条件1の next.config 部分 = `grep -q "knowledge" next.config.mjs && grep -q "retro" next.config.mjs && ! grep -q "eslint" next.config.mjs` exit 0(条件1全体は UI-B で判定)。
- **成果物**: lib/ui/score.ts / lib/data/overview.ts / lib/data/review.ts(export 追加のみ)/ app/globals.css(トークン)/ next.config.mjs(redirects + eslint キー削除)/ テスト3本。
- **executor**: backend-engineer。**ターン上限**: 20。**節目 commit**: (a) 集計 + テスト緑 (b) トークン + config。

### /goal UI-B「シェル + 画面再編」(UI-A 後)
- **対象設計**: docs/design/detail/ui-shell.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **1, 2, 5, 6, 8** が exit 0 + 条件4/7 再実行緑。
- **成果物**: app/(shell)/ 一式(layout / NavLink / 7ページ)/ 旧3ファイル削除 / app/layout.tsx 最小化 / ingestion-foundation §2.5 注記(主セッション)。
- **executor**: frontend-engineer(シェル・画面)+ 主セッション(注記)。**ターン上限**: 30。**節目 commit**: (a) シェル + 移設 + ビルド緑 (b) SC-02 + 実機確認緑。

### 共通の禁止事項
- **proxy.ts / lib/ingestion / db/migrations / 既存テストファイルの変更禁止**(条件4/7 の diff ゲートで機械判定)。
- 新規依存の追加禁止(チャート・jsdom 等。SVG は手書き)。
- `.env` / `.env.local` 書き込み禁止 / `.claude/settings.json`・hooks 変更禁止 / tsconfig 変更禁止。
- SSoT への一切のアクセス禁止。`api.github.com` / `raw.githubusercontent.com` の文字列を書かない(M1 条件8)。
- 実ネットワークをテストに持ち込まない(実機確認は条件2の手順のみ — ローカル dev db・ステータスコードのみ判定)。
- 秘密実値形式リテラル禁止。

---

## 次の手順

`/design-review ui-shell`(detail)→ 全 PASS で `/goal UI-A` から実装。
