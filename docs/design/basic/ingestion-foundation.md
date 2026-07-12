# 基本設計: ingestion-foundation(M1 取り込み基盤 + 振り返り)

> 対象: 要件定義 v1.1 §4.3 / §4.7 / §5 / §6 / §9 M1。
> 根拠資料: docs/research/m1-ssot-schema.md(2026-07-12 実スキーマ調査)
> ステータス: **PASS**(design-review: arch/sec = Round 2 PASS、data = Round 3 PASS — reviews/ingestion-foundation.md 参照。detailed-design への申し送りあり)
> 作成: 2026-07-12(主セッション執筆)/ 改訂: 2026-07-12

---

## 1. 目的 / スコープ

### 目的
SSoT 2リポジトリの Markdown/JSON を GitHub API(読み取り専用)で取得し、正規化して Neon に
冪等 upsert する**取り込み基盤**を作る。その最初の消費者として**振り返りビュー(実スコア)**を実装し、
「データが実際に流れて画面に出る」ことを M1 の完成条件とする。

### やる(M1)
1. **同期基盤**: `/api/sync`(Route Handler)+ 増分検知(sync_state の last_commit と GitHub compare API)+ 冪等 upsert。認可・メソッドは §3.3(Cron は GET + Bearer / 手動は POST + admin)。`vercel.json` に毎時 Cron 定義を追加(デプロイは別途)。
2. **M0 認証境界との統合**: `proxy.ts` の matcher に `api/sync(?:/|$)` の除外を追加し(`/api/auth` と同型 — 第1層は Route 内の認可検証)、`tests/proxy.test.ts` に素通し `/api/sync`・保護 `/api/syncx` の境界ケースを追加する。**M0 成果物への変更であることを明示**し、`docs/design/detail/auth-foundation.md` §2.1 の matcher 行に「M1 で拡張」の注記を追加する(担い手 = 主セッション。M0 の capture.md 追随と同じ意図的例外)。
3. **マイグレーション 0002**: `timeline_records` / `metric_aggregates`(空で先行)/ `sync_state` / `tag_synonyms`。メタフィルタ用の通常インデックス(occurred_at / type / org / tags)を含む(db.md 準拠。DDL は detailed-design)。
4. **パーサ5本**(正規化規則は §3.2 の規範表に従う):
   task-log / case-bank index.json / quality-gate JSONL / decisions / logs。
5. **タグ初期語彙**: cc-sier `masters/`(departments / roles / workflows)から slug 化して `tag_synonyms` に投入。タグ付与は**決定的な語彙包含マッチ**(タイトル+本文。LLM 不使用)+ case-bank は `state.request_keywords[]` も入力に使う。
6. **振り返りビュー**(`/review`): 週次(直近8週)/ 月次(直近6ヶ月)の実スコア集計と、同期間の decisions / logs 一覧(出典 = raw_ref から GitHub リンク)。**集計・一覧とも `status='ok'` のレコードのみを対象とする**(error はサマリ件数のみ将来表示)。集計契約は §3.4。クエリ時集計(チャートライブラリ導入なし)。
7. **ルール/要件の追随更新**(担い手 = 主セッション。M0 前例の意図的例外): `.claude/rules/ingestion.md`(冪等キーの複数レコードファイル拡張 — §3.1)/ `docs/design/requirements.md` **§5.1**(`.companies/<org>/` 実構造の反映)**と §5.2**(timeline_records スコア列への `signals` 追記 — §3.1)。

### やらない(M1 では対象外)
- **embedding 列・ベクトル検索**(M2。0002 に vector 列は作らない — モデル/次元未確定のため)。
- session-summaries / **conversation-log** / knowledge / board.md / WBS / masters 本文の取り込み。
  conversation-log の見送り理由 = **マスク保証が現状サンプリング確認のみ**のため(調査資料)。
  M2 で取り込む際は**マスク検証方針(frontmatter `masked: true` の検証 + 機微パターン走査)を先に設計する**こと(問い #2)。
- ai-war-room の `docs/sample/`(自己申告のデモデータ。fixtures 転用は別途)/ `docs/manual/` / `docs/templates/`。
- `metric_aggregates` への実体化(テーブルのみ先行作成。M1 の集計はクエリ時)。
- LLM によるタグ付け・要約(M5 の整理 Action の領分)。
- Vercel への実デプロイ・Cron の実運用(定義ファイルのみ用意)。
- SSoT への書き込み一切(読み取り = GET のみ)。

---

## 2. アーキテクチャ上の位置づけ

3層の **Ingestion 層(第1層)を新設**し、Index/DB 層(第2層)に共有テーブル群を追加、
App 層(第3層)は `/review` が索引済みデータを読む。

```
GitHub(SSoT・読み取りのみ)
  │ GET /repos/{repo}/commits, /compare, /contents, raw
  ▼
SourceAdapter(§3.3 — GitHub 実装 / Fixture 実装の差し替え可能な単一経路)
  ▼
/api/sync(GET=Cron Bearer / POST=admin)
  ├─ sync_state.last_commit と HEAD を compare → 変更ファイル列挙
  ├─ allowlist(§2.1 の6パターン)でフィルタ → denylist(機微)で二重防御
  ├─ パーサ(§3.2 規範表)→ 正規化レコード(パース失敗も status=error でレコード化・サニタイズ適用)
  └─ 冪等 upsert(source, file_path, item_key)→ timeline_records / sync_state 更新
  ▼
Neon(共有データ・user_id なし)
  ▼
/review(requireUser + status='ok' のみクエリ時集計)
```

### 2.1 取得 allowlist(確定・repo スコープ付き)

| repo | パターン |
|---|---|
| cc-sier-organization | `.companies/*/.task-log/*.md` |
| cc-sier-organization | `.companies/*/.case-bank/index.json` |
| cc-sier-organization | `.companies/*/.quality-gate-log/*.jsonl` |
| cc-sier-organization | `.companies/*/masters/departments.md` / `roles.md` / `workflows.md`(語彙のみ・索引化しない) |
| ai-war-room | `docs/decisions/*.md` |
| ai-war-room | `docs/logs/*.md` |

- allowlist は **repo 単位で定義**するため、cc-sier 側にも存在する `docs/decisions/` との名前衝突は構造的に起きない(cc-sier の `docs/` はパターン外)。
- **denylist(防御第2層)**: パスに `profile` / `personality` / `minefield` / `.interaction-log` / `.active` / `agent-memory` を含むものは、allowlist 通過後でも**パーサ入口で拒否**(6パターンすべてをテストで担保 — §5-3d)。
- GitHub への呼び出しは **SourceAdapter 1経路に閉じ込め、GET のみ**(受け入れ条件8の判定アンカー — §5-8)。
- 重い処理はしない(M1 の同期はテキスト正規化のみ。初回 ~180ファイル + case 142件)。

---

## 3. データ / インターフェース概要

### 3.1 テーブル(概要。DDL 確定は detailed-design)

| テーブル | 主なカラム | 備考 |
|---|---|---|
| `timeline_records` | `id` PK / `source` / `file_path` / **`item_key`** / `commit`(最終処理コミット)/ `type` / `occurred_at` / `org` / `topic` / `tags text[]` / `title` / `body` / `raw_ref` / `status`('ok' \| 'error') / スコア列(`reward_score`, **`signals jsonb`**(4シグナル bool×4。task-log のみ・他ソースは NULL), `completeness`, `accuracy`, `clarity`, `quality_gate_result`)/ `synced_at` | **UNIQUE (source, file_path, item_key)** = 冪等 upsert キー。user_id なし(共有)。メタフィルタ index(occurred_at / type / org / tags)を DDL に含む。embedding 列は作らない(M2)。**signals 列は要件 §5.2 のスコア列列挙に無いため、§1-7 の要件追随更新に §5.2 への signals 追記を含める** |
| `sync_state` | `repo` PK / `last_commit` / `last_synced_at` / `last_summary`(jsonb: ok/error 件数) | 増分同期のカーソル |
| `tag_synonyms` | `synonym` PK / `canonical` | masters 由来の初期語彙 + slug 正規化 |
| `metric_aggregates` | `period` / `metric` / `org` / `value` / 複合 PK | **空で先行作成**(M1 は投入しない) |

**item_key の生成規則(確定)**:
- 単一レコードファイル(task-log / decisions / logs)= `''`(空文字。NULL は使わない — UNIQUE を効かせるため)。
- case-bank = case の `id`。`raw_ref` は `file_path#<case id>`。
- quality-gate JSONL = **`sha256(生行バイト列)` + `#` + 同一ファイル内の同一ハッシュ出現順序(0起点)**。
  同一内容行が同日ファイルに複数あっても**別イベントとして数える**(合格率を歪めない)。
  行の順序入替・追記に対して安定(同一内容の n 番目という同一性)。ハッシュは**サニタイズ前**の生行で計算(処理系の変更でキーが揺れない)。
- SSoT 側で消えた行/case のレコードは**残置を許容**(破壊的 DELETE 禁止。`commit` 列で鮮度判別)。

**サニタイズ(ok / error 両パスに適用 — 不変条件)**:
- 「個人環境情報(ローカル絶対パス)を索引に持ち込まない」を**パーサ出力全体の不変条件**とする。
  quality-gate の `target` に加え、`errors[]` / `warnings[]` / `checklists[]` 内の文字列に含まれる
  絶対パス(`/home/...` 等)も同一規則でリポジトリ相対 or ファイル名のみに切り詰める。
- **status='error' のレコードの body にも同じサニタイズを適用してから格納する**(元テキスト保持はサニタイズ後)。
- 機微 denylist はパス単位で先行(§2.1)、フィールドサニタイズは内容単位で ok/error 両方に適用、の二段。

**スコアの正規化(確定)**:
- reward(0-1)はそのまま。task-log の judge(1-5)は **`(x-1)/4`** で 0-1 に写像(下限も 0 に揃える)。case-bank の judge(0-1)はそのまま。
- 元値には raw_ref から遡及可能。

### 3.2 正規化マッピング(規範表 — パーサ契約の中核)

| ソース | `type`(要件 §5.2 語彙) | `occurred_at` | `title` | `topic` | スコア |
|---|---|---|---|---|---|
| task-log | `task` | frontmatter `started`(欠損時はファイル名日時) | `request` 先頭120字 | ファイル名 slug | `reward_score` ← `## reward > score` / **`signals` ← `## reward > signals`(completed / artifacts_exist / excessive_edits / retry_detected の bool×4)** / judge 3軸 ← `## judge`(optional・(x-1)/4) |
| case-bank | `score` | `outcome.started`(欠損時は `id` の日時部。**id が task_id 同形式 `YYYYMMDD-HHMMSS-<slug>` であることは fixture 作成時に実データで確認する仮説** — 確認できなければこのフォールバックは使わない。両方欠損は status='error') | `state.request_head` | case `id` | `reward_score` ← `reward` / judge 3軸 ← `judge.{completeness,accuracy,clarity}`(null 許容) |
| quality-gate | `quality` | ファイル名日付 | `QG <status>: <target(サニタイズ後)>` | target のファイル名 | `quality_gate_result` ← `status` |
| decisions | `decision` | ファイル名日付 | H1 の `{タイトル}` 部 | ファイル名 slug | なし(NULL) |
| logs | `daily_log` | ファイル名日付 | H1 全体 | `daily` | なし(NULL) |

- 共通: `org` = **パス `.companies/<org>/` の `<org>` セグメントを正とする**(cc-sier の全ソース共通。frontmatter `org` / `state.org_slug` は存在すれば突合検証に使い、不一致は status='error')。ai-war-room = NULL。`tags` = 語彙包含マッチ(+ case-bank は `request_keywords[]` を追加入力)。`body` = 本文(quality-gate は行 JSON のサニタイズ済み表現・checklists 含む)。`raw_ref` = `<file_path>`(複数レコードファイルは `#<item識別>` を付す)。
- type 語彙は要件 §5.2 の既存7値に収まる(要件側の語彙変更なし)。
- ai-war-room は frontmatter が無いため**日付=ファイル名 / タイトル=H1** を正とし、規則外の命名は status=error。
- パーサは**純関数**(ネットワーク・DB 依存なし)。入力 = 生テキスト + メタ(source, file_path, commit)、出力 = レコード配列(0..N)。失敗は throw せず status='error'(§3.1 のサニタイズ適用済み)。fixtures は匿名サンプルのみ。

### 3.3 アプリ側インターフェース

| IF | 契約 |
|---|---|
| `GET /api/sync` | **Vercel Cron 用**(Cron は GET で起動する仕様)。認可 = `Authorization: Bearer ${CRON_SECRET}` **単独**(Cookie セッションへのフォールバックはしない — GET の CSRF を構造的に排除)。不一致/欠落 → 401 |
| `POST /api/sync` | **手動トリガ用**。認可 = admin ロールのセッション(**Route Handler 用の認可形**: `getUser()` + user_roles 照会で判定し、未認証は **401**・非 admin は **403** を返す — `requireUser()` の redirect は使わない)。二層防御(M0 契約)に従い Route 内で検証 |
| レスポンス | 取込サマリ(repo ごとの ok/error 件数・last_commit) |
| `SourceAdapter` | **GitHub への唯一の経路**(`lib/ingestion/github-source.ts`・GET のみ)。同一 IF の **FixtureSource**(`fixtures/` から読む)を持ち、テスト・冪等性の受け入れ判定はこちらで実ネットワークなしに実行する。**ローカル実行ランナー(scripts/ 等)を作る場合も SourceAdapter 経由を必須とする**(直接 GitHub を叩かない) |
| `lib/ingestion/*` | **サーバ専用**(`import 'server-only'` を規約とする)。パーサ5本 / upsert(単一のデータアクセス経由) |
| `lib/data/review.ts` | 集計クエリ(共有データのため userId 引数なし。認可は呼び出し側の requireUser。**WHERE status='ok'** を全クエリの既定とする) |
| `GET /review` | `requireUser()` 必須。§3.4 の集計 + 同期間 decisions/logs 一覧(GitHub 出典リンク) |
| `proxy.ts`(M0 成果物の拡張) | matcher 除外に `api/sync(?:/|$)` を追加(境界付き)。`/api/syncx` 等は保護対象のまま(tests/proxy.test.ts に境界ケース追加) |
| `vercel.json` | `{"crons":[{"path":"/api/sync","schedule":"0 * * * *"}]}`(GET 起動・定義のみ) |

### 3.4 振り返りの集計契約

- 対象 = `status='ok'` のみ。期間バケット = 週(月曜起点・直近8週)/ 月(直近6ヶ月)。
- 指標と分母(**null は分母から除外**):
  - 件数: type 別レコード数(全 type)
  - reward 平均: `reward_score` 非 null の平均(type ∈ task, score)
  - 4シグナル達成率: `signals` 列(jsonb)の各 bool の true 率(**`signals` 非 null のレコードが分母**)
  - judge 3軸平均: 正規化済み値の**source 横断プール平均**(非 null のみ。source 別内訳は列があるため将来分離可能 — M1 は単一トレンドを表示)
  - 品質ゲート合格率: `quality_gate_result='pass'` の率(type=quality が分母)
- 並置リスト: 同期間の type ∈ (decision, daily_log) を occurred_at 降順。

### 3.5 環境変数

- **`CRON_SECRET`** を追加(`.env.example` にプレースホルダ)。形式のないランダム文字列のため
  check-no-secrets.sh のパターン追加は不可(形式なし秘密クラスとして M0 §2.3 の整理どおり記録)。
  比較は定数時間比較を detailed-design で言及。サーバ専用(クライアント非露出)。
  Neon Auth の Cookie の SameSite 属性(SDK 既定 = strict)も detailed-design で確認・記録する(POST の CSRF 前提)。
- 既存 `GITHUB_TOKEN`(読み取り用 PAT・設定済み)を SourceAdapter で使用(サーバ専用)。

---

## 4. リスク・トレードオフ

| 論点 | 判断 | トレードオフ |
|---|---|---|
| 冪等キーを (source, file_path, item_key) に拡張 | 拡張する(ルール追随更新をスコープに含む) | 実データ(case-bank 142件/1ファイル、JSONL)に旧キーでは対応不能。調査で確定した事実に基づく |
| JSONL の item_key = 行ハッシュ + 出現順序 | 採用(同一内容行を別イベントとして数える) | 行削除時に末尾の同一内容行が stale 化し得るが、合格率の過少計上(黙った合体)より安全側。掃除は問い #1 に合流 |
| /api/sync を proxy matcher から除外 | 除外し Route 内認可を第1層とする(/api/auth と同型) | 公開到達可能ルートが1つ増える。Bearer/admin の Route 内検証 + 境界付き matcher + proxy テストで担保。M0 成果物変更は本設計で明示・追随 |
| Cron = GET / 手動 = POST | メソッドで系統を分離 | Vercel Cron の GET 起動仕様と整合。GET に副作用を持たせる点は Cron エンドポイントの慣行として許容(Bearer 必須で外部からの誤爆を遮断) |
| ai-war-room に frontmatter なし | ファイル名日付 + H1 タイトルを正とする | 規則外は error レコード化。SSoT への frontmatter 追加は書き込み禁止のため採らない |
| タグ付与 = 決定的な語彙包含マッチ | 採用(LLM 不使用) | 精度は語彙依存で低め。再現性・機械判定を優先。補強は M2/M5 |
| 集計はクエリ時 / metric_aggregates は空で先行 | クエリ時集計 | データ小規模では十分。増えたら実体化に切替 |
| 初回フル同期の実行時間(Vercel serverless 制限) | リスクとして明記。初回はローカルから実行する運用でも回避可能 | 分割実行の要否は detailed-design で試算(問い #3) |
| stale レコード残置 | 許容 | 破壊的 DELETE 禁止と整合。`commit` 列で判別可能 |
| 機微ファイルの防御 | allowlist 取得 + denylist 二重化 + フィールドサニタイズ(ok/error 両パス) | 調査で除外リスト外の機微候補・ローカル絶対パス混入を確認済み。テストで担保(§5-3) |

---

## 5. 受け入れ条件(機械判定)

後続 `/goal` の合否判定に直結。すべて exit code で判定できる形とする(詳細コマンドは detailed-design で確定し、**現リポジトリ/実 DDL に対して成立することを確認してから確定する** — M0 の教訓)。

1. **マイグレーション 0002 必須要素**(exit 0): `db/migrations/0002_*.up.sql` に4テーブルの CREATE TABLE、(source, file_path, item_key) の一意制約(表記は detailed-design の実 DDL に合わせ grep を確定)、`status` 列、メタフィルタ index が含まれ、down が存在する。
2. **可逆性**: ローカル db で 0001 適用済み状態から 0002 の up → down → up がすべて exit 0。
3. **パーサ契約テスト**: `npm test` が exit 0。最低限含む:
   (a) 5ソースの fixture → 期待レコード数・`type`・`occurred_at`・スコア値の一致(§3.2 規範表どおり)
   (b) judge (x-1)/4 正規化 / signals(bool×4)の抽出 / quality-gate `target`・`errors[]`・`warnings[]`・`checklists[]` 内絶対パスのサニタイズ(各1ケース)
   (c) 不正入力(命名規則外・壊れた frontmatter)→ `status='error'` レコード化(throw しない)
   (d) 機微 denylist **6パターン全列挙**でパーサ入口拒否
   (e) 複数レコードファイルの item_key: 同一入力 → 同一キー(決定性)+ **同一内容行×2 → 異なるキー(出現順序 suffix)**
   (f) **error レコードの body にもサニタイズが適用されている**(絶対パスを含む不正行 → body に絶対パスが残らない)。
   実ネットワークなし(FixtureSource + fixtures のみ)。
4. **冪等性と更新反映(契約)**: FixtureSource で同一 fixture セットを2回取込 → `timeline_records` 件数不変。
   続けて**同一キーで内容を変えた fixture を取込 → 件数不変かつ該当行の body/commit が更新されている**
   (ローカル db + psql で exit code 判定)。
5. **/api/sync 認可ゲート**: ローカル起動で
   (a) GET 認証なし → 401 (b) GET 不正 Bearer → 401 (c) GET 正しい Bearer(+FixtureSource or dry-run)→ 2xx
   (d) **セッションなし POST → 401**(redirect でないこと) (e) 非 admin セッション POST → 403。
   proxy 素通しの前提が成立していること(条件6のテストで担保)。
6. **テスト緑(統合)**: `npm test` exit 0 には、更新された `tests/proxy.test.ts`
   (素通し: `/api/sync`、保護: `/api/syncx`)と、`/review` 集計関数のユニット
   (fixture 入力 → §3.4 の期待集計値。**status='error' 行が集計に入らないケースを含む**)を含む。
   `npm run build` exit 0。
7. **秘密実値ゼロ**: `bash scripts/check-no-secrets.sh` exit 0(`CRON_SECRET` は形式なしクラスとして記録)。
8. **SSoT 書き込み禁止ゲート(M0 条件8の M1 再定義 — 判定アンカー確定)**:
   **構造で保証し grep は逸脱検知**の型を採る:
   (a) GitHub API ホスト(`api.github.com` / `raw.githubusercontent.com`)への言及が
   `lib/ingestion/github-source.ts` **以外**の `lib/` `app/` `scripts/` `tests/` に存在しない(集計型 grep。M0 条件8と同じ4ディレクトリ走査)
   (b) `github-source.ts` 内に `method:` 指定が存在しない、または GET のみ(fetch の既定 = GET)。
   自 API の POST 受信(`export async function POST`)は判定対象外(GitHub への送信ではない)。
9. **ルール/要件/先行設計の追随**(exit 0): `grep -q "item_key" .claude/rules/ingestion.md` /
   `grep -q ".companies" docs/design/requirements.md` /
   `grep -q "signals" docs/design/requirements.md`(§5.2 スコア列への追記)/
   `grep -q "api/sync" proxy.ts`(M0 成果物拡張の実在)/
   `grep -q "api/sync" docs/design/detail/auth-foundation.md`(M0 詳細設計への注記追随)。

---

## 6. 未解決の問い

1. **stale レコードの掃除** — SSoT 側で消えた case/行/ファイルのレコード残置(JSONL の出現順序 suffix 分を含む)をいつ・どう掃除するか(soft-delete 列か、運用で無視か)。
2. **残りソースの取り込み時期と前提条件** — conversation-log は **M2 で取り込む前にマスク検証方針(`masked: true` の検証 + 機微パターン走査)を設計すること**。session-summaries は `log_file` が対象外 `.interaction-log` への参照を含む点に注意(取り込み時も参照を辿らない)。knowledge(継続更新型の occurred_at 設計)/ board.md / WBS(M3)。
3. **初回フル同期の実行環境** — Vercel serverless の時間制限内で完了するか。分割実行(repo 単位・ページング)の要否を detailed-design で試算。
4. **タグ付与の精度** — 決定的マッチの実効性。masters 語彙が org 間で揃うか(jutaku-dev-team は masters のみ保有・語彙未検証)。M5 の LLM 整理での補強余地。
5. **case-bank `outcome.files_written[]` のパス性質** — 絶対パスか相対か fixture 作成時に確認し、絶対ならサニタイズ対象に含める(detailed-design)。
6. **metric_aggregates の実体化時期** — データ量・クエリ性能の実測で判断。
7. **jutaku-dev-team のスキーマ** — ログ類ディレクトリが生えた時点で fixture 追加(現状 docs/masters のみ)。

---

## 次の手順

`/design-review ingestion-foundation` で再レビュー(Round 2)。全 PASS 後
`/detailed-design ingestion-foundation`(DDL / パーサ IF / 判定コマンド確定)→ `/goal`(分割は detailed-design で定義)。
