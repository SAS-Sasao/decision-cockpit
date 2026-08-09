# 要件定義書 v1.2 — 統合意思決定コックピット

> **v1.2(2026-08-09・リバース追記)**: v1.1 は M0〜M5 を前提に書かれていたが、実装が
> **M5 完了後に大きく広がった**ため、**実装済みの内容を要件へ逆写し**した。追記箇所は
> 「**(v1.2 追記)**」で示す。本書は**実装の後追い記録ではなく、以後の変更判断の土台**とする
> (各機能の正典は docs/design/{basic,detail}/<topic>.md・受け入れ条件は同 §4/§5)。
> 主な増分: **AI 実行経路が4本に**(壁打ち / Codex 端末 / Codex 壁打ちモード / CI レビュー)/
> **CI ループが3本に**(整理 / WBS 書き戻し / CI レビュー)/ SSoT への書き戻しに**第2の例外**
> (WBS 限定編集)/ 盤面の双方向化(カード操作 → SSoT 還流)/ フロント整合性の機械判定。
>
> v1.0 からの変更: 複数ユーザー対応の土台(認証・ユーザー管理・権限テーブル)を当初から組み込み。
> 方針: 現状の主利用者は1名だが、ログインでユーザーを分け、権限テーブルを先に用意する。
> 取り込み元ソースと整理済み知識(SSoT/索引)は当面「共有」。生キャプチャのみ個人別。
> データ元: `SAS-Sasao/cc-sier-organization` / `ai-war-room`(2026-06-14 反映)。アプリ repo は新規。

---

## 1. 目的

組織運用の定量データ(cc-sier-organization)と個人の判断ログ(ai-war-room)を統合し、データドリブンに意思決定する個人/小規模チーム向けコックピット。UI から日々のメモ・課題・次の一手・壁打ちを入力し、Claude Action が整理して SSoT に還元する。将来の複数ユーザー利用を見据え、認証とユーザー管理を最初から備える。

## 2. 前提・利用者

- 現状の主利用者は1名。ただし**複数ユーザー対応の土台を当初から実装**する。
- **(v1.2 追記)「土台」の範囲**: スキーマ(user_id 所有)・ログイン・ロール表まで。
  **CI ループは単一ユーザー前提**で、organize-loop は未処理行に2人以上の user_id が現れると
  **run を fail させて停止**する(帰属設計を再決着するまで動かさない)。
  board_overrides の一覧と review の一覧には同種のガードが**無い**(§5.2 の帰属の項)。
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

### 実装済みの追加スコープ(v1.2 追記 — MVP 後に確定)

7. **盤面の双方向化**: /today のカード(WBS / capture)を UI から動かし、WBS の差分は
   **SSoT へ限定編集 PR で還流**(wbs-loop)。
8. **AI レビュー**: 本番 UI から CI(GitHub Actions)上の Claude に**読取専用レビュー**を依頼し、
   結果を DB 経由で表示(review-loop)。ローカル開発向けに **Codex の2経路**(端末 / 壁打ちモード)。
9. **壁打ちの導線化**: 返答に検証済みパラメータの提案リンクを付す(spar-navigate)。
10. **フロント整合性の機械判定**: Playwright で console エラー・横はみ出し・SVG テキスト重なりを
    6画面ぶん検査(front-check・ローカル運用ツール)。
11. **capture の運用機能**: 手動トリアージ(status)と論理削除(ゴミ箱)。
12. **組織 docs の索引化**: cc-sier の docs 配下(learning-notes 等)を knowledge 型として取り込み。

### 将来拡張

- 完全分離モデル(各ユーザーが自分の repo/データを持ち、整理済み知識も個人別)。
- 領域ヘルス検知 / 委譲方針の最適化。
- 本格 RBAC(きめ細かい権限)。今回は土台(ロール表)のみ用意。
- **(v1.2 追記)** card-review(/today のカードからワンクリックで AI レビュー依頼 — 設計 PASS 済み・実装待ち)/
  codex-ops v2(編集権限の付与)/ 案D(CI が修正 PR を出す)/ SSoT 横断レビュー。

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
- 朝07:00/昼12:00/夜19:00/深夜24:00。未処理 inbox を消費し、**2 repo の許可パスへ PR**
  (**(v1.2 訂正)** ai-war-room の `docs/logs/`・`docs/decisions/` に加え、
  `cc-sier-organization` の `.companies/<org>/docs/decisions/`・`.companies/<org>/docs/todos/`。
  **省略形で書かない** — 許可パスは黄金ルール1 の中核で、`docs/todos/`(repo 直下)と読める余地を作らない)。
  完了時に `processed_at` / `status='done'` / `curated_ref` を更新(**mark は repo 単位**)。整理済みは共有知識となる。

### 4.6 ユーザー管理・認証(新規)
- ID/パスワードによるログイン画面。サインイン/サインアウト/セッション管理。
- ユーザー一覧・ロール割当(最小)。ロール=admin / member を初期定義。
- 権限テーブル(roles / user_roles、将来用に permissions / role_permissions)を**先行して用意**。
- アクセス制御(当面): 生キャプチャ・壁打ちは所有者(user_id)本人のみ参照可。共有データ(索引・整理済み)は認証済みユーザーが参照可。admin はユーザー/ロール管理可。

### 4.7 共通機能
- GitHub 自動同期(§6)。横断タイムライン基盤(時間軸 + タグ)。
- **(v1.2 追記)** 安全 Markdown レンダラ(HTML 文字列を生成せずトークン木を JSX 化・リンクは
  http/https の allowlist のみ)。SSoT 由来の本文・AI の出力はすべてこれで描画する。

### 4.8 盤面の双方向化 — WBS カード操作と SSoT 還流(v1.2 追記・wbs-loop)

- /today の **WBS カードをボタン / D&D で移動**できる。差分は `board_overrides` に記録し、
  **SSoT は即座には変えない**(UI は「PR 反映待ち」バッジ)。
- 日次の CI(**決定的スクリプト・LLM 不使用**)が差分を
  `.companies/<org>/docs/secretary/*-wbs.md` の**ステータストークン置換のみ**の PR にする。
- **黄金ルール1 の第2例外**(2026-07-26 承認)。行単位バイト diff の機械 verify → PR → **自動マージなし**。
- 差分は**3つの出口**で決着する。**DB の `resolution` は2値**(`applied` / `superseded`)で、
  **書き手が分かれる**: (1) 反映済み = 同期後にアプリが `applied` (2) 外部で先に変わっていた =
  同期後にアプリが `superseded` (3) 対象行が SSoT から消えていた = **CI(wbs_bot)** が `superseded`。

### 4.9 AI レビュー — 実行経路4本(v1.2 追記)

| 経路 | 実行場所 | 用途 | 正典 |
|---|---|---|---|
| 壁打ち(SPAR) | Vercel の API ルート | 索引を文脈に相談・結論を capture へ | capture-spar |
| Codex 端末レビュー | 人間の端末(クリーンコピー) | repo のセカンドオピニオン | codex-ops |
| Codex 壁打ちモード | ローカル dev ランナー(127.0.0.1) | 同上を UI から | codex-spar |
| **CI レビュー** | **GitHub Actions(claude-code-action)** | **本番 UI から repo レビュー(非同期)** | **review-loop** |

- **全経路の共通原則**: 結果は**参考意見**(design-review / acceptance-judge の**代替にしない**)/
  出力は素テキスト or 安全レンダラで描画(innerHTML 系を使わない)。
- **経路ごとに異なる点**(v1.2 訂正 — 4経路を1つの原則で束ねない):
  - **SPAR のみ**が結論を capture へ保存できる(§4.4 — これが SPAR の中核機能)。
  - **Codex 2経路と CI レビューは読取専用**で、結果を capture / SSoT に流す経路を持たない
    (codex-spar は結論保存から**構造的に除外**・review-loop は capture と非連結)。
- Codex 経路は**クリーンコピー隔離**(`git archive HEAD` = 追跡ファイルのみ)で秘密を構造的に不在にする。
- CI レビューは **3-job 分離**(claim / review / writeback)で、**Claude が動く job に DB secrets を渡さない**。
  状態は `review_requests` の CAS 遷移(先勝ち・後着 no-op)。

### 4.10 capture の運用機能(v1.2 追記)

- **トリアージ**: `status`(open / in_progress / done)。**書き手は2系統** — ユーザーの手動操作と、
  整理ループの完了マーク(`status='done'`)。未処理バッジは
  `user_id スコープ AND processed_at IS NULL AND status='open' AND deleted_at IS NULL` で数える。
- **論理削除(ゴミ箱)**: `deleted_at`。**物理 DELETE は禁止**。整理ループの消費対象からも除外。

### 4.11 フロント整合性の機械判定(v1.2 追記・front-check)

- Playwright で6画面を検査: **console エラー**(allowlist は完全一致の正規表現)/ **横はみ出し** /
  **SVG テキストの重なり**(境界矩形の総当たり)。
- **ローカル専用の運用ツール**(`npm test` にも CI にも組み込まない)。認証は手動ログイン1回
  (state は gitignore)。
- **(v1.2 訂正)実データの扱い**: Playwright の**自動キャプチャ(失敗時スクショ・トレース・動画)は
  すべて無効**。ただし**証跡用の明示スクリーンショットは撮る**(`e2e/screenshots/` = gitignore)。
  **画像を repo / PR / チャットへ出すことは禁止**(実画面には同期済みの実データが映るため)。

## 5. データ要件

### 5.1 データソースの実体(2026-06-14 反映)

> **(v1.2 注記)** 本節は「**SSoT に何があるか**」の記述であり、「**何を取り込むか**」とは別。
> 実際の取込対象は**実装の allowlist が正典**(lib/ingestion/run-sync.ts)— §11 の判定もそちらを見る。

**(v1.2 追記)** 組織側 docs の索引化(org-docs-ingestion)により、`docs/` 配下の
`daily-digest` / `secretary/learning-notes` / `research` / `retail-domain` / `diagrams` / `drawio` /
`info-source-master.md` が **knowledge 型**として、`docs/decisions/` が **decision 型**として取り込まれる。

cc-sier(定量): **データは `.companies/<org>/` 配下に組織単位で配置**(2026-07-12 実構造反映 — docs/research/m1-ssot-schema.md)。各 org 配下に `.task-log/`(MD+YAML frontmatter・報酬スコア4シグナル/Git), `.case-bank/`(JSON・`index.json` 1ファイルに cases 配列/LLM-as-Judge 3軸), `.quality-gate-log/`(JSONL・合否), `.session-summaries/`(統計), `.conversation-log/`(MD・マスク済), `docs/`(board.md, WBS), `masters/`(すべてGit)。対象外: `.interaction-log/`・`.active`・`agent-memory/`・機微候補(`*profile*`/`*personality*` 等)。

ai-war-room(定性): `docs/decisions/`・`docs/logs/`・`docs/templates/`(Git)。対象外: `profile.md`・`minefield.md`(gitignore)。

### 5.2 データモデル

共有データ(全ユーザー共通・user_id を持たない):
- `timeline_records`: id / source / **file_path / item_key / commit**(冪等キーと世代)/
  type(task/quality/score/session/conversation/decision/daily_log/**knowledge**)/ occurred_at / org /
  topic / tags[] / title / body / raw_ref / **status('ok','error')**(パース失敗もレコード化)/ **synced_at** /
  スコア列(reward_score, signals(報酬4シグナル bool×4・task-log 由来のみ), completeness, accuracy,
  clarity, quality_gate_result)/ embedding(M2)/ **embedding_model・embedded_at**(モデル混在の検知 —
  不一致行を再埋め込み対象にする)
- `metric_aggregates`: period / metric / org / value(**(v1.2 注記)DDL のみ存在し、
  現状は書き手も読み手もいない** — 集計は表示時に timeline_records から算出している)
- `sync_state`: repo / last_commit / last_synced_at /
  **`last_summary` jsonb**(ok / error / skipped / deleted / fetch_failed / hasMore / sourceKind)/
  **`progress` jsonb**(再開用の進行カーソル)
- `tag_synonyms`: 正規化シノニム

個人別データ(user_id 所有):
- `capture_inbox`: id / **user_id** / created_at / kind(status/issue/next_move/spar_conclusion) / topic / tags[] / body / source / processed_at / curated_ref
  / **(v1.2 追記)** `status`(open/in_progress/done・手動トリアージ)/ `deleted_at`(論理削除)

**(v1.2 追記)盤面・レビューのデータ**:
- `board_items`(0005): WBS / kanban の索引。冪等キー `(source, file_path, item_key)`・`commit` は属性
  (世代)。表示・検証はいずれも**最新世代**に限定する。
- `board_overrides`(0009): カード移動の**オーバーレイ差分**(SSoT 不変)。
  PK `(source, file_path, item_key)` / `desired_state` / `base_state`(移動直前の実効状態)/
  `pr_ref` / `resolved_at` / `resolution`(applied | superseded)。
- `review_requests`(0010): CI レビューの依頼と結果。`status`(pending → running → done | error)/
  `question` / `result` / `error_kind` / `run_ref`。**全遷移が CAS**(先勝ち)。物理 DELETE なし。

**(v1.2 追記)帰属の位置づけ — §5.4 の「所有者本人のみ参照」の明示された例外**:
`board_overrides.user_id` と `review_requests.requested_by` は**帰属を記録するが参照はスコープしない**
(前者 = 盤面は共有物 / 後者 = 一覧は admin 限定だが依頼者では絞らない)。**単一ユーザー前提での受容**であり、
複数ユーザー運用に移行する場合は**この2つが最初に壊れる**(organize-loop は未処理行に2人以上の user_id が
現れると run を fail させるガードを持つが、board_overrides の一覧と review の一覧にはガードが無い)。

**(v1.2 追記)CI 専用 DB ロール**(被害上限を機械で決める・**到達面 = 読取と書込の両方**で記す):

| ロール | SELECT(読める列) | UPDATE(書ける列) |
|---|---|---|
| `organize_bot` | capture_inbox の10列(**`body` を含む** — 整理に本文が要るため) | processed_at / curated_ref / status |
| `wbs_bot` | board_overrides の8列 | pr_ref / resolved_at / resolution |
| `review_bot` | review_requests の5列(**`requested_by` は含まない**) | status / started_at / completed_at / **result** / result_truncated / error_kind / run_ref |

- いずれも**列限定 GRANT**(正典 = docs/setup/organize-role.sql)。**他テーブルへの GRANT は付与しない**が、
  「到達できないこと」は SQL では保証されず**有効化時の手動確認**に依る(各 setup doc のゲート項目)。
- `review_bot` は **`result`(最大30000字)を書ける** — 被害上限は「状態列のみ」ではない。
  DB 側の長さ CHECK が無制限格納を防ぐ(review-loop 詳細 §1)。

認証・権限(ユーザー管理):
- ユーザー/セッション: **Neon Auth が Neon 内に保持**(DB ブランチと一緒に分岐)。アプリは user id を参照。
- `roles`: id / name(admin, member) / description
- `user_roles`: user_id / role_id(m:n)
- (将来用に先行作成) `permissions`: id / key、`role_permissions`: role_id / permission_id

### 5.3 結合キーとタグ正規化
- 結合は「時間軸」+「タグ/トピック」。取込時に slug 化し `tag_synonyms` で正準語へ。語彙は org-slug/masters から初期生成し運用追補。

### 5.4 プライバシー・分離
- `profile.md` / `minefield.md`(機微候補)は取り込まない。秘密情報は env のみ(直書き禁止)。
- **(v1.2 訂正)会話ログ(`.conversation-log/`)は現在まったく取り込んでいない**(実装 allowlist に該当なし)。
  v1.1 の「取り込むのはマスク済み会話ログのみ」は**取り込みを前提にした条件文**だったが、
  マスク保証がサンプリング確認のみのため見送られたまま(ingestion-foundation §5 問い #2)。
  将来取り込む場合は**マスク検証方針(frontmatter `masked: true` の検証 + 機微パターン走査)を
  先に設計する**こと — 「マスク済みだから索引に入っている」と読ませない。
- 生キャプチャ・壁打ちは所有者本人のみ参照(user_id スコープをアプリ層で強制。将来 RLS 併用可)。
- 整理済み(SSoT→索引)は共有知識。**個人 private メモが整理後は共有になる**点を許容(完全個人別が必要なら将来の分離モデルAへ拡張)。

**(v1.2 追記)外部・CI への越境データの一覧**(各設計書の受容を1箇所に集約する。
新機能の判断はここを起点にする。個別の受容根拠は各設計書 §4 が正典):

| 経路 | 何が出るか | 出先 | 受容の記録 |
|---|---|---|---|
| 壁打ち(SPAR) | 入力文 + 索引の抜粋(denylist 済み・120字) | 外部 LLM API | capture-spar |
| organize-loop | **capture の本文**(rows.json) | Claude(CI)+ artifact(保持1日) | organize-loop |
| review-loop | 質問文 + **本 repo(decision-cockpit)の追跡ファイル**(CI が checkout。**SSoT repo ではない**) | Claude(CI)+ artifact + 実行ログ | review-loop |
| Codex 2経路 | **repo の追跡ファイル全文**(クリーンコピー) | OpenAI | codex-ops / codex-spar |
| card-review(実装待ち) | **WBS の title とパス(組織名・担当者名を含み得る)/ capture 本文** | 同 review-loop | card-review 詳細 §0b |
| **索引の埋め込み**(v1.2 追記) | **`status='ok'` の全 timeline_records の title + tags + body**(`buildEmbedInput` で連結) | 外部埋め込み API(OpenAI / Google) | search-foundation |
| **検索/壁打ちのクエリ埋め込み** | 入力クエリ文 | 同上 | search-foundation |

- **前提は経路ごとに違う**(1行にまとめない — 封じ込めの過大主張を避ける):
  - **admin 限定なのは CI 系3経路のみ**(organize / review / card-review)。
    **SPAR は member を含む全認証ユーザーが使える**(`app/api/spar/route.ts` は `getUser()` のみ。
    admin で絞っているのは壁打ちパネルの **CI レビュー・モードだけ**)。
  - **artifact 保持1日 / private repo / checkout** が効くのは CI 系のみ。Codex は人間の端末、
    埋め込みはサーバからの API 呼び出しで、いずれも該当しない。
  - **埋め込み経路は量が最大**(索引全行 ≒ 数千行が外部 API に渡る)。ユーザー操作の起点が無く
    バッチで走るため、**「使わなければ出ない」が成立しない唯一の経路**。
  - 全経路に共通するのは「**機微は書かない運用規律**」と「機微ファイル(profile / minefield)を
    索引に入れない」の2点のみ。
- **注意**: card-review は本文を `question` に**複製**するため、capture を論理削除しても
  複製は残る(受容済み)。また **「実名を書かない」という注記は、システムが自動挿入する経路では
  成立しない**(だから確認ステップで人が読む)。
- **DB ロール経由の到達**: `review_bot` は `question` を読める = capture 本文の複製にも届く
  (organize-role.sql の分離理由に対する部分的な緩み — **card-review 詳細 §1** で受容。
  基本設計 §1 の review_bot 言及は「列限定 GRANT は列追加で自動拡張されない」の話で別物)。

## 6. アーキテクチャ / データ取り込み

```
2 repo(SSoT)─GitHub API→ Vercel Cron(**日1回・JST 06:00**)─解析/正規化→ Neon(pgvector)
                                                              ▲           │
    2 repo の許可パス ←organize-loop(PR)← capture_inbox(user別)────────│
    WBS のトークン置換 ←wbs-loop(PR・決定的スクリプト)← board_overrides ─│
    (書き込みなし)    ←review-loop(CI レビュー)→ review_requests ───────│
            timeline_records / board_items(共有)──表示・壁打ち文脈───────┘
認証: Neon Auth(users/sessions を Neon に保持)→ Next.js が user_id でキャプチャをスコープ
```

- 取り込みは pull 型。冪等キー **`(source, file_path, item_key)`**(`commit` は「最後に処理した
  コミット」の属性列 — キーに含めない。再同期で重複を作らないため)。整理は GitHub Actions +
  claude-code-action@v1、PR・許可パス限定。生キャプチャと整理済みを分離。
  **(v1.2 追記)** Vercel Hobby では cron が**日1回**(JST 06:00)。
- **(v1.2 追記)CI ループは3本**、SSoT への書き戻しは**2つの例外のみ**:

| ループ(workflow) | 実行主体 | 書き込み | 例外の別 |
|---|---|---|---|
| organize-loop(`daily-organize.yml`) | claude-code-action(3-job 分離) | 2 repo の許可パスへ**追加のみ** | 黄金ルール1 の例外1 |
| wbs-loop(`wbs-writeback.yml`) | **決定的スクリプト(LLM 不使用)** | WBS の**トークン置換のみ** | 黄金ルール1 の例外2 |
| review-loop(`ci-review.yml`) | claude-code-action(3-job 分離) | **書き込みゼロ**(読取レビュー) | 例外に当たらない |

  **書き込みを伴う2ループ(organize / wbs)は PR 経由・自動マージなし・force push 禁止**
  (人間レビューが最終防御)。**review-loop は PR を作らない**ため、この防御列ではなく
  **「そもそも書けない」こと自体**(後述の `github_token` 明示)が担保になる。
  3ループとも **ENABLE_* のリポジトリ変数で個別に停止**できる。
- **(v1.2 追記)防御は「指示」ではなく機械層に置く**: CI の Claude には `--allowedTools` を完全一致で
  与え(Bash・ネットワーク系ツールなし)、`persist-credentials: false`・artifact 保持1日・
  **repo 側のエージェント設定(settings / .mcp.json)を LLM 起動前に除去**する。
  質問文は**ファイル経由**で渡し、式展開でプロンプトに埋めない。
- **(v1.2 追記)「CI は本 repo に書けない」の唯一の担保**: claude-code-action に
  **`github_token` を明示指定**して OIDC / GitHub App 経路を使わない。指定しないと action は OIDC を
  交換して **contents/pull-requests/issues が write の App トークン**を取得し、**workflow の
  `permissions` とは無関係に書ける**ようになる(2026-08-09 実測。正典 =
  docs/research/claude-code-action-oidc.md)。**`id-token: write` を足す方向で直さないこと。**
  action は可変メジャータグ(`@v1`・SHA 未ピン)である点は受容。
- **(v1.2 注記)防御の形は経路ごとに違う**: organize-loop の Claude ジョブは**そもそも checkout しない**
  (スクリプト実体・SSoT・秘密が同一 FS に存在しない = より強い構造的防御)。除去 step があるのは
  **checkout が必然の review-loop のみ**。「揃える」ために organize 側へ checkout を足さないこと。
- 開発環境は **Docker(`docker compose`)**: app(Next.js dev)+ ローカル pgvector コンテナでローカル完結。**Neon は staging/本番とマイグレーションのブランチ検証**に使う(env で切替可)。

## 7. 非機能要件

- 認証: **Neon Auth**(ID/パスワード。users/sessions を Neon に保持し DB ブランチと分岐。Neon MCP の provision_neon_auth で構築可)。代替: Auth.js + Neon アダプタ。
- 認可: ロールベースの土台(roles/user_roles)。当面 admin/member の2ロール。user_id スコープで個人データを保護。
- 性能/コスト: データ小規模。Neon 無料枠 + Vercel + 埋め込み API 従量。
- 運用: 同期失敗リトライ・最終同期可視化。Actions は concurrency で二重実行防止、空振りは no-op。
- **(v1.2 追記)フロント品質**: UI を変更したら `npm run e2e`(6画面)を通す。目視 OK は不可。
- **(v1.2 追記)開発ガード**: guard hooks(PreToolUse)で `rm -rf` / force push / 生の
  DROP・TRUNCATE・DELETE / **DB ボリュームの破棄** / SSoT への書き込み兆候 / **Claude セッションからの
  codex 起動**を機械遮断する(2026-07-20 の DB 全消失事故を受けた恒久措置)。
- **(v1.2 追記)復旧**: `capture_inbox` / `board_overrides` / `review_requests` は **SSoT から復元
  できない**(UI 入力・カード操作・レビュー履歴)。DB を初期化する場合は docs/setup/db-recovery.md の
  手順を**最後まで完了**させ、復元できなかったデータを人間に報告する。
  **⚠ ランブック側の追随が必要**(2026-08-09 時点・db-recovery.md の3点):
  1. replay が **0009 止まり**で 0010(review_requests)を含まない
     → **CR-1 の成果物として 0011 まで拡張する**(card-review 詳細 §3 + 同 §4 のピンが担保)。
  2. 「復元できないもの」の列挙に **review_requests が無い**
     → **これはどの設計書も引き受けていない**(card-review には「復元」の語が1つも無い)。
     CR-1 の設計に追記してから着手する(next-actions に記載)。**本書のこの記述を
     「CR-1 がやる」根拠にしない** — 担い手を決めるまでは未決事項。
  3. 「本番のマイグレーションは 0003〜0008 が未適用」という記述が残っている
     → **§9 の実状(0001〜0010 適用済み)と食い違う**。読むと再適用しかねない。
- **(v1.2 追記)AI 利用のコスト・封じ込め**: CI レビューは admin 限定 + 同時1件 + 日次上限 +
  timeout。Claude は Max サブスク認証(従量課金なし)。Codex は読取専用・端末起動のみ。

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

**(v1.2 追記)実績と M5 後の追加**(いずれも設計 → 3レンズ全 PASS → /goal → acceptance-judge の順で実装):

| 区分 | 内容 |
|---|---|
| M0〜M5 | 完了(2026-07-12 〜 07-20)。設計書 = auth-foundation(M0)/ ingestion-foundation(M1)/
  search-foundation(M2)/ today-view(M3)/ capture-spar(M4)/ organize-loop(M5)。
  M5 は organize-loop を **2 repo** に拡張して着地 |
| capture の運用 | capture-triage(status)/ capture-trash(論理削除)/ spar-overlay(全画面の壁打ち) |
| 基盤の修正 | tag-cold-start(初回同期でタグが付かない既存バグの恒久修正)/ md-render / org-docs-ingestion |
| UI | ui-shell / ui-polish / today-board-interactive(カンバン + モーション)/ today-summary-sync |
| 品質 | **front-check**(Playwright・fail→fix→pass を実証) |
| SSoT 還流 | **wbs-loop**(WL-1 オーバーレイ / WL-2 CI 書き戻し) |
| AI 経路 | spar-navigate / **codex-ops** / **codex-spar** / **review-loop**(RL-1 / RL-2) |
| 設計済み・実装待ち | **card-review**(/today のカードから AI レビュー依頼) |

**運用状態(2026-08-09)**: Vercel 本番稼働・マイグレーション 0001〜0010 適用済み・
CI レビューは実運用中。

| ループ | 状態 |
|---|---|
| review-loop | **稼働中**(有効化済み・実 run が done まで到達) |
| wbs-loop | **有効化待ち**(ユーザー操作 = ロール作成 + Secrets + Variables) |
| organize-loop | **⚠ ユーザー操作だけでは有効化できない** — review-loop と同じ2欠陥
  (OIDC 経路 / `Write(path)` の無効な権限記法)を抱えており、**このままだと generate job が必ず失敗する**。
  **別 goal で改訂 + 3レンズ再通過が必要**(正典が別のため)。それまで `ENABLE_DAILY_ORGANIZE=true` にしない |

## 10. 決定事項(旧未決の決着)

1. gitignore データ → 解決(スコア系は 2026-06-14 公開・取込対象)。
2. 埋め込み → 多言語1モデルを env 固定(初期は汎用、research-spike で検証し差替)。
3. タグ正規化 → slug 化 + tag_synonyms。
4. スキーマ確認 → 公開済み。パーサ前に実ファイルで契約を fixture 固定。
5. 認証 → **Neon Auth(ID/パスワード)** に決定(旧: Vercel パスワード保護から変更)。
6. リリース順 → §9。
7. **(v1.2 追記)SSoT への書き戻しは2経路のみ** — organize-loop(追加のみ)と wbs-loop
   (トークン置換のみ・決定的スクリプト)。手元(開発セッション・executor)からの書き込みは**完全禁止**。
8. **(v1.2 追記)AI の位置づけ** — 生成物は**参考意見**。設計レビュー(3レンズ critic)と
   受け入れ判定(acceptance-judge)の**代替にしない**(作業役と判定役の分離は不変)。
9. **(v1.2 追記)実行時のフロント動的変更は不採用** — LLM 生成コードの実行は統治が効かず
   front-check の前提も崩れるため。代替 = パラメータのみ操作する SPAR 拡張(spar-navigate)。
10. **(v1.2 追記)本番からの AI 実行は CI 経由** — Vercel サーバレスでは
   サンドボックスが成立せず実行時間・サイズの制約もあるため(調査 =
   docs/research/codex-on-vercel-feasibility.md)。
11. **(v1.2 追記)受け入れ条件のピンは実測してから書く** — 「形は固定できるが動くことは保証しない」
   ため、CI を伴う goal は**実 run を1回通すまで完了と見なさない**(review-loop の教訓 =
   16/16 PASS でマージしたが本番で3回失敗した)。
12. **複数ユーザー → 土台を当初から実装**(ログイン・users/roles/user_roles・capture_inbox の user_id 化)。ソースと整理済み知識は共有、生キャプチャは個人別。

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
  - **(v1.2 訂正)取込対象の正典は実装の allowlist**(lib/ingestion/run-sync.ts)。2026-08-09 時点:
    - cc-sier: `.task-log/*.md` / `.case-bank/index.json` / `.quality-gate-log/*.jsonl` /
      `masters/{departments,roles,workflows}.md` / `docs/decisions/` / `docs/daily-digest/` /
      `docs/secretary/learning-notes/` / `docs/research/` / `docs/retail-domain/` / `docs/diagrams/` /
      `docs/drawio/` / `docs/info-source-master.md` / `docs/secretary/*-wbs.md`(board 経路)
    - ai-war-room: `docs/decisions/` / `docs/logs/`
    - **取り込んでいない**(v1.1 が「取込対象」と書いていたが実装されていない):
      `.session-summaries/` / `.conversation-log/` / `board.md`(**二重ソースの状態競合を避けるため
      意図的に対象外** — today-view / org-docs-ingestion の決着)/ ai-war-room の `docs/templates/`。
  - 対象外(denylist・小文字正規化の部分一致): `profile` / `personality` / `minefield` /
    `.interaction-log` / `.active` / `agent-memory` / `claude.md` / `memory.md` / `agents.md`。
  - 組織側 `docs/decisions/` は **decision 型として合流**(検索の既定フィルタに乗る)。それ以外の
    docs は **knowledge 型**(org-docs-ingestion の2系統)。
- **禁止事項に違反していない**: 元 repo への書き込み記述なし(**例外2経路の記述は可** — v1.2)/
  秘密情報(接続文字列・トークン・APIキー)の直書きなし / `profile.md`・`minefield.md` の取込・転記なし。
- **(v1.2 追記)実装との対応が取れている** — **母集団は実装側の成果物**にする。
  本書への grep は「本文が言及している限り必ず PASS」して**乖離を検出できない**ため使わない(R1 の指摘):
  - **実在する CI workflow がすべて本書に記述されている**(逆写しの網羅性):
    `for f in .github/workflows/*.yml; do n=$(basename "$f" .yml); grep -q "$n" docs/design/requirements.md ||
       echo "MISSING in requirements: $n"; done`
  - **実在するテーブルがすべてデータモデルに現れている**:
    `grep -h "CREATE TABLE IF NOT EXISTS" db/migrations/*.up.sql | sed 's/.*EXISTS //;s/ (.*//' |
       while read t; do grep -q "$t" docs/design/requirements.md || echo "MISSING table: $t"; done`
  - **実在する CI ロールがすべて記述されている**:
    `grep "^CREATE ROLE" docs/setup/organize-role.sql | awk '{print $3}' |
       while read r; do grep -q "$r" docs/design/requirements.md || echo "MISSING role: $r"; done`
  - **`timeline_records.type` の語彙が DDL と一致**(語彙の追加漏れを検出):
    `grep -o "type IN ([^)]*)" db/migrations/0004_org_docs.up.sql | grep -o "'[a-z_]*'" | tr -d "'" |
       while read v; do grep -q "$v" docs/design/requirements.md || echo "MISSING type: $v"; done`
  - **設計書が存在する機能は §9 の実績表に載っている**(逆写しの取りこぼし検出):
    `for f in docs/design/basic/*.md; do n=$(basename "$f" .md); grep -q "$n" docs/design/requirements.md ||
       echo "NOT in requirements: $n"; done`(**未実装の設計は「将来拡張」または「実装待ち」として
    記載されていればよい** — 判定は「言及の有無」)

  **⚠ これらが保証するのは「網羅」だけで「記述の正しさ」ではない。**
  母集団を本書の外に置いたことで「**実装に増えたものが本書に無い**」は検出できるようになったが、
  次のクラスは**原理的に検出できない**(R1 の事実誤りはすべてこのクラスだった):
  - **記述の中身の誤り** — 名前さえ出ていれば通る(例: 書き戻し先の repo 数・GRANT の範囲・
    Cron の頻度)。**この層の防御は design-review(3レンズの現物照合)だけ**である。
  - **列レベルの追加** — `ALTER TABLE ADD COLUMN` はテーブル名の判定に掛からない
    (0006 `status` / 0007 `deleted_at` / 0011 の card_* 参照列)。
  - **type 語彙の母集団がファイル固定** — 0004 を直接見ているため、CHECK を張り替える
    migration が来ても 0004 を読み続けて緑のままになる。
  - **逆向き**(本書にあるが実装に無い)と、部分一致による取りこぼし(`roles` が `user_roles` に一致)。

  → **「§11 が全緑 = 実装と一致」と読まない。** 全緑は「実装側の成果物が本書のどこかに
  言及されている」までしか意味しない。

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
