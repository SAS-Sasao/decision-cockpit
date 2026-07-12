# 基本設計: ui-polish(概観・振り返りの MoC 忠実化 + 共通チャート部品)

> 対象: 画面設計書 docs/design/ui/screen-design.md(SC-02 / SC-05)+ MoC 実 HTML docs/design/ui/moc/decision-cockpit.dc.html。
> 根拠資料: docs/research/ui-polish-moc-spec.md(2026-07-12 視覚仕様抽出)
> 前提: ui-shell 完了(シェル・トークン10種・SC-02 最小版・/retro 稼働)。
> **ユーザー方針(2026-07-12)**: 先にビジュアルを MoC に寄せる。**M2 以降のマイルストーンも MoC 準拠で実装する** — 本設計のチャート部品はその共通土台。
> ステータス: **PASS**(design-review Round 2 全レンズ PASS — reviews/ui-polish.md 参照。R2 の Low はピン強化を反映済み・残りは detailed-design へ申し送り)
> 作成: 2026-07-12(主セッション執筆)/ 改訂: 2026-07-12

---

## 1. 目的 / スコープ

### 目的
SC-02(概観)と SC-05(振り返り)の意匠を MoC に忠実化し、その過程で**再利用可能なチャート部品**を確立する。
以降のマイルストーン(M2 ナレッジ / M3 今日 / M4 キャプチャ)は、この部品と本設計の「MoC 準拠の規範」に乗って実装する。

### やる(ui-polish)
1. **チャート部品の共通化**(調査 §2/§3 の実装方式を移植・**全部品に null 契約を定義** — MoC の欠陥は持ち込まない):
   - `lib/ui/chart.ts`(**純関数** — テスト対象): 線形スケール変換 / null 分割セグメント(現 buildSegments の一般化)/ line・area の path 生成 / ゲージの dasharray 計算 / ローカル min-max 正規化。
   - `components/charts/`: `sparkline.tsx` / `line-chart.tsx`(グリッド・軸目盛・hollow ドット・area オプション・凡例)/ `gauge.tsx` / `h-bar.tsx` / `bar-line-chart.tsx`。すべて Server Component・ライブラリなし。
   - **null 契約(Round 1 決着)**: 折れ線系 = splitSegments で欠測区間を分割描画 / **gauge = 値 null なら中央に「—」+ リングは背景色のみ** / **h-bar = 値 null ならバー長 0 + na 色 + 値表示「—」**。条件1 のテストでゲージ・バーの null ケースも判定。
2. **フォントのセルフホスト化(方針変更)**: `@fontsource/ibm-plex-sans-jp` と `@fontsource/ibm-plex-mono` を**exact pin(^ なし)**で依存追加し、layout で weight サブセットを import。**ビルド・実行ともネットワーク非依存を維持**(node_modules から同一オリジン配信)。IBM Plex は **OFL-1.1**(セルフホスト再配布可・パッケージに LICENSE 同梱)。数値・タグ・軸ラベル等へ Mono を適用(`--font-mono` 変数)。
   ※ ui-shell 基本設計 §1「Web フォント配信なし」の**明示的上書き**(同 §6 問い#1 の決着)— **被変更側への注記追随を条件10 でゲート**(前例: auth/ingestion/ui-shell の注記方式)。
3. **globals.css の拡張**: 不足トークン4種(`--grid: oklch(0.28 0.013 255)` / `--panel-row: oklch(0.165 0.012 255)` / `--line-row: oklch(0.24 0.014 255)` / `--line-faint: oklch(0.22 0.013 255)`)+ `--font-mono` + `.panel` クラス(radius 12px / padding 18px 20px)+ `@keyframes ckfade / ckblink` + scrollbar / selection(`ckspin` は MoC 内でも未使用 — 移植しない)。「Web フォント配信なし」の既存コメントも更新。
4. **SC-02 のリッチ化**(app/(shell)/page.tsx):
   - KPI カード: 数値 Mono 28px/600・差分 pill(色 14% アルファ)・**6週スパークライン**(reward・QG の2カード。**記録件数カードにはスパークラインを付けない** — weeklyTrend に件数系列がなくデータ拡張を避ける。旧問い#4 の決着)。
   - 横断タイムライン: `line-chart`(reward = area 付き・QG = 線・グリッド・軸目盛・hollow ドット・凡例は**実描画系列のみ**)。
   - **品質ゲート円形ゲージ + 内訳バー**: ゲージ = 今週の qgPassRate。**内訳 = pass / 非 pass の2値**(`qgPassRate × recordsByType の quality 件数`から**表示層で導出** — データ変更なし。MoC の内訳3項目(lint 等)は実データに存在しないため置き換え — Round 1 G1 の決着)。
   - 最近の判断ログ: 行カード化(bg `--panel-row`・タグ pill)。**lib/data/overview.ts の recentDecisions に `tags` 列を追加取得**(SELECT 列追加のみ)。
5. **SC-05 のグラフ化**(app/(shell)/retro/page.tsx — 既存テーブルは残し、上部にチャートを追加):
   - judge 3軸折れ線(`line-chart` 3系列)— **軸 0-1**(実データ準拠)・目盛 toFixed(2)。
   - 4シグナル横バー(`h-bar` ×4)— **対象 = 最新バケット(今週・進行中)**・null は na 表示(Round 1 G3 の決着)・バー長 = 生の true 率・**色は SIGNAL_DIRECTION で個別方向**(達成系: 高=good / 発生系: 高=bad)・「低いほど良い + 今週(進行中)」注記。
   - 報酬×QG 複合チャート(`bar-line-chart`・y 目盛なしは MoC 踏襲)。
   - 集計ロジック(lib/data/review.ts)・テーブルは**不変**。
6. **トップバー同期ドットの ckblink 適用**(app/(shell)/layout.tsx への軽微変更 — 旧問い#5 の決着: スコープに含める。シェル契約の退行は条件7 の ui-shell 条件6 再実行で検知)。
7. **M2 以降への規範(恒久ルール)**: 新画面の設計は「画面設計書の該当 SC + MoC HTML の該当ブロック」を意匠規範とし、チャートは components/charts を再利用・不足部品はここに追加。**前 goal が新設したテストは次 goal の凍結列挙に編入する**(テスト世代管理の一般則 — Round 1 arch の決着)。この規範を画面設計書 §7 に追記する。
8. **描画規約(恒久)**: `dangerouslySetInnerHTML` を使わない(grep ゼロで機械判定)。チャート部品の色 props は**トークン変数文字列(`var(--…)`)のみ**を受け、SSoT 由来文字列を style へ流さない。

### やらない(ui-polish では対象外)
- 今日の着手候補 / オープンタスク KPI(M3 — SC-02 にブロック枠も置かない)。
- SC-01/03/04/06/07 の意匠(各マイルストーンで規範に従う)/ 壁打ちオーバーレイ(M4)/ ライトテーマ / モバイル最適化。
- チャートライブラリの導入(手書き SVG で全ブロック再現可能 — 調査 §6)。
- DB スキーマ変更 / SSoT アクセス / 集計ロジックの変更(**データ層の変更は recentDecisions への tags 列追加、ただ1点** — 内訳バー等は既存データから表示層で導出)。
- weeklyTrend への件数系列追加・inbox 履歴化(データ拡張を伴うため — 必要になったら別トピック)。

---

## 2. アーキテクチャ上の位置づけ

**App 層(第3層)の表示層のみ**。データ層の変更は lib/data/overview.ts の tags 追加(SELECT 列追加)1点に限定し、
**SQL の不変条件(`WHERE status = 'ok'` / `user_id = $1 AND processed_at IS NULL`)は grep ピンで機械判定**(条件6 — Round 1 sec G2 の決着)。

```
lib/ui/chart.ts(純関数)→ components/charts/*(薄い SVG 部品)→ 画面2枚 + layout(ドットのみ)
app/globals.css(トークン・アニメ拡張)/ @fontsource(node_modules から自己配信・exact pin)
```

- 認可・ルート・proxy・集計契約は不変(diff 凍結 + **二層防御の第2層 = ui-shell 条件6 の再実行**で機械判定 — sec G3 の決着)。
- フォント・チャートとも実行時外部リクエストゼロ(禁止文字列 grep で機械判定 — sec G4 の決着)。

---

## 3. データ / インターフェース概要

| IF | 契約 |
|---|---|
| `lib/ui/chart.ts` | `scaleLinear` / `splitSegments`(null 分割)/ `linePath` / `areaPath` / `gaugeDash(pct, r)` / `normalizeLocal`。純関数・DOM 非依存 |
| `components/charts/*` | props = データ配列 + 色(**`var(--…)` トークン文字列のみ**)+ 寸法既定値(調査 §2/§3 の viewBox)。null 契約は §1-1 のとおり |
| `lib/data/overview.ts` | `recentDecisions` に `tags: string[]` を追加(SELECT 列追加のみ。他の SQL・型・関数は不変 — grep ピンで判定) |
| `lib/ui/score.ts` | `SIGNAL_DIRECTION: Record<SignalKey, 'high-good' \| 'high-bad'>` を追加(completed / artifacts_exist = high-good、excessive_edits / retry_detected = high-bad)。既存 API 不変 |
| `app/globals.css` | §1-3 の追加トークン・クラス・アニメーション |
| フォント | @fontsource 2パッケージ(**exact pin**)。Sans JP 300/400/500/600/700・Mono 400/500/600 を layout で import |

---

## 4. リスク・トレードオフ

| 論点 | 判断 | トレードオフ |
|---|---|---|
| フォント方針の変更(配信なし → セルフホスト) | @fontsource・exact pin | ui-shell 基本設計 §1 の明示的上書き — **被変更側注記 + grep ゲート(条件10)**。ui-shell 詳細の package* 凍結条件は main 基準のためマージ後は自己解消(文書上の規範のみ注記で整理)。OFL-1.1 で再配布適法 |
| ゲージ内訳のデータ欠如 | **pass / 非 pass の2値に再定義**(表示層導出) | MoC の3項目内訳(lint 等)は実データに無い — 無いデータを飾らない原則を維持しつつゲージ+内訳の意匠は再現 |
| 4シグナルの対象バケット | 最新バケット(今週・進行中)+ na 許容 | MoC の「当週」表現と一致。部分週の分母極小は既存の「今週(進行中)」注記で許容 |
| MoC の null ガード欠如 / 死に凡例 | 移植しない(全部品に null 契約・凡例は実描画のみ) | MoC より堅牢(見た目は同一) |
| judge 軸 0-5(MoC)vs 実データ 0-1 | 0-1 軸に置換 | screen-design §7.2 の読み替え方針と一貫 |
| テスト世代管理 | **前世代テスト(overview-data / score-level / redirects 含む)を全凍結**・新テストは新ファイルへ | recentDecisions は既存テストの対象外(grep 0件確認済み)のため凍結可能。SIGNAL_DIRECTION 等の新テストは tests/chart.test.ts 等の新設に置く |
| 視覚忠実度の機械判定不能 | 構造の機械判定 + 手動チェックリスト | スクリーンショット比較は導入しない。**実画面のスクリーンショットを repo / PR に保存しない**(実データが写るため) |

---

## 5. 受け入れ条件(機械判定)

すべて exit code 判定(実コマンドは detailed-design で実ファイルに照合して確定)。

1. **チャート純関数とテスト**: `lib/ui/chart.ts` + 新テスト(`tests/chart.test.ts` 等)に
   (a) splitSegments(null 分割・全 null・単点)(b) linePath/areaPath 座標 (c) gaugeDash(0 / 0.5 / 1)
   (d) normalizeLocal(定数列・単調列)(e) **gauge / h-bar の null 契約**(§1-1)のケースを含み `npm test` exit 0。
2. **部品の存在と使用 + 描画規約**: `components/charts/` 5部品が存在し、SC-02 が sparkline・line-chart・gauge を、SC-05 が line-chart・h-bar・bar-line-chart を import(grep)。**`dangerouslySetInnerHTML` が app/ components/ lib/ に 0 件**(集計型 grep)。
3. **トークン・スタイル拡張**: globals.css に `--grid` `--panel-row` `--line-row` `--line-faint` `--font-mono` `ckfade` `ckblink` `::-webkit-scrollbar` `::selection` が存在 + `oklch(` 出現数 ≥ 14(**出現数計上 — `grep -o | wc -l`**。行数計上の grep -c は使わない)。
4. **フォント(依存とネットワーク非依存)**: package.json に @fontsource 2パッケージ(exact pin — バージョンが `^`/`~` なしの grep)。
   **package.json と package-lock.json の追加が @fontsource スコープのみ**(diff 増分の機械判定 — 実コマンドは detailed-design)。
   layout で両 import(grep)。**`fonts.googleapis.com` / `fonts.gstatic.com` / `next/font/google` が app/ components/ lib/ に 0 件**(集計型 grep)。
5. **読み替えの担保**: `SIGNAL_DIRECTION` が score.ts に存在し4キーの方向値が §3 どおり(grep)、retro がそれを参照(grep)。judge 軸 0-1 はチャート部品への domain 指定の grep + 純関数テストで担保(詳細は detailed-design)。
6. **データ層の制約(grep ピン + 凍結)**:
   `git diff --exit-code main -- proxy.ts lib/ingestion db/migrations lib/auth app/logout app/api app/login app/auth next.config.mjs lib/data/review.ts` exit 0 /
   **既存テスト全凍結** = ui-shell 詳細 §4-4 の列挙 + `tests/overview-data.test.ts tests/score-level.test.ts tests/redirects.test.ts` を編入(diff exit 0)/
   **overview.ts の SQL 不変条件ピン**: `WHERE status = 'ok'` の**出現数 = 2**(集計・recentDecisions の両クエリ — 片方からの脱落を検知)+ `WHERE user_id = $1 AND processed_at IS NULL` の**全文一致 grep**(inbox の本人スコープ — capture.md 契約)。
7. **境界・二層防御の再実行**: check-no-secrets / M1 条件8 / server-only 各 exit 0 + **ui-shell 条件6(基本 §5-6)の再実行**(全6ページ requireUser・admin の isAdmin+notFound・layout の signOutAction/isAdmin — layout 変更(§1-6)後の退行検知)。
8. **ビルド・実機**: ダミー env で `npm run build` exit 0。実機(**ui-shell 詳細 §4-2 の手順** — app 停止・port 3300・ダミー env・SYNC_SOURCE=fixture)で未認証 `/` `/retro` → 307(退行なし)。
9. **規範の追記**: `grep -q "components/charts" docs/design/ui/screen-design.md`(§7 への M2 以降規範)。
10. **被変更側の注記追随**: `grep -q "ui-polish" docs/design/basic/ui-shell.md`(§1 フォント行への上書き注記 — 担い手 = 主セッション・前例どおり)。

**手動確認チェックリスト(機械判定外・/goal 完了後にユーザーが実施)**:
screenshots/sc02-overview.png・sc05-retro.png との目視比較 — (a) パネル角丸・余白 (b) 数値の Mono (c) タイムラインの面+線+ドット (d) 円形ゲージ (e) SC-05 の3チャート。**実画面のスクリーンショットは repo / issue / PR に保存しない**。

---

## 6. 未解決の問い

1. **ckfade の適用方式**(template.tsx か CSS のみか)— detailed-design。
2. **フォント weight の最終サブセット**(バンドルサイズ実測後)— detailed-design。
3. **SC-05 のチャート/テーブル併置レイアウト** — detailed-design。
4. **「MoC 準拠規範 + テスト世代管理」の rules/ 昇格** — 現状は本設計 + screen-design §7。恒久化の要否は M2 設計時に判断。
5. **/goal 分割** — 方向性は「純関数・部品・トークン先行 → 画面適用」の2分割(UI-A/B 型)。確定は detailed-design。

---

## 次の手順

`/design-review ui-polish` 再レビュー(Round 2)→ 全 PASS で `/detailed-design ui-polish` → `/goal`。
