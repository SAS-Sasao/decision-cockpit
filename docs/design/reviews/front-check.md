# design-review: front-check(基本)

- 対象: docs/design/basic/front-check.md
- 実施日: 2026-07-25
- 方式: 3レンズ並行(critic は読み取り専用)× 2ラウンド

## Round 1 — arch FAIL(2)/ data FAIL(1+条件付き1)/ sec FAIL(4+条件付き2)

| # | レンズ | 指摘 | 設計への反映 |
|---|---|---|---|
| 1 | arch | testing.md「実ネットワーク禁止」の適用範囲が規約本文に無く解釈依存(設計の留保が発動) | **testing.md に適用範囲の限定句を追記**する方針に変更・閉包に testing.md 追加 |
| 2 | arch | 主セッション実施が黄金ルール4/5 からの無説明逸脱 | §6 に理由明記(対話認証の往復・判定分離は acceptance-judge で維持 — M5-B/TCS-1 と同形式) |
| 3 | arch | fail 証跡の保存先・形式・判定手順が未定義 | **e2e/evidence-fc1.md(コミット対象・数値+svg aria-label のみ)**を新設・§5-4 に grep ピン |
| 4 | arch | ベースライン455の出典なし | 「2026-07-25 main 実測」+ 凍結定義参照を §5-2 に固定 |
| 5 | arch | state.json 不在時の judge 挙動が二義 | 「不在の時点で judge を呼ばない・実行時不在は前提未達 FAIL」で一意化 |
| 6 | data | 「凍結テスト変更禁止」と chart.test.ts 追記要求の矛盾 | **凍結の定義を明文化**: 既存ケースの本文・名前・期待値の不変 = 追記は可(§1/§5-2/§6 で同語) |
| 7 | data | gauge.tsx の閉包漏れ(検出時に修正すると閉包違反のデッドロック) | 閉包に gauge.tsx を条件付き追加(検出されなければ無変更)。text を持つ全チャート(line/gauge/bar-line)が閉包内に |
| 8 | sec | **Playwright 既定成果物(trace/video/HAR/test-results/playwright-report)に Cookie・ログイン POST が残る**(根因) | **キャプチャ全無効化**(trace/video/screenshot off・reporter list のみ)+ 成果物5パスを gitignore + grep ピン |
| 9 | sec | state.json = セッショントークン平文保存の認識と境界が無い(§6 と字面矛盾) | §1-3 に明示: 保存先1箇所・表示/ログ/コピー禁止・失効時再生成・残置許容(明示決定) |
| 10 | sec | スクリーンショットへの実データ写り込みの前提・持ち出し禁止が無い | §1-4 に写り込み前提を明示・§6 に gitignore 外へのコピー禁止(docs/コミット/PR/チャット)・証跡の正 = JSON サマリに変更 |
| 11 | sec | E2E_BASE_URL で本番を指せる(cookie/実データ持ち出し経路)+「POST しない」が過大主張 | **機構ごと不採用**(localhost 固定・`! grep` ピン)+ 主張を「操作系イベントを行わない(アプリ JS の通信は制御外)」に修正 |
| 12 | sec | console allowlist の regex 未固定・握り潰し不可視 | 全文アンカー regex・初期2エントリを設計書に明記・無限定パターン禁止・`suppressed` をサマリに必須出力 |
| 13 | sec | e2e:auth 実行時の録画にパスワード POST が残り得る | キャプチャ全無効化が同一 config で e2e:auth にも及ぶことを明記 |

## Round 2 — **全レンズ PASS**(R1 指摘 6+3+6 = 全解消を各レンズが確認)

残る観察(FAIL ではない)への設計者回答:
- **sec Q1**(e2e/*.ts 内で process.env を読む抜け道): 閉包レビューに加え、judge の追加確認として
  `grep -rn "process.env" e2e/` が 0件であることを見る(§6 禁止の実効化)。
- **sec Q2**(修正前後スクリーンショットの位置づけ): ローカル補助資料で確定(保存先は gitignore 済み
  e2e/screenshots/。証跡の正は evidence-fc1.md の数値)。
- **sec Q3 / data**(screenshot:"off"・reporter list の未ピン): judge の追加確認に含める
  (`grep -qE "screenshot:\s*['\"]off['\"]"` / reporter に html が無いこと)。
- **data**(before>0 の数値ピン): evidence-fc1.md の形式を「`overlapPairs(before) = <n>`」の行に固定し、
  judge が n>0 を数値で確認する。

## 合格判定

**全レンズ PASS(Round 2)** — /goal FC-1 へ進む。

## /goal FC-1 への申し送り

- キャプチャ無効化(trace/video/screenshot off・reporter list)と gitignore 5パスは**最初のコミットに含める**
  (ハーネスが一度でも走る前に遮断を効かせる)。
- fail→fix→pass の順序厳守: 重なりを検出できないままチャートを直さない(検出関数の拡張で fail を再現してから)。
- state.json 生成(`npm run e2e:auth`)は**ユーザーの1回操作** — 依頼して待つ。judge はその後に呼ぶ。
- evidence-fc1.md は「overlapPairs(before) = n」「overlapPairs(after) = 0」の数値行 + 対象 svg の aria-label のみ。
- judge 追加確認: `grep -rn "process.env" e2e/` = 0件 / screenshot off・reporter ピン / suppressed の出力実在。
