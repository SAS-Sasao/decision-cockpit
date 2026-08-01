# design-review: today-summary-sync(基本)

- 対象: docs/design/basic/today-summary-sync.md
- 実施日: 2026-08-01
- 方式: 3レンズ並行(critic は読み取り専用)

## Round 1 — **全レンズ一発 PASS**(FAIL 0・問い4)

| レンズ | 判定 | 要旨 |
|---|---|---|
| arch | PASS | laneCounts の入力 = 盤面描画の入力(page.tsx:71/89 → TodayBoard)と同一で「見えている数と一致」が構造的に成立(board.tsx:299 のバッジ式と定義上同一)。否定 grep の現物衝突なし(data.summary.retryRate/rewardAvg は非マッチ) |
| data | PASS | summary 契約凍結(tests/today-data.test.ts:197-207 のピン)と両立する唯一の軽量解。slice(8) 後入力でも「盤面と一致」は真(board.tsx は全件描画・楽観状態なし)。done 端ケース(8件超・slice 落ちオーバーレイ)も両方向で一致維持を確認 |
| sec | PASS | 新規露出は「件数(数値)」のみ・書き込み面/認可変更なし。unknown[] の型強制で本文非参照を契約化。閉包に board.tsx が無いこと自体が client 非接触の担保 |

## 問いへの設計者回答(反映済み)

1. レーン件数の二重定義(board.tsx:299)→ **正典 = laneCounts** と §1-1 に明記(board.tsx は server-only を import できず共有不可・乖離時は laneCounts に合わせる)
2. 欠落レーンの値 → captureLanes のみの件数(テスト観点に追加)
3. テストケース名ピン → 「capture 合算」を §4 に追加
4. /goal 禁止事項 → グローバル禁止(SSoT 接触・破壊的 SQL・force push)を §5 に再掲(goals.md テンプレ準拠)

## 合格判定

**全レンズ PASS(Round 1)** — /goal TSS-1 へ進む。
