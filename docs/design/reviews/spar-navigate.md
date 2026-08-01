# design-review: spar-navigate(基本)

- 対象: docs/design/basic/spar-navigate.md
- 実施日: 2026-08-01
- 方式: 3レンズ並行 × 2ラウンド(R2 は data/sec — arch は R1 PASS)

## Round 1 — arch PASS(問い3)/ data FAIL 1 / sec FAIL 1(+Low 群)

| # | レンズ | 指摘 | 反映 |
|---|---|---|---|
| 1 | sec **FAIL** | href 不変条件「先頭 / のみ」は protocol-relative(`//evil`)を通す・§4 の `startsWith("/")` ピンは危険な実装形を正解例として許す | 不変条件を**「固定リテラル `/knowledge?…`/`/retro?…` 起点・モデル文字列はクエリ値のみ encodeURIComponent 経由」**に述べ直し。§4 は固定リテラル存在ピン(-F)+ **`! grep startsWith` の否定ピン**に変更。テストに protocol-relative ケース |
| 2 | data **FAIL** | extractNavBlock の「末尾フェンス1個」が機械判定に落ちていない(非末尾温存・閉じ欠落・除去後空の境界未定義) | 判定規則を確定(行全体一致の開始行・閉止後は空白/改行のみ・非末尾/閉じ欠落/2個目は本文残置)+ §4-1b で**9観点のケース名 grep に昇格** |
| 3 | sec (d) | 偽 nav フェンスで本文を隠せる(除去後に検証失敗しても本文に戻らない) | **全滅ならフェンスを除去しない(本文復元)**に契約変更 — 無効 nav による隠蔽が構造的に不可能。主張スコープ(有効 nav を伴う省略は守備範囲外)も明記 |
| 4 | sec (a) | q の文字種未検証(bidi/ゼロ幅でラベル視覚偽装)・URL 残留面・クリック時埋め込み送信の系統 | Unicode カテゴリ C 拒否 / §1-6 に受容3点を明示 |
| 5 | sec (b) | dangerouslySetInnerHTML 走査がファイル単体に退行・ラベル主張の精密化 | capture-spar と同じディレクトリ走査形に復帰 / 「構造はサーバ固定・モデル寄与は q 値のみ」 |
| 6 | arch | ケース名の機械判定昇格・実装主体の明示・nav.ts の server-only 慣行 | §4-1b ループ grep / 主セッション実施の逸脱明示(FC-1 同型)/ server-only 付きで統一 |

## Round 2 — **data PASS / sec PASS**(R1 中核の解消を確認)

残問い(実装細則)も反映済み: 除去後空 = trim 判定 / 合成は `applyNavExtraction` に集約(route はそれを呼ぶだけ — テストのトートロジー防止)/ 開始行は行全体一致 / フェンス2個は非末尾ケースに統合 / grep ピンは -F 化。

## 合格判定

**全レンズ PASS** — /goal SN-1 へ進む。

## /goal SN-1 への申し送り

- applyNavExtraction が本文契約の単独の正 — route.ts はこれを呼ぶだけ。テストは合成関数を対象にする。
- §4-1b の9観点(語彙外/4件目/文字種/encode/非末尾/閉じ欠落/本文復元/protocol-relative/除去後が空)を
  it 名の固定語として必ず含める。
- nav.ts に `startsWith` を書かない(否定ピン)。ラベルはサーバテンプレート・href は固定リテラル起点。
- panel の描画は `<a href>` のみ(target=_blank・router.push へのモデル由来文字列は禁止)。
