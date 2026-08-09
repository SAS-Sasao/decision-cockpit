# 基本設計: card-review(/today のカードから AI レビューを依頼する)

- 起点: 2026-08-09 壁打ち決着(next-actions 5.6 の**案C**)。review-loop の有効化後、
  「毎回プロンプトを書く摩擦」が使用頻度の律速になると判断。**質問文を書かずに依頼できる**ようにする。
- ユーザー決定: **結果は依頼元カードに紐づけて表示**(壁打ち履歴に流すだけの軽量案は不採用)。
- 前提: review-loop(RL-1 / RL-2)は本番稼働中。**CI 側(ci-review.yml / scripts/review)は無改造**。
- **R1 反映(3レンズ全 FAIL → 全面改訂)**:
  (1) 「api-lib に抽出済みのものを共有」は**事実誤認**だった(受理シーケンスは route.ts にインライン)。
  → **`lib/review/submit.ts` に受理シーケンスを抽出し、route.ts と Server Action の両方がそれを呼ぶ**
  (正典を1つにする。api-lib の diff 0 凍結は撤回 — 凍結が共通化を禁止する向きに働いていた)。
  (2) **ワンクリックは「送信文を人が見ない」= review-loop の同意ガードを外す**ことだった
  → **確認ステップ(生成された質問文のプレビュー)を必須**にする(摩擦は1クリック分だけ戻す)。
  (3) 結果の閲覧も **admin 限定**に(review-loop の 403 契約からの後退を防ぐ)。
  (4) cardKey / 世代 / lookup 述語 / CHECK の NULL 経路 / DISTINCT ON / 閉包ピンをすべて明示。

## 1. 目的 / スコープ

### 方式の骨格

```
/today のカード(WBS / capture)の [レビュー] ボタン(admin のみ描画)
  → ① Server Action prepareCardReview({ 識別子 })
        認可 → カード lookup(述語は §1-4)→ **質問文を生成して返すだけ**(DB 変更なし・dispatch なし)
  → ② UI が生成された質問文を**そのまま表示**して確認を求める(送信されるものを人が見る)
  → ③ Server Action submitCardReview({ 識別子 })
        認可 → **カードを再 lookup して質問文を再生成**(クライアントの文字列は受け取らない)
        → submitReview()(= route.ts と共通の受理シーケンス)→ カード参照付き INSERT → dispatch
  → CI(ci-review.yml)は無改造
  → /today がカード別の最新レビューを引き、カード上にバッジ + 結果(折りたたみ・admin のみ)
```

**設計の要**: ②で見せた文と③で送る文が**同一である保証**は「同じ純関数に同じカードを入れる」ことで得る
(クライアントに文字列を往復させない)。カードが②③の間に変わった場合は③の生成結果が正
(送信内容は常にサーバの再生成物)。

### やる

1. **`lib/review/submit.ts`(新設)— 受理シーケンスの正典を1つにする**(R1 arch A / data 2-b / sec K):
   - `submitReview({ requestedBy, question, card })` を公開。中身は現 route.ts の POST から**移設**:
     PAT 未設定 = `review_not_configured`(**INSERT より前・fail-closed**)→ sweep 2文 →
     INFLIGHT(`busy`)→ 日次上限(`daily_limit`)→ **INSERT(card 参照込み)** → dispatch
     (204 以外 = `DISPATCH_FAILED_SQL` + `dispatch_failed`)。
   - **PAT を含むヘッダ・リクエストをログに出さない / GitHub のエラーボディを戻り値に載せない**
     (固定の error 語彙のみ)を関数の契約として保持。
   - INSERT は `card` の有無で列が変わるため、**`INSERT_SQL`(既存・2列)と `INSERT_WITH_CARD_SQL`
     (新設)を api-lib に置き**、submit.ts が選ぶ(review_requests に触る SQL の正典は api-lib のまま)。
   - **`app/api/review/route.ts` の POST は submitReview を呼ぶだけに書き換える**(振る舞い不変。
     §5 でエラー語彙・順序の同値をピン)。`api-lib.ts` / `route.ts` の diff 0 凍結は**撤回**。
2. **0011 マイグレーション**(additive):
   - `card_kind text CHECK (card_kind IS NULL OR card_kind IN ('wbs','capture'))`
   - WBS 参照: `card_source text` / `card_file_path text` / `card_item_key text`
     — **0009 と同水準の値域 CHECK**(`card_source = 'cc-sier-organization'` /
     file_path の regex / `position('..' in card_file_path) = 0` / `card_item_key <> ''`。
     いずれも `IS NULL OR …` 形で nullable と両立)
   - capture 参照: `card_capture_id uuid`
   - **依頼時点のスナップショット** `card_title text`(WBS のタイトル / capture の topic)—
     世代ズレで「昔の内容へのレビュー」が新しいカードに貼り付く問題への手当て(R1 data 1-a)。
     表示時に現在のカードと突き合わせ、異なれば「カード内容が変わっています」と注記する。
   - **整合制約(NULL 経路を塞ぐ形で3本)**:
     `card_kind IS NULL` のとき参照列4つがすべて NULL /
     `card_kind = 'wbs'` のとき3点が非 NULL かつ capture_id が NULL /
     `card_kind = 'capture'` のとき capture_id が非 NULL かつ3点が NULL。
     **0010 の `(a) = (b)` イディオムは card_kind が nullable のため使わない**(NULL で素通りする —
     R1 data 1-e)。`CASE` か `(card_kind IS NULL AND …) OR (card_kind = 'wbs' AND …) OR …` の
     全域形にする(最終形は詳細設計)。
   - **索引**: `WHERE card_kind IS NOT NULL` の部分索引(カード別最新1件の取得用・列順は §1-5 の
     クエリに合わせる)。
   - **再適用可能性**: テーブル制約に `IF NOT EXISTS` は無いため、**db-recovery.md の replay 手順で
     2回目にエラー停止する**。0011 は「再実行不可」と明記し、**db-recovery.md 側に 0010 / 0011 の
     追記と replay の注意を入れる**(R1 data 1-d。現状 0009 止まりの列挙も同時に更新)。
   - `review_bot` の GRANT は**変更しない**(列限定 GRANT は列追加で自動拡張されない = CI から新列は
     不可視。§5 で organize-role.sql の diff 0 をピン)。
3. **`lib/review/card-prompt.ts`(新設・純関数)**:
   - `buildCardQuestion(card): string` — 入力は **DB 行から組んだ値オブジェクト**(クライアント文字列を
     直接埋めない)。テンプレートの固定文言は関数内リテラル。
   - **上限保証は question 全体で行う**(R1 data 2-a / sec C): 本文・タイトルを個別に切り詰めた上で、
     **最後に組み上がった question を `QUESTION_MAX_CHARS`(2000)でコードポイント単位に切り詰める**
     (既存 `truncateResult` と同単位)。DB の CHECK 違反による 500 を構造的に起こさない。
   - 500字切り詰めは**上限を守るための手段**であり、注入対策ではない(R1 sec C — §4 の手当て欄から削除)。
4. **カード lookup の述語(サーバ側・厳格)** — 「識別子のみ受理」を成立させる実体(R1 sec F/G):
   - WBS: `updateBoardState` と**同水準**(source 固定リテラル / file_path 形式 / `..` 排除 /
     item_key 非空)+ **最新世代限定**(`LATEST_BOARD_CTE` と同じ選出。title を取るため列を足した
     クエリが要る場合は**選出式リテラルの文字同一**ピンの母集団に加える)。
   - capture: `user_id = <本人> AND id = $1 AND deleted_at IS NULL AND kind IN ('next_move','issue')`
     — 削除済み・盤面外 kind・他人の行は**すべて不受理**。
   - 不受理時は**存在秘匿**(理由を区別しない・既存 `updateBoardState` の規律)。
5. **`lib/data/today.ts` にカード別の最新レビュー取得**:
   - `listLatestCardReviews()` — **`WHERE card_kind IS NOT NULL`** で自由入力行を除外し
     (R1 data 4-b)、`DISTINCT ON (card_kind, card_source, card_file_path, card_item_key,
     card_capture_id) … ORDER BY <同じ列群>, created_at DESC` の**正しい形**で1クエリ(R1 data 4-a)。
   - **admin のときだけ呼ぶ**(非 admin には結果を渡さない — R1 sec I / data 4-d)。
   - 返す形 = `Map<cardKey, LatestReview>`。**cardKey は Map 内部専用の新表記**で、
     `wbs|<filePath>|<itemKey>` / `capture|<id>`。**board.tsx の dataTransfer とは別の名前空間**
     (capture の dataTransfer は素の UUID のまま — R1 arch C / data 1-c)。生成は**単一の純関数**
     `cardKeyOf()` に集約し、SQL 行側とカード側の両方がそれを使う。
6. **`/today` の UI**(board.tsx + page.tsx):
   - カードに **[レビュー] ボタン**(`canReview` prop = サーバで isAdmin 評価。既存 prop 名は
     `canCiReview` だが**別画面・別機能**なので `canReview` とする — 名前の対応は §6)。
   - 押下 → **確認パネル**(生成された質問文の全文 + 「この内容が CI の Claude に送信されます。
     機微情報が含まれていないか確認してください。**送信内容は履歴に残ります**」)→ [送信] / [キャンセル]。
     **描画は素テキスト**(Markdown 描画にしない — 表示とバイト列がズレると「人が読んで確認する」という
     受容根拠が崩れる。R2 sec N-3)。
   - **確認と送信の間にカードが変わった場合**(R2 sec N-2 の TOCTOU): ③は再生成した文を送る。
     ②で見せた文と一致しない可能性を**受容**する(capture 本文は不変・WBS title は再同期時のみ変化 =
     窓は狭い)。ただし③で再生成した question が②と異なる場合は**送信せず再確認を求める**形を
     詳細設計で検討する(実装コストとの兼ね合いで決着)。
   - 実行中(pending / running)= バッジ「AI レビュー中」+ **そのカードのボタン無効化**。
     ただし **stale 閾値(pending 15分 / running 60分)を過ぎた行は「中断(時間切れの可能性)」表示にし
     ボタンを再有効化**する(R1 arch E / data 2-d の per-card ロックの解消)。
   - 完了 = 折りたたみで結果を**既存の安全 Markdown レンダラ**で描画。`run_ref` は `isSafeRunRef` 経由のみ。
   - **完了検知 = ボタンを押したカードがある間だけ 10 秒ポーリング**(`router.refresh()`)。
     ページ全体の常時ポーリングはしない(R1 arch E-1)。
   - 同時1件は**グローバル**なので、実行中は**全カードのボタンを無効化**(押して `busy` を返すより
     UI が正直 — R1 arch E-3)。**判定に必要なのは card 由来行だけでは足りない**(壁打ちパネル由来の
     `card_kind IS NULL` の実行中行は `listLatestCardReviews()` に現れない)ため、
     **`INFLIGHT_SQL` を再利用したグローバル判定を別途1本取る**(admin 時のみ・戻り値は boolean。
     stale 超過行は sweep 前でも「中断」扱いなので**母集団から外す**— R2 arch N-3)。
   - **ポーリングの述語は「DB 上で実行中の行がある間」**(クライアントの押下状態ではない —
     リロードや別セッションで残った pending も拾う。R2 arch N-4)。
   - 既存契約(TBI-1 の dataTransfer / wbs-loop の移動 / laneCounts)は不変(§5 でピン)。

### やらない

- CI 側(ci-review.yml / scripts/review)の変更 / `review_bot` GRANT の変更。
- **クライアントからの質問文送信**(識別子のみ受理・確認画面の文字列も送り返さない)。
- 任意テキストの追記欄(v2 — §6)。
- 日次上限・同時1件の緩和。
- 結果を capture_inbox / SSoT へ還流すること。
- `spar-panel.tsx` / `spar-panel-lib.ts` の変更(codex-spar 契約の凍結を継続)。
- **非 admin への結果表示**(依頼も閲覧も admin 限定 — review-loop の 403 契約を維持)。

## 2. アーキテクチャ上の位置づけ

App 層のみの拡張。review-loop の非同期ブリッジ(アプリ = トリガーと表示 / 実行 = CI)の**入口を1つ増やす**。
結合点(review_requests)も実行者(review_bot)も不変。WBS の識別子は board_overrides と同じ複合キーを使い、
新しい結合キーを発明しない(表示用 cardKey は Map 内部専用と明示)。
**受理シーケンスの正典は `lib/review/submit.ts` 1つ**(route.ts / Server Action はその呼び出し側)。

## 3. データ / インターフェース概要

- 0011 = additive(列追加 + CHECK + 部分索引)。down は列 DROP = **card 参照履歴の不可逆消失**を伴うため
  「適用は人間の承認手順のみ」を down.sql 冒頭に明記(0010 と同型)。
- `submitReview(input)` → `{ ok: true; id } | { ok: false; error: ReviewSubmitError }`。
  `ReviewSubmitError` = `"review_not_configured" | "busy" | "daily_limit" | "dispatch_failed"`(固定集合)。
- Server Action: `prepareCardReview(ref)` → `{ ok: true; question } | { ok: false; error: "not_found" }` /
  `submitCardReview(ref)` → `submitReview` の戻り値 + `"not_found"`。`ref` は識別子のみ。
- `buildCardQuestion(card)` / `cardKeyOf(ref)` — 純関数・テスト対象。
- `listLatestCardReviews()` — admin 時のみ呼ぶ。`Map<cardKey, LatestReview>`。
- 成果物(2 goal): 0011 up/down / submit.ts / api-lib への INSERT_WITH_CARD_SQL / route.ts 書き換え /
  card-prompt.ts / today/actions.ts / today.ts / board.tsx / page.tsx / capture・board lookup /
  テスト / db-recovery.md / **docs/design/detail/review-loop.md の追随改訂**(§2.2 の受理シーケンスが
  submit.ts へ移設されたこと・§4 RL-1 の route.ts ピンの扱い — R2 arch N-1 / data N-1)/
  設計・レビュー記録 / next-actions。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| **注入源の変化(R1 sec B の中核)**: review-loop の受容根拠は「注入源 = admin 本人が打つ質問文」だった。本設計は **SSoT 由来のテキスト(WBS タイトル)と過去の capture 本文**を質問文に載せる | **前提の変化を明示して受容し直す**: WBS の書き手は本人と本人が動かす CI のみ(外部 PR を受け付けない private repo)。ただし「本人が実行時に目視していない文字列が入る」ことは事実なので、**確認ステップで人が読む**(§1-6)+ **CI 側の機械防御は無改造で継承**(allowedTools に Bash・ネットワーク系なし = 注入が成立しても持ち出し手段が無い)。**500字切り詰めは注入対策として数えない**(上限保証の手段) |
| **同意ガードの消失(R1 sec D)**: 「機微を書かない」注記は「人が文面を書く」ことと対で成立していた | **確認ステップを必須**にし、生成された質問文の全文と注記を表示してから送信する。ワンクリック→2クリックの摩擦は受容(それでも「書く」よりは軽い) |
| **capture 本文の複製と論理削除の非整合(R1 data 5-d / sec D-2)**: 削除した本文が question に残る | (a) **依頼できるのは `deleted_at IS NULL` の行のみ**(§1-4)(b) 送信済みの question は**スナップショットとして残る**(review_requests は物理 DELETE なし)— この点を**受容として明記**し、確認ステップの注記に「送信内容は履歴に残ります」を含める |
| **結果の閲覧権(R1 sec I)** | **admin 限定**(依頼と同じ判定)。非 admin には `listLatestCardReviews()` を呼ばない・結果 prop を渡さない |
| **受理シーケンスの二重管理(R1 arch A / sec K)** | **submit.ts に抽出して正典を1つに**。route.ts はそれを呼ぶだけ。§5 で「route.ts に fetch / PAT 読み出しが残っていない」ことを否定ピンで担保 |
| **question が 2000 字を超えて INSERT が例外(R1 data 2-a / sec C)** | **question 全体を最後に切り詰める**(コードポイント単位)。部品ごとの切り詰めの和に依存しない |
| **stale による per-card ロック(R1 arch E-2)** | 表示側で stale 閾値を超えた pending/running を「中断」扱いにしてボタンを再有効化。実際の error 化は次回依頼時の sweep(既存の決着どおり) |
| **完了が /today に伝わらない(R1 arch E-1)** | 実行中のカードがある間だけ 10 秒ポーリング(`router.refresh()`)。常時ポーリングはしない |
| **世代ズレ(R1 data 1-a)** | `card_title` のスナップショットを保存し、表示時に現在の title と異なれば注記。世代キー(commit)は持たない = **タイトル一致までの近似**で受容 |
| **cardKey の衝突・表記誤り(R1 arch C / data 1-b,1-c)** | cardKey は Map 内部専用と明記・生成は単一純関数・`card_source` は DB CHECK で単一値に固定(= source を落としても衝突しない根拠を DB 側に持つ) |
| **0011 の再適用不可(R1 data 1-d)** | 「再実行不可」を明記 + **db-recovery.md の replay 手順を 0010/0011 まで更新**(成果物に含める) |
| **結果表示の XSS** | 既存の安全 Markdown レンダラ + `dangerouslySetInnerHTML` 否定ピン + run_ref 前置一致 |
| **result 内リンクの持ち出し面(R1 sec B-3)** | 既存レンダラは http/https を許容する(`rel="noopener noreferrer"` 付き)。**注入源が拡大した状態でもリンク化を維持することを受容**(閲覧者 = admin 本人のみ・クリックは人の判断) |
| **0011 の本番適用忘れ** | §5 手動ゲートに「main マージ前に適用」を明記(0009/0010 の教訓) |

## 5. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較。**詳細設計(`/detailed-design card-review`)で DDL・IF・ピンを確定**し、
**/goal CR-1**(0011 + submit.ts 抽出 + route 書き換え + card-prompt + lookup + テスト)→
**/goal CR-2**(/today UI + 取得 + e2e)。以下は骨子(最終ピンは詳細設計 §4 が正):

```bash
# 0011(制約名の固定 — 0010 と同水準)
test -f db/migrations/0011_review_card_ref.up.sql && test -f db/migrations/0011_review_card_ref.down.sql
for k in "card_kind" "card_title" "card_ref_shape" "cc-sier-organization" "position('..'"; do
  grep -qF "$k" db/migrations/0011_review_card_ref.up.sql || echo "MISSING ddl: $k"; done
grep -qF "承認手順" db/migrations/0011_review_card_ref.down.sql
# 受理シーケンスの正典が1つ(route は submit を呼ぶだけ)
test -f lib/review/submit.ts && grep -qF "submitReview" app/api/review/route.ts
grep -c "fetch(" app/api/review/route.ts                                   # = 0(dispatch は submit.ts)
grep -c "REVIEW_DISPATCH_PAT" app/api/review/route.ts                      # = 0(PAT の読み出しも submit.ts)
grep -c "REVIEW_DISPATCH_PAT" lib/review/submit.ts                         # = 1
# 質問生成(全体上限・サーバ生成)
grep -qF "QUESTION_MAX_CHARS" lib/review/card-prompt.ts
# Server Action(2段・識別子のみ・認可)— **認可は関数レンジで固定**(R2: 改訂で消してしまった項目)
for k in "prepareCardReview" "submitCardReview" "buildCardQuestion"; do
  grep -qF "$k" "app/(shell)/today/actions.ts" || echo "MISSING action: $k"; done
# prepare / submit の各関数レンジ内に isAdmin 呼び出しが1回ずつ(既存 updateBoardState は getUser のみで
# 認可水準が違うため、ファイル単位の総数ピンは組めない — レンジ抽出で判定する。詳細設計 §4 で確定)
# route.ts 側の既存ピン(review-loop 詳細 §4 RL-1 の `await isAdmin(` = 2)は**書き換え後も維持**する
test "$(grep -c "await isAdmin(" app/api/review/route.ts)" = "2"
# error 語彙 → HTTP status の写像は route.ts に残る(submit.ts は語彙のみ返す)
for k in "review_not_configured" "daily_limit" "busy" "dispatch_failed"; do
  grep -q "$k" app/api/review/route.ts || echo "MISSING status map: $k"; done
# 受理シーケンスの順序(PAT → sweep2文 → INFLIGHT → daily → INSERT → dispatch)は
# submit.ts のユニットテスト(モック順序の記録)で担保する — grep では守れない(詳細設計 §3)
# lookup の述語(capture の3条件)
for k in "deleted_at IS NULL" "next_move" "user_id"; do
  grep -qF "$k" <lookup を置くファイル> || echo "MISSING lookup: $k"; done   # 配置は詳細設計
# 取得(自由入力行の除外・DISTINCT ON の形)
grep -qF "card_kind IS NOT NULL" lib/data/today.ts
grep -qF "DISTINCT ON" lib/data/today.ts
# 既存契約の凍結(diff 0)
git diff main -- "app/(shell)/capture/spar-panel-lib.ts" .github/workflows/ci-review.yml \
  scripts/review docs/setup/organize-role.sql | wc -l                      # = 0
# UI(admin 限定・安全描画・既存カンバン契約の不変)
grep -qF "canReview" "app/(shell)/today/board.tsx"
grep -rln "dangerouslySetInnerHTML" "app/(shell)/today" | wc -l            # = 0
grep -qF 'wbs|${item.filePath}|${item.itemKey}' "app/(shell)/today/board.tsx"   # TBI-1 の dataTransfer 不変
# 閉包(CR-1 / CR-2 それぞれの allowlist で git diff main --name-only | grep -vxF … | wc -l = 0)
# npm test(ホスト)exit 0 / npx tsc --noEmit exit 0 / npm run e2e 6画面 green
```

手動ゲート(ユーザー操作): (a) **0011 を本番適用**(main マージ前)+ **違反形の拒否を実測**
(card_kind NULL + 参照列あり / wbs で capture_id 同時セット / 3点の部分欠落 — 0010 と同水準)
(b) カードから依頼 → **確認パネルに質問文が出る** → 送信 → バッジ → 完了後にカード上で Markdown 表示
(c) 実行中は全カードのボタンが無効 (d) 非 admin ではボタンも結果も出ない
(e) 壁打ちパネルの CI レビュー(既存経路)が引き続き動く(= submit.ts 抽出の非退行)
(f) 削除済み capture・盤面外 kind では依頼できない。

## 6. 未解決の問い

- 任意テキストの追記欄(v2)— 確認パネルで質問文を**編集**できるようにするか。編集を許すと
  クライアント由来文字列が入るので、`/api/review` と同じ `validateQuestion` を通す形になる。
- prop 名の非対称(`canCiReview` = 壁打ちパネル / `canReview` = /today)。統一するか、画面ごとに分けるか。
- 日次上限 10 件が足りるか(ワンクリック化後の実績を見て)。
- 案A(SSoT 横断レビュー)との合流 — WBS カードのレビューは SSoT の文脈も読めた方が精度が高い。
  契約改定を伴うため本設計では対象外。
- `card_title` のスナップショットは「タイトル一致までの近似」。commit 世代まで持つべきかは運用で判断。
  **capture 側は topic が nullable かつ本文の更新経路が無いため、差異検知は実質 WBS 専用**(R2 data N-2)。
- **stale 閾値(15分 / 60分)が SQL 文字列と UI に二重定義される**(現状 api-lib の SQL リテラル内にしかない)。
  定数化して単一化するか、テストで同値をピンするかは詳細設計で決着(R2 data N-4)。
- `submitReview` の入力契約: question の**非空保証**を関数側に持たせるか、呼び出し側2経路の責務にするか
  (R2 arch N-6)。DB の `btrim(question) <> ''` が最終防御である点は不変。
- 新 Server Action の error 語彙を既存 `updateBoardState`(`unauthorized` / `bad_request`)に
  合わせるか別立てにするか / `revalidatePath("/today")` を呼ぶか(ポーリングで代替するか)— R2 arch N-5。
