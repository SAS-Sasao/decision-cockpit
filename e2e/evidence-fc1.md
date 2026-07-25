# FC-1 証跡: fail → fix → pass(2026-07-25)

対象設計: docs/design/basic/front-check.md §1-5 / §5-4。
数値と svg aria-label のみ記載(実データ本文は含めない)。

## 修正前(before)— ハーネス初回実行(commit 6a6388b 時点・3 failed / 2 passed)

- overlapPairs(before) = 4(合計)
  - `/` : 2 — svg「横断タイムライン」(y目盛 × X ラベル)/ svg「今週・進行中」(ゲージ中央値 × キャプション)
  - `/knowledge` : 1 — svg「横断タイムライン」(y目盛 × X ラベル)
  - `/retro` : 1 — svg「横断タイムライン」(y目盛 × X ラベル)
- overflow(before): `/knowledge` = true(1341px / 1280px)・`/retro` = true(1514px / 1280px)
- `/login`・`/capture` = 重なり 0・overflow false(修正前から green)

## 中間(1回目の修正後)

- overlapPairs = 0(全画面)・`/knowledge` overflow 解消。
- `/retro` overflow = true が残存(1431px / 1280px)→ 追加診断で原因 = 集計テーブル(nowrap 12列・幅 1177px)
  → スクロールコンテナ(overflow-x: auto)で解消。

## 修正後(after)— 5 passed / 0 failed

- overlapPairs(after) = 0(全5画面)
- overflow(after) = false(全5画面)
- consoleErrors = 0・suppressed = 0(全5画面 — allowlist の発動もなし)

## 修正内容(閉包 §5-6 / §8 の範囲)

1. line-chart: PAD_BOTTOM 8→20(X ラベル帯をプロット外へ)+ xLabelStep による間引き + svg レスポンシブ化
2. gauge: 中央値(center-6)とキャプション(center+24)の上下分離
3. bar-line-chart: svg レスポンシブ化(maxWidth 100%)
4. retro: グリッド minmax(0, Nfr) 化 + 集計テーブルをスクロールコンテナで包む
5. knowledge: グリッド minmax(0, 1fr) 化 + overflowWrap: anywhere
