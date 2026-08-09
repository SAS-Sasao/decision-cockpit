# design-review: card-review(基本)

- 対象: docs/design/basic/card-review.md
- 実施日: 2026-08-09
- 方式: 3レンズ並行 × 2ラウンド

## Round 1 — **3レンズ全 FAIL**(設計の根幹に2つの誤り)

| # | レンズ | 中核指摘 | 反映 |
|---|---|---|---|
| 1 | arch A / data 2-b / sec K | **「共通処理は api-lib に抽出済み」は事実誤認**。抽出されていたのは SQL 定数と純関数のみで、受理シーケンス(PAT fail-closed → sweep → 同時1件 → 上限 → INSERT → dispatch → 502 固定形 → PAT 非ログ)は route.ts にインライン。しかも設計が **api-lib を diff 0 で凍結**していたため、**共通化が禁止され二重実装が強制される**構造だった | **`lib/review/submit.ts` に受理シーケンスを抽出**し正典を1つに。route.ts の POST はそれを呼ぶだけに書き換え。**凍結は撤回**し、代わりに否定ピン(route.ts の `fetch(` = 0 / PAT = 0、submit.ts の PAT = 1)で移設完了を確認。card 参照付き INSERT は `INSERT_WITH_CARD_SQL` として api-lib に置く |
| 2 | sec B / D | **ワンクリック = 送信文を人が見ない**。review-loop が防御に数えていた「機微情報を書かない」注記は「人が質問文を自分で書く」ことと対で成立しており、サーバ自動生成でその同意ガードが構造的に消える。注入源も「admin 本人が打つ文」から「SSoT 由来の WBS タイトル + 過去の capture 本文」に変わるのに、リスク表は「既存経路と同一」で済ませていた | **確認ステップ(質問文の全文プレビュー・素テキスト描画)を必須化**(摩擦は1クリック分だけ戻す)。§4 に注入源の変化を独立行で受容し直し(private repo・確認ステップ・CI の機械防御は無改造で継承 = 注入が成立しても持ち出し手段がない)。「500字切り詰めは注入対策」という誤った手当ては削除(上限保証の手段と明記) |
| 3 | sec I / data 4-d | **依頼は admin 限定なのに結果の閲覧に認可が無い** — review-loop の 403 契約からの後退 | 結果も **admin 限定**(`listLatestCardReviews()` は admin 時のみ呼ぶ・非 admin には prop を渡さない) |
| 4 | data 1-e | 相互排他 CHECK に **0010 の `(a) = (b)` イディオムを使うと card_kind が nullable なので NULL で素通り**する | イディオムの使用を明示的に禁止し、`CASE` / OR 連結の**全域形**に。制約名までピン + **違反形の拒否実測**を手動ゲートに(0010 と同水準) |
| 5 | data 4-a / 4-b | `DISTINCT ON` の記述が **SQL として成立していない**(ORDER BY 先頭一致が必要)。`card_kind IS NULL` の既存全行が1グループに畳まれ偽のカード行が返る | 正しい形に修正 + `WHERE card_kind IS NOT NULL` で自由入力行を除外・部分索引も同述語に |
| 6 | arch C / data 1-c | **cardKey が「board.tsx の dataTransfer と同じ表記」は誤り**(capture の dataTransfer は素の UUID)。統一と解釈すると TBI-1 の drop 分岐が壊れる | **Map 内部専用の新表記**と明記し dataTransfer とは**別の名前空間**に。生成は単一純関数 `cardKeyOf()`。§5 に TBI-1 の dataTransfer 文字列の不変ピン |
| 7 | arch E / data 2-d | 完了が /today に伝わらない / **stale 行がカードのボタンを恒久ロック** / 同時1件はグローバルなのに UI 抑止はカード単位 | ポーリング(実行中の行がある間)/ stale 超過は「中断」表示でボタン再有効化 / 実行中は全カード無効化 |
| 8 | data 2-a / sec C | 500字の**単位が未定義**。WBS の title は無制限なので **question が 2000 字を超えて INSERT が例外**になる経路が残る | **question 全体を最後にコードポイント単位で切り詰め**る契約に(部品ごとの和に依存しない) |
| 9 | sec F / G / data 2-c | 「識別子のみ受理」を支える **lookup 述語が未定義**(削除済み capture・盤面外 kind・旧世代 WBS を受理し得る) | WBS = updateBoardState と同水準 + **最新世代限定** / capture = `user_id AND deleted_at IS NULL AND kind IN ('next_move','issue')` / 不受理は存在秘匿 |
| 10 | data 1-a / 1-b / 1-d / arch D / G | 世代キーなし / 値域 CHECK なし / **0011 は再実行不可なのに db-recovery.md の replay 手順と衝突** / 閉包ピン・凍結対象の不足 | `card_title` スナップショット / 0009 と同水準の値域 CHECK / 再実行不可を明記し **db-recovery.md 更新を成果物に** / 凍結対象を入れ替え(api-lib・route.ts を外し **organize-role.sql** を追加) |

## Round 2 — **3レンズ PASS**(改訂の副作用を申し送りに)

R1 の指摘はいずれも**機序ごと**取り込まれたことを各レンズが確認。sec は「複製をやめたことで秘密衛生の
漏れが根本解消」「`ReviewSubmitError` の固定 union により GitHub のエラーボディが混ざる経路が型で塞がる」
「0011 の値域 CHECK はアプリ検証の二重化 = R1 の要求以上」と評価。

一方、改訂の副作用として**設計者が消してしまったもの**が見つかり、基本設計に差し戻して反映した:

| # | 指摘 | 反映 |
|---|---|---|
| N-1(最重要) | **改訂で §5 から `isAdmin` のピンが丸ごと消えた**。認可要件は増えた(prepare / submit / page)のに機械判定がゼロ。さらに route.ts を書き換え対象にしたのに review-loop 側の `await isAdmin(` = 2 のピンを引き継いでおらず、**リファクタで POST の 403 が落ちても気づけない** | 認可ピンを復活(prepare / submit は**関数レンジ**で判定 — 既存 updateBoardState は getUser のみで水準が違うためファイル単位の総数では組めない)+ route.ts の `= 2` を維持 + error 語彙の写像ピン |
| N-2(arch) | グローバル同時1件で全カード無効化と決めたが、**判定に必要な情報が設計内に無い**(壁打ち由来の実行中行は `listLatestCardReviews()` に現れない) | `INFLIGHT_SQL` を再利用したグローバル判定を別途1本取る(admin 時のみ・stale 超過は母集団から外す) |
| N-3(arch) | ポーリング述語が §1 と §4 で不一致(押下状態 vs データ状態) | **DB 上で実行中の行がある間**に統一(リロード・別セッションの pending も拾う) |
| N-4(sec) | 確認パネルの**描画形式が未定**。Markdown 描画だと「読んだ文」と「送るバイト列」がズレ、受容根拠が崩れる | **素テキスト**に確定 |
| N-5(sec) | 確認と送信の間にカードが変わる TOCTOU(同意の忠実性は保証されない) | 窓の狭さを根拠に受容 + 「再生成結果が異なれば再確認」を詳細設計で検討と明記 |
| N-6(arch/data) | route.ts の**正典が2文書に割れる**(review-loop 詳細 §2.2 が POST 手順を規定) | **review-loop.md の追随改訂を成果物に追加** |
| N-7(data) | `card_title` が整合制約の被覆外 / stale 閾値が SQL リテラルと UI に二重定義 / 受理順序は grep では守れない | §6 の未解決に記録(詳細設計で決着) |

## 合格判定

**全レンズ PASS** — `/detailed-design card-review` へ進む。

## /detailed-design card-review への申し送り(必須で決着させる順)

1. **route.ts の正典の所在**(arch N-1 / data N-1): submit.ts 抽出後、review-loop 詳細 §2.2 の POST 手順と
   §4 RL-1 の route.ts ピン(4語彙・`isAdmin` = 2)が成立し続けるか。**review-loop.md を同時改訂**して
   閉包 allowlist に含めるか。
2. **認可ピンの再設置**(sec N-1 / arch G): `prepareCardReview` / `submitCardReview` の isAdmin を
   **関数レンジ**で固定する形を確定。
3. **受理順序の担保先**: PAT → sweep2文 → INFLIGHT → daily → INSERT → dispatch の順序は grep で守れない。
   submit.ts のユニットテスト(モック呼び出し順の記録)で担保する形を確定。
4. **グローバル inflight の取得手段**(arch N-2)を §3 の IF と §5 のピンに落とす。
5. **0011 の DDL 確定**: 全域形の CHECK(制約名 `card_ref_shape`)/ 値域 CHECK / `card_title` の被覆と
   長さ上限 / **部分索引の列順と方向**(前5列 ASC + created_at DESC の混在・NULLS 位置 — data N-3)/
   再実行不可の明記 + db-recovery.md の 0010・0011 追記。
6. **lookup の配置**(§5 のプレースホルダを実パスに)と、`LATEST_BOARD_CTE` の文字同一ピン母集団への編入。
7. `INSERT_WITH_CARD_SQL` の列数・列名アサート(実 DB を使えないため型と DB CHECK が最終防御 — data N-6)。
8. 新 Server Action の error 語彙(既存 `updateBoardState` と合わせるか別立てか)・`revalidatePath` の要否。
9. stale 閾値の単一化(api-lib の定数化 or テストでの同値ピン)・`submitReview` の非空保証の責務。
10. CR-1 / CR-2 の**閉包 allowlist(実行形)**。
