# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-08-16 card-review CR-1 完了(judge PASS)** —
> **M0〜M5 + TCS-1 + FC-1 + TBI-1 + WL-1/2 + TSS-1 + SN-1 + CO-1 + CS-1 + RL-1/2 + CR-1 完了**
> (vitest **605件**緑 + **e2e 6画面 green**)。**Vercel 本番稼働中**。
> **CI レビューは本番で実運用中**(依頼 → CI → 結果を Markdown 表示まで通した)。
> **有効化待ち×2(ユーザー操作)**: M5(organize-loop)/ wbs-loop。
> **🔴 マージ待ち**: `goal/cr-1-card-review`(**0011 の本番適用が先** — 下記「card-review 0011 の
> 本番適用」)。その後 `/goal CR-2`(/today UI)で画面から使えるようになる。
> codex はローカル2経路とも稼働中(端末 review.sh / 壁打ち Codex モード)。
> **⚠ 2026-07-20 に DB 全消失事故が発生し復旧済み**(詳細は下記「2026-07-20 の事故と再発防止」)。
> ローカル db(復旧後)= timeline_records **8,013行**(ok・error 9)/ board_items 59行 / **埋め込み 8,013行(完了)** /
> タグ 564行 / **capture_inbox 0行(事故で消失・復元不能)** / admin ロール2ユーザー再付与済み。
> **本番マイグレーション: 0001〜0010 まで全適用済み**(**0010 = 2026-08-03**・review_requests /
> 0003→0008 = 2026-07-25 / **0009 = 2026-07-26** —
> WL マージ後に /today が本番でエラーになり事後適用。**教訓: スキーマ前提のコードを main へマージする前に
> 本番マイグレーション適用を段取りする**(マージ = Vercel 自動デプロイのため))。
> **⚠ 既知の SDK 欠陥(記録)**: @neondatabase/auth 0.4.2-beta の middleware は保護パスへの POST を常に 307 にする —
> proxy.ts の GET 正規化ラッパーで回避中。**SDK 更新時はラッパー不要化と CSRF 前提(SameSite=strict)を再評価**。
> **概観の「今週」KPI が空なのは正常**(週の切り替わり — 組織側 score/quality の最新が先週分。新しい記録が入れば埋まる)。
> **秘密情報は本ファイルに実値を書かない。**
>
> **✅ 壁打ち Codex モード(CS-1)有効化済み(2026-08-02)** — インストール + `codex login`(ChatGPT
> 連携)+ ランナー起動 + UI からの実応答を確認。ゲート実績: **(a) 応答表示 PASS /
> (f) ネットワーク到達試験 PASS**(curl 依頼 → 「コマンド実行と外部ネットワークアクセスが禁止」と
> 実行拒否 — 指示層の拒否。sandbox 実効 = コードで networkAccessEnabled:false 固定・第一層は
> クリーンコピーのため受容)/ **(g) 承認プロンプトなし PASS**。起動時の ESM 専用 SDK の解決失敗は
> dynamic import で修正済み(fix/codex-spar-esm-import)。
> **残り(任意・推奨)**: (b) ランナー停止中のエラー表示 (c) フラグ未設定でチップ非表示
> (d) LAN 非到達 (e) 秘密引用なしの目視継続 **(h) ChatGPT 設定のデータ学習 off 確認 +
> codex-setup.md §1 の表への記録(推奨・未実施)**。
> **運用注意**: Codex の「スクリーンショットを添付して」等の要求には従わない(実画面 = 実データ —
> 外部送信しない)。デザイン等は**コードを読ませる**プロンプトで依頼する。
> 端末レビュー(CO-1・review.sh)のゲート (a)〜(e) は未実施(使う時に codex-setup.md §3)。
>
> **▶ 次セッションの再開ポイント(2026-08-03 終業時点)**:
> 1. ~~🔴 review-loop の有効化~~ → **✅ 有効化完了・実運用開始(2026-08-09)**。
>    本番 UI から依頼 → CI で Claude がレビュー → 結果が UI に表示されるまで通した
>    (run 31295950018 = claim 30s / review 3m58s / writeback 32s・結果 1,975文字・done)。
>    **実地で確認できた防御**: review job のログに DB 接続情報が1件も出ない(3-job 分離の実証・
>    claim job にのみ出現)/ Claude が曖昧な依頼文を「データとして扱う」と明示し勝手な指示実行をしない
>    (プロンプト注入対策の実証)/ 失敗3回はいずれも writeback が `ci_failed` を記録(fail-safe の実証)。
>    **有効化までに3つの実装欠陥を実地で発見・修正**(いずれも設計レビューでは検出できない層):
>    (1) OIDC 権限(→ `github_token` 明示指定で回避。`id-token: write` は「CI は repo に書けない」
>    不変量を壊すので不採用)(2) `CLAUDE_CODE_OAUTH_TOKEN` 未登録(手順書の不足 — M5 と共用と
>    書いたが M5 自体が未有効化だった)(3) **`Write(out/**)` は無効な権限記法**(→ `Edit(out/**)`)。
>    詳細 = [`claude-code-action-oidc.md`](../research/claude-code-action-oidc.md)。
>    残ゲート(任意): (c) gate off で skip / (d) 非 admin で 403 / (e) 同時1件 409 / (f) 日次上限 429。
> 2. 🔴 **Neon パスワードリセット**(持ち越し・チャット露出の後始末)= リセット → `.env` → Vercel 差し替え。
> 3. ~~🎯 開発の再開点 = `/goal CR-1`~~ → **✅ CR-1 実装完了(2026-08-16・judge PASS 14/14)**。
>    ブランチ = `goal/cr-1-card-review`(3コミット・**main 未マージ**)。605テスト緑 / tsc exit 0 /
>    閉包 allowlist 外 0。0011 の形状 CHECK はローカル db で **受理3 / 拒否8** を実測
>    (選言形が素通りさせた「kind NULL + capture_id」「kind NULL + wbs 完全形」も拒否)。
>    同じ up.sql の2回流しも exit 0(再実行安全)。
>    **🔴 マージ前にあなたの操作が2つ必要**(下記「card-review 0011 の本番適用」):
>    (1) Neon ブランチで 0011 を検証 (2) 本番適用。**適用してからマージする**
>    (マージ = Vercel 自動デプロイ。0009/0010 で本番が先に壊れた教訓)。
>    その後 `/goal CR-2`(/today UI + e2e)。詳細は下記 5.7。
> 4. さらに先に進むなら **M6 候補の選定**(下記 6)/ **案D(実装まで任せる)**(下記 5.6)。
>
> **▶ 過去の再開手順(履歴)**:
> 0. ~~🐛 /today のサマリーチップがカード移動に追随しない~~ → **解決(2026-08-01 TSS-1・judge 判定)**。
>    チップ「オープン」「着手中」を純関数 `laneCounts`(盤面 = 合成後 columns + capture レーンの件数・
>    正典)に置換 + 注記文更新。507テスト + e2e 6画面 green。設計 = today-summary-sync(3レンズ一発 PASS)。
> 0.5 ~~🤖 codex の運用検討~~ → **方向確定(2026-08-01 壁打ち)**: (a) **使い道2 = spar-navigate として実装**
>    (壁打ちが検証済みパラメータの提案リンクを返す — SN-1・下記完了済み参照) (b) **使い道1 = Codex 並走は
>    「読取専用のセカンドオピニオン」から** → **基本設計 PASS(2026-08-01)**: docs/design/basic/codex-ops.md。
>    R1 で sec/data FAIL(AGENTS.md は強制ではない・サンドボックスの読取範囲は保証されない・作業ツリーには
>    .env 以外にも e2e/.auth / e2e/screenshots の秘密がある)→ **クリーンコピー隔離に方式転換**
>    (レビューは scripts/codex/review.sh 経由のみ — `git archive HEAD` を一時 dir に展開 = 追跡ファイルのみ・
>    秘密は構造的に不在)→ R2/R3 全レンズ PASS(記録 = docs/design/reviews/codex-ops.md)。
>    **CO-1 実装完了(2026-08-02・judge PASS)** — 詳細は完了済みリスト参照。残タスク = **有効化
>    (ユーザー操作)**: codex-setup.md の手順1〜3 + 初回受け入れ検査 (a)〜(e) ゲート(上記再開ポイント)。
> 1. ~~🔧 コールドスタートのタグ空問題の恒久修正~~ → **完了(2026-07-25 TCS-1・judge PASS)**。
>    masters 優先パーティション + mergeTagVocab のラン内マージで**初回同期からタグが付く**(設計
>    docs/design/basic/tag-cold-start.md・3レンズ一発 PASS)。tsc の「2件エラー」は**幻**(古い
>    tsconfig.tsbuildinfo が原因)と判明 — .gitignore 追加 + sync-local.ts の `export {};` で再発防止。
> 2. ~~🚀 Vercel 展開~~ → **完了(2026-07-25)**: マイグレーション 0003→0008 適用 / Vercel Import + env 登録 + Deploy
>    (cron は Hobby 制限で**日1回 JST 06:00** — `vercel.json` 変更済み)/ 初回同期 **8,283行**(タグ587行が
>    **1回で付与 = TCS-1 本番実証**・error 9 は既知)/ 埋め込みバックフィル **8,283/8,283・失敗0**(~$0.4)/
>    admin 2ユーザー付与。**env のキー名注意: 埋め込みは `EMBEDDING_API_KEY`**(OPENAI_API_KEY ではない — 手順書修正済み)。
>    **🔴 残り1点: Neon パスワードリセット(必須)** — 2026-07-25 の作業中に接続文字列がチャットへ再露出。
>    リセット → `.env` 更新(ユーザーのみ)→ **Vercel の `DATABASE_URL` も差し替え + Redeploy** の3点セットで完了。
> 3. **🤖 整理ループの有効化**(展開後): 下記「整理ループの有効化」の7項目(organize_bot 作成 → Secrets 4本 →
>    Variables → branch protection → 0行 skip 確認 → 実データ確認 → 復旧手順の把握)。
>    **⛔ 有効化の前に必須の修正あり(2026-08-09 判明)**: daily-organize.yml も review-loop と同じ
>    `claude-code-action` の OIDC 問題を抱えており、**このままだと generate job が必ず失敗する**
>    (根拠 = [`docs/research/claude-code-action-oidc.md`](../research/claude-code-action-oidc.md))。
>    対処 = (1) LLM step に `github_token` を明示指定(OIDC/GitHub App 経路を使わない)
>    (2) **`--allowedTools` の `Write(out/**)` を `Edit(out/**)` に直す**(Write のパス記法は
>    Claude Code が受理するが照合しない = 書き込みが拒否される。2026-08-09 実測)。
>    正典が別(organize-loop.md)なので**別 goal で改訂 + 3レンズ再通過**が必要。
>    **それまで `ENABLE_DAILY_ORGANIZE=true` にしないこと**(失敗は fail-closed なので事故にはならないが、
>    PR も mark も走らず無駄に赤 run が出るだけ)。
> 3.5 **🔁 wbs-loop(WBS カード操作 + SSoT への限定編集 PR 還流)— 基本設計 PASS・詳細設計待ち**(2026-07-26):
>    ユーザー承認済みの黄金ルール1 改定(WBS 限定編集 = `.companies/<org>/docs/secretary/*-wbs.md` の
>    ステータストークン置換のみ・決定的スクリプト・PR 人間レビュー)を前提に、フルループ
>    (オーバーレイ WL-1 → CI 書き戻し WL-2)を設計。3レンズ×3ラウンドで PASS(R1 は全レンズ FAIL —
>    照合の収束性・verify の死角・共有ロール露出面など13点を改訂で解消。記録 = docs/design/reviews/wbs-loop.md)。
>    **次の一手 = `/detailed-design wbs-loop`** → `/design-review` → `/goal WL-1` → `/goal WL-2`。
> 3.6 **🔁 wbs-loop 進捗**: 詳細設計 PASS(3R・2026-07-26)→ **WL-1(オーバーレイ)実装完了**(同日):
>    /today の **WBS カードがボタン + D&D で動かせる**ようになった(差分は board_overrides に記録・
>    SSoT 不変・「PR 反映待ち」バッジ・0009 適用済み・484テスト + e2e 6画面 green)。
>    実装中の発見1件は設計改訂済み(messy fixture は fixtures/parser-samples/ に隔離 —
>    FixtureSource 走査で board-sync 凍結期待値を変えないため)。
>    **WL-2(CI 書き戻し)も完了(2026-07-26・judge 49ピン + 追加5点 PASS)**: board-rewrite(3バイト同長
>    スプライス)+ scripts/wbs 5本(バイト diff 一次 verify・staged 閉包・不在 superseded)+ wbs-writeback
>    workflow(決定的スクリプトのみ・LLM なし)+ wbs_bot 専用ロール + run-sync 照合統合 + **契約4ファイル改定
>    (WBS 限定編集 — 黄金ルール1 第2例外)**。504テスト + e2e 6画面 green。
>    **フルループの有効化はユーザー操作** — 下記「🔁 WBS 書き戻し(wbs-loop)の有効化」の6項目
>    (wbs_bot 作成 → Secrets → Variables → 動作確認 → **レビュー疲れ警告の理解** → 復旧手順)。
> 4. ~~🎨 ステップ2: today-board-interactive~~ → **完了(2026-07-26 TBI-1・judge 判定済み)**。詳細は完了済みリスト参照。
>    - 案1第1弾: /today にカンバン(カード = **capture の next_move / issue**・CT-1 の status を
>      レーンにマップ・D&D で status 更新 = 既存契約のまま衝突ゼロ。WBS カードは読み取り専用チップ)。
>    - 案3: チャート・数値のモーション(CSS/SVG ネイティブ・ライブラリ追加なし・prefers-reduced-motion 尊重・
>      front-check の e2e が安全網)。
>    - 将来弾(別設計): 第2弾 = WBS カードのオーバーレイ移動(cockpit 側差分・SSoT 不変)/
>      第3弾 = organize-loop の PR 書き戻しで WBS へ還流(許可パス拡張 = 契約改定・「todos の還流」と同枠)。
> 5. **🤖 AI 動的フロント(案2・保留 — 狙いの確認待ち)**: 「実行時に AI がフロントのコードを書き換える」形は
>    **不採用**(設計→レビュー→judge の統治が効かない / front-check の前提が崩れる / LLM 生成コード実行は
>    XSS 級の攻撃面 / SPAR の封じ込め(env 固定・fail-closed・コスト上限)が崩壊)。安全な代替3形のどれが
>    狙いに近いかユーザーに確認してから設計する:
>    (a) レイアウト設定の DB 化(ウィジェット並び替え・表示切替 — SDK 不要の決定的カスタマイズ)
>    (b) 開発ループでの AI 改善(現行の Claude Code フローそのもの)
>    (c) **AI がパラメータのみ操作する SPAR 拡張**(生成物はコードではなく検索条件・期間・タグ等に限定 —
>        SPAR と同じ封じ込めで安全。3案の中では最有力)
> 5.5 **🤖 codex-prod(本番からの Codex/AI レビュー — 方向確定 2026-08-02・実作業は未着手)**:
>    Vercel 単体は**実質不可**と調査で判定済み(サンドボックス不成立・300秒上限・バイナリサイズ —
>    根拠 = [`docs/research/codex-on-vercel-feasibility.md`](../research/codex-on-vercel-feasibility.md))。
>    **採用方針 = 案1: GitHub Actions 経由**(アプリ → workflow_dispatch → CI 上で read-only 実行 →
>    結果を DB or PR で還流。organize-loop / wbs-loop の統治パターン(CI が信頼できる実行者・
>    3-job 分離・PR ゲート)を流用。非同期 UI・数分)。
>    **壁打ち決着(2026-08-03)— トピック名 = review-loop**:
>    (a) エンジン = **claude-code-action + Max サブスク認証(CLAUDE_CODE_OAUTH_TOKEN — organize-loop
>    と同方式・従量課金なし)**。ユーザーの実績参照 = cc-sier-organization の daily-todo-sync.yml。
>    (b) 認可 = **admin ロール限定**。 (c) 上限 = 同時1件 + 日次上限 + 質問文字数上限(アプリ +
>    workflow concurrency の二重)。 (d) 還流先 = **専用テーブル review_requests(0010)+ 専用ロール
>    review_bot**(capture_inbox 相乗りは契約違反のため不採用)。UI はステータスポーリング表示。
>    (e) トリガー = **workflow_dispatch**(Vercel に decision-cockpit 限定 fine-grained PAT
>    (actions:write のみ)を1本追加)。 (f) UI = **壁打ちパネルの第3モード「CI レビュー」**
>    (本番でも表示・admin のみ・非同期プレースホルダ + 履歴)。
>    統治 = 3-job 分離(DB secrets を Claude ジョブに渡さない)・repo 書き込みなし(読取レビューのみ)・
>    対象 = decision-cockpit repo のみ(SSoT 2 repo 対象外)。
>    **設計完了(2026-08-03)**: 基本設計(3レンズ・R1 全 FAIL → R3 PASS)+ 詳細設計(3レンズ・
>    R1 全 FAIL → R5 PASS)。記録 = docs/design/reviews/review-loop.md。
>    **RL-1 + RL-2 実装完了・main マージ済み(2026-08-03・judge とも PASS)**:
>    RL-1 = 0010 + /api/review + 壁打ちパネル「CI レビュー」モード(admin 限定)/
>    RL-2 = ci-review workflow(3-job 分離)+ scripts/review 3本 + review_bot + 契約 + setup。
>    **0010 は本番適用済み**(2026-08-03 承認 — CHECK 7本・索引3本を検証。ローカル db でも全遷移と
>    違反5形の拒否を実測)。570テスト + e2e 6画面 green。
>    **🔴 次の一手 = 有効化(あなたの操作)** = [`review-loop-setup.md`](./review-loop-setup.md) の
>    手順2〜5: review_bot ロール作成 → **fine-grained PAT**(decision-cockpit 1 repo・Actions RW のみ)
>    を Vercel の `REVIEW_DISPATCH_PAT` へ → GitHub Secrets `REVIEW_DATABASE_URL` → Variables
>    `ENABLE_CI_REVIEW=true` → 動作確認ゲート (a)〜(h)。**それまでは UI から押しても 503・
>    dispatch しても全 job skip で安全**。
> 5.6 **🤖 AI 活用の次フェーズ(2026-08-09 壁打ち決着)— review-loop を土台にした2案**:
>    差別化の正体 = (1) repo 全体をコンテキストに持てる (2) CI という権限が絞られた実行環境
>    (3) 成果物が DB に残る。加えて Cockpit 固有の武器 = **判断ログ・WBS・メトリクスを SSoT として
>    持っている**(AI コードレビュー SaaS には原理的に真似できない)。
>    - **【次に実装】案C = `/today` からワンクリック依頼**: カード(WBS / capture)に「レビュー」
>      ボタンを置き、**サーバ側でカード内容から質問文を組み立てて** /api/review に投げる。
>      既存の防御を1つも壊さない(質問は今と同じ question カラム → artifact ファイル経由で、
>      式展開ゼロの経路に乗る)。**未決の設計論点**: (i) 結果をカードに紐づけるか(= review_requests に
>      カード参照列 = 0011 が必要)壁打ち履歴に流すか(既存のまま) (ii) ボタンの露出方法
>      (iii) 日次上限10件との関係(押しやすくなる分あたりやすい)。
>    - **【将来・別フェーズ】案D = 実装まで任せる(修正 PR を出す)**: **review-loop の拡張ではなく
>      別 workflow(`ci-implement.yml` 新設)**として設計する — review-loop の「書き込みゼロ」は
>      温存する。D で壊れる防御 = contents:write / persist-credentials / `Edit(out/**)` の砂場 が
>      すべて前提から外れるため、**基本 + 詳細 + 3レンズ複数ラウンドが確実に必要**。
>      骨格案 = PR ゲートが最終防御(自動マージ禁止)/ ブランチ名を `ai/<request_id>` に機械固定 /
>      **変更パスの allowlist + PR 作成前の機械 verify**(wbs-loop のバイト diff と同思想)/
>      テスト緑を PR 作成の条件に / **入力は案C のレビュー結果**(何を直すかが構造化済み = 暴走面が小さい)。
>      **未決の設計論点(D 着手時に最初に決める)**: (i) 触ってよいパス — `.github/**`・`.claude/**` は
>      禁止確定、`db/migrations/**`・`app/**` は要判断 (ii) **AI の自己改変防止**(CLAUDE.md / rules を
>      書き換えられると統治が自壊する — 除去 step か allowlist か) (iii) PR 本文の機械 verify 契約
>      (iv) 失敗時(テスト赤・allowlist 外)の扱い (v) SSoT にも書くか(= 黄金ルール1 の第3例外・大改定)。
>    - **順序の根拠**: C は防御を壊さず、**C の出力が D の入力になる**。また C の運用で「AI の指摘は
>      採用に値するか」を見極めてからでないと、D の「どこまで任せるか」に根拠が持てない。
>    - 検討したが**採らなかった案**: SSoT 横断レビュー(案A・差別化は最大だが契約改定が必要 — C の後に再訪)/
>      定時レビュー cron(案B・A の価値確認後)/ ChatGPT・Codex 側の拡張(案E・Claude Code に対する
>      優位が薄く統治が二重化する)。
> 5.7 **🎯 card-review(/today のカードから AI レビュー — 案C)= CR-1 完了 / CR-2 待ち**:
>    基本設計(3レンズ・R1 全 FAIL → R2 PASS)+ 詳細設計(3レンズ・R1 全 FAIL → **R5 で全 PASS**)。
>    記録 = docs/design/reviews/card-review.md(基本)/ card-review-detail.md(詳細)。
>    ~~次の一手 = `/goal CR-1`~~ → **✅ CR-1 完了(2026-08-16)**: 0011 + submit.ts 抽出 +
>    card-prompt + card-key + card-lookup + route 書き換え + テスト35件。
>    **次の一手 = 0011 の本番適用 → main マージ → `/goal CR-2`**(/today UI + 取得 + e2e)。
>    **🔴 CR-1 は 0011 を含む** — Neon ブランチ検証 → 本番適用 → main マージの順(0009/0010 の教訓)。
>    設計で潰した本質的な穴: CHECK の全域形が実は全域でなかった(NULL 素通り・実測で再現)/
>    「api-lib に抽出済み」という事実誤認(受理シーケンスは route.ts にインライン)/
>    ワンクリックが review-loop の同意ガードを外すこと(→ 確認ステップを必須化)/
>    today-view の「外部送信なし」受容が破れること。
>    ~~🔴 CR-1 の着手前に設計へ1点追記が要る(要件 v1.2 arch レンズ E-1)~~ →
>    **✅ CR-1 で解消(2026-08-16)**: db-recovery.md の「復元できないもの」に `review_requests` を追加
>    + card-review 詳細 §1/§4 に成果物とピン(節を awk で切り出して数える — replay 列挙のピンは
>    列挙側しか見ないため、これが無いと無改訂でも PASS した)。
>    「本番は 0003〜0008 が未適用」という古い記述も実状(0001〜0010 適用済み)に訂正済み。
> 6. **M6 候補**(organize-loop §4-R の受容項目から): provenance の索引化 / タグ付与の床 / todos の還流(allowlist 追加) /
>    整理ループの head-of-line 監視。**SC-07 ユーザー管理**の配置判断もこの前後。
>
> **2026-07-20 の完了サマリ**: capture-trash(CT-2)→ **organize-loop 設計(基本3R + 詳細8R の全レンズ PASS** — livelock・
> 時間軸汚染・PAT 流出経路・スクリプト改ざん経路などを実装前に構造で除去)→ **M5-A**(0008 + 消費スクリプト5本 +
> frontmatter 剥離とパーサ拡張で**還流を実際に閉じた**)→ **M5-B**(3-job 分離 workflow + プロンプト + 契約4ファイル改定)。
> 途中で DB 全消失事故が発生し、**復旧 + 再発防止(guard hook + ルール + runbook)まで完了**。
>
> **2026-07-25 の完了サマリ**: **TCS-1(tag-cold-start)** — 軽量1枚設計 → 3レンズ**一発 PASS** → 実装 → judge 全条件 PASS。
> masters 優先の安定パーティション + `mergeTagVocab` ラン内マージ(凍結例外1件の反転 + 新規テスト5件)。
> 副産物: tsc「2件エラー」は tsconfig.tsbuildinfo の幻と判明(.gitignore + `export {};` で再発防止)/
> **app コンテナに git が無い**ため `npm test` 条件は**ホスト実行が正**(check-no-secrets が動かない — 設計 §5-1 に注記)。
>
> **運用メモ**: allowlist 拡張直後の同期は `--force` / `--force` は全量再埋め込みを招く(コスト意識)/
> **空 DB からの初回同期も1回でタグが付く(TCS-1 恒久修正済み・部分復元状態のみ対処 B)** / モデル切替時は検索が一時 0件(ガードの過渡状態)/
> **DB ボリュームの破棄は禁止**(guard-bash.sh で遮断・復旧は [`db-recovery.md`](./db-recovery.md))/
> **UI を触った後は `npm run e2e`**(6画面のフロント整合性チェック・state 失効時は `npm run e2e:auth` を再実行)/
> **migration を含む goal は、main マージ前に本番適用を段取り**(マージ = 自動デプロイ。0009 の教訓)/
> Vercel 展開時 env: `EMBEDDING_MODEL=text-embedding-3-large` / `EMBEDDING_DIM=1536` /
> `SPAR_PROVIDER` / `SPAR_MODEL` / `SPAR_API_KEY` / `CRON_SECRET`。

---|---|---|
| `daily-digest/` | 94ファイル(日付付き・7〜60KB) | 組織活動の日次サマリ — タイムライン素材そのもの |
| `secretary/learning-notes/` | 約50ファイル(WBS 番号付き・10〜60KB) | ドメイン知識の本体 — ナレッジ検索の主役候補 |
| `decisions/` | 1件 | **組織側の判断ログ**(現状 decision は ai-war-room の12件のみ) |
| `secretary/board.md` / `storcon-preparation-wbs.md` | — | **M3 が必要とする kanban / WBS** |
| `diagrams/` `drawio/` `research/` `retail-domain/` `reports/` `todos/` | 45+ファイル | 図解説・用語集・日報・TODO |

org-docs-ingestion 設計時の必須論点:
1. **機微データの同居**: `secretary/personality-profile-sasao.md`(既存 denylist の profile/personality パターンが捕捉する想定 — **設計で必ず検証**)・`secretary/MEMORY.md` の扱い判断。
2. **チャンク分割**: 見出し単位分割等の設計(冪等キーの item_key 拡張と相性良し)。埋め込み済み 331件との共存・再埋め込み方針。
3. 大容量ファイル(60KB 級)の SYNC_MAX_FILES / EMBED_MAX_ROWS への影響。

## 🔍 ナレッジ検索の既知の仕様(2026-07-18 確認)

- SC-04 の既定フィルタは **type=decision**(設計どおり — 「過去の判断」の再利用が目的)。cc-sier 由来の task/score/quality(317件・埋め込み済み)は**検索対象に含まれるがヒットしない**(データ層 searchKnowledge は type:"all"/個別指定に対応済み・UI が未公開なだけ)。**UI に type 切替チップを足す小改修**はいつでも可能(md-render と同じ軽量設計 → レビュー → 小 goal で1周)。org-docs 取り込みとセットでやると効果的。

---

## ⚠️ 2026-07-20 の事故と再発防止(記録)

**事象**: ローカル DB のボリュームが作り直され(`docker compose down -v` 相当)、**全テーブルが消失**。
M5-A の executor 稼働中に発生。

**復旧結果**(docs/setup/db-recovery.md の手順で実施):
- 復旧: スキーマ(0001〜0008)/ timeline_records **8,013行**(ok・error 9)/ board_items 59行 / タグ 564行 /
  埋め込み 8,013行(バックフィル ~$0.4)/ admin ロール2ユーザー
- **復元不能**: `capture_inbox`(UI 入力のメモ・課題・壁打ち結論)— SSoT に無いため消失

**再発防止(実装済み)**:
1. `.claude/hooks/guard-bash.sh` に**ボリューム破棄コマンドの遮断**を追加
   (`docker compose down -v` / `--volumes` / `docker volume rm|prune` / `docker system prune` / `cockpit-db-data` の削除)。
   12ケースで動作検証済み(禁止形6件 BLOCKED・正常形6件 allowed)。
2. `CLAUDE.md` 黄金ルール6 と `.claude/rules/db.md` に禁止と**復旧義務**を明記。
3. **復旧 runbook を新設**: [`db-recovery.md`](./db-recovery.md)(実際に復旧できた手順をそのまま収録)。

**あわせて判明した既存バグ → 2026-07-25 に両方決着(TCS-1)**:
- **コールドスタートでタグが空になる** → **恒久修正済み**。masters を優先処理する安定パーティション +
  `mergeTagVocab` によるラン内語彙マージ(lib/ingestion/run-sync.ts / tag-vocab.ts)。凍結例外1件(旧契約
  ピンの反転)+ 新規テスト5件(ユニット3・コールドスタート契約・クロス adapter 契約)。設計 =
  docs/design/basic/tag-cold-start.md(3レンズ一発 PASS)。**「同期を2回」回避策は不要になった**
  (部分復元状態のみ db-recovery.md 手順3 の対処 B が残る)。
- `npx tsc --noEmit` の2件エラー → **幻エラーと判明**(実体は古い `tsconfig.tsbuildinfo` が削除済みの一時
  スクリプトを参照し続けていたもの。キャッシュ削除で exit 0)。再発防止: `.gitignore` に tsbuildinfo 追加 +
  `scripts/sync-local.ts` をモジュールスコープ化(`export {};`)。

## 🔴 最優先(持ち越し・すぐ終わる)

- [ ] **Neon のパスワードをリセットする**(チャット露出分の後始末)
  - Neon コンソール → 対象プロジェクト → **Connect** → **Reset password** → `.env` の `DATABASE_URL` を差し替え(Vercel / GitHub Secrets 登録済みならそちらも)。
- [ ] **M0 手動確認の残り1点**(30秒): ブラウザ F12 → Application → Cookies → `localhost:3000` を全削除 → リロード → `/login` に戻れば M0 の手動確認オールクリア。

## 🟢 M1 仕上げの手動アクション(実装は完了済み)

- [x] `CRON_SECRET` を生成し `.env` に追記済み(2026-07-12・Claude が対応)。**Vercel 展開時に同値を Vercel 環境変数へ登録するのはあなたの操作**
- [x] **初回フル同期(実データ・ローカル db)**: 完了(2026-07-12)。ok 331件(task 155 / score 159 / quality 3 / decision 12 / daily_log 2)+ error 9件(frontmatter 無しの初期 task-log 等・設計どおりレコード化)。github-source 実疎通 OK・denylist 1件遮断・error body の絶対パス残存 0
- [x] **0002 の Neon 本番適用**: 完了(2026-07-12。ブランチ検証全緑 → 承認 → 適用 → 検証ブランチ削除)
- [ ] (任意)**Neon 本番への実データ同期** — 本番の timeline_records はまだ空。Vercel 展開時の Cron に任せるか、ローカルから `DATABASE_URL=<Neon> npx tsx scripts/sync-local.ts` で先行投入(Claude が実施可能)

## 🎨 UI(画面デザイン MoC)対応 — 進行中

- [x] **ui-shell 完了**(2026-07-12): 共通シェル(サイドバー/トップバー/ダークテーマ)+ SC-02 概観(最小版)+ ルート再編(/today /knowledge /retro /capture /admin/users・旧 URL 308)+ ログアウト接続。UI-A/UI-B とも judge PASS
- [x] **POLISH-A 完了**(2026-07-12・judge PASS): 共通チャート部品5本(スパークライン/面グラフ/円形ゲージ/横バー/複合)+ chart.ts 純関数 + SIGNAL_DIRECTION + トークン/keyframes 拡張 + @fontsource セルフホスト(IBM Plex Sans JP/Mono・exact pin・layout import 7本)。テスト140件緑・build 緑
- [x] **POLISH-B 完了**(2026-07-12・judge PASS): SC-02 リッチ化(KPI Mono+差分 pill+スパークライン/横断タイムライン/gauge+内訳バー/判断ログ行カード+タグ pill)+ SC-05 チャート(judge 3軸 0-1・報酬×QG 複合・4シグナル横バー granularity 連動)+ ckblink ドット + ckfade template + overview.ts tags + 注記2件。実機 307 確認済み
- [ ] **ui-polish の手動確認(あなたの操作・機械判定外)**: ログインして `/`(概観)と `/retro` を MoC(docs/design/ui/moc/decision-cockpit.dc.html をブラウザで開く)と目視比較 — 基本設計 §5 末尾のチェックリスト5点。違和感があれば次セッションで微調整(実画面のスクリーンショットは repo/PR に保存しない)
  - 目視時の観点(実装時の裁量判断 — MoC に厳密な指定がなく executor が決めた点。気になれば微調整対象):
    1. 差分 pill = MoC どおり「プラスのみ緑(14% アルファ)・ゼロ/マイナス/null はミュート色」(赤にしていない)
    2. KPI 数値・スパークラインの色 = スコアレベル連動(good/warn/bad)。横断タイムラインの凡例色は系列固定(reward=good 緑 / QG=accent)
    3. 品質ゲート内訳バー = pass が `--good` / 非 pass が `--bad`
    4. 記録件数・未処理キャプチャの KPI カードには差分 pill もスパークラインも無し(元データに差分/系列が無いため — 設計どおり)
    5. 14% アルファ表現は `color-mix(in oklch, var(--…) 14%, transparent)`(トークン由来を維持・oklch 直書きなし)
  - 完了後の手動確認: MoC スクリーンショット(sc02/sc05)との目視比較5点(設計 §5 末尾のチェックリスト。実画面のスクリーンショットは repo/PR に保存しない)
- [ ] SC-07 ユーザー管理 UI は M4 前後で(M0 未解決の問い#1 の決着候補)
- 恒久規範(ui-polish 基本設計 §1-7): **M2 以降の新画面は MoC 該当ブロックを意匠規範とし components/charts を再利用** / 前 goal の新設テストは次 goal の凍結列挙に編入

## ⏳ 後続マイルストーンが来たら(今は不要)

| いつ | やること |
|---|---|
| **M4**(capture + 壁打ち) | SC-06 実装(capture_inbox 契約 = .claude/rules/capture.md 準拠・user_id 所有・kind 4語彙)。SC-07 ユーザー管理の配置判断もここで |
| **M5**(自動整理・**実装完了 2026-07-20**) | 有効化手順は下記「🤖 整理ループの有効化」を参照 |
| Vercel 展開時 | **手順書あり: [`vercel-deploy.md`](./vercel-deploy.md)**(事前条件・環境変数・Cron・初回同期・トラブルシュートまで記載。現時点でデプロイ不要) |

## 🔁 WBS 書き戻し(wbs-loop)の有効化 — あなたの操作

**実装は完了済み**(WL-1 / WL-2)。以下はすべて**ユーザー操作**。それまでは workflow_dispatch しても
override 0件なら green skip で安全。

1. **専用 DB ロール**: `docs/setup/organize-role.sql` の **wbs_bot セクション**を Neon 本番で実行
   (organize_bot とは別ロール — capture_inbox へ到達しないことを確認)。
2. **GitHub Secrets**: `WBS_DATABASE_URL`(**wbs_bot の接続文字列**)。`ORGREPO_PAT` は M5 と共用可。
3. **GitHub Variables**: `ENABLE_WBS_WRITEBACK=true`。
4. **動作確認**: /today で WBS カードを1枚動かす → workflow_dispatch → cc-sier-organization に
   `wbs/<date>` ブランチの PR が立つ(**ステータストークン1箇所だけの diff** であること)→ マージ →
   次の同期後にバッジが消える(applied)。
5. **⚠ レビュー疲れ警告**: この PR は毎日届き得る単純な置換 diff だが、**人間レビューが最終防御**
   (依存汚染・スクリプト改ざんの場合は機械 verify が無効化される — 設計 §4-R の受容)。
   **「変更行が PR 本文の一覧と一致していること」を毎回確認し、機械的に承認しない。**
   一覧外の差分が1行でもあれば必ず reject して報告すること。
6. 復旧: PR を閉じた場合は、対象カードを一度別レーンへ動かして戻す(= 再送)。

## 🗄️ card-review 0011 の本番適用 — あなたの操作(**main マージの前に**)

ブランチ `goal/cr-1-card-review` は実装完了・judge PASS だが、**0011 が本番 DB に無い状態で
マージすると Vercel が自動デプロイして本番のコードとスキーマがずれる**(0009/0010 で実際に
/today が本番でエラーになった)。順序は **Neon ブランチ検証 → 本番適用 → main マージ**。

- [ ] **1. Neon ブランチで検証**: 本番から分岐したブランチに `db/migrations/0011_review_card_ref.up.sql`
      を流し、エラーなく完了すること。**同じ up.sql を2回流して2回目も成功する**こと
      (再実行安全 — ローカルでは実測済み。NOTICE は出るが exit 0)。
- [ ] **2. 形状 CHECK の実測**(ローカルでは実測済み・本番相当でも確認するなら):
      **正常3形が受理**(kind NULL で参照列すべて NULL / wbs 完全形 / capture 形)・
      **違反形は拒否**(kind NULL + capture_id / kind NULL + wbs 完全形 / wbs で capture_id 同時 /
      wbs で title 欠落 / 不正 file_path / source 違い / 未知の kind / 空文字の kind)。
      **前2つが本命** — 選言の連結形はこれを素通りさせた。
- [ ] **3. 本番適用**(人間承認 — db.md の規約)。`review_bot` の GRANT は**変更しない**
      (列限定の付与は列追加で自動拡張されないため、新列は CI から不可視のままでよい)。
- [ ] **4. main へマージ**(`--no-ff`)→ Vercel 自動デプロイ。
- [ ] **5. `/goal CR-2`**(/today の UI + 取得 + e2e)。CR-1 は UI 非接触なので、
      CR-2 まで進めて初めて画面からカードレビューが使える。

## 🤖 整理ループ(M5 organize-loop)の有効化 — あなたの操作

**実装は完了済み**(M5-A / M5-B・judge PASS)。以下はすべて**ユーザー操作**で、Vercel 展開(本番 DB に capture が入る)後に実施する。
それまでは workflow_dispatch で手動実行しても **0行 green skip** で安全。

1. **専用 DB ロールの作成**: `docs/setup/organize-role.sql` を Neon 本番で実行(パスワードは Neon 側で設定)。
   作成後、**capture_inbox 以外に到達できないこと**を確認(被害上限 = 3列 UPDATE の前提)。
2. **GitHub Secrets**(repo Settings → Secrets):
   - `CLAUDE_CODE_OAUTH_TOKEN`(ローカルで `claude setup-token`)
   - `DATABASE_URL` — **organize_bot の接続文字列**(所有者ロールではない)
   - `WARROOM_PAT`(ai-war-room 用: contents:write + pull_requests:write のみ)
   - `ORGREPO_PAT`(cc-sier-organization 用: 同上)— **どちらも admin 権限・マージ権を与えない**
3. **GitHub Variables**: `ENABLE_DAILY_ORGANIZE=true`(+ 任意で `ORGANIZE_ALLOWED_ORGS`。既定 `domain-tech-collection`)
4. **両 repo の branch protection**: main へのレビュー必須 / force push 無効 / ブランチ削除保護 / **PAT に自分の PR をマージさせない**
5. **手動実行で確認**: workflow_dispatch → 0行なら generate/publish がスキップされ green。
6. **実データでの確認**(展開後): 両 repo に PR が立つ / frontmatter と H1 が正しい / mark で INBOX が「完了・整理済み」になる /
   **次回同期で ok 行として還流**(error 行が増えない)/ **morning スロットの生成日付が JST 当日**(設計 §4 条件8)。
7. 詰まった場合の復旧: PR をクローズ + `organize/<date>-<slot>` ブランチを削除して再実行(マージ済みなら次スロットを待つ)。

## 🧹 細かい積み残し(任意)

- [ ] `tsconfig.tsbuildinfo`(ビルド副産物・未追跡)を `.gitignore` に追加
- [ ] guard-write hook の `*secrets*` パターン精緻化(`check-no-secrets.sh` への偽陽性)
- [ ] `next.config.mjs` の `eslint` キー削除(Next 16 非対応の警告・無害)
- [ ] `Dockerfile.dev` に非 root USER を検討(.next の root 所有 EACCES の恒久対策)
- [ ] アカウント `t.s.0514.0952@gmail.com`(パスワード失念)の扱い — 当面 `笹尾テスト` を使用
- [ ] dev console の script-tag 警告は SDK(0.4.2-beta)由来・無害。SDK 更新時に再確認

## ✅ 完了済み(参考・時系列)

- Claude Action のサブスク認証切替(`CLAUDE_CODE_OAUTH_TOKEN` 方式)
- **M0 完了**: 設計2段階(全レンズ PASS)→ /goal M0-A・M0-B(acceptance-judge PASS)→ Neon Auth 実機ログイン確認・admin 付与(2ユーザー)・0001 本番適用
- `GITHUB_TOKEN` 設定・検証済み(認証 5,000回/h・両 SSoT 読み取り OK。スコープはユーザー許容済み)
- SSoT 実スキーマ調査(docs/research/m1-ssot-schema.md — `.companies/<org>/` 構造・frontmatter 不在・複数レコードファイル等を確定)
- **M1 設計完了**: 基本/詳細とも全レンズ PASS(livelock・削除カーソル停止・サニタイズ迂回を実装前に捕捉)
- **M1 実装完了**(2026-07-12): /goal M1-A(0002+パーサ5本+fixtures)・M1-B(SourceAdapter+run-sync+/api/sync+proxy 統合。冪等/認可は実地再現済み)・M1-C(/review 実スコア集計)— いずれも judge PASS。テスト98件・ビルド緑
- **M1 仕上げ完了**(2026-07-12): CRON_SECRET 生成 / 実データ初回同期(331件)/ 0002 本番適用(ブランチ検証→承認→適用)
- **ui-shell 実装完了**(2026-07-12): 設計2段階 PASS → UI-A(集計/トークン基盤)・UI-B(シェル+画面再編)judge PASS。テスト120件。/knowledge・/retro 開通・実機確認済み
- **ui-polish 基本設計 PASS**(2026-07-12): MoC 実 HTML を MCP で取得(docs/design/ui/moc/)→ 視覚仕様抽出(docs/research/ui-polish-moc-spec.md)→ 3レンズ2ラウンドで PASS。ゲージ内訳は pass/非pass 導出・null 契約・SIGNAL_DIRECTION・judge 0-1 軸・フォントセルフホスト(exact pin)を確定
- **M2(検索)完了**(2026-07-17): dual-provider 埋め込み(OpenAI 主・Google 切替可・fail-closed)+ pgvector 近傍検索 + SC-04(M2-A / M2-B judge PASS)。後日 text-embedding-3-large(1536)へ移行(全行再埋め込み済み)
- **md-render / org-docs-ingestion / OD-FIX / OD-DEC 完了**(2026-07-18): 安全 MD レンダラ(GFM 表対応)・組織 docs 取り込み(knowledge 型 8種列挙 + /knowledge type チップ)・recent の type/tag バグ修正・org decision H1 フォールバック(decision 13件)
- **M3(今日ビュー)完了**(2026-07-18): today-view 設計(基本 2R + 詳細 3R 全レンズ PASS)→ M3-A(0005 board_items + parseBoard + board 経路 + lib/data/today.ts)・M3-B(SC-03 画面 + 注記3件)とも judge PASS → 実 WBS 同期(59行・skippedRows 0)。0005 はブランチ検証済み・本番未適用
- **M4(capture + 壁打ち)完了**(2026-07-19): capture-spar 設計(基本 2R + 詳細 2R 全レンズ PASS — 認証二層化・外部送信2系統・fail-closed dispatch)→ M4-A(フォーム + INBOX)・M4-B(lib/spar + /api/spar + パネル)judge PASS。**M4-FIX**: SDK middleware の POST 欠陥(get-session へ method 転送 → 保護パス POST が常に 307)を実機で発見・proxy.ts の GET 正規化ラッパーで回避(judge PASS)
- **spar-overlay 完了**(2026-07-19): トップバー壁打ちボタン活性化・全画面スライドオーバー(SparPanel 再利用・layout ボタン置換のみ・judge PASS)
- **capture-triage(CT-1)完了**(2026-07-19): 0006 status 列(open/in_progress/done)+ INBOX 状態ボタン + バッジ連動(user_id 完全形ピン・UPDATE 単一性ゲート)。capture.md 契約更新済み・0006 ブランチ検証済み・本番未適用
- **capture-trash(CT-2)完了**(2026-07-20): 0007 deleted_at 論理削除 + ゴミ箱ボタン + `?trash=1` 一覧 + 復元(InboxRow 不変 + TrashRow 専用型で凍結例外ゼロ・UPDATE 3本ゲート・全5 SQL 面 user_id 二重ゲート)。capture.md 契約更新済み・0007 ブランチ検証済み・本番未適用
- **M5(自動整理ループ / organize-loop)完了**(2026-07-20): 設計は**基本3R + 詳細8R の全レンズ PASS**(3-job 分離・決定的ファイル名で livelock 除去・state/run.json アンカー・organize_bot で被害上限を3列 UPDATE に封じ込め)。M5-A(0008 + scripts/organize 5本 + frontmatter 剥離 + パーサ拡張 = 還流の成立)・M5-B(workflow 全面改修 + プロンプト + 契約4ファイル)とも judge PASS。**有効化はユーザー操作**(下記「整理ループの有効化」)
- **TCS-1(tag-cold-start)完了**(2026-07-25): コールドスタート時に全行 tags 空になる既存バグの恒久修正。
  run-sync の masters 優先パーティション + `mergeTagVocab` ラン内マージ(repo 横断で語彙が効く)。
  本番初回同期は**1回でタグが付く**ようになり「2回走らせる」回避策は廃止(部分復元状態のみ db-recovery.md 対処 B)。
  設計 = docs/design/basic/tag-cold-start.md(3レンズ一発 PASS)・judge 7条件 + 追加確認4点 PASS
- **FC-1(front-check: Playwright フロント整合性チェック)完了**(2026-07-25): 目視 OK 禁止をフロント表示に拡張。
  `npm run e2e` = 5画面の console error / 横はみ出し / **SVG テキスト重なり**を機械判定(chromium・キャプチャ全 off・
  localhost 固定・`npm test` とは完全分離)。認証は `npm run e2e:auth` の手動ログイン1回(state は gitignore)。
  **fail→fix→pass を実証**: 重なり4件(折れ線の目盛り×Xラベル3画面 + ゲージ中央×キャプション)と
  横はみ出し2件(1fr グリッドの min-content 押し広げ + nowrap テーブル)を検出→修正→全 green
  (証跡 = e2e/evidence-fc1.md)。設計 = front-check(3レンズ 2R PASS・実装中の発見3件は §8 で設計改訂)
- **TBI-1(today-board-interactive: /today カンバン操作 + UI モーション)完了**(2026-07-26):
  /today に capture カード(next_move/issue)が合流し、**ボタン + ネイティブ D&D で status 移動**
  (書き込みは既存 own-row Action 1本に収斂・UPDATE 3本不変・dataTransfer は id のみ)。WBS カードは読み取り専用のまま。
  モーション = 折れ線/弧の描画アニメ(pathLength 方式)+ バー伸長 + カード入場 + **数値カウントアップ**
  (全て CSS/rAF ネイティブ・依存追加ゼロ・prefers-reduced-motion 尊重・総時間 ≤450ms で e2e 静定内)。
  e2e は 6画面に拡大(/today 追加・"/" の誤名 "today"→"overview" 修正)。463テスト + e2e 6 green。
  設計 = today-board-interactive(3レンズ 2R PASS — sec の dataTransfer 指摘を含む13点反映)。
  **反省の記録**: 実装途中、settings 修正ブランチを goal ブランチから切って main へマージし、**TBI 途中状態が
  main に早期着地**(force push 禁止のため巻き戻さず、検証済みの最終状態で上書き決着。以後「修正ブランチは
  必ず main から切る」)。
- **TSS-1(today-summary-sync)完了**(2026-08-01): /today のサマリーチップ「オープン」「着手中」が
  カード移動に追随しないバグを修正。純関数 `laneCounts`(合成後 columns + capture レーンの件数 = 盤面が正典)
  に置換 + 注記文更新。設計 = today-summary-sync(3レンズ一発 PASS)・judge PASS。507テスト + e2e 6画面 green
- **SN-1(spar-navigate)完了**(2026-08-01): 壁打ちの返答末尾に**検証済みパラメータの提案リンク**
  (ナレッジ検索 q/type・振り返り g)を最大3件表示。モデル出力は ```nav フェンスの JSON のみ・サーバ側
  ホワイトリスト検証(href は固定リテラル起点 + encodeURIComponent・ラベルはサーバテンプレート)・
  **無効 nav 全滅時はフェンスを除去せず本文復元**(偽フェンスによる本文隠蔽を構造的に不可能に)。
  設計 = spar-navigate(3レンズ 2R PASS)・judge PASS。521テスト + e2e 6画面 green
- **RL-1 + RL-2(review-loop: 本番 UI から CI レビュー)完了**(2026-08-03・judge PASS / 16/16 PASS):
  壁打ちパネルの第3モード「CI レビュー」(admin 限定)から `workflow_dispatch` で GitHub Actions を
  起動し、**CI 上の Claude(Max サブスク認証)が自 repo を読んでレビュー**して結果を DB へ還流する
  非同期ループ。Vercel 単体では実行不可(調査 = docs/research/codex-on-vercel-feasibility.md)という
  結論から「実行は CI・アプリはトリガーと表示のみ」に決着。
  **状態機械 = 全書き手 CAS + 先勝ち**(claim/writeback/sweep すべて WHERE に現在 status・後着は no-op)/
  **3-job 分離**(Claude が動く job に DB secrets を渡さない)/ **機械層の防御**(allowedTools 完全一致で
  Bash・ネットワーク系なし・persist-credentials: false・artifact 保持1日・**LLM 起動前に repo 側の
  エージェント設定を除去 + 不在 assert**・質問はファイル渡しで式展開ゼロ)/ **review_bot は列限定 GRANT**
  (依頼者の帰属列は SELECT にも含めない)。0010 は**本番適用済み**。570テスト + e2e 6画面 green。
  設計 = review-loop(基本 3レンズ R1 全 FAIL → R3 PASS / 詳細 3レンズ R1 全 FAIL → R5 PASS)。
  **教訓の記録**: 受け入れ条件のピン自体が「正しい実装を落とす」較正欠陥を3度持ち込み(awk レンジが
  1行に潰れる / job 数ピンが on: 配下を拾う / uses 等式がコメントを拾う)、そのつど**実在ファイルに対する
  実測**で是正した。ピンが落ちたときは**実装を直す**(ピンを緩めない)= 作業役と判定役の分離。
  **有効化はユーザー操作**(review-loop-setup.md 手順2〜5)
- **CS-1(codex-spar: 壁打ちに Codex モード)完了**(2026-08-02・judge PASS): SPAR パネルに
  「SPAR / Codex」チップ(`NEXT_PUBLIC_CODEX_SPAR=1` のときのみ表示 — 本番は構造的に非表示)。
  Codex はホスト側 dev ランナー(`npm run codex:serve`・127.0.0.1:8788・**受理3検証 = Origin 完全一致 +
  Content-Type JSON 必須 + Host 完全一致**で CSRF/DNS rebinding を構造遮断・直列1件・10分上限)が
  クリーンコピー(git archive HEAD)上で実行(SDK 実引数で read-only / approvalPolicy=never /
  network 無効を固定・子 env は allowlist 全量置換)。**Codex 応答は結論保存(spar_conclusion)から
  構造的に除外**(latestSparConclusion)+ SPAR への history からも除外(sparHistory)= SSoT への
  合流と逆方向クロス送信の両遮断。新規テスト26件(547件)・e2e 6画面 green・/api/spar 非接触。
  設計 = codex-spar(R1 sec/data FAIL → 受理3検証 + 保存除外で R2 PASS)。**有効化はユーザー操作**
  (ゲート (a)〜(h) — codex-setup.md §6)
- **CO-1(codex-ops v1: Codex 読取専用セカンドオピニオン)完了**(2026-08-02・judge PASS): レビューの
  唯一の入口 = `scripts/codex/review.sh`(**クリーンコピー隔離** — mktemp に git archive HEAD 展開 =
  追跡ファイルのみ・.env / e2e/.auth / e2e/screenshots は構造的に不在・起動前 assert 毎回・trap で
  異常終了時も破棄・終了時に元 repo の status 表示)+ AGENTS.md(Codex 憲法)+ .claude/rules/codex.md
  (参考意見・コピペ実行禁止・judge 代替禁止)+ docs/setup/codex-setup.md(初回受け入れ検査ゲート +
  ローテーション一覧)+ CLAUDE.md 参照追記 + **guard-bash に codex 起動 deny**(先頭トークン一致のみ・
  パイプテスト 14ケース検証済み)。アプリコード非接触(521テスト不変)。設計 = codex-ops
  (R1 sec/data FAIL → クリーンコピー隔離へ方式転換 → R2/R3 全レンズ PASS)。**有効化はユーザー操作**

## 関連ドキュメント

- M1 設計: [`../design/basic/ingestion-foundation.md`](../design/basic/ingestion-foundation.md) / [`../design/detail/ingestion-foundation.md`](../design/detail/ingestion-foundation.md)
- 画面設計(UI MoC): [`../design/ui/screen-design.md`](../design/ui/screen-design.md) / MoC 実 HTML: `../design/ui/moc/`
- ui-shell / ui-polish 設計: [`../design/basic/ui-shell.md`](../design/basic/ui-shell.md) / [`../design/detail/ui-shell.md`](../design/detail/ui-shell.md) / [`../design/basic/ui-polish.md`](../design/basic/ui-polish.md)(レビュー記録: reviews/ui-shell.md・reviews/ui-polish.md)
- レビュー記録: [`../design/reviews/ingestion-foundation.md`](../design/reviews/ingestion-foundation.md)
- 調査資料: [`../research/m1-ssot-schema.md`](../research/m1-ssot-schema.md)
- セットアップ手順: [`neon-vercel-setup.md`](./neon-vercel-setup.md) / 要件定義: [`../design/requirements.md`](../design/requirements.md)
