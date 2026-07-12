# 基本設計: ui-shell(画面シェル + 概観ダッシュボード + ルート再編)

> 対象: 画面設計書 docs/design/ui/screen-design.md(デザイン MoC v1.0 + ギャップ分析 §7)/ 要件定義 v1.1 §4.7。
> 前提: M0(認証)/ M1(取り込み + /review)完了・実データ 331件がローカル db に同期済み。
> ステータス: **PASS**(design-review Round 2 全レンズ PASS — reviews/ui-shell.md 参照。R2 の Low 指摘は rev.3 で反映済み)
> 作成: 2026-07-12(主セッション執筆)/ 改訂: 2026-07-12

---

## 1. 目的 / スコープ

### 目的
機能マイルストーン(M0/M1)で作った骨格 UI を、デザイン MoC 準拠の**共通シェル(サイドバー + トップバー + ダークテーマ)**に載せ替え、
**SC-02 概観ダッシュボード**を新設する。以降の画面追加(M2〜M5)がシェルに「はめるだけ」になる土台を作る。

### やる(ui-shell)
1. **ルート再編(MoC 準拠)**: `/` = SC-02 概観(新設)/ `/today` = 現「今日」骨格の移設 / `/knowledge` = 現 `/search` の移設 / `/retro` = 現 `/review` の移設(**M1-C 成果物の機能は不変**・ファイル移動のみ)/ `/capture`・`/admin/users` = プレースホルダページ(「準備中」空状態。機能は M4)。
   - 旧 URL の後方互換: `next.config.mjs` の `redirects()` で `/search → /knowledge`・`/review → /retro`(permanent = 308)。
   - **実行順の正確な理解(Round 1 修正)**: Next.js では **redirects は proxy(middleware)より先に評価される**。未認証の `/review` は 308(/retro)→ 307(/login)の2段になる。リダイレクト先も matcher 保護下のため**保護の帰結は等価**(漏れなし)。
   - **proxy.ts の matcher は変更しない**(新 URL はすべて既定保護。除外リストに触れない)。
2. **共通シェル**: route group `app/(shell)/` を新設し、保護画面をその配下へ移動。
   - **サイドバー(230px 固定)**: ロゴ / ナビ6項目(概観・今日・ナレッジ・振り返り・キャプチャ・管理 — アクティブ強調・管理は admin ロールのみ表示)/ **未処理 inbox バッジ**(capture_inbox の本人・未処理件数。M4 まで通常 0)/ ユーザー行(名前・ロール・**ログアウト = M0 の signOutAction をここで初接続**)。
   - **トップバー(56px)**: 画面タイトル / **同期ステータス**(sync_state の最終同期時刻・repo 別)/ 壁打ちボタン(**disabled プレースホルダ** — M4)。
   - `/login`・`/auth/*` はシェル外(現状のまま)。
   - **`/admin/users` のアクセス制御(決定)**: ナビ表示制御(isAdmin)とは別に、**ページ側でも isAdmin 判定し、非 admin は `notFound()`(404 — 存在も隠す)**。プレースホルダ段階から適用(表示制御 ≠ アクセス制御)。
   - **二層防御の適用(決定)**: shell layout の `requireUser()`(ナビ用ユーザー情報取得を兼ねる)に加え、**配下の全ページも冒頭で `requireUser()` を呼ぶ**(auth-foundation §2.1 の条項どおり。layout は Next.js の soft navigation で再実行されないため層として数えない)。
3. **ダークテーマ(デザイントークン)**: 画面設計書 §4.2 の oklch トークンを CSS カスタムプロパティとして `app/globals.css` に定義し、シェル・各画面が参照。スコア閾値色(≥0.80 良 / ≥0.65 注意 / <0.65 不良)も共通定数化(`lib/ui/score.ts`)し、/retro と SC-02 の数値表示に適用。
4. **SC-02 概観(M1 データで実現できる範囲)**:
   - KPI カード×4: 報酬スコア(今週平均)/ 品質ゲート合格率(今週)/ 記録件数(今週・type 別内訳)/ 未処理 inbox(本人)。
     **前週差分は reward と QG の2カードのみ**(records は件数表示のみ・inbox は時点スナップショットで前週値が定義不能なため差分なし)。
   - 週次トレンド(直近6週 — **MoC のスパークライン仕様に合わせた期間**。/retro の8週とは意図的に異なる): reward 平均 + QG 合格率の**インライン SVG の簡易チャート**(チャートライブラリ導入なし)。
   - 最近の判断ログ(decision 直近5件・GitHub 出典リンク)。
   - データは新設 `lib/data/overview.ts`(集計純関数 + クエリ層の分離 — review.ts と同型)。

### やらない(ui-shell では対象外)
- **MoC の「今日の着手候補」「オープンタスク KPI」**: task の kanban ステータスは timeline_records に無い(board/WBS 未取り込み)→ **M3**(SC-03 と同時)。KPI 3枚目は「記録件数」で代替。
- SC-03 kanban / SC-04 類似検索(M2)/ SC-06 キャプチャ・壁打ち(M4)/ SC-07 管理機能(M4 前後)— プレースホルダページのみ。
- 壁打ちスライドオーバーの実体(M4。ボタンは disabled 設置)。
- **Web フォント(IBM Plex)の導入**: `font-family` 指定のみ(未解決の問い #1)。
  **※ 上書き注記(ui-polish・2026-07-12)**: 本行は **ui-polish 基本設計 §1-2 で明示的に上書き**された — @fontsource セルフホスト(exact pin・OFL-1.1・ネットワーク非依存を維持)で IBM Plex Sans JP / Mono を導入済み。あわせて ui-shell 詳細 §4 条件7 の「package* 無差分(新規依存なし)」は main 基準のため @fontsource 追加のマージ後は自己解消しており、以降の依存ゲートは ui-polish 詳細 §4 条件4(@fontsource 2パッケージ限定)を正とする。
- モバイル対応(最低限のみ)。
- DB スキーマ変更(**マイグレーション不要** — M1 のテーブルで完結)。
- SSoT への一切のアクセス(読みも書きもしない)。

---

## 2. アーキテクチャ上の位置づけ

**App 層(第3層)のみ**の変更。Ingestion / DB スキーマ・SSoT には触れない。

```
app/
├── (shell)/                    ← 新設 route group(URL に現れない)
│   ├── layout.tsx              ← サイドバー + トップバー(requireUser = ナビ用情報取得)
│   ├── page.tsx                ← SC-02 概観(新設・ページ内 requireUser)
│   ├── today/page.tsx          ← 旧 app/page.tsx の骨格を移設(+ requireUser)
│   ├── knowledge/page.tsx      ← 旧 /search を移設(+ requireUser)
│   ├── retro/page.tsx          ← 旧 /review を移設(M1-C 成果物・機能不変)
│   ├── capture/page.tsx        ← プレースホルダ(M4・requireUser)
│   └── admin/users/page.tsx    ← プレースホルダ(requireUser + isAdmin で非 admin は notFound)
├── login / auth / api          ← 変更なし(シェル外)
└── globals.css                 ← デザイントークン定義
lib/data/overview.ts            ← SC-02 集計(server-only・純関数分離)
lib/ui/score.ts                 ← スコア閾値 → 色クラスの共通定数
```

- 認可は M0 の二層防御契約を維持: proxy(第1層・matcher 不変)+ **各ページの `requireUser()`**(第2層)。
  layout の requireUser は補助(soft navigation で再実行されないため層に数えない — §1-2 の決定)。
  個人データ(capture_inbox バッジ)は **user_id スコープ**(capture.md 契約)。
- 重い処理なし: 集計はクエリ時(データ小規模・review.ts と同じ方針)。

---

## 3. データ / インターフェース概要

### 3.1 新設 IF

| IF | 契約 |
|---|---|
| `lib/data/overview.ts` | `getOverviewData(userId: string): Promise<OverviewData>`。共有データ(timeline_records `WHERE status='ok'`・sync_state)+ **本人の** capture_inbox 未処理件数(`WHERE user_id=$1 AND processed_at IS NULL` — 個人データのため userId 必須)。集計は純関数 `aggregateOverview(rows, now)` に分離 |
| **集計の規範(Round 1-2 決着)** | **ingestion-foundation 基本設計 §3.4 を規範として完全継承**: 週バケット = **月曜起点・UTC**(実装は review.ts の週境界ロジックを export して再利用し、二重定義しない — §3.3)。**「今週」= now を含む進行中の部分週**。前週差分 = 今週(部分週)と前週(完了週)の差。平均・率は部分週でも不偏だが**分母が小さい間はぶれやすい**ため **UI に「今週(進行中)」と明記**(件数系カードには差分を付けないので系統的な過少表示は生じない)。**差分の null 伝播: 今週・前週の一方でも値が null(分母 0)なら delta = null('na' 表示)**。分母極小時の na 抑制閾値は**設けない**(注記で足りると判断)。reward 平均の分母 = `reward_score` 非 null(type ∈ task, score)/ QG 合格率の分母 = type=quality(§3.4 と同一)。null は全指標で分母除外。**status='error' 行は入力に混入しても集計に現れない**(純関数側でも防御) |
| `OverviewData` | `{ kpis: { rewardWeekAvg, rewardPrevDelta, qgPassRate, qgPrevDelta, recordsThisWeek, recordsByType, unprocessedInbox }, weeklyTrend: { week, rewardAvg, qgPassRate }[](6週・古→新), recentDecisions: { occurred_at, title, source, file_path, org }[](5件), lastSync: { repo, lastSyncedAt: Date \| null }[] }`。**lastSync は固定 repo リスト(SSoT 2 repo の定数)起点で構築**し、sync_state に行が無い repo は lastSyncedAt=null(「未同期」表示)— 行不在が未同期の実態のため。**recordsByType は件数 > 0 の type のみ**(表示順は task/quality/score/decision/daily_log) |
| `lib/ui/score.ts` | `scoreLevel(v: number \| null): 'good' \| 'warn' \| 'bad' \| 'na'`(≥0.80 / ≥0.65 / それ未満 / null)。トークンの色変数名を返すヘルパ |
| `app/(shell)/layout.tsx` | `requireUser()` → ユーザー名・ロール(user_roles 照会)をサイドバーへ。**未処理バッジ件数は lib/data/overview.ts の関数経由で取得**(userId 第1引数 — 専用の軽量関数か getOverviewData 共用かは detailed-design で確定)。ナビ定義は配列1箇所。`signOutAction()`(M0 成果物・Server Action = POST)をログアウトボタンに接続 |
| `next.config.mjs` | `redirects()`: `/search → /knowledge`・`/review → /retro`(permanent: true) |

### 3.2 デザイントークン(globals.css・画面設計書 §4.2 の転記)

`--bg` / `--panel` / `--line` / `--text` / `--text-sub` / `--accent`(ティール)/ `--accent-spar`(バイオレット)/
`--good` / `--warn` / `--bad` を oklch 値で定義。スコア閾値(0.80 / 0.65)は `lib/ui/score.ts` に一元化
(/retro の表示にも適用 — M1-C のロジック・ラベルは不変で**色付けのみ追加**)。

### 3.3 既存物への影響

| 対象 | 影響 |
|---|---|
| `app/review/page.tsx` | `app/(shell)/retro/page.tsx` へ移動(集計契約・ラベル・requireUser・dynamic 不変。/retro のスコア数値に score.ts の色付けを追加 — ロジック不変) |
| `app/page.tsx` / `app/search/page.tsx` | (shell)/today・knowledge へ移設(骨格 + `requireUser()` 追加) |
| `app/layout.tsx` | ルートレイアウトは最小化(html/body + globals.css)。ナビは shell layout へ |
| `lib/data/review.ts` | **週境界ロジックの export 追加 + 週数のパラメータ化のみ**(現物は private・8週固定 → overview と共有するため。集計ロジック・出力は不変。既存 review-data テストは無変更で緑 = 退行網) |
| `proxy.ts` / `lib/ingestion/*` / `db/` | **変更なし** |
| `tests/proxy.test.ts` | **無変更**(URL 集合・matcher とも不変。新 URL の保護確認は条件2の実機判定が担う) |

---

## 4. リスク・トレードオフ

| 論点 | 判断 | トレードオフ |
|---|---|---|
| ルート再編を今やる | MoC 準拠に確定 | M1-C 詳細設計の「/review」記述と食い違う → 本設計が移設を明示し、**ingestion-foundation 詳細設計 §2.5 に注記を追随**(条件8)。旧 URL は 308 で残す |
| redirects が proxy より先に評価される | 事実として受容(Round 1 修正) | 未認証の旧 URL は 308 → 307 の2段。リダイレクト先も保護下のため安全性は等価。条件2で旧 URL の 308 を機械判定 |
| KPI「今週」= 進行中の部分週 | 採用(ダッシュボードは「いま」を見る場所) | 前週(完了週)との差分は見かけ上低く出る → UI に「今週(進行中)」を明記し誤読を防ぐ。差分は reward/QG の2カードに限定(inbox は前週値が定義不能) |
| /admin/users は非 admin に 404 | notFound() で存在も隠す | プレースホルダ段階から適用。M4 で実画面に差し替わっても契約が既に立っている |
| 各ページに requireUser(layout は補助) | 全ページ配置 | 冗長だが auth-foundation §2.1 と一貫し、soft navigation の layout 非再実行にも頑健。機械判定(条件6)で強制 |
| route group 再編の regression | ファイル移動 + redirect のみ(ロジック不変) | ビルド・既存テスト(無変更)が退行検知網 |
| SC-02 を M1 データに限定 / チャートはインライン SVG / Web フォント見送り | (rev.1 どおり) | MoC との見た目差は許容。無いデータをモックで飾らない |

---

## 5. 受け入れ条件(機械判定)

すべて exit code で判定(詳細コマンドは detailed-design で実ファイルに照合して確定 — M0/M1 の教訓)。

1. **ルート構成(ファイル実在 + 旧ファイル非存在)**(exit 0):
   ```bash
   set -e
   for p in "app/(shell)/layout.tsx" "app/(shell)/page.tsx" "app/(shell)/today/page.tsx" \
            "app/(shell)/knowledge/page.tsx" "app/(shell)/retro/page.tsx" \
            "app/(shell)/capture/page.tsx" "app/(shell)/admin/users/page.tsx"; do test -e "$p"; done
   test ! -e app/page.tsx
   test ! -e app/review/page.tsx
   test ! -e app/search/page.tsx
   grep -q "knowledge" next.config.mjs && grep -q "retro" next.config.mjs   # redirects 定義
   ```
2. **保護 + 後方互換(実機)**: ローカル起動(ダミー env + SYNC_SOURCE=fixture)で未認証 curl:
   `/` `/today` `/knowledge` `/retro` `/capture` `/admin/users` → **307(/login)**、`/login` → 200、
   **旧 URL: `/search` → 308(/knowledge)・`/review` → 308(/retro)**(redirects が proxy より先の事実に基づく期待値)。
3. **デザイントークン**: `grep -c "oklch(" app/globals.css` ≥ 9 / `lib/ui/score.ts` に 0.80・0.65 の閾値が存在(grep)。
4. **テスト緑**: `npm test` exit 0。最低限含む:
   (a) `aggregateOverview` のユニット(KPI 値・前週差分(reward/QG)・6週トレンド・null 分母除外・**status='error' 混入行が現れない**・週境界(月曜起点 UTC)— now 固定で決定的)
   (b) `scoreLevel` の境界(0.80 / 0.65 / null)
   (c) next.config の redirects 定義の契約(source/destination/permanent を import して assert)
   (d) **既存テストファイルは1文字も変更せず**全緑(regression 検知。proxy.test.ts への追加も行わない — §3.3)。
5. **ビルド**: ダミー env で `npm run build` exit 0。ルート一覧に `/`・`/today`・`/knowledge`・`/retro`・`/capture`・`/admin/users` が**現れる**(「現れない」側の判定は行わない — 旧ページの不存在は条件1の構造判定が担う)。
6. **シェル契約(grep)**(exit 0):
   ```bash
   set -e
   f="app/(shell)/layout.tsx"
   for h in '"/"' '/today' '/knowledge' '/retro' '/capture' '/admin/users'; do grep -q -- "$h" "$f"; done
   grep -q "signOutAction" "$f" && grep -q "isAdmin" "$f"
   for p in "app/(shell)/page.tsx" "app/(shell)/today/page.tsx" "app/(shell)/knowledge/page.tsx" \
            "app/(shell)/retro/page.tsx" "app/(shell)/capture/page.tsx" "app/(shell)/admin/users/page.tsx"; do
     grep -q "requireUser" "$p"; done
   grep -q "isAdmin" "app/(shell)/admin/users/page.tsx" && grep -q "notFound" "app/(shell)/admin/users/page.tsx"
   ```
7. **秘密・境界の再実行**: `bash scripts/check-no-secrets.sh` exit 0 / M1 条件8(GitHub ホストは github-source.ts のみ)/ server-only(`lib/data/overview.ts` を対象に追加)/ **`git diff --exit-code main -- proxy.ts` が exit 0**(無差分 — `--exit-code` で偽 PASS を排除)。
8. **設計追随**: `grep -q "retro" docs/design/detail/ingestion-foundation.md`(§2.5 への移設注記)。

---

## 6. 未解決の問い

1. **Web フォント(IBM Plex)の導入時期** — セルフホストならネットワーク非依存にできる。M3 前後で判断。
2. **壁打ちスライドオーバー**(M4)— ボタンは disabled 設置のみ。実装設計は M4 で。
3. **SC-02「着手候補」ブロック**(M3)— board/WBS 取り込み後に KPI「オープンタスク」と共に差し替え。
4. **ライト/ダークテーマ切替** — MoC はダーク固定。CSS 変数構造で将来対応可能。
5. **capture/admin プレースホルダの文言** — M4 設計時に実画面へ差し替え。
6. **/today 骨格の中身** — 本設計では移設のみ。実装は M3(SC-03)。

---

## 次の手順

`/design-review ui-shell` 再レビュー(Round 2)→ 全 PASS で `/detailed-design ui-shell` → `/goal`。
