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

---

# 詳細設計(docs/design/detail/ui-polish.md)

## Round 1 — 2026-07-12

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | High 2: **条件5 の high-bad 出現数=2 ピンが基本設計の型注釈 IF と自己矛盾**(忠実な実装ほど偽 FAIL・判定が B 初出で A 成果物を縛る)/ **POLISH-A に build ゲートがなく、A 成果物(layout import・components)が npm test をすり抜けて main が壊れる窓**(ui-shell redirects 事案と同型)。Med 2(条件2 の A 部分の実行形未定義 / layout import 判定の行数計上+部分一致)。Low 4 |
| data | **PASS(条件付き)** | qgBreakdown 数理・granularity 連動(月バケット同構造)・SQL ピン出現数・FROZEN 被覆・tags 影響ゼロを実地照合で確認。Med 1(high-bad ピンの制約が実装者に未伝達 — arch High-1 と同根)。Low 3(gauge total の導出経路 / FROZEN の間接参照 / layout import 判定) |
| sec | **FAIL** | Med 2: **`as TokenColor` キャストの抜け道が禁止にも判定にもない**(申し送り#5 の明示要求が未決着)/ **exact pin が否定判定(^/~ のみ)で URL・tag 指定が素通り + lock の resolved 行未検査 → 供給源差し替えの偽 PASS 経路**。Low 3(第3 @fontsource / tsconfig・check-no-secrets.sh の凍結外 / 条件8 の参照ズレ) |

**総合: FAIL(arch/sec)** → rev.2 で決着:

1. **条件5 をキー別固定表記の grep に変更**(satisfies 表記を §2.3 で実装指示 — 型注釈の出現数に非依存)。score.ts 部分は POLISH-A の達成状態に編入。
2. **POLISH-A に条件8 の build 部分を追加**(main 壊れ窓の封鎖 — ui-shell 教訓の明示適用)+ A 用の条件2/5 部分コマンドを実行形で明記 + buildSegments 移設は B と明記(A では page.tsx 不可侵)。
3. **`as TokenColor` を禁止事項 + 集計型 grep に追加**(条件2)。
4. **exact pin を肯定判定に**(数値 semver の出現数 = 2)+ **lock の resolved 行検査**(registry.npmjs.org/@fontsource のみ)+ @fontsource 行数 = 2 の等値ピン(第3パッケージ排除)。
5. layout import 判定を「行頭 import のみ・厳密等値」に / retro の部品 grep を import パス終端まで固定(部分一致排除)/ 条件1 の OR 除去 / FROZEN_TESTS を本書で展開 / gauge total = recordsByType 由来を明記 / SignalKey は score.ts 自前定義 / tsconfig・scripts/check-no-secrets.sh を凍結に追加 / overview.ts 新規クエリは宣言+レビュー担保(意図的)と明記 / 条件8 の参照を build=§4条件5相当・実機=§4-2 に分離。

## Round 2 — 2026-07-12(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS(条件付き)** | High 2 / Med 2 / Low 4 全解消(build ゲート編入で main 壊れ窓閉鎖・キー別 grep と satisfies の逐語一致・判定コマンド全分岐トレースで偽 PASS なし・/goal 割付の和集合が全10条件を被覆)。新規 Med 2 は**いずれも偽 FAIL 側**(§2.1 コメントの禁止リテラル転記トラップ / 「1 / 49」と §3 の表記不一致)+ Low 2(template.tsx 判定なし / splitSegments 分担の二義性) |
| data | **PASS** | Med/Low 全解消を文字単位照合(grep 4本 = satisfies 表記に厳密一致・gauge total の分母恒等・FROZEN 17テスト全被覆・SQL ピン現物一致)。新規 Low 1(反例表記の不一致 — arch と同根)+ Info 2 |
| sec | **PASS** | Med 2 解消 — as TokenColor grep が `as unknown as` 変形も捕捉・供給源差し替えの3経路(URL/tag 指定・resolved 改変・第3パッケージ)を経路別トレースで閉鎖確認。新規 Low 2(resolved 判定のアンカー / POLISH-A に条件7 なし)+ Info 2 |

**総合: PASS(全レンズ)** — R2 の新規指摘は rev.3 で全て反映:
コメントから禁止リテラル除去(転記トラップ解消)/ 反例表記を `1 / 49` に一本化 / template.tsx の test -f を条件3 に追加 / splitSegments の A/B 分担を明記(A=chart.ts 新規実装・B=page.tsx 置換+旧削除)/ resolved 判定を行頭形式に固定 / **POLISH-A に条件7 を編入**(ui-shell UI-A の前例どおり)/ 条件1 の test -f 個別化。

### /goal への申し送り(Info・非ブロッキング)

1. `as TokenColor` の空白/括弧変形・`as any` は grep 外(tsc + build + sink 側防御で実害経路は閉 — 能動的偽装のみ)。
2. lockfile 直書きの第3 @fontsource は機械判定外(信頼境界は @fontsource スコープ内で不変・宣言 + 人間レビュー担保)。
3. SignalKey は parsers 型と二重定義(凍結で本作業中は一致保証。将来のパーサ語彙変更時の突合は将来設計の課題)。

