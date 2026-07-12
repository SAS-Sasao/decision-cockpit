# design-review: ui-polish(SC-02/SC-05 の MoC 忠実化 + 共通チャート部品)

対象: docs/design/basic/ui-polish.md(根拠: docs/research/ui-polish-moc-spec.md / docs/design/ui/moc/decision-cockpit.dc.html)

---

## Round 1 — 2026-07-12

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **PASS(条件付き)** | 3層・SSoT・結合キー・軽量拡張は現物照合で整合。Med 2: **凍結テスト列挙の世代ずれ**(ui-shell 新設3テストが凍結外 — 実装と退行網が同時可変)/ **被変更側(ui-shell 設計)への注記追随が条件にない**(前例からの逸脱)。Low 4(条件7 参照の宙吊り・lock 増分・規範の置き場・/goal 方向性) |
| data | **FAIL** | **G1: SC-02 ゲージ内訳バー「status 別件数」のデータが存在しない**(quality_gate_result は自由文字列・OverviewData に内訳なし)+「変更は tags 1点」宣言と矛盾。G2/G3: gauge・h-bar の null 契約と4シグナルの対象バケット未定義。G5: 件数スパークライン採用時のデータ欠如。tags 追加・SC-05 充足性・SIGNAL_DIRECTION・軸 0-1・新トークン値は実地照合で PASS |
| sec | **FAIL** | **G1: package-lock.json が判定・凍結の両方から漏れ**(依存追加の実体が無検査)。**G2: overview.ts の「SELECT 列追加のみ」制約の機械判定なし + 退行網(overview-data.test.ts)が凍結外**。**G3: 二層防御第2層(requireUser)の再検証なし**(307 は凍結済み第1層が返すだけ)。Low: 外部フォント禁止 grep なし / dangerouslySetInnerHTML 規約なし / ckblink 採用時の layout 契約。Info: OFL・pin 方針 |

**総合: FAIL(data/sec)** → rev.2 で決着:

1. **ゲージ内訳 = pass / 非 pass の2値に再定義**(qgPassRate × quality 件数から表示層で導出 — データ変更なし。「tags 1点限定」宣言を維持)。
2. **null 契約を全部品に定義**(gauge = 中央「—」/ h-bar = 長さ0 + na 色)+ 条件1 のテストケース化。4シグナルの対象 = 最新バケット(今週)+ na 許容。件数スパークラインは**不採用**と決着。
3. **テスト世代管理**: 前世代テスト(overview-data / score-level / redirects)を凍結列挙へ編入(recentDecisions はテスト対象外を確認済み → 凍結可能)。新テストは新ファイルへ。「前 goal の新設テストは次 goal の凍結に編入」を規範化(§1-7)。
4. **overview.ts の制約機械化**: SQL 不変条件の grep ピン(`WHERE status = 'ok'` / `processed_at IS NULL`)を条件6 に追加。
5. **二層防御第2層**: ui-shell 条件6 の再実行を条件7 に追加(ckblink による layout 軽微変更の退行検知を兼ねる — 旧問い#5 はスコープ入りで決着)。
6. **依存の機械判定強化**: exact pin 明記 + package-lock の増分 = @fontsource スコープのみ(条件4)+ 外部フォント禁止 grep(fonts.googleapis.com / fonts.gstatic.com / next/font/google)。OFL-1.1 の適法性を明記。
7. **被変更側注記(条件10 新設)**: ui-shell 基本設計 §1 への上書き注記 + grep ゲート。package* 凍結の世代整理(main 基準ゆえ自己解消)も記載。
8. **描画規約(§1-8)**: dangerouslySetInnerHTML 禁止(grep)+ 色 props はトークン変数のみ。
9. 条件8 の実機参照を「ui-shell 詳細 §4-2 の手順」と明示(判定器の宙吊り解消)。/goal 分割の方向性(部品先行 → 画面適用)を問い#5 に明記。

## Round 2 — 2026-07-12(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Round 1 の Med 2 / Low 4 全解消を現物照合(凍結列挙が既存9テスト全被覆・条件10 の grep が空振りでない・実機参照先の実在)。新規 Low 1(layout の overview 関数の存在ピン要否) |
| data | **PASS** | G1 を数理検証(pass/非pass 導出は同一フィルタ由来で分母恒等・**Math.round なら全ケース復元可**)。G2/G3/G5 解消・SQL ピンの実表記一致・前世代テスト凍結の前提(recentDecisions 非参照)裏取り。新規 Low 3(丸め方式・status 出現数・週/月切替と注記)+ Info(計上方式) |
| sec | **PASS** | G1〜G3 解消(lockfile 増分・SQL ピン + 全テスト凍結・ui-shell 条件6 再実行)。新規 Low 1(inbox ピンが宣言より弱い)+ Info 3 |

**総合: PASS(全レンズ)** — R2 の即応可能な指摘は rev.3 で反映済み:
inbox ピンを全文一致(`WHERE user_id = $1 AND processed_at IS NULL`)に強化 / `WHERE status = 'ok'` を出現数 = 2 ピンに / 条件3 の oklch 計上を出現数方式(grep -o)に明記。

### detailed-design への申し送り(非ブロッキング)

1. **[data] 内訳導出(pass/非pass)は `Math.round` でピンし、chart.ts の純関数としてテスト対象に含める**(floor だと 1/49 型の反例で off-by-one)。rate=null 時の表示分岐の帰着先(gauge の null 契約)も明記。
2. **[data] 4シグナル h-bar の対象は week 固定か granularity(週/月)連動か** — SC-05 レイアウト(問い#3)と合わせて確定。注記文言も追随。
3. **[arch] layout への存在ピン**(`getUnprocessedInboxCount` / `getLastSync` の grep)を条件7 に足すか、表示のみの退行は手動チェック許容と明示するか。
4. **[sec] package-lock 増分判定の実コマンド**は偽 PASS 側がないことを確認して確定(@fontsource を含まない integrity 行が増分に混ざる — 素朴な式は偽 FAIL 側で安全)。
5. **[sec] 色 props のトークン限定**の型/テストでの担保方式。lib/db.ts の凍結追加(コスト極小)の要否。

