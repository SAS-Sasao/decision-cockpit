# ui-polish 事前調査: MoC 視覚仕様の抽出(2026-07-12・research-spike)

> ui-polish 基本設計の根拠資料。出典 = docs/design/ui/moc/decision-cockpit.dc.html(デザイン MoC 実 HTML・claude.ai/design から取得)。
> 対象 = SC-02(概観)/ SC-05(振り返り)/ 共通パネル。現実装(app/(shell)/page.tsx・retro/page.tsx・globals.css)との差分込み。

## 1. 共通パネルレシピ

- panel: bg `--panel`・border 1px `--line`・**radius 12px**・padding **18px 20px**(KPI カードは 16px 17px)・box-shadow なし(フラット)
- 見出しラベル: 12px / text-sub / weight 400。パネルタイトル: 13.5px / 600
- セクション見出し(Mono): IBM Plex Mono 10-11px・letter-spacing 0.06-0.1em・muted
- **数値はすべて IBM Plex Mono**(KPI 28px/600・ゲージ中央 26px/600・統計 18-22px)
- **未トークン化の色4種**: グリッド線 `oklch(0.28 0.013 255)` / 行カード背景 `oklch(0.165 0.012 255)` / 行 border `oklch(0.24 0.014 255)` / 細区切り `oklch(0.22 0.013 255)`

## 2. SC-02 のチャート実装(すべて手書き SVG・ライブラリなし)

- **スパークライン**: viewBox `0 0 140 34`・preserveAspectRatio none。area(折れ線 + 底辺で閉じた polygon・fill=系列色 14%)+ line(width2 round)。系列ごとローカル min/max 正規化。**null ガードなし(MoC の欠陥 — 移植時は現実装の buildSegments を踏襲)**
- **横断タイムライン**: viewBox `0 0 640 200`・padding(34/8/8/22)。水平グリッド5本 + y 目盛(Mono 9px・2桁小数)+ x 週ラベル。reward のみ area(opacity 0.13)・gate は線のみ。各点 **hollow-ring ドット**(r2.6・fill=bg・stroke=系列色 1.6)。凡例は SVG 外(スウォッチ 10x10 r3 + 11.5px)。※MoC の凡例3つ目「判断ログ(定性)」は**実描画なしの死に凡例** — 移植しない
- **円形ゲージ**: 118×118・r48・背景リング(グリッド色 width9)+ 前景弧(`stroke-dasharray="C*pct C"`・round cap・-90° 回転)。中央 = 値(Mono 26px/600)+ キャプション(Mono 9px)
- **内訳バー**: track h6 r4 グリッド色 / fill = 単純 div width%
- **判断ログ/着手候補の行カード**: bg 0.165・border 0.24・r9・hover で teal 寄り。タグ = pill(Mono 10px・teal 文字・teal 10% bg)。rework バッジ(Mono 10px amber「↺n」)

## 3. SC-05 のチャート

- **judge 3軸折れ線**: 3系列(teal/green/violet)・area なし・hollow ドット・凡例上部。**⚠️ MoC は 0-5 生値(軸 min3/max5)想定だが、実データは 0-1 正規化済み**(0002 DDL コメント + score.ts 閾値が根拠)→ **軸は 0-1 に置換必須**・目盛は現行の toFixed(2) に統一
- **4シグナル横バー**: ラベル + 値(Mono 12px/600・色分け)→ track h7 r4 / fill div width%。**⚠️ MoC の4項目(完了度/品質ゲート/効率/Git規律)は実データと別物** → 実 signals(completed/artifacts_exist/excessive_edits/retry_detected)に読み替え。**色は個別方向**: 達成系 = 高いほど green / 発生系(excessive_edits・retry_detected)= **高いほど red**(バー長は生値のまま・注記併記)
- **報酬×QG 複合チャート**: 520×190。棒 = QG(rect rx3・teal 45%・スロット幅の42%)+ 線 = reward(green 2.2 + hollow ドット)。グリッド5本・**y 目盛テキストなし(MoC 踏襲)**
- **週次判断ログ並置**: week(Mono 10.5px muted)+ タイトルのみ・細区切り。現実装の方が情報量が多い(出典リンク等)→ 装飾のみ寄せて情報は維持

## 4. フォント

- MoC は Google Fonts 読み込み: Sans JP(300-700)+ Mono(400-600)。数値・タグ・軸など**データ的要素はほぼ Mono**
- 現実装は font-family 宣言のみ(実体未配信 → system-ui 表示)。**これが最大の視覚差分**

## 5. アニメーション・その他(現実装 0%)

- `ckfade`(ビュー表示時 fade+6px 上昇 0.3s)/ `ckblink`(同期ステータスドット点滅 2.4s)/ scrollbar(width9・thumb 0.32)/ selection(teal 30%)。`ckspin` は MoC 内でも未使用(移植不要)

## 6. 判定

- **全ブロックが SVG 基本図形で再現可能・ライブラリ不要**(現行 WeeklyTrendChart と同じ技法の延長)
- 追加注意: MoC のチャート関数は null ガードなし → 現実装の null 分割(buildSegments)を全部品に適用すること
