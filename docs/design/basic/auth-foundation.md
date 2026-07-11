# 基本設計: auth-foundation(M0 認証・ユーザー管理土台)

> 対象: 要件定義 v1.1 §4.6 / §5.2 / §9 M0。
> ステータス: **PASS**(design-review Round 2 全レンズ PASS — reviews/auth-foundation.md 参照。detailed-design への申し送り7件あり)
> 作成: 2026-07-11(主セッション執筆)/ 改訂: 2026-07-11(reviews/auth-foundation.md Round 1 反映)

---

## 1. 目的 / スコープ

### 目的
全機能の前提となる認証・ユーザー管理の土台を作る。ログインでユーザーを分離し、
権限テーブルを先行整備して、以降のマイルストーン(M1〜M5)が `user_id` と
ロールを前提に実装できる状態にする。

### やる(M0)
1. **Neon Auth の有効化と Next.js への統合**(ID/パスワード = email/password)。
   - サインイン / サインアウト / セッション取得。
   - `/login` 画面。未認証アクセスは `/login` へリダイレクト(全画面保護)。
2. **最初のマイグレーション `db/migrations/0001_auth_foundation`**:
   - `CREATE EXTENSION IF NOT EXISTS vector`(pgvector 有効化。以降の全マイグレーションが vector 前提にできるよう M0 に同梱)。
   - `roles` / `user_roles`(認可の土台。ロール初期値 = `admin` / `member`)。
   - `permissions` / `role_permissions`(将来の本格 RBAC 用に**空で先行作成**)。
   - `capture_inbox`(**user_id 所有**。kind 語彙は capture 契約に従う)。
   - **seed(`admin` / `member` の2ロール)は 0001 の up 内に含める**(`ON CONFLICT DO NOTHING` で再適用冪等)。
3. `.env.example` に Neon Auth 用の環境変数プレースホルダを追記。
4. **秘密実値スキャンスクリプト `scripts/check-no-secrets.sh` の追加**(受け入れ条件7の判定器。契約は §5-7)。
5. **テストランナーの導入**とテスト(モックのみ・実ネットワークなし): 未認証リダイレクト / セッションヘルパの契約。ランナーの選定(vitest 等)は detailed-design で確定。
6. **`.claude/rules/capture.md` を要件 v1.1 に追随更新**(capture_inbox の user_id 所有を契約カラムに明記。M5 の「processed_at IS NULL 消費」契約が user_id スコープ前提であることを補記)。

### やらない(M0 では対象外)
- 管理 UI(ユーザー一覧・ロール割当)。要件 §4.6 の MVP 項目だが §9 の M0 定義に含まれないため後送(ロール割当は当面 SQL で代替。時期は未解決の問い #1)。
- capture の入力 UI(M4)・壁打ち(M4)・`timeline_records` 等の共有テーブル(M1)。
- RLS(将来。当面は**アプリ層で user_id スコープを強制**)。
- ソーシャルログイン / パスワードポリシーの独自実装(Neon Auth に委譲)。
- SSoT(cc-sier-organization / ai-war-room)への一切のアクセス。

---

## 2. アーキテクチャ上の位置づけ

3層構成のうち **App 層(第3層)+ Index/DB 層(第2層)のスキーマ土台**。
**Ingestion 層と SSoT には触れない**(読みも書きもしない)。

```
ブラウザ ── /login(Neon Auth SDK)──▶ Neon Auth(users / sessions を Neon 内に保持)
   │                                        │ user_id(text)
   ▼                                        ▼
Next.js App Router ── requireUser() ──▶ Neon Postgres
  (middleware で全画面保護)           roles / user_roles / permissions /
                                        role_permissions / capture_inbox(user_id)
                                        + pgvector 拡張(有効化のみ)
```

- ユーザー/セッションの実体は Neon Auth が **Neon 環境の**専用スキーマに保持し、
  DB ブランチと一緒に分岐する(要件 §5.2)。アプリは `user_id`(text)を参照するのみ。
- **ローカル開発の分界**: DB はローカル pgvector コンテナ、認証は Neon Auth(クラウド)
  という分離になる。**ローカル db に Neon Auth のスキーマは存在しない**(「ブランチと
  分岐」は Neon 環境のみの性質)。FK なし方針(§3.1)により、ローカル db 単独でも
  マイグレーション検証(受け入れ条件2)が成立する。ローカル dev の `user_id` は
  Neon Auth(dev 用キー)が返す実ユーザー ID。
- マイグレーション経路: ローカル db コンテナで検証 → Neon ブランチで検証
  (`create_branch` → 適用)→ 本番反映は人間承認。**down の適用も同経路**
  (ローカル/ブランチ上は psql 等で自由に検証可。本番への down は人間承認必須)。
- 制約: Neon Auth はクラウドサービスのため、**ローカル dev でも認証フローは外部に出る**
  (dev 用キーで許容)。**テストは実ネットワーク禁止**のため認証はモックで代替する。

---

## 3. データ / インターフェース概要

### 3.1 テーブル(概要。DDL 確定は detailed-design)

| テーブル | 主なカラム | 備考 |
|---|---|---|
| (Neon Auth 管理) | `id`(text) ほか | Neon Auth が作成・管理。**アプリからは参照のみ** |
| `roles` | `id` PK / `name` unique / `description` | seed: `admin`, `member`(0001 up 内・冪等) |
| `user_roles` | `user_id` text / `role_id` → roles / PK(`user_id`,`role_id`) | m:n |
| `permissions` | `id` PK / `key` unique | 空で先行作成(将来 RBAC) |
| `role_permissions` | `role_id` / `permission_id` / 複合 PK | 空で先行作成 |
| `capture_inbox` | `id` PK / **`user_id` text NOT NULL** / `kind` CHECK / `topic` / `tags text[]` / `body` NOT NULL / `source` / `created_at` / `processed_at` NULL / `curated_ref` | kind ∈ status / issue / next_move / spar_conclusion(capture 契約) |

- **方針: Neon Auth のユーザーテーブルへ FK は張らない**(同期タイミング・削除の揺れに
  引きずられないため)。参照整合はアプリ層で強制し、将来 RLS を併用。
  - 残余リスク: Neon Auth 側でユーザーが削除された場合、`user_roles` / `capture_inbox`
    に orphan 行が残り得る。**M0 では許容**(主利用者1名・削除運用なし)。定期検出の
    要否は RLS 導入検討(未解決の問い #4)に合流させる。
- `processed_at IS NULL` 走査(M5)の partial index 等のインデックス方針は
  **detailed-design の DDL で確定**(未解決の問い #6)。
- down マイグレーションには対応する `DROP TABLE` / `DROP EXTENSION` を含む。
  db ルールの「生 DROP 禁止」は ad-hoc 実行の禁止であり、**本設計で明示し
  design-review と人間承認を経たマイグレーション定義としての DROP は許容**とする
  (適用経路は §2 のとおり。ローカル/Neon ブランチ上の検証は自由、本番 down は人間承認)。

### 3.2 アプリ側インターフェース

| IF | 契約 |
|---|---|
| `getUser()` | セッションからユーザー(`{ id, email }` 相当)を返す。未認証は `null` |
| `requireUser()` | 未認証なら `/login` へ redirect。認証済みならユーザーを返す |
| `middleware` | 全ルートを保護。例外 = `/login`・静的アセット・**Neon Auth SDK が要求する認証ハンドラ/コールバックルート**(実パスは SDK 確定後に detailed-design で列挙) |
| **二層防御(契約)** | **middleware は第1層にすぎない。API Route / Server Action / データアクセス層は middleware に依存せず、必ず `requireUser()` / `getUser()` を呼んでから user_id スコープのクエリを発行する**。M1 以降のすべての実装がこの契約に従う |
| `/login` ページ | Neon Auth SDK のサインイン UI。成功後 `/` へ |
| サインアウト | ヘッダ等から実行し `/login` へ |

- user_id スコープの強制手段: 個人データ(capture_inbox 等)への読み書きは、
  user_id を引数に取る**単一のデータアクセスヘルパ経由に限定**する(直接 SQL の散在を
  禁止)。ヘルパの具体 IF は detailed-design で確定。

### 3.3 環境変数

- Neon Auth 有効化時に**コンソール画面へ表示される名称をそのまま**採用し、
  `.env.example` にプレースホルダで追記する(実値は `.env` と Vercel のみ。直書き禁止)。
  想定: プロジェクト ID / publishable key / secret key の3種。
- **正確な env 変数名・キー形式の確定は detailed-design の必須項目**とし、確定と同時に
  `scripts/check-no-secrets.sh` の検知パターンへ secret key 形式を追加する
  (この追加を detailed-design の受け入れ条件に含める)。
- 既存 `DATABASE_URL` は変更なし。

---

## 4. リスク・トレードオフ

| 論点 | 判断 | トレードオフ |
|---|---|---|
| Neon Auth(外部 SaaS)依存 | 採用(要件 §10-5 で決定) | 代替は Auth.js + Neon アダプタ。ユーザーデータは Neon 内に同期されるため移行余地あり。ローカル dev でも認証だけ外部依存 |
| pgvector を 0001 に同梱 | 同梱 | M0 に検索系の拡張が混ざるが、単発の有効化マイグレーションを分けるより履歴が単純。失敗時の切り分けも `IF NOT EXISTS` で問題なし |
| Neon Auth ユーザーへの FK なし | FK なし | DB 単独では参照整合を担保できない。アプリ層強制 + 将来 RLS で補う(小規模・単一アプリ経路のため許容)。orphan 行は許容し検出要否は問い #4 に合流 |
| 管理 UI を M0 から除外 | 除外 | 当面ロール割当は SQL 手作業。主利用者1名の現状では影響軽微 |
| テストで認証をモック | モック | 実際の Neon Auth との結合・middleware matcher の設定ミスはテストで検知できない。**dev/staging での手動確認項目を固定**: (a) 未認証で `/` にアクセスし `/login` へリダイレクトされる (b) ログイン成功で `/` に到達できる (c) サインアウト後に再び保護される。デプロイのたびに実施 |
| ローカル dev の非機密資格情報 | `postgres://cockpit:cockpit@db:5432/cockpit` は**設計上「非機密」と定義** | docker-compose.yml / ドキュメントに現れるが、ローカル専用・外部到達不能のため秘密スキャン対象から除外する |

---

## 5. 受け入れ条件(機械判定)

後続 `/goal` の合否判定に直結する。すべて実ネットワークなしで判定可能なこと。
**各条件は exit code で判定できる形とする。**

1. **マイグレーションが存在し必須要素を含む**(exit code 一本):
   ```bash
   set -e
   f=$(ls db/migrations/0001_*.up.sql)
   grep -q "CREATE EXTENSION IF NOT EXISTS vector" "$f"
   for t in roles user_roles permissions role_permissions capture_inbox; do
     grep -Eq "CREATE TABLE[^;]*\b$t\b" "$f"
   done
   ls db/migrations/0001_*.down.sql >/dev/null
   ```
   → exit 0。
2. **ローカル db コンテナで up → down → up が exit 0**(可逆性):
   `docker compose up -d db` 後、psql で順に適用しすべて exit 0。
3. **seed 済みロールが2件**(条件2の最終 up 適用後に判定。seed は up 内のため成立):
   `SELECT count(*) FROM roles WHERE name IN ('admin','member');` = 2。
4. **capture_inbox の kind 語彙が契約どおり**: NOT NULL 列を供給した上で kind のみ不正な
   `INSERT INTO capture_inbox (user_id, kind, body) VALUES ('test-user', 'bogus', 'x');`
   が**非ゼロ exit で失敗**する(CHECK 違反に失敗を隔離)。
5. **ログイン画面と保護が実装されている**: `app/login/page.tsx` が存在し、
   `npm run build` が exit 0。
6. **テストが緑**: `npm test` が exit 0(ランナーは detailed-design で選定・導入)。テストには最低限
   (a) 未認証アクセスが `/login` へリダイレクトされる(モック)
   (b) `requireUser()` が未認証で redirect / 認証済みでユーザーを返す、を含む。
7. **秘密実値ゼロ**: `bash scripts/check-no-secrets.sh` が exit 0。スクリプトの契約:
   - 検知パターン = 秘密の**実値形式**のみ: `npg_[A-Za-z0-9]+` / `ghp_[A-Za-z0-9]+` /
     `github_pat_[A-Za-z0-9_]+` / `sk-ant-[A-Za-z0-9-]+`(Neon Auth の secret key 形式は
     env 名確定時に追加 — §3.3)。
   - 走査除外 = `.env` / `.env.*` / `node_modules/` / `.git/` / **スクリプト自身**。
   - 汎用の `postgres://` URL はパターンに**含めない**(ローカル dev URL は非機密 — §4)。
   - 判定 = ヒット 0 件で exit 0、1件以上で exit 1。
8. **禁止事項に違反していない**(exit code 判定):
   ```bash
   # アプリコードが SSoT repo に言及しない(M0 は SSoT 非接触)
   ! grep -RIn --exclude-dir=node_modules -E "cc-sier-organization|ai-war-room" app/ lib/ scripts/ 2>/dev/null
   # 破壊的 SQL は db/migrations/ の外に存在しない
   ! grep -RIn --exclude-dir=node_modules -E "DROP TABLE|TRUNCATE|DELETE FROM" app/ lib/ scripts/ 2>/dev/null
   ```
   → 両方 exit 0(対象ディレクトリが未作成の場合はスキップ可)。

---

## 6. 未解決の問い

1. **管理 UI(ユーザー一覧・ロール割当)の配置先** — M4(キャプチャ)と同時か、独立の M0.5 か。M0 では SQL 代替。
2. **admin ロールのブートストラップ方法** — 初回ユーザーへ手動 SQL で付与(現案)か、`ADMIN_EMAIL` env による初回ログイン時自動付与か。
3. **Neon Auth の正確な env 変数名 / SDK パッケージ名 / 認証ハンドラルートの実パス** — コンソール画面と最新ドキュメントで確認し detailed-design で固定。**確定と同時に check-no-secrets.sh のパターンと middleware 例外リストを更新する(detailed-design の受け入れ条件に含める)**。
4. **RLS の導入時期と orphan 行検出の要否** — 複数ユーザーが実際に増えるタイミング(M6 の完全分離検討時)が候補。
5. **「ID/パスワード」の ID = email でよいか** — Neon Auth の標準は email/password。ユーザー名方式が必須なら追加検討。
6. **capture_inbox のインデックス方針** — `processed_at IS NULL` 走査(M5)向け partial index 等。detailed-design の DDL で確定。

---

## 次の手順

`/design-review auth-foundation` で arch / data / sec の3レンズレビュー(全 PASS で実装へ)。
実装は `/detailed-design auth-foundation`(DDL・関数 IF・テスト観点の確定)を経て `/goal`。
