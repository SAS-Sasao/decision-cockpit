# 次にやること(あなたの手動アクション)

> 状態スナップショット: 2026-06-14 時点。Neon 接続(`DATABASE_URL`)設定・疎通確認済み、Claude Action をサブスク認証へ切替済み(`main` にマージ・push 済み)。
> このファイルは「Claude では実行できない/人間が判断・操作する」タスクの一覧。完了したらチェックを付ける。
> **秘密情報(接続文字列・トークン・パスワード)は本ファイルに実値を書かない。** 各サービスの設定画面と `.env`(gitignore 済み)にのみ置く。

---

## 🔴 今すぐ(セキュリティ・最小設定)

- [ ] **Neon のパスワードをリセットする**
  - 理由: セットアップ中に接続文字列(パスワード込み)をチャットへ貼ったため、平文で露出済み。本番運用前に必ずローテーションする。
  - 手順: Neon コンソール → 対象プロジェクト → **Connect** → **Reset password**(または Roles → 該当ロール → Reset)。
  - リセット後: 新しい接続文字列を `.env` の `DATABASE_URL` に貼り替える(旧文字列は無効化される)。

- [ ] **`.env` の不要行を削除**(未対応なら)
  - `ANTHROPIC_API_KEY=__set_me__` の行を削除(サブスク認証に切替えたため不要)。残っていても害はないが掃除として。

---

## 🟡 Claude Action(自動整理 ×4・ロードマップ M5)を動かすとき

朝昼夜深夜の `daily-organize` ワークフローを有効化する場合のみ。

- [ ] **サブスク認証トークンを生成**
  ```bash
  claude setup-token        # 要 Claude Pro/Max。ブラウザ認証 → 長期 OAuth トークンが出力される
  ```
- [ ] **GitHub の Secrets を登録**(リポジトリ → Settings → Secrets and variables → **Actions** → New repository secret)
  - `CLAUDE_CODE_OAUTH_TOKEN` … 上で生成したトークン
  - `WARROOM_PAT` … ai-war-room へ PR を作る最小スコープの PAT
  - `DATABASE_URL` … Neon 接続文字列
- [ ] **有効化フラグを設定**(同画面の **Variables** タブ)
  - `ENABLE_DAILY_ORGANIZE` = `true`(雛形は既定 false で no-op)

---

## 🟢 開発を進めるとき

- [ ] **pgvector を有効化**(現状 0.8.1 利用可・未インストール)
  - 原則は **番号付きマイグレーション(`db/migrations/`)経由**。プロジェクトの流れに従い `/basic-design` → `/design-review`(全レンズ PASS)→ `/goal` で進める。
  - 動作確認だけなら Neon SQL Editor で `CREATE EXTENSION IF NOT EXISTS vector;` でも可(手順書 §1.4)。
- [ ] **埋め込み設定を確定**(検索 M2)
  - 多言語モデルを1つに固定し、`.env` の `EMBEDDING_MODEL` / `EMBEDDING_DIM` / `EMBEDDING_API_KEY` を埋める(混在禁止)。
- [ ] **SSoT 取り込み用トークン**(取り込み M1)
  - `.env` の `GITHUB_TOKEN` に**読み取り専用 PAT** を設定(cc-sier-organization / ai-war-room の読み取り)。
- [ ] **ローカル起動の確認**
  ```bash
  docker compose up --build   # app + ローカル pgvector(http://localhost:3000)
  ```
- [ ] **(任意)Vercel デプロイ**(手順書 §2)。`DATABASE_URL` 等の環境変数を Vercel に登録。

---

## ✅ 完了済み(参考)

- `DATABASE_URL` を `.env` に設定 → 疎通確認(PostgreSQL 18.4 / `neondb` / `neondb_owner`)
- Claude Action をサブスク認証(`CLAUDE_CODE_OAUTH_TOKEN`)へ切替 → `main` にマージ・push 済み
- `jq` 導入(書き込みガード hook の誤ブロックを解消。`.env` 書き込みは引き続き `permissions.deny` で遮断)

---

## 関連ドキュメント

- セットアップ全体: [`neon-vercel-setup.md`](./neon-vercel-setup.md)
- 環境変数テンプレート: [`../../.env.example`](../../.env.example)
