# 詳細設計: ui-polish(概観・振り返りの MoC 忠実化 + 共通チャート部品)

> 対象基本設計: docs/design/basic/ui-polish.md(design-review Round 2 全レンズ PASS)
> 根拠資料: docs/research/ui-polish-moc-spec.md / docs/design/ui/moc/decision-cockpit.dc.html
> ステータス: **PASS**(design-review 詳細 Round 2 全レンズ PASS — reviews/ui-polish.md 参照。R2 の Low/Med(偽 FAIL 側)は rev.3 で反映済み)
> 作成: 2026-07-12(主セッション執筆)

## 0. 申し送りの決着(reviews/ui-polish.md Round 2)

| # | 申し送り | 決着 |
|---|---|---|
| 1 | 内訳導出の丸め・null 分岐 | **`qgBreakdown(rate, total)` を chart.ts の純関数**として定義し **`Math.round`** でピン(floor は `1 / 49` 型反例で off-by-one — テストに反例ケースを固定表記 `1 / 49` で含める)。`rate=null または total=0 → null` を返し、**表示は gauge / h-bar の null 契約に帰着** |
| 2 | 4シグナルの対象バケット | **granularity 連動**(週/月トグルの最新バケット)。注記文言も連動: 「今週(進行中)」/「今月(進行中)」 |
| 3 | layout への存在ピン | **条件7 に grep 追加**: `getUnprocessedInboxCount` / `getLastSync` が layout に存置(表示のみの退行は手動チェック許容と明記) |
| 4 | package-lock 増分の実コマンド | **エントリキー行方式**(偽 PASS なし): 増分のうち `"node_modules/` を含む行が **@fontsource 以外に 0 件**(新規パッケージエントリの検知として precise。integrity 等の付随行は検査対象外 = 偽 FAIL も出ない) |
| 5 | 色 props の型担保 / lib/db.ts 凍結 | **`type TokenColor = \`var(--${string})\``**(template literal 型)を部品 props に採用 — tsc が非トークン文字列を拒否(grep で存在判定)。**lib/db.ts を凍結リストに追加** |

その他の基本設計の問いの決着:
- **問い1(ckfade)**: `app/(shell)/template.tsx` を新設(ナビゲーション毎に再マウントされる Next の仕組みで、children を `ckfade` の div で包むだけの3行)。
- **問い2(フォント weight)**: Sans JP = **400/500/600/700**(300 は使用箇所が特定できずフォールバックで代替 — 削減)/ Mono = **400/500/600**。計7 import。
- **問い3(SC-05 レイアウト)**: チャートは上部に **2列グリッド**(左 = judge 3軸折れ線・右 = 報酬×QG 複合)+ その下に**4シグナル横バーの横並びカード** → 既存テーブル・一覧が続く。

---

## 1. スキーマ DDL

**変更なし(マイグレーション不要)**。pgvector 次元にも関与しない。
参照列は ui-shell 詳細 §1 と同一 + `timeline_records.tags`(recentDecisions 用・0002 で実在)。

---

## 2. 関数 / API インターフェース

### 2.1 lib/ui/chart.ts(純関数・新設)

```ts
export type TokenColor = `var(--${string})`;  // ※この型への強制キャスト(as を用いた変換)は禁止 — §5・条件2で機械判定。本設計コメントを実装ファイルへ転記しないこと(判定 grep に誤ヒットするため)
export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number;
export function splitSegments(values: (number | null)[]): { startIndex: number; values: number[] }[];
  // POLISH-A で chart.ts に新規実装(page.tsx の旧 buildSegments は A では併存)。B で page.tsx を部品に置換し旧実装を削除
export function linePath(xs: number[], ys: number[]): string;          // "M x0 y0 L x1 y1 …"
export function areaPath(xs: number[], ys: number[], baselineY: number): string;  // line + 底辺で閉じる
export function gaugeDash(pct: number, r: number): { dashArray: string; circumference: number };
export function normalizeLocal(values: (number | null)[]): (number | null)[];  // min=max は 0.5 に写像
export function qgBreakdown(rate: number | null, total: number): { pass: number; fail: number } | null;
  // pass = Math.round(rate * total)・fail = total - pass。rate null / total 0 → null(§0-1)
```

### 2.2 components/charts/(新設・すべて Server Component・色は TokenColor のみ)

| 部品 | props(既定値) | null 契約 |
|---|---|---|
| `sparkline.tsx` | `{ values: (number\|null)[]; color: TokenColor; width?=140; height?=34 }`(area+line・ローカル正規化) | splitSegments で欠測分割。全 null → 空 SVG |
| `line-chart.tsx` | `{ series: { label; color: TokenColor; values: (number\|null)[]; area?: boolean }[]; xLabels: string[]; domain?: [number, number]; width?=640; height?=200; formatTick?: (v)=>string }`(グリッド5本・y 目盛・hollow ドット・凡例は series のみ) | 同上 |
| `gauge.tsx` | `{ value: number\|null; color: TokenColor; caption: string; size?=118 }`(r48・width9・-90°) | **null → 中央「—」+ 背景リングのみ** |
| `h-bar.tsx` | `{ label: string; value: number\|null; color: TokenColor }`(track h7 r4) | **null → 長さ0 + `var(--text-sub)` + 値「—」** |
| `bar-line-chart.tsx` | `{ bars: (number\|null)[]; line: (number\|null)[]; barColor; lineColor: TokenColor; xLabels }`(棒 = スロット42%幅 rx3 45%α・線 = width2.2 + hollow ドット・y 目盛なし) | bar null → 描画スキップ / line は splitSegments |

### 2.3 既存ファイルへの変更

| ファイル | 変更 |
|---|---|
| `lib/ui/score.ts` | `SIGNAL_DIRECTION` 追加。**表記固定(条件5の grep と一致)**: score.ts 内に `SignalKey` を自前定義(parsers 型はサーバ側のため import しない)し、`export const SIGNAL_DIRECTION = { completed: "high-good", artifacts_exist: "high-good", excessive_edits: "high-bad", retry_detected: "high-bad" } as const satisfies Record<SignalKey, "high-good" \| "high-bad">;`(**型注釈でなく satisfies** — 条件5 はキー別固定表記の grep で判定し、型注釈の出現数に依存しない)。既存 API 不変 |
| `lib/data/overview.ts` | recentDecisions の SELECT と row map に `tags` 追加のみ(`WHERE status = 'ok'` ×2・inbox の全文 WHERE は不変 — 条件6 ピン) |
| `app/globals.css` | 追加トークン: `--grid: oklch(0.28 0.013 255)` / `--panel-row: oklch(0.165 0.012 255)` / `--line-row: oklch(0.24 0.014 255)` / `--line-faint: oklch(0.22 0.013 255)` / `--font-mono: "IBM Plex Mono", ui-monospace, monospace`。`.panel`(bg/border/radius12/padding 18px 20px)。`@keyframes ckfade / ckblink`・`::-webkit-scrollbar`(w9・thumb oklch(0.32 0.014 255))・`::selection`(accent 30%)。フォントコメントを「@fontsource セルフホスト(ui-polish)」に更新 |
| `app/layout.tsx` | @fontsource の CSS import ×7(Sans 400/500/600/700・Mono 400/500/600) |
| `app/(shell)/template.tsx` | 新設(ckfade ラッパー — §0 問い1) |
| `app/(shell)/layout.tsx` | 同期ステータスにドット(`ckblink`)追加のみ(getUnprocessedInboxCount / getLastSync / signOutAction / isAdmin は存置 — 条件7 ピン) |
| `app/(shell)/page.tsx` | SC-02 リッチ化(基本設計 §1-4): KPI Mono 28px/600 + 差分 pill + スパークライン(reward/QG)/ line-chart(reward area + QG)/ **gauge + qgBreakdown 内訳バー**(**total = kpis.recordsByType の quality エントリから導出** — 不在なら 0 → null 契約)/ 判断ログ行カード + タグ pill。**buildSegments の chart.ts への移設・置換は POLISH-B で実施**(A では page.tsx を触らない — 中間状態で SC-02 無傷) |
| `app/(shell)/retro/page.tsx` | SC-05 チャート追加(§0 問い3 のレイアウト): judge line-chart(**`domain={[0, 1]}`** — grep 固定表記)・複合チャート・シグナル h-bar ×4(SIGNAL_DIRECTION 色 + granularity 連動注記)。既存テーブル・集計呼び出し不変 |
| `package.json` | `@fontsource/ibm-plex-sans-jp`・`@fontsource/ibm-plex-mono` を **exact pin** で追加(他の変更なし) |

- **主セッション担当(注記2件)**: docs/design/ui/screen-design.md §7 に規範追記(条件9)/ docs/design/basic/ui-shell.md §1 に上書き注記(条件10)。

---

## 3. テスト観点

vitest。実 DB・実ネットワークなし。**新テストは新ファイル**(前世代テストは全凍結 — 基本設計 §1-7)。

| テストファイル | ケース |
|---|---|
| `tests/chart.test.ts`(新設) | splitSegments(null 分割・全 null・単点・先頭/末尾 null)/ linePath・areaPath の座標(2点で手計算一致)/ gaugeDash(0 / 0.5 / 1 — 円周比)/ normalizeLocal(定数列 → 0.5・単調列)/ **qgBreakdown(通常・`qgBreakdown(1 / 49, 49)` → pass=1 の丸め反例 — テストコードに `1 / 49`(スペース入り)の固定表記で記述・rate null → null・total 0 → null)** / **SIGNAL_DIRECTION の4キーと方向値**(high-bad が excessive_edits / retry_detected)|
| 既存テスト | **1文字も変更しない**(overview-data / score-level / redirects を含む全凍結 — 条件6) |

視覚(SVG の見た目)はテストしない — ビルド + 実機 307 + 手動チェックリスト(基本設計 §5 末尾)で担保。

---

## 4. 受け入れ条件(機械判定)

`FROZEN_TESTS`(本書で展開 — 既存17テスト + 基盤): `tests/proxy.test.ts tests/review-data.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion tests/helpers tests/overview-data.test.ts tests/score-level.test.ts tests/redirects.test.ts vitest.config.ts`。すべて exit code 判定。

1. **純関数とテスト**: `test -f lib/ui/chart.ts` + `test -f tests/chart.test.ts`(個別実行)+ `npm test` exit 0。chart.test.ts に qgBreakdown の**丸め反例ケースが存在**: `grep -q "1 / 49" tests/chart.test.ts`(表記は §3 で固定・OR なし)**かつ** `grep -q "qgBreakdown" tests/chart.test.ts`。
2. **部品と描画規約**(集計型):
   ```bash
   fail=0
   for f in sparkline line-chart gauge h-bar bar-line-chart; do
     [ -f "components/charts/$f.tsx" ] || fail=1; done
   grep -q "TokenColor" lib/ui/chart.ts || fail=1
   for p in 'charts/sparkline"' 'charts/line-chart"' 'charts/gauge"'; do grep -qF "$p" "app/(shell)/page.tsx" || fail=1; done
   for p in 'charts/line-chart"' 'charts/h-bar"' 'charts/bar-line-chart"'; do grep -qF "$p" "app/(shell)/retro/page.tsx" || fail=1; done
   # import パス終端(引用符)まで固定 — line-chart が bar-line-chart に部分一致する誤 PASS を排除
   grep -RIn "dangerouslySetInnerHTML" app components lib; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn "as TokenColor" app components lib; s=$?; [ "$s" -ne 1 ] && fail=1   # キャストの抜け道禁止
   exit "$fail"
   ```
3. **トークン・スタイル**: `test -f "app/(shell)/template.tsx"`(ckfade ラッパーの実在 — POLISH-B で成立)+ globals.css に `--grid` `--panel-row` `--line-row` `--line-faint` `--font-mono` `ckfade` `ckblink` `::-webkit-scrollbar` `::selection` の grep 9本 + `test "$(grep -o 'oklch(' app/globals.css | wc -l)" -ge 14`。
4. **フォント**(集計型):
   ```bash
   fail=0
   test "$(grep -c '"@fontsource/' package.json)" = "2" || fail=1                # 2パッケージちょうど(第3の混入も排除)
   test "$(grep -cE '"@fontsource/[a-z-]+": *"[0-9]+\.[0-9]+\.[0-9]+"' package.json)" = "2" || fail=1   # exact pin の肯定判定(数値 semver のみ — URL/tag/範囲指定を拒否)
   git diff main -- package.json | grep '^+' | grep -v '^+++' | grep -v '@fontsource'; s=$?; [ "$s" -ne 1 ] && fail=1
   git diff main -- package-lock.json | grep '^+' | grep '"node_modules/' | grep -v '@fontsource'; s=$?; [ "$s" -ne 1 ] && fail=1
   git diff main -- package-lock.json | grep '^+' | grep '"resolved"' | grep -v '"resolved": "https://registry.npmjs.org/@fontsource/'; s=$?; [ "$s" -ne 1 ] && fail=1   # 供給源判定は resolved 値の先頭形式に固定(URL パス埋め込みの偽 PASS を排除)
   grep -RIn -E "fonts\.googleapis\.com|fonts\.gstatic\.com|next/font/google" app components lib; s=$?; [ "$s" -ne 1 ] && fail=1
   test "$(grep -c '^import "@fontsource/' app/layout.tsx)" = "7" || fail=1      # 行頭 import のみ計上・厳密等値(コメント非計上)
   exit "$fail"
   ```
5. **読み替えの担保**(キー別固定表記 — §2.3 の satisfies 表記と一致・型注釈の出現数に非依存):
   `grep -q 'completed: "high-good"' lib/ui/score.ts` / `grep -q 'artifacts_exist: "high-good"' lib/ui/score.ts` /
   `grep -q 'excessive_edits: "high-bad"' lib/ui/score.ts` / `grep -q 'retry_detected: "high-bad"' lib/ui/score.ts` /
   `grep -q "SIGNAL_DIRECTION" "app/(shell)/retro/page.tsx"` / `grep -q "domain={\[0, 1\]}" "app/(shell)/retro/page.tsx"`(固定表記 — §2.3 で実装指示)。
6. **凍結 + SQL ピン**:
   `git diff --exit-code main -- proxy.ts lib/ingestion db/migrations lib/auth lib/db.ts app/logout app/api app/login app/auth next.config.mjs lib/data/review.ts tsconfig.json scripts/check-no-secrets.sh` exit 0 /
   `git diff --exit-code main -- <FROZEN_TESTS>` exit 0 /
   `test "$(grep -o "WHERE status = 'ok'" lib/data/overview.ts | wc -l)" = "2"` /
   `grep -q "WHERE user_id = \$1 AND processed_at IS NULL" lib/data/overview.ts`(全文ピン)。
   ※ overview.ts への**新規クエリ追加の禁止は宣言 + FROZEN_TESTS + 人間レビューで担保**(機械判定しない — 意図的判断。可変範囲は tags 追加のみ)。
7. **境界・二層防御・シェル契約**: check-no-secrets / M1 条件8 / server-only 各 exit 0 + **ui-shell 条件6(基本 §5-6)再実行** + layout 存在ピン: `grep -q "getUnprocessedInboxCount" "app/(shell)/layout.tsx"` && `grep -q "getLastSync" "app/(shell)/layout.tsx"`(表示のみの意匠差は手動チェック許容)。
8. **ビルド・実機**: **build 手順 = ui-shell 詳細 §4 条件5 相当**(app 停止 → .next 掃除(root 所有時は docker で削除)→ ダミー env build → docker compose start app で復帰)で exit 0。**実機手順 = ui-shell 詳細 §4-2**(port 3300・SYNC_SOURCE=fixture・ダミー env)で未認証 `/` `/retro` → 307。
9. **規範の追記**: `grep -q "components/charts" docs/design/ui/screen-design.md`。
10. **被変更側注記**: `grep -q "ui-polish" docs/design/basic/ui-shell.md`。

**手動確認チェックリスト**(機械判定外): 基本設計 §5 末尾の5点(MoC スクリーンショット目視比較)。実画面のスクリーンショットは repo / PR に保存しない。

---

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal POLISH-A「チャート部品・基盤」(先行)
- **対象設計**: docs/design/detail/ui-polish.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **1, 3(globals 分), 4** が exit 0 + 条件6(凍結・ピン)+ **条件7(check-no-secrets / M1 条件8 / server-only — 走査コストゼロ・ui-shell UI-A の前例どおり)**+ **条件8 の build 部分**(A 成果物の layout import・components がコンパイルされる保証 — **main 壊れ窓の封鎖**。ui-shell redirects 事案の教訓)+ **条件2/5 の A 部分**(実行形):
  ```bash
  fail=0
  for f in sparkline line-chart gauge h-bar bar-line-chart; do [ -f "components/charts/$f.tsx" ] || fail=1; done
  grep -q "TokenColor" lib/ui/chart.ts || fail=1
  grep -RIn "as TokenColor" app components lib; s=$?; [ "$s" -ne 1 ] && fail=1
  grep -q 'completed: "high-good"' lib/ui/score.ts || fail=1
  grep -q 'excessive_edits: "high-bad"' lib/ui/score.ts || fail=1
  exit "$fail"
  ```
- **成果物**: lib/ui/chart.ts / components/charts/ 5部品 / SIGNAL_DIRECTION(score.ts)/ globals.css 拡張 / @fontsource 導入(package* + layout import)/ tests/chart.test.ts。
- **executor**: frontend-engineer。**ターン上限**: 25。**節目 commit**: (a) 純関数 + テスト緑 (b) 部品 + トークン + フォント + **build 緑**。
- ※画面(page/retro)は触らない — 部品は未使用のまま(条件2 の import grep は POLISH-B で成立)。buildSegments の移設も B で行う。

### /goal POLISH-B「画面適用 + 注記」(POLISH-A 後)
- **対象設計**: docs/design/detail/ui-polish.md(本書。/goal 発行時に転記)。
- **達成状態**: 条件 **2, 5, 7, 8, 9, 10** が exit 0 + 条件1/3/4/6 再実行緑。
- **成果物**: SC-02 リッチ化 / SC-05 チャート追加 / layout ドット(ckblink)/ template.tsx / overview.ts の tags 追加 / 注記2件(主セッション: screen-design §7・ui-shell 基本 §1)。
- **executor**: frontend-engineer(画面)+ 主セッション(注記)。**ターン上限**: 25。**節目 commit**: (a) SC-02 + ビルド緑 (b) SC-05 + 実機確認緑。

### 共通の禁止事項
- **凍結対象の変更禁止**(条件6 の diff リスト + FROZEN_TESTS)。@fontsource 2パッケージ以外の依存追加禁止。
- チャートライブラリ・jsdom の導入禁止(SVG 手書き)。`dangerouslySetInnerHTML` 禁止。色 props は TokenColor のみ。
- `.env` 書き込み禁止 / `.claude/settings.json`・hooks 変更禁止 / tsconfig 変更禁止 / SSoT 非接触。
- `api.github.com` / `raw.githubusercontent.com` / `fonts.googleapis.com` / `fonts.gstatic.com` / `next/font/google` の文字列を書かない。
- 実ネットワークをテストに持ち込まない。実画面のスクリーンショットを保存しない。

---

## 次の手順

`/design-review ui-polish`(detail)→ 全 PASS で `/goal POLISH-A` から実装。
