# 要件定義書 v1.1 — 統合意思決定コックピット

> v1.0 からの変更: 複数ユーザー対応の土台(認証・ユーザー管理・権限テーブル)を当初から組み込み。
> 方針: 現状の主利用者は1名だが、ログインでユーザーを分け、権限テーブルを先に用意する。
> 取り込み元ソースと整理済み知識(SSoT/索引)は当面「共有」。生キャプチャのみ個人別。
> データ元: `SAS-Sasao/cc-sier-organization` / `ai-war-room`(2026-06-14 反映)。アプリ repo は新規。

---

## 1. 目的

組織運用の定量データ(cc-sier-organization)と個人の判断ログ(ai-war-room)を統合し、データドリブンに意思決定する個人/小規模チーム向けコックピット。UI から日々のメモ・課題・次の一手・壁打ちを入力し、Claude Action が整理して SSoT に還元する。将来の複数ユーザー利用を見据え、認証とユーザー管理を最初から備える。

## 2. 前提・利用者

- 現状の主利用者は1名。ただし**複数ユーザー対応の土台を当初から実装**する。
- 認証はアカウント制(ID/パスワードでログイン)。ユーザーと権限を管理する。
- 取り込み元(cc-sier / ai-war-room)と整理済み SSoT・索引は当面「共有」。**生キャプチャ(inbox)と壁打ちは個人別(user_id 所有)**。
- SSoT=Markdown/JSON。アプリは原則読む側。整理済みへの書き戻しは CI(Claude Action)が PR 経由でのみ。
- デプロイ Vercel / DB Neon(Postgres)+ pgvector。

## 3. スコープ

### MVP

1. ナレッジ再利用ビュー
2. 今日(着手判断)ビュー
3. 振り返りビュー
4. フロント・キャプチャ(メモ)+ 壁打ちパネル(個人別)
5. 朝昼夜深夜の Claude Actions 整理ループ
6. **ユーザー管理・認証(ログイン画面・ユーザー/権限テーブル)**

### 将来拡張

- 完全分離モデル(各ユーザーが自分の repo/データを持ち、整理済み知識も個人別)。
- 領域ヘルス検知 / 委譲方針の最適化。
- 本格 RBAC(きめ細かい権限)。今回は土台(ロール表)のみ用意。

## 4. 機能要件

### 4.1 ナレッジ再利用ビュー(最優先)
- decision をテーマ・キーワードで検索(pgvector 主軸)。ヒット判断に同一テーマ・近接期間の組織実績(完了件数・実スコア)を時間軸で紐づけ。新規テーマ入力で類似過去判断と経過を提示。

### 4.2 今日(着手判断)ビュー
- オープン WBS / kanban を一覧。各タスクにスコア・差し戻し履歴・関連 decision を添える。意思決定支援が目的。

### 4.3 振り返りビュー
- 週次/月次で報酬スコア(4 シグナル)・LLM-as-Judge 3 軸・品質ゲート合格率のトレンドを可視化。同期間の判断ログを並置。

### 4.4 フロント・キャプチャ + 壁打ちパネル(個人別)
- メモ入力(kind=status/issue/next_move)を `capture_inbox` に保存(user_id 所有)。
- 壁打ちはサーバ側で Claude を呼び pgvector 文脈注入。結論を inbox(kind=spar_conclusion・user_id)へ。機微データ(profile/minefield)は文脈に含めない。

### 4.5 整理ループ(Claude Actions ×4)
- 朝07:00/昼12:00/夜19:00/深夜24:00。未処理 inbox を消費し ai-war-room の logs/decisions に PR、processed_at 更新。整理済みは共有知識となる。

### 4.6 ユーザー管理・認証(新規)
- ID/パスワードによるログイン画面。サインイン/サインアウト/セッション管理。
- ユーザー一覧・ロール割当(最小)。ロール=admin / member を初期定義。
- 権限テーブル(roles / user_roles、将来用に permissions / role_permissions)を**先行して用意**。
- アクセス制御(当面): 生キャプチャ・壁打ちは所有者(user_id)本人のみ参照可。共有データ(索引・整理済み)は認証済みユーザーが参照可。admin はユーザー/ロール管理可。

### 4.7 共通機能
- GitHub 自動同期(§6)。横断タイムライン基盤(時間軸 + タグ)。

## 5. データ要件

### 5.1 データソースの実体(2026-06-14 反映)

cc-sier(定量): `.task-log/`(YAML・報酬スコア4シグナル/Git), `.case-bank/`(JSON・スコア推移/LLM-as-Judge 3軸 ※2026-06-14公開), `.quality-gate-log/`(合否 ※公開), `.session-summaries/`(統計 ※公開), `.conversation-log/`(MD・マスク済 ※公開), `board.md`, WBS, `masters/`(すべてGit)。対象外: `.interaction-log/`・`.active`・`agent-memory/`。

ai-war-room(定性): `docs/decisions/`・`docs/logs/`・`docs/templates/`(Git)。対象外: `profile.md`・`minefield.md`(gitignore)。

### 5.2 データモデル

共有データ(全ユーザー共通・user_id を持たない):
- `timeline_records`: id / source / type(task/quality/score/session/conversation/decision/daily_log) / occurred_at / org / topic / tags[] / title / body / raw_ref / スコア列(reward_score, completeness, accuracy, clarity, quality_gate_result) / embedding(検索対象のみ)
- `metric_aggregates`: period / metric / org / value
- `sync_state`: repo / last_commit / last_synced_at
- `tag_synonyms`: 正規化シノニム

個人別データ(user_id 所有):
- `capture_inbox`: id / **user_id** / created_at / kind(status/issue/next_move/spar_conclusion) / topic / tags[] / body / source / processed_at / curated_ref

認証・権限(ユーザー管理):
- ユーザー/セッション: **Neon Auth が Neon 内に保持**(DB ブランチと一緒に分岐)。アプリは user id を参照。
- `roles`: id / name(admin, member) / description
- `user_roles`: user_id / role_id(m:n)
- (将来用に先行作成) `permissions`: id / key、`role_permissions`: role_id / permission_id

### 5.3 結合キーとタグ正規化
- 結合は「時間軸」+「タグ/トピック」。取込時に slug 化し `tag_synonyms` で正準語へ。語彙は org-slug/masters から初期生成し運用追補。

### 5.4 プライバシー・分離
- 取り込むのはマスク済み会話ログのみ。`profile.md`/`minefield.md` は取り込まない。秘密情報は env のみ(直書き禁止)。
- 生キャプチャ・壁打ちは所有者本人のみ参照(user_id スコープをアプリ層で強制。将来 RLS 併用可)。
- 整理済み(SSoT→索引)は共有知識。**個人 private メモが整理後は共有になる**点を許容(完全個人別が必要なら将来の分離モデルAへ拡張)。

## 6. アーキテクチャ / データ取り込み

```
2 repo(SSoT)─GitHub API→ Vercel Cron(毎時)─解析/正規化→ Neon(pgvector)
                                                              ▲           │
            ai-war-room MD ←Claude Actions×4(PR)← capture_inbox(user別)│
            timeline_records(共有)───────表示・壁打ち文脈──────────────┘
認証: Neon Auth(users/sessions を Neon に保持)→ Next.js が user_id でキャプチャをスコープ
```

- 取り込みは pull 型(毎時)。冪等キー source+file_path+commit_sha。整理は GitHub Actions + claude-code-action@v1、PR・許可パス限定。生キャプチャと整理済みを分離。

## 7. 非機能要件

- 認証: **Neon Auth**(ID/パスワード。users/sessions を Neon に保持し DB ブランチと分岐。Neon MCP の provision_neon_auth で構築可)。代替: Auth.js + Neon アダプタ。
- 認可: ロールベースの土台(roles/user_roles)。当面 admin/member の2ロール。user_id スコープで個人データを保護。
- 性能/コスト: データ小規模。Neon 無料枠 + Vercel + 埋め込み API 従量。
- 運用: 同期失敗リトライ・最終同期可視化。Actions は concurrency で二重実行防止、空振りは no-op。

## 8. 技術スタック

- Next.js(App Router, TS)on Vercel / Neon(Postgres)+ pgvector。
- 認証: Neon Auth(ID/パスワード)。認可: 自前 roles/user_roles。
- 検索: pgvector + 多言語埋め込み(env で1モデル固定、日本語品質優先、research-spike で検証)。
- 同期: Vercel Cron + GitHub API(pull)。整理: GitHub Actions + claude-code-action@v1。
- 壁打ち: サーバ側 API ルートから Claude を呼び pgvector 文脈注入。

## 9. リリース順

- M0: 認証・ユーザー管理土台(Neon Auth + ログイン画面 + roles/user_roles + capture_inbox.user_id)。
- M1: 取り込み基盤 + 振り返り(実スコア)。
- M2: ナレッジ再利用(pgvector)。
- M3: 今日ビュー。
- M4: キャプチャ + 壁打ち(個人別)。
- M5: 整理 Actions ×4。
- (将来)M6: 完全分離 / 領域ヘルス / 本格 RBAC。

> 認証は他機能の前提になるため M0 に前出し。

## 10. 決定事項(旧未決の決着)

1. gitignore データ → 解決(スコア系は 2026-06-14 公開・取込対象)。
2. 埋め込み → 多言語1モデルを env 固定(初期は汎用、research-spike で検証し差替)。
3. タグ正規化 → slug 化 + tag_synonyms。
4. スキーマ確認 → 公開済み。パーサ前に実ファイルで契約を fixture 固定。
5. 認証 → **Neon Auth(ID/パスワード)** に決定(旧: Vercel パスワード保護から変更)。
6. リリース順 → §9。
7. **複数ユーザー → 土台を当初から実装**(ログイン・users/roles/user_roles・capture_inbox の user_id 化)。ソースと整理済み知識は共有、生キャプチャは個人別。

## 11. 受け入れ条件(機械判定)

本要件定義書が満たすべき機械判定可能な条件。後続の `/design-review docs/design/requirements.md` と各マイルストーンの `/goal` の土台とする。

- **必須セクション(H2)がすべて存在する**: 目的 / 前提・利用者 / スコープ / 機能要件 / データ要件 / アーキテクチャ / 非機能要件 / 技術スタック / リリース順 / 受け入れ条件(機械判定)。
  - 検証例: `for s in 目的 前提 スコープ 機能要件 データ要件 アーキテクチャ 非機能要件 技術スタック リリース順 受け入れ条件; do grep -q "^## .*$s" docs/design/requirements.md || echo "MISSING: $s"; done`
- **データモデルに認証・権限・所有が定義されている**:
  - `users`(Neon Auth 参照)・`roles`・`user_roles` が §5.2 に存在する。
  - `capture_inbox` が `user_id` を持つ(個人所有)。
  - `timeline_records` は `user_id` を**持たない**(共有)ことが明記されている。
  - 検証例: `grep -q "user_roles" docs/design/requirements.md && grep -q "capture_inbox" docs/design/requirements.md && grep -Eq "timeline_records.*user_id を持たない|user_id を持たない" docs/design/requirements.md`
- **データ目録の対象/対象外が両 repo の実 `.gitignore` と矛盾しない**(根拠パス併記)。未確認スキーマは「要確認」と明示する。
  - 取込対象: `.task-log/` `.case-bank/` `.quality-gate-log/` `.session-summaries/` `.conversation-log/`(マスク済) `board.md` WBS `masters/`(cc-sier) / `docs/decisions/` `docs/logs/` `docs/templates/`(ai-war-room)。
  - 対象外: `.interaction-log/` `.active` `agent-memory/`(cc-sier) / `profile.md` `minefield.md`(ai-war-room・gitignore)。
  - 注: 上記は 2026-06-14 時点の反映。`/design-review` で両 repo の実 `.gitignore`(GitHub API 経由・読み取りのみ)と突き合わせ、差異があれば「要確認」として更新する。
- **禁止事項に違反していない**: 元 repo への書き込み記述なし / 秘密情報(接続文字列・トークン・APIキー)の直書きなし / `profile.md`・`minefield.md` の取込・転記なし。

---

## 付録: 本書をプロンプトで生成・維持する

新規 repo で `claude` を起動し以下を貼ると、最新リポジトリを確認しつつ `docs/design/requirements.md` を生成/更新する。

````text
あなたは統合意思決定コックピットの要件定義担当です。docs/design/requirements.md を生成/更新せよ。

# 入力
- GitHub: SAS-Sasao/cc-sier-organization と SAS-Sasao/ai-war-room を読む(書込禁止・API経由のみ)。
- 両 repo の .gitignore を確認し「同期可能(Git管理)」と「対象外」を実態で列挙(.case-bank等が公開済みか、profile/minefieldが対象外か)。
- task-log(YAML)/case-bank(JSON)/board.md/WBS/decisions/logs の実スキーマをサンプル確認。

# 確定方針(変更しない)
- 個人/小規模チーム・統合型。SSoT=Markdown/JSON、アプリは読む側。UIはcapture_inboxのみ書く。整理はClaude ActionがPRでSSoTに還元。
- 複数ユーザー対応の土台を当初から: ID/パスワードのログイン画面、認証=Neon Auth(users/sessionsをNeonに保持)、
  権限テーブル roles/user_roles(将来用 permissions/role_permissions も先行作成)、capture_inbox に user_id 所有。
- ソース取り込み元と整理済み知識(timeline_records)は共有。生キャプチャ・壁打ちのみ個人別(user_idスコープで保護)。
- スタック: Next.js(Vercel)/ Neon + pgvector / 埋め込みは多言語1モデルenv固定。
- MVP: ナレッジ再利用/今日/振り返り/キャプチャ+壁打ち/朝昼夜深夜Actions/ユーザー管理・認証。
- 結合キー=時間軸+タグ(slug化+tag_synonyms)。プライバシー=マスク済みのみ取込、profile/minefield除外。
- リリース順 M0認証・ユーザー管理→M1取込+振り返り→M2ナレッジ→M3今日→M4キャプチャ+壁打ち→M5整理Actions。

# 出力の必須セクション(H2)
目的 / 前提・利用者 / スコープ / 機能要件(6項: 5画面+ユーザー管理) /
データ要件(データ目録・データモデル[共有/個人別/認証権限]・結合キー・プライバシー分離) /
アーキテクチャ / 非機能要件 / 技術スタック / リリース順 / 受け入れ条件(機械判定)

# 禁止事項
- 元 repo への書込。秘密情報の直書き。profile.md/minefield.md の取込・転記。

# 受け入れ条件(機械判定)
- 上記必須セクション(H2)がすべて存在。
- データモデルに users(Neon Auth参照)/roles/user_roles と capture_inbox.user_id が定義され、timeline_records は user_id を持たない(共有)ことが明記。
- データ目録の対象/対象外が両 repo の実 .gitignore と矛盾しない(根拠パス併記)。未確認スキーマは「要確認」として明示。

20ターンで停止。完了後 /design-review docs/design/requirements.md を促せ。
````
