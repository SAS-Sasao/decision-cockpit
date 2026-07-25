# design-review: today-board-interactive(基本)

- 対象: docs/design/basic/today-board-interactive.md
- 実施日: 2026-07-25
- 方式: 3レンズ並行(critic は読み取り専用)× 2ラウンド

## Round 1 — arch PASS(問い6)/ data PASS(問い4)/ **sec FAIL 1**(+検討1)

| # | レンズ | 指摘 | 設計への反映 |
|---|---|---|---|
| 1 | sec **FAIL** | **dataTransfer ペイロード未規定** — ネイティブ D&D の dataTransfer はブラウザ外ドロップでも読めるため、素朴実装だと個人メモ本文が OS レベル持ち出し経路に乗る | §1-3 に「**id のみ**・本文/topic 禁止・理由」を明記 + §5-5 に setData の grep ピン + §6 禁止事項 |
| 2 | sec | e2e/screenshots・state.json 持ち出し禁止の再掲 | §6 に FC-1 §6 の恒久ルールとして再掲 |
| 3 | arch | 主セッション実施の逸脱理由が FC-1 より薄い | §6 を「黄金ルール4 からの逸脱の明示」ラベル + e2e:auth 対話往復の実質理由に書き換え |
| 4 | arch/data | §5-4(package.json)の判定基準が二重 | **完全不変**に統一(`grep -v '"e2e'` 削除・閉包にも含めない二重ゲート注記) |
| 5 | arch | 判定方式(空 diff で grep が非ゼロ exit)の明文化 | §5 冒頭に「stdout 数値比較・exit code で判定しない(FC-1 と同運用)」を明記 |
| 6 | arch | count-up の開始時刻ずれと静定タイマーの前提 | §1-7 に「HTML 数値 = 重なり検出対象外・中間値桁数 ≤ 最終値で overflow 不動」を明記 |
| 7 | arch | tags 非表示は意図的か | 「やらない」に意図的省略として明記 |
| 8 | arch/data | listBoardCaptures に LIMIT が無い(listInbox 規範との差) | クランプ 1..100・既定 100 を §1-4/§3 にピン |
| 9 | data | revalidate の非対称(update のみ /today) | **4アクション対称**に変更(save/status/delete/restore すべて + count=4 ピン)。/today = force-dynamic + router.refresh が正で revalidatePath はルータキャッシュパージ、の根拠も明記 |
| 10 | data | M5 mark による todo/doing→done のレーンジャンプ | §4 に**受容(仕様)**として明文化 + 手動チェック (d) に観察項目 |
| 11 | data | 新関数コメントへの `UPDATE capture_inbox` リテラル汚染 | §6 禁止事項に追加(count=3 ピン保護 — CT-2 と同じ申し送り) |
| 12 | arch 軽微 | モーションピンが line-chart のみ / today-data.test.ts「新規可」誤記 / page.tsx コメント契約 | ピンを5チャートに拡大 / 「既存へ追記」に修正 / §6 手順2 にコメント更新を明記 |

## Round 2 — **全レンズ PASS**(R1 指摘の全解消を各レンズが確認・新規重大ギャップなし)

## 合格判定

**全レンズ PASS(Round 2)** — /goal TBI-1 へ進む。

## /goal TBI-1 への申し送り

- **listBoardCaptures の既定 LIMIT は 100**(既存 `clampLimit` の DEFAULT_LIMIT=50 をそのまま流用しない —
  既定値だけ明示指定。arch/data R2 の注記)。
- **setData ピンはメンバアクセス形が必要**(`card.id` 等 — 素の変数 `id` だと `[A-Za-z_.]+id` に不一致)。
  第2の setData 呼び出しを追加しない(§6 禁止の実効面)。
- 4アクションへの revalidatePath("/today") は**1アクション1行**(count=4 ピンの整形前提)。
- 新関数・コメントに `UPDATE capture_inbox` リテラルを書かない(count=3 ピン)。
- page.tsx ヘッダの「クライアントコンポーネントは使わない」契約コメントを本設計参照に更新。
- モーションの総時間 ≤ 450ms・SVG text 非アニメ・BarLineChart の rect は ckgrow(ピンは h-bar 代表)。
- judge 追加確認: dataTransfer に id 以外を載せる setData が無いこと(目視)/ e2e 6画面 green /
  §5 冒頭の判定方式(stdout 数値比較)で実行。
