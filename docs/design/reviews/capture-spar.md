# design-review: capture-spar(M4 キャプチャ + 壁打ち — SC-06)

対象: docs/design/basic/capture-spar.md

## Round 1 — 2026-07-19

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | **High: 条件4「未認証 /api/spar → 401」が現行構成で不成立**(Neon Auth middleware は保護パスに一律 redirect_login(307)・401 経路なし — SDK 現物で確認。requireUser も redirect で 401 不能)。Med 2: 「M2 と同型 dispatch」が現物(モデル名前方一致・既定なし throw)と不一致 — 既定 `openai` は「既定フォールバック禁止」前例と未整理 / searchKnowledge 失敗時(embedding env 起因 throw)の /api/spar 応答契約なし。Low 5(topK≤20 無音クランプ / layout disabled ボタン title の虚偽化 / screen-design §7.1 行の注記漏れ / env -u に SPAR なし / scripts 凍結の解凍宣言) |
| data | **FAIL** | **High: §2「外部通信 = LLM プロバイダのみ」が現物と矛盾** — searchKnowledge は先頭でクエリ埋め込み(EMBEDDING_API_KEY・実ネットワーク)を実行。壁打ち1メッセージ = 埋め込み1回 + チャット1回のコスト・レイテンシ非自覚 + 埋め込み失敗時挙動未定義。Med 2: 「他人の行が返らないテスト」がモック db 前提で同語反復(検証の実体未定義)/ 回帰 env -u に SPAR_API_KEY なし(実ネットワーク禁止の証明が非対称)。Low 7(topK クランプ / refs nullability / 二重送信非冪等 / source 語彙 / topic '' vs NULL / テスト命名衝突 / spar_conclusion の手動投入)。DDL 突合・M5 消費契約との両立・本人スコープ index 適合は現物照合で成立 |
| sec | **FAIL** | **High: 同・認証境界**(matcher 除外宣言も proxy 無差分ピンも handler 内 401 機構もなく実装が即興化)。Med 3: 外部送信の明示が前例水準未達(送信データ列挙なし・埋め込みプロバイダへの送信欠落・UI 告知なし)/ lib/spar の server-only・鍵参照局所化・NEXT_PUBLIC 否定が embedding.ts 前例から後退 / **self-signup 開放中の第三者による LLM コスト消費が無言**(レート制限なしの受容が未宣言)。Low 4(CSRF 受容明示 / LLM 応答・INBOX の描画方針不在 / エラーログへの鍵漏えい方針 / refs リンク化・M5 申し送り)。認可モデル宣言・denylist 供給源・破壊的操作なしは現物照合で健全 |

**総合: FAIL(全レンズ)** → rev.2 で決着:

1. **認証境界の二層化(3レンズ共通 High)**: 実機ピン = 未認証 POST /api/spar → **307**(middleware 保護のまま — **proxy.ts は main と無差分ピン**(search-foundation §5-7 前例))。二層目 = handler 冒頭 `getUser()`(redirect しない現物 API)null → **401 JSON**(**api/sync POST と同型** — ユニットテスト(モック)で機械判定)。
2. **外部送信の2系統明示(data High / sec Med)**: 壁打ち1メッセージ = (a) クエリ埋め込み(埋め込みプロバイダ)+ (b) チャット(LLM プロバイダ)。送信内容(新メッセージ・直近履歴・注入文脈)を §2 に列挙し、**UI に外部送信の告知**を含める。コストガードに「1メッセージ = 埋め込み1回 + チャット1回」を明記。
3. **検索失敗の縮退契約(arch/data Med)**: searchKnowledge 失敗(embedding env 起因 throw 含む)は **文脈なしで継続**(refs: [] + `degraded: true` + UI「文脈なし」表示 — knowledge 画面 searchError 縮退と同型)。5xx を面に出さない。
4. **dispatch の fail-closed 統一(arch Med)**: SPAR_PROVIDER / SPAR_MODEL / SPAR_API_KEY **すべて既定値なし・明示必須**(未設定は 4xx)— 「既定フォールバック禁止」前例に整合。「M2 と同型」は「同一原則(fail-closed・既定なし)・選択方式は provider 明示 env(意図的相違 — チャットモデル名にプロバイダ推論規約が無い)」に表現修正。推奨値は .env.example のコメントで案内。
5. **鍵の局所化(sec Med)**: lib/spar/ は server-only・SPAR_API_KEY 参照は dispatch ファイル限定(⊆ 判定は詳細設計)・`NEXT_PUBLIC_SPAR` 否定 grep・エラーは status のみ(応答本文・鍵をログ/エラーに載せない — embedding.ts 前例)。
6. **第三者コスト消費の受容宣言(sec Med)**: 認証済み全ユーザーが /api/spar 利用可・self-signup 開放中は登録ユーザーによるコスト消費が可能(実運用2アカウントの個人環境での**意図的受容**)・per-request 4ガードのみでレート制限なし(v1)・強化は SC-07 / M5 の課題 — search-foundation の宣言形式で §2 に明記。
7. **テスト実体の明確化(data Med 2件)**: 本人スコープ = grep -F(`user_id = $1`)+ モック db で SQL/params にセッション userId が渡る assert(実行時フィルタの実体は Postgres の WHERE)。回帰は `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE -u SPAR_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL npm test`。
8. **描画方針(sec Low)**: LLM 応答・INBOX 本文は React 既定エスケープの**素テキスト**(md レンダラ不使用 — Server Component 実装のため client パネルに持ち込まない)。`dangerouslySetInnerHTML` 否定 grep を条件5 に追加。refs チップは v1 リンクなし。
9. **細部契約(data Low 群)**: SPAR_CTX_TOPK は searchKnowledge の MAX_LIMIT=20 に従属(契約明記・既定3)/ refs の title・date は null 許容 / 二重送信は client 送信中 disable + 非冪等受容 / `source = "ui"` 固定を M4 契約とし M5 へ申し送り / topic は trim 後空を NULL 正規化 / 新テストは凍結済み tests/capture-contract.test.ts と別名。
10. **凍結・注記対象の追補(arch/sec Low)**: scripts(check-no-secrets.sh)は M4 凍結列挙から除外を明記 / screen-design 注記対象に **§7.1「壁打ちスライドオーバー = M4」行の読み替え**を追加 / layout disabled ボタンの title 文言(「M4 で実装予定」)は凍結優先で据え置き受容(次回 layout 変更 goal で更新)/ **M5 設計への申し送り節を新設**(spar_conclusion = LLM 生成物が PR パイプライン入力・source 語彙・spar_conclusion の手動投入可能性)。
11. **CSRF 受容明示(sec Low)**: SameSite=strict(SDK 既定)+ Server Action の origin 検査 + Cookie 認証の同一オリジン fetch — 受容と明記。

## Round 2 — 2026-07-19(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | R1 決着11件中10件完全反映(現物照合: getUser null 返し / api/sync POST 401 同型 / proxy matcher 非除外 / embedding fail-closed 前例 / MAX_LIMIT=20 / knowledge 縮退前例 / layout title 現物)。新設節(§7 申し送り・§2 認可宣言・外部送信節)に新規矛盾なし。Low 2(テスト命名衝突の明文 / refs チップの出典表示水準) |
| data | **PASS** | High 2件(外部送信2系統・縮退契約)/ Med 2件(スコープテスト実体・env -u 対称化)/ Low 群すべて反映を現物照合。§7 × capture.md 消費契約(processed_at IS NULL・行単位冪等・created_at 順)の突合も矛盾なし。Low 1(テスト命名 — 凍結ゲートで実質担保あり) |
| sec | **PASS** | G1〜G4・L1〜L4 全反映(現物照合: SameSite=strict は SDK 既定値 + 条件9 の lock ピンで成立 / denylist 9パターン実在 / embedding.ts の status-only 前例)。残ギャップなし |

**総合: PASS(全レンズ)** — R2 の Low 2件は rev.3 で吸収:
新設テストは tests/capture-contract.test.ts と**別名**(条件7 に明文化・確定名は詳細設計の列挙)/ refs チップは source/filePath を**ツールチップ等で提示**(出典を辿れる — search.md 充足・表示形は詳細設計)。

### detailed-design への申し送り(非ブロッキング)

1. **実機 307 の実行形**: curl はリダイレクト追従無効の形で fenced block 化(追従すると 307 → 200 に化ける)。
2. **topK 従属の参照方向**: SPAR_CTX_TOPK ≤ 20 は searchKnowledge の MAX_LIMIT への従属契約 — MAX_LIMIT 変更時に spar 側が追随する旨を一行固定。
3. **listInbox の IF 契約**: limit は既定 50 + 上限クランプを IF に内蔵(clampLimit 前例と同型・呼び出し側自由にしない)。
4. **grep とモック assert の対**: `user_id = $1`(grep -F)と params[0](assert)の対応を SQL 確定時に崩さない。
5. **refs.score の型**: 検索経路では常に non-null だが KnowledgeHit.similarity は `number | null` — /api/spar の refs 型でどちらへ倒すか明示。
6. **check-no-secrets 追随の根拠**: SPAR_API_KEY が OpenAI 鍵なら既存 sk-proj-/sk-svcacct- パターンで被覆済みの可能性 — 「追加不要」の場合も判定根拠を一行残す(同一コミット規則の空振り防止)。
7. **コストガードのサーバ強制**: SPAR_MAX_TURNS / 入力上限 / SPAR_CTX_TOPK / max_tokens は**サーバ側で強制**(client 供給値を信頼しない — 超過は 4xx or 切詰め)を明文化し、超過入力テストを機械判定に載せる。
8. **否定 grep の範囲 ⊇ 実装ファイル集合**: dangerouslySetInnerHTML 等の否定 grep は、壁打ちパネルが capture 配下の外(components/ 等)に置かれる場合も被覆する範囲でピンする。
9. **LLM 実行時エラーの応答契約**: プロバイダの実行時 4xx/5xx → /api/spar の応答形(status のみ・応答本文をクライアントへ非転送)とモック fetch 非 2xx テストを明示。
10. **SameSite=strict の前提**: 現 SDK バージョン既定値に依存(条件9 の lock で成立)— SDK 更新を伴う将来 goal で CSRF 受容根拠を再確認する条件を残す。
11. **FROZEN_TESTS_M4 の全列挙**: M3 までの全テスト(tests/capture-contract.test.ts 含む)+ run-sync.test 再凍結 + helpers + vitest.config。scripts は除外(check-no-secrets 追随のため)。新テストの確定名を列挙で固定。
