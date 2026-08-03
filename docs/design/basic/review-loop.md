# 基本設計: review-loop(本番 UI からの AI レビュー依頼 — CI 実行の非同期ループ)

- 起点: 2026-08-03 壁打ち決着。Vercel 単体での Codex 実行は**実質不可**
  (調査 = docs/research/codex-on-vercel-feasibility.md)→ **実行は GitHub Actions・アプリはトリガーと
  結果表示のみ**。エンジン = **claude-code-action + Max サブスク認証(`CLAUDE_CODE_OAUTH_TOKEN`)**。
- R1 反映(2026-08-03・3レンズ全 FAIL → 改訂): 状態機械を**全書き手 CAS + 先勝ち**に再設計 /
  review_bot を**列限定 GRANT**に / job2 の防御を**プロンプト規律から機械層(allowedTools・
  persist-credentials・retention)へ**引き上げ / PAT 実害上限を書き直し / CI 上の repo 設定
  (CLAUDE.md・settings.json)の帰結を決着。
- 前提条件: **decision-cockpit は private repo**(ゲート (g) で確認 — public なら導入中止)。

## 1. 目的 / スコープ

### 方式の骨格

```
UI(壁打ちパネル第3モード・admin 限定)
  → POST /api/review(サーバ強制の認可・検証・上限・stale sweep)
  → INSERT review_requests(status='pending')
  → GitHub API workflow_dispatch(REVIEW_DISPATCH_PAT・inputs.request_id)
  → CI(ci-review.yml・3-job 分離):
      claim(review_bot・pending→running の CAS・run_ref 記録・質問を artifact 化)
      → review(claude-code-action・allowedTools 機械制限・DB secrets なし)
      → writeback(running→done|error の CAS — 後着は no-op)
  → UI ポーリング(status 遷移 + 結果の素テキスト表示)
```

### やる

1. **0010 マイグレーション**: `review_requests`(詳細 DDL は詳細設計 — 以下は基本合意):
   - `id uuid PK / requested_by(user_id・FK は capture_inbox と同形)/ question text CHECK(1..2000字)/
     status CHECK IN ('pending','running','done','error') / result text / result_truncated boolean /
     error_kind CHECK IN ('dispatch_failed','stale','ci_failed') / run_ref text /
     created_at・started_at・completed_at(timestamptz)`。
   - 整合制約: **`status='error' ⇔ error_kind IS NOT NULL`**・**`status='running' ⇒ started_at IS NOT
     NULL`**・**`status IN ('done','error') ⇒ completed_at IS NOT NULL`**(claim の単一文性(§1-5)と
     併せて「started_at NULL の running が sweep に永遠に掛からない」恒久 409 を構造排除 — arch/data R2)。
     **run_ref は claim 時(job1)に記録**(stale 化しても run を辿れる)。
   - 物理 DELETE なし(履歴は残す)。
2. **専用 DB ロール `review_bot`(列限定 GRANT — organize-role.sql と同粒度)**:
   - `SELECT (id, status, question, created_at, started_at)` — **requested_by は取得不可**
     (user 帰属を CI に出さない — organize-loop と同思想)。
   - `UPDATE (status, started_at, completed_at, result, result_truncated, error_kind, run_ref)` —
     **question・requested_by・created_at は UPDATE 不可**(履歴改ざん・注入踏み台・日次カウント
     汚染の遮断)。INSERT/DELETE なし。他テーブル到達不能。
3. **状態機械(R1 中核の再設計 — 「排他」ではなく「全書き手 CAS + 先勝ち」)**:
   - 遷移: `pending →(claim CAS)→ running →(writeback CAS)→ done | error`。
   - **すべての遷移 UPDATE は WHERE に現在 status を含む CAS**:
     claim = `WHERE id=$1 AND status='pending'` / writeback = `WHERE id=$1 AND status='running'` /
     sweep = `WHERE status='pending' AND created_at < now()-interval '15 min'` および
     `WHERE status='running' AND started_at < now()-interval '60 min'`。
   - **先勝ち**: 後から来た書き手の CAS は 0行更新 = **no-op(green skip)**。行が壊れる経路がない
     (error(stale) 確定後に CI が完走しても done で上書きされない — 遅着結果は破棄)。
     dispatch_failed も CAS(`WHERE id=$1 AND status='pending'`)— claim が先勝ちした場合は no-op で、
     **「502 を返した依頼が後に done になる」ことがあり得る**(希少・結果は残るだけで無害 — 仕様として受容)。
   - **同時1件はアプリ層の努力目標**(同時 POST が検査をすり抜けると pending 2行があり得るが、
     各 run が各 id を claim し concurrency 直列で状態は壊れない — 単一ユーザー前提の受容)。
   - **閾値の根拠**: CI 最悪所要 = claim 5 + concurrency 待ち + review 15 + writeback 5 ≒ 25分 +
     余裕 → **running stale = 60分**。pending stale = **15分**(dispatch 済みで claim されない =
     gate off / PAT 失効 / CI 停止)。アプリ同時1件の判定は sweep 実行**後**に行う。
4. **`POST /api/review` + 一覧**(新設 API・/api/spar 非接触):
   - 認可: `getUser()` + **`isAdmin()` を POST / 一覧(GET)の両ハンドラでサーバ強制**
     (機械判定はハンドラ単位 — 詳細設計でピン)。
   - 検証: 1..2000字 / stale sweep → 同時1件(pending/running 存在 = 409)/ 日次上限 10件
     (**JST 当日・created_at のみで数える — status 不問**。error 行も消費する仕様 =
     dispatch 失敗連打の抑制。単一ユーザー運用で許容)→ 429。
   - `REVIEW_DISPATCH_PAT` 未設定 = 503 `review_not_configured`(fail-closed)。dispatch 失敗 =
     error('dispatch_failed') + 502。
   - 一覧 = admin 全行・**直近 20件に制限**(単調増加対策)。
5. **`.github/workflows/ci-review.yml`(新設)— organize / wbs のピン群を踏襲**:
   - `workflow_dispatch`(inputs: request_id)・gate `vars.ENABLE_CI_REVIEW == 'true'`(先頭 job の
     if — 後続は needs 連鎖で skip)・`concurrency: ci-review` 直列・**permissions は workflow 級
     `contents: read` のみ(job 級 permissions を置かない — organize §2.5 と同形)**・
     **workflow 級 / job 級 env なし(step 級のみ)**。
   - **job1 claim**(secrets = `REVIEW_DATABASE_URL` のみ・step 級): checkout
     (**persist-credentials: false** — 全 checkout 共通ピン)→ claim = **単一 UPDATE 文**
     (`SET status='running', started_at=now(), run_ref=<run URL> WHERE id=$1 AND status='pending'
     RETURNING question` — CAS・3列設定・question 取得を1文で行う。0行 = green skip の output。
     **claim 成功時のみ** question を artifact 化(条件付き step — green skip 時に過去行の question を
     再 artifact 化しない・**retention-days: 1**))。
   - **job2 review**(secrets = **`CLAUDE_CODE_OAUTH_TOKEN` のみ** — DB secrets 非到達):
     - 実行条件 = **claim 成功(job1 output)** のみ。
     - checkout(persist-credentials: false)→ **repo 側の実行系設定を除去: `.claude/settings.json` +
       `.mcp.json`(+ 存在すれば `.claude/settings.local.json`)**(sec R2 — 除去は**セキュリティ
       load-bearing**: (1) settings.json の allow 規則が action 引数の外でツール承認を拡張するのを防ぐ
       (2) `.mcp.json` の MCP サーバ(`npx -y` = 実行時に外部コード取得・起動すれば OAuth を持つ
       プロセスの子になる)の**起動可能性をデフォルト挙動頼みにしない** (3) フック(node_modules/jq
       前提)の CI 誤動作防止。**除去の巻き戻しは sec レンズ再通過が必要**(フック CI 対応を理由に
       戻さない)。CI ワークスペース内の除去 = repo 書き込みではない。**CLAUDE.md / .claude/rules は
       残す**(レビュー文脈として有用 — 読む前提で受容))。
     - claude-code-action: **`--allowedTools` は完全一致ピン(Read / Grep / Glob / Write(out/**) のみ。
       Bash・WebFetch・WebSearch・mcp__* の否定ピン — organize と同形)**。ツール上限は
       **action 引数が正**(repo 設定に依存しない)。**質問は式展開でプロンプトに埋めず、
       artifact のファイルを Read で読ませる**(`${{ }}` 式注入面の回避 — organize の rows.json 方式と
       同形)。プロンプト = 固定文(レビュー規律: 読取のみ・出力 = ファイル:行/問題/根拠 →
       out/review.md)。結果 artifact(retention 1日)。
   - **job3 writeback**(secrets = `REVIEW_DATABASE_URL`): 実行条件 = **gate 成立 AND claim 成功
     AND run 未キャンセル(job2 の成否は問わない)** — 素の `if: always()` は使わない。
     writeback **CAS**(running のみ遷移)。result 上限 = **文字単位**(UTF-8 セーフ・値は詳細設計)・
     超過は切り詰め + `result_truncated=true`(UI に「切り詰め」表示)。job2 失敗 = error('ci_failed')。
   - 各 job `timeout-minutes`(claim/writeback 5・review 15)。
6. **UI: 壁打ちパネル第3モード「CI レビュー」**:
   - **ChatTurn 列に合流しない**(専用の依頼フォーム + 依頼履歴リストの別領域表示。
     codex-spar の mode 語彙("spar"|"codex")・`latestSparConclusion` / `sparHistory` は**不変** —
     契約の境界を明確化)。
   - 表示条件 = サーバから渡す isAdmin prop(capture ページ / spar-overlay 双方)。非 admin は
     チップごと非表示(API 側 403 が正)。
   - 送信 → プレースホルダ → ポーリング(status バッジ + result 素テキスト描画)。
     **run_ref は `https://github.com/SAS-Sasao/decision-cockpit/actions/` 前置一致のときのみ
     リンク化**(不一致は素テキスト — DB 侵害時の javascript: 面の遮断)。
   - 注記文言: 「質問は CI(GitHub Actions)の Claude に送られます。**機微情報(実名・秘密)を
     書かない**こと。結果は**参考意見**(設計レビュー・受け入れ判定の代替にしない)」。
7. **契約・手順**: `.claude/rules/actions.md` に review-loop 節(第3の CI ループ・**書き込みゼロ**・
   3-job 分離・allowedTools 機械制限・**judge / critic の代替禁止**)。
   `docs/setup/review-loop-setup.md` 新設(PAT 作成 → Secrets → Variables → 動作確認 → 停止・失効手順)。
   `.env.example` に `REVIEW_DISPATCH_PAT` プレースホルダ。
   **`.gitignore` に `.claude/settings.local.json` を追加**(sec R2 — `enabledMcpjsonServers`(MCP 承認)を
   含むローカルファイルが誤 commit されて job2 の「MCP 不起動」前提を崩すのを追跡ガードで防ぐ)。

### やらない

- **repo への書き込み・PR 生成・コミット**(読取レビューのみ — 黄金ルール1 の例外追加は不要)。
- SSoT 2 repo の checkout・レビュー対象化(対象 = decision-cockpit のみ)。
- 非 admin への公開 / ストリーミング / 依頼キャンセル / 行の物理削除。
- capture_inbox 連携(結果は capture に入らない・結論保存対象外・M5 の消費対象外)。
- **judge / acceptance-judge / design-review critic の代替**(黄金ルール4 — actions.md に明記)。
- ChatTurn / `latestSparConclusion` / `sparHistory` の変更(codex-spar 契約は凍結)。
- `/api/spar`・lib/spar・daily-organize.yml・wbs-writeback.yml の変更。

## 2. アーキテクチャ上の位置づけ

App 層(API + UI + テーブル)+ CI(開発プロセス層)の非同期ブリッジ。DB を結合点にする構図は
capture_inbox(organize-loop)・board_overrides(wbs-loop)と同型。SSoT 非接触(checkout = 本 repo
のみ・書き戻しなし)。**organize-loop との構造差分を明示**: あちらの Claude ジョブは checkout なし
(「checkout・.git・スクリプト・secrets なし」の複合不変量)だったが、本ループはレビュー対象として
**checkout が必然** — そのため不変量を「DB secrets 分離」+「allowedTools 機械制限」+
「persist-credentials: false」+「workflow 級 contents: read のみ」の組で再構成する(§4)。

## 3. データ / インターフェース概要

- 状態機械: §1-3 が正(**全書き手 CAS・先勝ち・後着 no-op** — 「排他」ではなくこの機構で一貫性を
  担保する)。ロック解除は「アプリ sweep(pending 15分 / running 60分)」と「job3 の error 書き込み」
  の二重(workflow cancel 時は job3 が走らないため sweep が最終解除)。
- API: `POST /api/review {question}` → 200 `{id}` / 400 / 401 / 403 / 409 / 429 / 502 / 503。
  一覧 = admin・直近20件。
- dispatch: `POST /repos/SAS-Sasao/decision-cockpit/actions/workflows/ci-review.yml/dispatches`。
- 成果物(詳細設計 → **/goal RL-1**(0010 + API + UI + テスト)→ **/goal RL-2**(workflow +
  role SQL + 契約 + setup)。**goal 別の閉包 allowlist(実行形)は詳細設計 §4 に置く**)。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| **認可の破れ** | `getUser()` + `isAdmin()` を **POST / 一覧の両ハンドラで**サーバ強制(ハンドラ単位の機械判定 — 詳細設計)。UI 非表示は補助層 |
| **REVIEW_DISPATCH_PAT の漏えい — 実害上限(R1 で過小評価を訂正)**: (1) **他 workflow(daily-organize / wbs-writeback)の任意 dispatch** = SSoT への PR 経路の間接起動 + アプリ上限外のサブスク消費 (2) run の **cancel**(organize の publish-mark 間 cancel → 重複 PR)(3) actions:read 付随による **artifact 読取**(capture 本文 rows.json(retention 1日)・本ループの question/result)(4) run/ログ削除・workflow 無効化(監査痕跡消去・DoS) | 受容の根拠と縮小: **GitHub は PAT を workflow 単位に絞れない**(repo 単位が最小 — 制約として明記)。(1)(2) は **PR ゲート + 人間レビュー + 各 ENABLE ゲートが独立に維持**(SSoT 直接書き込みは不能)。(3) は全 artifact **retention 1日**で窓を最小化。ci-review の dispatch 単独では **pending 行が無ければ claim green skip = Claude 不起動**。保管 = Vercel env のみ・失効 = revoke + 差し替え(setup doc)。露出兆候があれば即失効 |
| **プロンプト注入(question → CI の Claude)— 最悪ケースの訂正** | 注入源 = admin 本人のみ(認可で限定)。**機械層で遮断**: job2 は `--allowedTools` 完全一致(Read/Grep/Glob/Write(out/**))で **Bash・ネットワーク系ツールなし = OAuth トークン持ち出し経路が構造的に不在**。persist-credentials: false + workflow 級 contents: read で push/PR 手段なし。残余 = 無意味な結果テキスト + サブスク消費(こちらは受容) |
| **OAuth と DB secrets の同居** | 3-job 分離(job2 に REVIEW_DATABASE_URL 非到達 — §5 否定ピン)。OAuth は M5 と共用のため、上記 allowedTools 遮断が共用トークンの保護を兼ねる |
| **CI 上の repo 設定(CLAUDE.md / settings.json / .mcp.json / hooks)** | organize は checkout なしで回避していた面の再導入 — 決着: **job2 で settings.json + `.mcp.json`(+ settings.local.json)を除去**(除去はセキュリティ load-bearing — allow 規則の承認拡張・MCP サーバ起動(npx 外部コード・OAuth 保持プロセスの子)を**デフォルト挙動に頼らず構造で遮断**。巻き戻しは sec 再通過)・settings.local.json は **.gitignore で追跡ガード**・**CLAUDE.md / rules は読む前提で受容**・**ツール上限は action 引数が正** |
| **review_bot の越権** | **列限定 GRANT**(§1-2)。question/requested_by/created_at は UPDATE 不可 = 履歴改ざん・「pending 行の question 書き換え → Claude への注入踏み台」・日次カウント汚染をロール層で遮断 |
| **状態の破損・ロック** | 全書き手 CAS + 先勝ち(§1-3)。stale 閾値は CI 最悪所要(~25分)に根拠づけ(running 60分)。ロック解除経路は sweep + job3 の二重 |
| **question / result の露出面** | 複製先を列挙して管理: DB(review_bot は question を書き換え不能)/ artifact(**retention 1日**)/ **action の実行ログにプロンプトが出る(受容 — private repo 前提・閲覧 = repo read 権限者)**。UI 注記「機微を書かない」(capture 同型) |
| **サブスク消費** | admin 限定 + 同時1件 + 日次10 + timeout + ENABLE ゲート。PAT 漏えい経由の organize 起動による消費は上記 PAT 行の受容に含む |
| **XSS・不正リンク** | result 素テキスト描画 + dangerouslySetInnerHTML 否定ピン + run_ref の**前置一致検証**(不一致は非リンク) |
| **非同期 UX(数分待ち)** | 受容。プレースホルダ + ポーリング + run_ref リンクで透明化 |

## 5. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較。**本設計 PASS 後に `/detailed-design review-loop`**(DDL・API IF・
workflow の全ピン(step-bound secrets / allowedTools 完全一致 / persist-credentials / retention /
job 実行条件の合成形)・テスト観点・goal 別閉包 allowlist を確定)→ /goal RL-1 → RL-2。
以下は基本設計レベルの骨子(**最終ピンは詳細設計 §4 が正**):

```bash
# スキーマ・ロール(列限定)
test -f db/migrations/0010_review_requests.up.sql && test -f db/migrations/0010_review_requests.down.sql
grep -q "error_kind" db/migrations/0010_review_requests.up.sql
grep -q "review_bot" docs/setup/organize-role.sql
grep -q "UPDATE (status" docs/setup/organize-role.sql        # 列限定 GRANT の存在形(正確な列列挙は詳細)
# API(ハンドラ単位の認可・上限)
test -d app/api/review
for k in "isAdmin" "409" "429" "review_not_configured" "stale" "2000"; do
  grep -q "$k" app/api/review/route.ts || echo "MISSING api: $k"; done      # 出力なし
# workflow(gate 先頭 job・CAS・機械制限)
test -f .github/workflows/ci-review.yml
for k in "workflow_dispatch" "request_id" "ENABLE_CI_REVIEW" "concurrency" "timeout-minutes" \
         "persist-credentials: false" "retention-days: 1" "allowedTools"; do
  grep -qF "$k" .github/workflows/ci-review.yml || echo "MISSING wf: $k"; done # 出力なし
# 除去 step(sec R2): settings.json と .mcp.json の両方の除去が job2 に存在する
grep -q "mcp.json" .github/workflows/ci-review.yml
grep -q "settings.local.json" .gitignore
# 否定ピン(詳細設計で完全形を確定): job2 ブロックに REVIEW_DATABASE_URL が現れない /
#   allowedTools に Bash・WebFetch・mcp__ が現れない / 素の "if: always()" を使わない /
#   claude-code-action の prompt に question の式展開(${{ }})が現れない(ファイル渡し)
# UI(合流なし・素テキスト・前置一致)
grep -q "CI レビュー" "app/(shell)/capture/spar-panel.tsx"
grep -rln "dangerouslySetInnerHTML" "app/(shell)/capture" | wc -l           # = 0
# 契約
grep -q "review-loop" .claude/rules/actions.md && grep -q "代替" .claude/rules/actions.md
test -f docs/setup/review-loop-setup.md && grep -q "REVIEW_DISPATCH_PAT" .env.example
# codex-spar 契約の凍結: spar-panel-lib.ts(latestSparConclusion / sparHistory)は diff 不変
# npm test(ホスト・件数 = 分岐点実測 + 新規)/ tsc exit 0 / e2e 6画面 green
```

手動ゲート(**有効化 = ユーザー操作**・全 PASS まで運用開始しない・fail = 導入中止して本設計を改訂):
(a) fine-grained PAT(decision-cockpit 1 repo・actions:write)→ Vercel env
(b) Secrets: `REVIEW_DATABASE_URL`(review_bot)・`CLAUDE_CODE_OAUTH_TOKEN` は M5 と共用
(c) Variables: `ENABLE_CI_REVIEW=true` (d) 実依頼1件が done 到達・結果表示・run_ref リンク動作
(e) gate off で dispatch → 全 job skip(DB 不変)・その後 pending は**次回依頼時の sweep で**
    stale error 化(15分経過後 — sweep は POST 時トリガであり自動ではない)
(f) 非 admin でチップ非表示 + API 403 (g) **repo が private であることの確認**
(h) job2 のログに DB 接続情報が出ていないことの目視(補助)。

## 6. 未解決の問い

- codex-action との比較再訪(サブスクのレート実感を見て。workflow 1ファイル差し替えで切替可能な
  構造を維持)。
- 古い行のアーカイブ方針(削除禁止のため表示は直近20件 — 蓄積の扱いは運用実績を見て)。
- SSoT を含む横断レビュー(checkout 対象の拡大 = 契約改定を伴う別設計)。
- stale sweep の cron 補完(現状は次回依頼時 sweep のみ。Hobby cron 日1回に載せるかは運用で判断)。
