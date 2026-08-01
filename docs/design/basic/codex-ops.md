# 基本設計: codex-ops(Codex 並走 — 読取専用セカンドオピニオン)

- 起点: 2026-08-01 ユーザー決定(codex 運用の壁打ち)— 使い道1「開発の自動化・並走」を
  **読取専用のセカンドオピニオンから**始める(編集権限の拡大は別設計)。
- 性質: **開発プロセスの統治設計**(アプリ非接触 — 成果物 = ラッパー1本 + 憲法・ルール・導入手順の
  文書3点 + CLAUDE.md への参照追記)。

## 1. 目的 / スコープ

### 前提(最重要の事実)

本プロジェクトの安全装置(guard-bash/guard-write hooks・`.env` 保護・SSoT 書き込み遮断・
DB ボリューム保護・post-edit typecheck)は **Claude Code のフック機構**であり、**Codex には一切効かない**。
Codex 導入の骨格は「フックの代替をどう積むか」= (a) **AGENTS.md**(Codex が読む憲法)
(b) **読取専用サンドボックスでの起動固定** (c) **運用ルール(人間側の規律)** の3層。

### 方式の骨格(R1 sec/data FAIL を受けた転換 — **クリーンコピー隔離が正**)

R1 で確定した事実: (1) AGENTS.md は**指示であって強制ではない**(注入・不服従で破れる) (2) 読取専用
サンドボックスは「書き込み・実行」の遮断であり**読み取り範囲・ネットワーク・approval 昇格は保証されない**
(バージョン依存・過信できない) (3) 「出力の目視」は引用の検出であり、**読んだ時点でコンテキストとして
送信される漏えいを原理的に検出できない**。
→ 対処: **Codex にライブ作業ツリーを読ませない**。レビューは常に**ラッパー経由**で行い、ラッパーが
`git archive HEAD` を一時ディレクトリに展開(= **git 追跡ファイルのみ**。`.env`・`e2e/.auth/`・
`e2e/screenshots/` 等の gitignore 資産は**構造的に不在**)し、そこを作業ディレクトリに Codex を起動する。
これにより「読まれて困るもの」がワークスペースに存在しなくなり、サンドボックスの読取範囲・目視の限界に
**依存しない**。残余(絶対パスで原本を読みに行く注入)は §4 で見積もって受容する。

### やる

0. **`scripts/codex/review.sh`(新設・運用の正)** — レビューの唯一の入口:
   (1) `mktemp -d` に `git archive HEAD | tar -x` で**追跡ファイルのみ**展開
   (2) そのディレクトリを作業場所として Codex を読取専用サンドボックス + **承認なし昇格を許さない
   approval 設定**で起動(実フラグは導入時に確認して本スクリプトに確定)
   (3) 終了後にコピーを破棄(**`rm -r --` 形・-f なし・対象は mktemp が返したパス変数のみ・
   `trap` で異常終了時も破棄** — 誤爆面を最小化)し、**元 repo の `git status --porcelain` が
   空であることを表示**(事後検知 — 運用規律の破れに「気づく」手段。検知範囲は本 repo のみ)。
   起動前に**コピー先の .env / e2e/.auth 不在を assert**(毎回の不変条件)。
   直接 `codex` を repo で起動しない(codex.md の禁止事項)。
1. **`AGENTS.md`(リポジトリ直下・新設)** — Codex が自動で読む指示書(追跡ファイルなのでコピーにも入る)。内容の骨子:
   - 黄金ルールの要点の写し(全文複製はしない — CLAUDE.md / .claude/rules/ への参照 + 絶対禁止の列挙):
     **SSoT 2 repo(../ 配下含む)への接触禁止 / `.env`・秘密ファイルの読み取り・引用・出力禁止 /
     いかなるファイル編集・コマンド実行もしない(読取専用)** / 破壊的操作の禁止。
   - 役割宣言: 「あなたはセカンドオピニオンのレビュアー。**成果は指摘の列挙のみ**。修正の実施・
     コミット・ファイル生成はしない(それらは Claude Code の統治フロー(設計→レビュー→judge)の領分)」。
   - 出力規律: 指摘は「対象ファイル:行 / 問題 / 根拠」形式。**コード全文の貼り直しをしない**
     (長大出力・写経コピペ誘発の防止)。
2. **`.claude/rules/codex.md`(新設)** — Claude Code 側から見た運用ルール:
   - 使う場面: (a) 設計書のセカンドオピニオン(3レンズ critic の補完 — **代替ではない**)
     (b) マージ前 PR / diff の別視点レビュー (c) バグの仮説出し。
   - 使わない場面: 実装・コミット・SSoT/秘密に触れる調査・**judge の代替**(判定役は acceptance-judge のまま
     — 黄金ルール4 不変)。
   - 結果の扱い: **参考意見**。採用する指摘は Claude Code の通常フロー(設計改訂 or fix ブランチ)に乗せる。
     Codex の提案をターミナルへ**手でコピペ実行しない**(統治の迂回になるため)。
   - 昇格条件: 編集権限(専用ブランチでの小修正)は **codex-ops v2 として別設計**(3レンズ再通過)。
   - **起動は review.sh のみ**(直接起動の禁止)。**Claude Code セッション内からの `codex` 直接起動は
     guard-bash.sh の deny で機械遮断する**(Hooks 第一 — arch R2 採用。人間のターミナルは規律のみ)。
     deny の一致粒度 = **実行コマンドの先頭トークンとしての `codex` のみ**(引数・パス・grep 対象文字列
     には一致させない — §5 の判定コマンド自身が deny を踏まないための要件。guard 部分一致誤検知の
     既知教訓 — arch R3)。
   - **契約ファイル改定 goal の閉包に AGENTS.md の追随確認を含める**(二重管理ドリフトの責務 — arch R1)。
   - **review.sh を改定する場合は初回受け入れ検査 (a)(b) を再実施**(隔離ステップの静かな除去の防止 — sec R2)。
   - **レビュー対象はコミット済み内容のみ**(archive = HEAD の帰結)。未コミット diff・秘密の
     **プロンプト手貼りは禁止**(隔離の迂回になるため — sec/data R2)。
   - `git status` 表示の検知範囲は本 repo のみ(SSoT clone・DB への逸脱は映らない — 部分的検知と明示)。
3. **`docs/setup/codex-setup.md`(新設)** — ユーザー向け導入手順(有効化はユーザー操作 — M5 同型):
   - インストールと認証(**API キー・認証情報はチャット・ファイルに貼らない** — 既存規範)。
     **データ保持・学習利用の設定確認**(認証経路により扱いが変わるため、導入時に OpenAI 側の
     設定・規約を確認して本書に記録する — sec R1)。
   - **起動は必ず `scripts/codex/review.sh` 経由**(クリーンコピー隔離 + サンドボックス + approval 固定。
     CLI フラグ名は導入時に `codex --help` で確認してスクリプトに確定 — 本設計はピンしない)。
   - **初回受け入れ検査(ゲート — 全 PASS まで運用開始しない。fail = 導入中止して本設計を改訂)**:
     (a) レビュー1回で元 repo の `git status --porcelain` が空
     (b) コピー先に **gitignore 資産全般が不在**であること(代表確認 = `.env`・`e2e/.auth/`・
         `e2e/screenshots/` の3パス。ラッパー自身も**起動前に .env / e2e/.auth の不在を毎回 assert**
         — 初回限りにしない。data R2)
     (c) サンドボックス内からの**ネットワーク到達試験**(fail 時の扱いもヘッダと同一 = **導入中止して
         本設計を改訂(3レンズ再通過)** — 個別の「受容追記」で済ませない)
     (d) **approval 昇格の挙動確認**(サンドボックス外実行の要求が出ても承認しない運用の確認)
     (e) 出力に秘密の引用が無いこと(限界は §4 に明示 — 補助チェック)。
   - 使い方の例(設計書レビュー・diff レビューのプロンプト例)。
   - **漏えい時対応への参照**: 万一 .env の値が露出した場合の失効・ローテーション先一覧
     (Neon PW リセット / GitHub PAT 再発行 / OpenAI キー再発行 / CRON_SECRET 再生成)。
4. **CLAUDE.md への参照追記(1項)**: 黄金ルール5 の後段等に「Codex は読取専用のセカンドオピニオン
   (正典 = .claude/rules/codex.md)。判定役・実装役の分離は不変」の1行。

### やらない

- **編集権限の付与**(workspace-write / 小修正の委任)— v2 で別設計(専用ブランチ・judge 判定・
  昇格基準を含めて3レンズ再通過)。
- Codex cloud / GitHub 連携(repo アクセス権の拡大)・CI への組み込み。
- Codex を judge・critic の代替にすること(3レンズ critic 体制・acceptance-judge は不変)。
- アプリコード・テスト・workflow への変更(本 goal の成果物 = **review.sh + 文書4点** — §0/§3 が正)。
- Codex 用のフック開発(Codex のフック機構が成熟するまでサンドボックス + 憲法 + 運用規律で代替)。

## 2. アーキテクチャ上の位置づけ

開発プロセス層(アプリ3層の外)。SSoT 非接触の担保 = **クリーンコピー隔離が第一層**(コピーは
追跡ファイルのみ・../ の SSoT clone とは無関係の一時ディレクトリ)+ AGENTS.md の明示禁止 +
サンドボックス(defense-in-depth の一枚 — 保証としては扱わない)。
既存統治(設計→3レンズ→goal→judge)への**追加の観点提供**であり、統治構造そのものは不変。

## 3. データ / インターフェース概要

成果物 = **scripts/codex/review.sh(ラッパー)** + 文書4点(AGENTS.md / .claude/rules/codex.md /
docs/setup/codex-setup.md / CLAUDE.md 追記)。アプリコード・スキーマ・CI の変更なし。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| **秘密・実データの読取→送信**(.env / e2e/.auth/state.json / e2e/screenshots の実画面 — R1 data で列挙) | **第一層 = クリーンコピー隔離**: `git archive HEAD` 展開のため gitignore 資産は**構造的に不在**(指示・目視に依存しない)。この保証は**「追跡ファイルに秘密が無い」不変条件**(黄金ルール2・guard-write・匿名 fixture 規約が担保)の上に立つ — 依存関係として明示。残余 = 下記「絶対パス注入」行 |
| **残余: 注入によりコピー外(絶対パス)の原本を読みに行く**(サンドボックスの読取範囲は保証されないため理論上可能) | 受容(見積もり): 注入源はレビュー対象 = **自己管理コンテンツのみ**(個人 repo・外部 PR なし・fixtures 匿名)で発生確率は低い。破れた場合の**実害上限を列挙**: DATABASE_URL(本番 DB — capture/overrides の読み書き)/ GITHUB_TOKEN(広スコープ — private SSoT の機微原本へ間接到達)/ NEON_AUTH_COOKIE_SECRET(セッション偽造)/ 各 API キー(課金)。**露出兆候があれば setup doc の失効・ローテーション一覧を即実行**。AGENTS.md の禁止 + 出力目視は補助層(限界 = 「読んだだけの送信」は検出不能 — 明示受容) |
| リポジトリ**追跡コード全文**が外部(OpenAI)へ送信される | 受容 — ただし SPAR 前例(denylist 済み抜粋120字)とは**水準が異なる別個の受容**として明示: 対象は git 追跡分のみ(コピー隔離により実データ・秘密は含まれない)。導入時に OpenAI 側のデータ保持・学習設定を確認して setup doc に記録 |
| Codex 出力の鵜呑み・統治の迂回(提案の手動コピペ実行) | codex.md で「参考意見・採用は通常フローに乗せる・コピペ実行禁止」を明文化 + **ラッパーが終了時に元 repo の `git status` を表示**(逸脱の事後検知)。判定役は acceptance-judge 不変 |
| CLI フラグ・挙動のバージョンドリフト | ドリフト面を review.sh 1ファイルに局所化(導入時に実フラグ確認)。AGENTS.md は CLI 仕様非依存 |
| AGENTS.md と CLAUDE.md の二重管理ドリフト | AGENTS.md は「絶対禁止の列挙 + 参照」に絞る(全文複製しない)。**追随の責務 = 契約ファイル(CLAUDE.md / rules)を改定する goal の閉包に AGENTS.md の追随確認を含める**(codex.md に明記 — arch R1) |

## 5. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較。凍結基準 = goal 分岐点 main(diff 比較は分岐点コミット基準 — 既存慣行)。
**/goal CO-1**(review.sh + 文書4点・ターン上限 5)。

```bash
# 0. ラッパー(運用の正)
test -f scripts/codex/review.sh
for k in "git archive" "mktemp" "git status --porcelain" "rm -r --" "codex" "trap"; do
  grep -qF "$k" scripts/codex/review.sh || echo "MISSING wrapper: $k"; done # 出力なし
bash -n scripts/codex/review.sh                                            # 構文 OK(exit 0)
# 1. AGENTS.md(憲法)
test -f AGENTS.md
for k in "読取専用" "セカンドオピニオン" ".env" "SSoT" "acceptance-judge" "コミット"; do
  grep -q "$k" AGENTS.md || echo "MISSING AGENTS: $k"; done            # 出力なし
# 2. 運用ルール
test -f .claude/rules/codex.md
for k in "参考意見" "コピペ実行" "judge の代替" "v2" "3レンズ" "review.sh" "追随"; do
  grep -q "$k" .claude/rules/codex.md || echo "MISSING rules: $k"; done # 出力なし
# 3. 導入手順
test -f docs/setup/codex-setup.md
for k in "review.sh" "初回受け入れ検査" "ゲート" "ネットワーク" "approval" "ローテーション" "貼らない" "保持"; do
  grep -q "$k" docs/setup/codex-setup.md || echo "MISSING setup: $k"; done # 出力なし
# 4. CLAUDE.md の参照追記(単一ファイル)
grep -q "codex.md" CLAUDE.md
# 5. アプリ非接触(実行形): npm test 全緑(件数 = goal 分岐点 main の実測・主判定は exit 0)/ tsc exit 0
git diff main --name-only | grep -vxF \
  -e 'scripts/codex/review.sh' -e 'AGENTS.md' -e '.claude/rules/codex.md' -e 'docs/setup/codex-setup.md' \
  -e 'CLAUDE.md' -e '.claude/hooks/guard-bash.sh' -e 'docs/design/basic/codex-ops.md' \
  -e 'docs/design/reviews/codex-ops.md' -e 'docs/setup/next-actions.md' | wc -l   # = 0(lib/app/tests/workflow 非接触)
# 6. guard: Claude セッションからの codex 直接起動の遮断(review.sh 経由の想定も含め deny — 人間の端末が正規経路)
grep -q "codex" .claude/hooks/guard-bash.sh
```

手動チェック(**ゲート** — 有効化 = ユーザー操作。全 PASS まで運用開始しない・fail = 導入中止して
本設計を改訂): §1-3 の初回受け入れ検査 (a)〜(e) を実施し、結果を next-actions に記録する。

## 6. 未解決の問い

- **`.env` の平文管理の根本対処**(シークレットマネージャ / direnv 分離等)— Codex に限らない
  課題として別トピック(優先度は Codex の実利用頻度を見て判断)。
- codex-ops v2(編集権限の昇格: codex/* ブランチ・judge 判定・昇格基準)— v1 の運用実績を
  1〜2週間見てから設計。
