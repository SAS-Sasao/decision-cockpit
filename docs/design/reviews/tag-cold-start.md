# design-review: tag-cold-start(基本)

- 対象: docs/design/basic/tag-cold-start.md
- 実施日: 2026-07-25
- 方式: 3レンズ並行(critic は読み取り専用・実装現物と突き合わせ)

## Round 1 — 結果: **全レンズ PASS**(FAIL 0・非ブロッキングの問い 8)

| レンズ | 判定 | 要旨 |
|---|---|---|
| arch(design-arch-reviewer) | **PASS** | 3層維持・SSoT 読み取り専用不変・進行カーソル(done Set / hasMore / last_commit 据え置き)は順序非依存であることを現物で確認。凍結例外1件の主張は grep で正確。「軽量1枚設計」の省略判断も妥当(スキーマ/API/パーサ/store 非接触) |
| data(design-data-reviewer) | **PASS** | mergeTagVocab の置換セマンティクスは store.ts の `ON CONFLICT (synonym) DO UPDATE` と key-value 等価。tests/ 全45ファイル横断で旧契約ピンは run-sync.test.ts:348 の**1件のみ**と確認(件数/型のみ検証の他テストは無風)。受け入れ grep ピンの衝突なし(「反映される/反映されない」は相互に部分一致しない) |
| sec(design-sec-reviewer) | **PASS** | 並べ替えは isDenied 濾過**後**の pending に対して行われ denylist の上流に割り込む余地なし。秘密の直書きなし(テストは env -u で秘密を明示除去)。破壊的操作なし(rm 対象は再生成可能な tsbuildinfo のみ)。.gitignore 追加はむしろ絶対パス漏洩防止の正方向 |

## 問いへの設計者回答(設計へ反映済み)

| # | レンズ | 問い | 回答 / 反映 |
|---|---|---|---|
| 1 | arch | adapters 順序前提(cc-sier 先頭)の機械的担保が無い | **文書化のみで受容**と §2 に明記。ただし横断伝播メカニズム自体は**クロス adapter 契約テストを新設**して担保(§5 テスト観点に追加)。順序が壊れた場合の劣化は「ai-war-room 初回ランのみタグ薄・次ランで回復」に限定 |
| 2 | arch | merge 呼び出しは `entries.length > 0` ガードの内側か外側か | **内側**。§3 スニペットをガード付きに修正 |
| 3 | data | tags 配列の順序は契約外であることの明記 | §2 に「集合セマンティクス・順序契約外」を明記(getAllTagSynonyms は元々 ORDER BY なし) |
| 4 | data | fetch_failed masters 時の回復経路の記述が楽観的 | リスク表を修正: 回復は「当該レコードの changedPaths 再登場 or 対処B(force)」のみ。自然回復は保証しない(発生条件の重なりが稀なため受容) |
| 5 | data | 部分復元状態(sync_state 残存・tag_synonyms のみ空)は対象外か | 対象外で確定(対処Bの領分)。リスク表に行を追加 |
| 6 | data | store.ts:56 コメント据え置きは意図的か | 意図的(ロード1回の事実は新契約でも真)。§2 に明記・store.ts は不変更 |
| 7 | sec | 閉包 allowlist の機械判定コマンド化 | §5-7 を実行形(`git diff main --name-only | grep -vxF ... | wc -l` = 0)に書き換え |
| 8 | sec | env -u リストのドリフト / repo 横断語彙の意図確認 | env -u は既往 goal 条件のミラー(goal ごとに保守・受容)。repo 横断語彙は**意図どおり**(結合キー設計の狙い・単一ユーザー前提)と §2 に明記 |

## 合格判定

**全レンズ PASS(Round 1)** — 問いはすべて非ブロッキングで、設計者が回答を設計へ反映済み(再レビュー不要)。
/goal TCS-1 へ進む。

## /goal TCS-1 への申し送り

- 凍結例外は **tests/ingestion/run-sync.test.ts:348 の1ケースの反転のみ**(タイトルも新契約に改題)。他の既存テストに触れない。
- merge 呼び出しは既存 `entries.length > 0` ガードの**内側**。
- 新規テスト3群: mergeTagVocab ユニット(置換/追加/空)・コールドスタート契約([record, masters] 列挙順)・クロス adapter 契約。
- 受け入れ条件 §5 はすべて実行形。§5-4 は `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`(incremental キャッシュ非依存の判定)。
- 閉包 allowlist(§5-7)外のファイルに触れない。store.ts はコメント含め不変更。
