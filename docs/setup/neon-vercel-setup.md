# Neon / Vercel セットアップ手順書

> decision-cockpit を **Neon(Postgres + pgvector)** と **Vercel(ホスティング)** で動かすための初期セットアップ。
> 粒度は「どの画面で・何を操作し・何を控えるか」。サービスの UI は変わることがあるので、ボタン名が違う場合は近い項目を探すこと。
> **秘密情報(接続文字列・APIキー・トークン)は本書・README・リポジトリに実値を書かない。** 各サービスの設定画面と `.env`(gitignore 済み)にのみ置く。

---

## 0. 事前に準備するもの(チェックリスト)

| 準備物 | 用途 | 取得先 |
|--------|------|--------|
| GitHub アカウント | リポジトリ連携(済) | — |
| Neon アカウント | DB(Postgres + pgvector)・認証(Neon Auth) | https://neon.tech |
| Vercel アカウント | アプリのホスティング・Cron | https://vercel.com |
| 埋め込み API キー | ベクトル検索(多言語1モデルに固定) | 選定後に各社コンソール(research-spike で検証) |
| Claude サブスク OAuth トークン | 自動整理(Claude Action) | ローカルで `claude setup-token`(要 Claude Pro/Max) |
| GitHub PAT × 2 | SSoT 読み取り用 / ai-war-room PR 書き戻し用 | GitHub Settings → Developer settings |
| ローカルツール | 開発 | Node.js 18+ / npm / gh CLI |

> 環境変数の一覧は [`.env.example`](../../.env.example) を参照。値はここでは設定せず、後述の各画面で取得して `.env` と Vercel に入れる。

---

## 1. Neon のセットアップ

Neon コンソール: **https://console.neon.tech**

### 1.1 サインイン
1. コンソールにアクセスし **Sign up / Log in**。
2. **Continue with GitHub** でログイン推奨。

### 1.2 プロジェクト作成
1. ダッシュボードで **New Project**（または **Create project**）をクリック。
2. 入力する:
   - **Project name**: `decision-cockpit`
   - **Postgres version**: 最新の安定版でよい
   - **Region**: 近いリージョン（例: `Asia Pacific (Tokyo)`）
3. **Create project** を押す。作成後、自動で `main` という DB ブランチができる。

### 1.3 接続文字列(`DATABASE_URL`)を控える
1. プロジェクト画面の **Connect**（または **Connection Details**）を開く。
2. **Connection string** をコピー。サーバレス(Vercel)向けに **Pooled connection**（`-pooler` が付く方）を推奨。
3. これが `DATABASE_URL`。後で `.env` と Vercel の環境変数に貼る。

### 1.4 pgvector 拡張を有効化
1. 左メニューの **SQL Editor** を開く。
2. 次を実行:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. `SELECT * FROM pg_extension WHERE extname = 'vector';` で 1 行返れば有効。

### 1.5 開発用 DB ブランチを作る(任意・推奨)
1. 左メニュー **Branches** → **New Branch**。
2. 名前を `dev` などにして作成。マイグレーションは本番(`main`)ではなくこのブランチで先に検証する。
   - ※本リポジトリの開発ルール: `create_branch` → `run_sql` → `prepare_database_migration` でブランチ検証 → 本番反映(`complete_database_migration`)は人間が承認。

### 1.6 Neon Auth を有効化(認証用・M0 で使用)
1. 左メニューの **Auth**（Neon Auth）を開く。
2. **Enable / Set up Neon Auth** をクリック（ユーザー/セッションのテーブルが Neon 内に用意される）。
3. 画面に表示される認証用の環境変数（例: プロジェクト ID・publishable key・secret key 等）を控える。
   - これらは M0(認証実装)で `.env` / Vercel に追加する。**画面に出た正確な名称をそのまま使う**（命名は変わることがある）。

### 1.7 Neon API キー(MCP / 管理用・任意)
1. 右上アカウントメニュー → **Account settings** → **API keys**。
2. **Create API key** → 表示されたキーを `NEON_API_KEY` として控える（一度しか表示されないので注意）。
   - 開発時の Neon MCP（[`.mcp.json`](../../.mcp.json) が `${NEON_API_KEY}` を参照）で使う。アプリ実行時のDB接続は `DATABASE_URL`。

---

## 2. Vercel のセットアップ

Vercel ダッシュボード: **https://vercel.com/dashboard**

### 2.1 サインイン
1. **Sign Up / Log In** → **Continue with GitHub**。

### 2.2 リポジトリをインポート
1. ダッシュボードで **Add New…** → **Project**。
2. GitHub 連携を許可し、リストから **`decision-cockpit`** を選んで **Import**。
3. **Framework Preset** は **Next.js** が自動検出される。Build/Output 設定はデフォルトのままで可。

### 2.3 環境変数を設定
インポート画面の **Environment Variables**、または後から **Project → Settings → Environment Variables** で追加する。各サービスで取得した値を入れる（対象環境: Production / Preview / Development）。

| 変数名 | 値の取得元 |
|--------|-----------|
| `DATABASE_URL` | Neon の接続文字列(§1.3) |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | 選定した埋め込みモデル名と次元 |
| `EMBEDDING_API_KEY` | 埋め込み API の提供元 |
| `GITHUB_TOKEN` | SSoT 読み取り用 PAT(読み取り専用) |
| `WARROOM_PAT` | ai-war-room への PR 書き戻し用 PAT(最小スコープ) |
| `NEON_API_KEY` | Neon API キー(§1.7) |
| (Neon Auth のキー) | Neon Auth 画面(§1.6)で表示された名称のまま |

> 一覧と説明は [`.env.example`](../../.env.example) と同じ。**実値は Vercel の画面に入力するだけで、リポジトリには書かない。**

### 2.4 デプロイ
1. **Deploy** を押す。
2. ビルドが完了すると公開 URL（`https://<project>.vercel.app`）が発行される。
   - 現状はスキャフォールド段階のため、表示されるのは 3 画面の骨格のみ（データ連携は Roadmap）。

### 2.5 Neon ↔ Vercel 連携(任意・推奨)
- Vercel の **Integrations** から **Neon** インテグレーションを追加すると、`DATABASE_URL` を自動で注入できる。手動で §2.3 に入れた場合は不要。

### 2.6 Vercel Cron(毎時の自動同期・M1 以降)
- SSoT の取り込みは Vercel Cron（毎時 pull）で行う想定。リポジトリ直下に `vercel.json` を追加して定義する:
  ```json
  { "crons": [ { "path": "/api/sync", "schedule": "0 * * * *" } ] }
  ```
- 対応する Route Handler(`/api/sync`)が必要。**現状は未実装（Roadmap M1）。** 上記は将来の設定例。

---

## 3. GitHub Actions(自動整理 ×4・M5)

リポジトリには [`.github/workflows/daily-organize.yml`](../../.github/workflows/daily-organize.yml) の雛形がある（**既定では実行しない**）。実行するときだけ以下を設定する。

### 3.1 Secrets を登録
1. GitHub の対象リポジトリ → **Settings** → **Secrets and variables** → **Actions**。
2. **New repository secret** で登録:
   - `WARROOM_PAT`（ai-war-room へ PR を作る最小スコープの PAT）
   - `CLAUDE_CODE_OAUTH_TOKEN`（サブスク認証トークン。ローカルで `claude setup-token` を実行して生成）
   - `DATABASE_URL`

### 3.2 有効化フラグ(Variables)
1. 同じ画面の **Variables** タブ → **New repository variable**。
2. `ENABLE_DAILY_ORGANIZE` = `true` を追加（雛形は既定 false で no-op。true にすると朝昼夜深夜のスケジュールが動く）。

---

## 4. ローカルでの動作確認(Docker・推奨)

開発は **Docker(Docker Desktop)** で行う。app(Next.js dev)+ ローカル pgvector コンテナを起動し、**ローカル完結**で開発できる。Neon は staging/本番、およびマイグレーションのブランチ検証(§1.5)に使う。

```bash
cp .env.example .env       # 秘密値を設定(.env は gitignore 済み)
docker compose up --build  # app + db(pgvector)を起動
# → アプリ: http://localhost:3000 / DB: localhost:5432(コンテナ内は db:5432)
docker compose down        # 停止(DB データは volume に残る / -v で破棄)
```

- ローカルの `DATABASE_URL` は既定で db コンテナ(`postgres://cockpit:cockpit@db:5432/cockpit`)を指す(compose が設定)。
- **Neon に向けて開発したい場合**は、compose の `app.environment.DATABASE_URL` をコメントアウトし、`.env` の `DATABASE_URL` に Neon の接続文字列(§1.3)を入れる。
- 定義: リポジトリ直下の `docker-compose.yml` / `Dockerfile.dev` / `docker/initdb/01-pgvector.sql`。

### Docker を使わない場合
```bash
npm install
npm run build            # 骨格のビルド確認(exit 0)
npm run dev              # http://localhost:3000(DATABASE_URL は別途用意)
```

---

## 5. 完了チェックリスト

- [ ] Neon プロジェクト作成・`DATABASE_URL` 取得（Pooled）
- [ ] `CREATE EXTENSION vector` で pgvector 有効化
- [ ] (推奨) `dev` DB ブランチ作成
- [ ] (M0) Neon Auth 有効化・認証用の値を控えた
- [ ] (任意) `NEON_API_KEY` を発行（MCP/管理用）
- [ ] Vercel に `decision-cockpit` を Import・Next.js 検出
- [ ] Vercel の環境変数を設定（`.env.example` の各キー）
- [ ] Vercel デプロイ成功・公開 URL を確認
- [ ] (M5 を使うなら) GitHub Actions の Secrets と `ENABLE_DAILY_ORGANIZE` を設定
- [ ] ローカルで `.env` 設定後 `npm run build` / `npm run dev` が通る

---

## 6. 注意事項

- **秘密情報は実値を書かない**: 接続文字列・APIキー・PAT は `.env`（gitignore 済み）と各サービスの設定画面にのみ置く。本書・README・コードに直書きしない。
- **UI は変わる**: ボタンやメニュー名が本書と違う場合は、近い名称の項目（例: "Connect" / "Connection Details"）を探す。Neon Auth の環境変数名は画面表示に従う。
- **本番への破壊的操作はしない**: DB スキーマ変更はマイグレーション + Neon ブランチで検証し、本番反映は人間が承認する（開発ルール参照）。
- 関連: 要件定義は [`../design/requirements.md`](../design/requirements.md)、環境変数テンプレートは [`../../.env.example`](../../.env.example)。
