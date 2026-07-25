# 基本設計: today-board-interactive(/today カンバン操作 + UI モーション)

- 起点: 2026-07-25 ユーザー決定「ステップ2 = 案1第1弾(カンバンのフロント変更)+ 案3(グラフに動き)を1トピックで」
  (docs/setup/next-actions.md 再開手順4)。
- 対象画面: /today(カンバン)・/(概観)・/retro(モーションのみ)。

## 1. 目的 / スコープ

### やる — A. カンバン操作(案1第1弾)

1. /today の3レーン(バックログ/着手中/完了)に **capture カード**を追加合流する:
   - 対象 = `capture_inbox` の **`kind IN ('next_move','issue')` AND `deleted_at IS NULL` AND 本人行**。
   - **status → レーンのマップ = open→todo / in_progress→doing / done→done**(CT-1 の語彙をそのまま使う。
     マップは純関数 `laneOfCaptureStatus` として切り出しユニットテスト対象)。
   - 完了レーンの capture 表示上限 = **8**(WBS の DONE_LIMIT と同じ規範・created_at 降順)。
   - レーン内の並び: capture カードを先頭ブロック(created_at 降順)、WBS カードは従来位置(既存ソート不変)。
2. カードの視覚区別: capture カードは kind バッジ(「次の一手」/「課題」)+ アクセント枠。
   `processed_at IS NOT NULL` の行は「整理済み」バッジ(M5 整理ループの成果の可視化)。
   **WBS カードは従来どおり読み取り専用**(操作 UI を付けない)。
3. 操作(capture カードのみ):
   - **ボタンが正**: 各カードに「→ 着手」「→ 完了」「← 戻す」(現レーンに応じて表示)。
   - **HTML5 ネイティブ D&D は enhancement**(draggable + drop レーン。**ライブラリ追加なし** — ルール5)。
     モバイル等 D&D 不能環境でもボタンで全操作可能。
   - **dataTransfer に載せるのは capture の id のみ**(`setData("text/plain", <id>)` — 本文・topic 等は
     載せない。ネイティブ D&D の dataTransfer はブラウザ外へのドロップでも読めるため、個人メモ本文が
     OS レベルの持ち出し経路に乗るのを防ぐ — sec レビュー R1)。§5-5 に grep ピン。
   - どちらも**既存 Server Action `updateCaptureStatus` を呼ぶ**(新しい書き込み経路を作らない)。
4. データ/契約(**スキーマ変更なし・マイグレーションなし**):
   - 取得: `lib/data/capture.ts` に **SELECT のみの新関数 `listBoardCaptures(userId, limit?)`** を追加
     (id, kind, topic, body, status, processed_at, created_at のサブセット。$n 束縛・user_id スコープ・
     **LIMIT はクランプ 1..100・既定 100** — listInbox / listTrash と同じ規範。data レビュー R1)。
   - 更新: **既存 `setCaptureStatus`(own-row UPDATE)を再利用。`UPDATE capture_inbox` は3本のまま増やさない**
     (capture.md の UPDATE ガバナンス維持 — 受け入れ条件でピン)。
   - `app/(shell)/capture/actions.ts` の **capture 4アクション全て**(save / updateStatus / delete / restore)に
     **`revalidatePath("/today")` を追加**(カンバンの内容は4操作すべてで変わるため対称に。既存テストは
     `toHaveBeenCalledWith("/capture")` 形式で追加呼び出しに寛容 — 確認済み。data レビュー R1 の非対称指摘を解消)。
     /today は `force-dynamic` + 操作後 `router.refresh()` が正で、revalidatePath はクライアントルータ
     キャッシュの明示パージとして機能する。
   - 未処理バッジ(status='open' 基準)は移動で自然にカウントダウン(CT-1 と同一挙動・変更なし)。
5. 実装配置: kanban 部分を client component **`app/(shell)/today/board.tsx`** に切り出す
   (D&D/ボタンのため。サマリーチップ・最終同期表示はサーバーのまま)。

### やる — B. UI モーション(案3)

6. **ライブラリ追加なし**(CSS/SVG ネイティブ + 極小 client component)。すべて
   **`@media (prefers-reduced-motion: no-preference)` ガード内**(globals.css)。
   - **SVG 線描画アニメ**: `pathLength={1}` + `stroke-dasharray: 1` + keyframes
     `from { stroke-dashoffset: 1 }`(終値は要素の計算スタイル = 追加の per-要素パラメータ不要)。
     対象 = LineChart / Sparkline の折れ線 path・Gauge の前景弧・BarLineChart の折れ線。
   - **バーの伸長**: HBar / BarLineChart の rect は transform: scaleY(またはscaleX)の ckgrow(origin を根元に固定)。
   - **入場フェード**: カード・パネルに既存 `ckfade` を適用拡大(stagger は inline `animationDelay`)。
   - **数値カウントアップ**: 新規 client component `components/motion/count-up.tsx`
     (rAF・450ms・reduced-motion 時は即時値・依存なし)。適用 = 概観 KPI 数値・/today サマリーチップ。
7. **front-check との整合(構造ピン)**:
   - アニメは**非レイアウト系プロパティのみ**(opacity / stroke-dashoffset / transform)。
     **SVG `<text>` の位置・サイズは一切動かさない**(重なり検出の前提を壊さない)。
   - **総時間(delay + duration)≤ 450ms**(e2e の 500ms 静定待ち以内に必ず完了)。
     stagger の animationDelay 上限 300ms・duration 上限 150ms…等の配分は実装裁量、合計 450ms が上限。
   - count-up は **hydration 後に開始**するため静定タイマー起点とずれ得るが、判定への影響はない:
     対象は **HTML 数値(SVG text ではない = 重なり検出の対象外)**で、アニメ中間値の桁数 ≤ 最終値のため
     overflow 判定も動かさない(arch レビュー R1 の問いへの回答として明記)。
8. e2e(front-check)の拡張: `AUTHED_PAGES` に **`/today` を追加(5→6画面)**。あわせて FC-1 の命名ミスを修正
   (`"/"` の name は "today" → **"overview"**。スクリーンショットのファイル名が変わるのみ・gitignore 内)。

### やらない

- **WBS カードの移動・編集**(第2弾 = オーバーレイ差分、第3弾 = organize-loop PR 還流 — 別設計。
  SSoT 読み取り専用は本設計でも不変)。
- スキーマ変更・マイグレーション・新しい UPDATE 文・kind 語彙の変更。
- D&D ライブラリ(dnd-kit 等)・アニメライブラリ(framer-motion 等)の導入。
- e2e への操作系イベント(D&D・クリック)の追加(front-check の「操作系イベントを行わない」原則を維持 —
  D&D の動作確認は手動チェックリスト)。
- 概観/retro のチャートの**データ・レイアウト変更**(動きだけ。座標計算・PAD 等は FC-1 の修正値を維持)。
- capture カードでの **tags の表示・フィルタ**(意図的省略 — カードは topic/body の要約表示に絞る。
  tags 活用は検索側の領分)。

## 2. アーキテクチャ上の位置づけ

- **App 層のみ**。Ingestion・Index/Search・スキーマに非接触。
- capture の書き込みは**既存の own-row 経路1本に収斂**(UI の入口が /capture と /today の2つになるだけで、
  Server Action・データ関数・SQL は同一)。黄金ルール1(SSoT 読み取り専用)への影響なし —
  カンバンで動くのは **cockpit ローカルの capture 行のみ**で、WBS(board_items)は表示専用のまま。
- client component の追加は board.tsx / count-up.tsx の2つに限定(重い処理なし・索引済みデータの表示と
  status 更新のみ)。

## 3. データ / インターフェース概要

```ts
// lib/data/capture.ts(SELECT のみ追加)
export type BoardCaptureRow = {
  id: string; kind: "next_move" | "issue"; topic: string | null; body: string;
  status: CaptureStatus; processedAt: string | null; createdAt: string;
};
export async function listBoardCaptures(userId: string, limit?: number): Promise<BoardCaptureRow[]>
// WHERE user_id = $1 AND kind IN ('next_move','issue') AND deleted_at IS NULL
// ORDER BY created_at DESC LIMIT $2(クランプ 1..100・既定 100 — listInbox と同じ規範)

// lib/data/today.ts(純関数追加 — ユニットテスト対象)
export function laneOfCaptureStatus(status: CaptureStatus): "todo" | "doing" | "done"
// open→todo / in_progress→doing / done→done

// app/(shell)/today/board.tsx(新規 client)
// props: columns(WBS 3レーン・既存 TodayCard)+ captures(BoardCaptureRow[] を laneOf でレーン分配済み)
// 操作: ボタン/drop → updateCaptureStatus({id, status}) を useTransition で呼び router.refresh()

// components/motion/count-up.tsx(新規 client)
// props: value(表示最終値)・format(表示関数は親から文字列で受ける形にせず数値+桁指定で決定的に)
```

- `updateCaptureStatus` の入出力・検証(UUID・語彙・own-row rowCount 0 → bad_request)は**不変**。
- globals.css 追加 = `@media (prefers-reduced-motion: no-preference) { @keyframes ckdraw / ckgrow … }`。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| アニメが e2e の静定(500ms)後も動き重なり誤検出/ちらつき | 総時間 ≤ 450ms を設計ピン(§1-7)。アニメは非レイアウト系のみ・text 非対象。e2e 6画面 green が受け入れ条件 |
| native D&D がモバイル/一部環境で効かない | **ボタンが正・D&D は enhancement**(§1-3)。全操作がボタンで完結 |
| revalidatePath 追加が凍結テストと衝突 | 事前確認済み: 既存は `toHaveBeenCalledWith("/capture")` で追加呼び出しに寛容。凍結例外なし |
| /today に capture カードが混ざり WBS と混同 | kind バッジ + アクセント枠 + 「整理済み」バッジで区別(§1-2)。WBS 側に操作 UI を付けない |
| done レーンの capture が無限に溜まる | 表示上限8(DONE_LIMIT と同じ規範)。整理ループが processed → いずれ「整理済み」で沈む |
| count-up が hydration 差分を生む | 初期レンダは最終値を出し、マウント後にアニメ開始(SSR/CSR の DOM 一致)。reduced-motion 時は即時値 |
| **M5 mark によるレーンジャンプ**: todo/doing のカード(processed_at IS NULL)も整理ループの消費対象で、mark が status='done' を書くとユーザー操作なしに done レーンへ移動する | **受容(仕様)**。整理ループに拾われた = 完了扱いは M5 の決着(消費対象は status 不問)と整合し、「整理済み」バッジで理由が読める。手動チェックの観察対象に含める |

## 5. 受け入れ条件(機械判定)

判定方式: コメント `# = 0` 等が付くパイプは **stdout の数値比較**で判定する(空 diff 時に grep が
非ゼロ exit を返すのは想定内 — exit code で判定しない。FC-1 と同じ運用)。

```bash
# 1. テスト(ホスト実行・凍結 = 既存ケースの本文・名前・期待値の不変。追記は可)
env -u GITHUB_TOKEN -u DATABASE_URL -u OPENAI_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL -u SPAR_API_KEY npm test  # exit 0
git diff main -- tests/ | grep -c '^-[^-]'   # = 0(削除行なし)

# 2. 新テストのケース名 grep
grep -q "listBoardCaptures" tests/capture-data.test.ts
grep -q "laneOfCaptureStatus" tests/today-data.test.ts || grep -rq "laneOfCaptureStatus" tests/

# 3. UPDATE ガバナンス(capture.md 維持)
[ "$(grep -c 'UPDATE capture_inbox' lib/data/capture.ts)" = "3" ]

# 4. 依存追加なし(D&D・モーション両方ネイティブ)— package.json は完全不変(閉包外)
git diff main -- package.json | wc -l   # = 0(変更行ゼロ。§5-8 の閉包にも含めない — 二重ゲート)

# 5. モーション・操作の構造ピン
grep -q "prefers-reduced-motion" app/globals.css
grep -q "pathLength" components/charts/line-chart.tsx
grep -q "pathLength" components/charts/sparkline.tsx
grep -q "pathLength" components/charts/gauge.tsx
grep -q "pathLength" components/charts/bar-line-chart.tsx
grep -q "ckgrow" components/charts/h-bar.tsx
[ "$(grep -c 'revalidatePath("/today")' 'app/(shell)/capture/actions.ts')" = "4" ]   # 4アクション対称
grep -qE 'setData\("text/plain", [A-Za-z_.]+id\)' "app/(shell)/today/board.tsx"      # drop データ = id のみ

# 6. 型・ビルド
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit    # exit 0
docker compose run --rm -T -e DATABASE_URL=postgres://dummy:dummy@db:5432/dummy app npm run build  # exit 0

# 7. e2e 6画面 green(app 起動 + state.json 前提 — 失効時は e2e:auth 再実行)
grep -q '"/today"' e2e/pages.spec.ts
npm run e2e    # exit 0(6 passed)

# 8. 変更の閉包: git diff main --name-only の全行が次に含まれる
#    lib/data/capture.ts / lib/data/today.ts /
#    app/(shell)/capture/actions.ts / app/(shell)/today/page.tsx / app/(shell)/today/board.tsx /
#    app/(shell)/page.tsx / app/globals.css /
#    components/charts/line-chart.tsx / components/charts/sparkline.tsx / components/charts/gauge.tsx /
#    components/charts/bar-line-chart.tsx / components/charts/h-bar.tsx / components/motion/count-up.tsx /
#    e2e/pages.spec.ts / tests/capture-data.test.ts / tests/today-data.test.ts(既存へ追記)/ tests/chart.test.ts /
#    docs/design/basic/today-board-interactive.md / docs/design/reviews/today-board-interactive.md /
#    docs/setup/next-actions.md
#    ※ package.json / package-lock.json は含めない(§5-4 完全不変の二重ゲート)
```

手動チェック(判定対象外・goal 報告に含める): (a) /today でボタン操作により capture カードがレーン移動し、
/capture の一覧・未処理バッジに即時反映される (b) D&D でも同様(PC ブラウザ) (c) reduced-motion 環境で
アニメが無効になる(DevTools のエミュレーションで確認) (d) 整理ループ有効化後: mark による
todo/doing → done のレーンジャンプが「整理済み」バッジ付きで起きる(§4 の受容挙動の観察)。

テスト観点(§5-1/2 の中身):
- `listBoardCaptures` 契約(tests/capture-data.test.ts 追記): kind フィルタ(status/spar_conclusion を含めない)・
  `deleted_at IS NULL`・user_id スコープ($1)・created_at 降順。
- `laneOfCaptureStatus` ユニット: 3値のマップ + 網羅性(CaptureStatus の全値)。
- チャートは座標計算に変更が無いこと = 既存 chart.test.ts が凍結のまま緑で担保(モーションは CSS のみ)。

## 6. 実装の分割と禁止事項

- **/goal TBI-1**(1本・**主セッション実施 — 黄金ルール4 からの逸脱の明示**(FC-1 と同型): 受け入れ条件に
  `npm run e2e` があり、state.json 失効時は**対話ログイン(e2e:auth)のユーザー往復**が発生し得るため
  executor 分離だと往復コストが大きい。判定分離(ルールの本質)は acceptance-judge で維持・ターン上限 12):
  1. データ層 + 純関数 + テスト → 節目 commit
  2. board.tsx(ボタン正・D&D enhancement)+ page.tsx 統合(page.tsx ヘッダの「クライアントコンポーネントは
     使わない」コメント契約も本設計参照へ更新)→ 節目 commit
  3. モーション(globals.css + チャート + count-up)→ e2e に /today 追加 → 全条件 → 節目 commit
  4. judge(state.json 前提)→ merge --no-ff
- 禁止: `.env` 非接触 / スキーマ・マイグレーション変更 / `UPDATE capture_inbox` の新設 / **新関数・コメントに
  `UPDATE capture_inbox` のリテラルを書かない**(count=3 ピンの汚染防止 — CT-2 と同じ申し送り)/
  WBS(board_items)への書き込み UI / 依存パッケージ追加 / SVG text の位置アニメ /
  **dataTransfer に id 以外(本文・topic)を載せない** / vitest.config.ts・凍結テスト本文の変更 /
  認証系(proxy.ts / lib/auth/)の変更 / **e2e/screenshots・e2e/.auth の内容を gitignore 外へ持ち出さない**
  (FC-1 §6 の恒久ルールを再掲)/ §5-8 allowlist 外のファイル変更。

## 7. 未解決の問い

- なし(WBS カード操作の第2弾・第3弾は next-actions に申し送り済み。案2(AI 動的フロント)は保留 —
  ユーザーの狙い確認待ち)。
