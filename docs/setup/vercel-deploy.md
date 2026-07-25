# Vercel デプロイ手順(実行用ランブック)

> 作成: 2026-07-12(M1 完了時点)/ **更新: 2026-07-25(M0〜M5 + TCS-1 完了時点・本書が最新)**。
> 旧手順 [`neon-vercel-setup.md`](./neon-vercel-setup.md) §2 は M0 以前の記述。
> **秘密情報の実値は本書に書かない**(値は `.env` と Vercel の画面にのみ)。

---

## 0. 事前条件チェックリスト(デプロイ前に必ず)

- [ ] **マイグレーション 0003→0008 が Neon 本番に適用済み**(0001-0002 は適用済み。0003→0008 は Neon ブランチで
      連鎖検証済み — **人間承認のうえ Claude が順に適用可能**。適用後の確認: embedding 列 / board_items /
      capture_inbox.status・deleted_at / capture_inbox_consume_idx が存在すること)
- [ ] **Neon パスワードリセット済み**(チャット露出分の後始末)→ リセット後の `DATABASE_URL` に `.env` を更新
      (`.env` の編集はユーザーのみ)。**Vercel に登録するのは必ずリセット後の値**
- [ ] `GITHUB_TOKEN`(fine-grained PAT)が有効(**Expiration 90日設定なら期限に注意** — 切れていたら再発行)
- [ ] `CRON_SECRET` が `.env` に存在(2026-07-12 生成済み)
- [ ] ローカルで `npm run build` が exit 0(現状緑・テスト 455件緑)

## 1. プロジェクト Import

1. https://vercel.com → **Continue with GitHub** でログイン
2. **Add New… → Project** → GitHub 連携から **`decision-cockpit`** を選び **Import**
3. Framework Preset = **Next.js**(自動検出)。Build/Output 設定はデフォルトのまま

## 2. 環境変数の登録(Project → Settings → Environment Variables)

対象環境は Production(+ Preview も使うなら両方)。**値はすべて `.env` からコピー**:

| 変数 | 値の出所 | 備考 |
|---|---|---|
| `DATABASE_URL` | `.env`(Neon の **pooled** 接続文字列) | パスワードリセット後の新しい値 |
| `NEON_AUTH_BASE_URL` | `.env` | Neon Auth の Base URL |
| `NEON_AUTH_COOKIE_SECRET` | `.env` | 32文字以上 |
| `GITHUB_TOKEN` | `.env` | SSoT 読み取り用 PAT |
| `CRON_SECRET` | `.env` | **Vercel はこの名前の env があると Cron 起動時に `Authorization: Bearer <値>` を自動付与**する(実装の GET 認可とそのまま噛み合う) |
| `SYNC_MAX_FILES` | 任意(未設定なら実装既定 100) | serverless の時間制限対策(進行カーソルで毎時追いつく) |
| `EMBEDDING_MODEL` | `text-embedding-3-large` | 検索(M2)。**ローカルと同一モデル・混在禁止** |
| `EMBEDDING_DIM` | `1536` | 同上(pgvector 次元) |
| `OPENAI_API_KEY` | `.env` | 埋め込み生成用 |
| `SPAR_PROVIDER` / `SPAR_MODEL` / `SPAR_API_KEY` | `.env` | 壁打ち(M4)。**3つとも明示必須**(未設定時は壁打ちのみ 4xx で他画面は正常 — fail-closed) |

**登録してはいけないもの**:
- `SYNC_SOURCE` — **production で `fixture` を指定すると同期が明示エラーになる設計**(誤って実データの代わりに fixture を取り込む事故の防止)。登録自体しない。
- `NEON_API_KEY` / `WARROOM_PAT` / `ORGREPO_PAT` / `CLAUDE_CODE_OAUTH_TOKEN` — Vercel では使わない(開発時 MCP / M5 の GitHub Actions Secrets の領分)。

## 3. デプロイと動作確認

1. **Deploy** を押す → ビルド完了で `https://<project>.vercel.app` が発行される
2. 手動確認:
   - `/` → 未認証なら `/login` へリダイレクト(307)
   - ログイン(email/password)→ `/` に到達
   - `/review` → 実スコア表示(Neon 本番にデータが無ければ空状態表示)
   - もし Neon Auth のログインが失敗する場合、Neon コンソール → Auth の**許可オリジン/ドメイン設定**に Vercel の URL を追加する必要がないか確認
3. Cron 確認: Project → Settings → **Cron Jobs** に `GET /api/sync`(毎時 `0 * * * *`・`vercel.json` 由来)が表示されているか

## 4. 初回同期・バックフィル・admin 付与

- Vercel(hobby)の関数実行時間制限があるため、**初回フル同期はローカルから Neon 本番に向けて実行するのが推奨**:
  ```bash
  # .env の DATABASE_URL が Neon を指すことを確認してから
  npx tsx scripts/sync-local.ts        # SYNC_SOURCE 未指定 = GitHub / 既定 SYNC_MAX_FILES=0(無制限)
  ```
  **タグは1回の同期で付く**(TCS-1 恒久修正済み — 「2回走らせる」回避策は不要)。
- **埋め込みバックフィル**(検索を有効にする・**~$0.4 の OpenAI 課金** — 人間承認のうえ実行):
  ```bash
  npx tsx scripts/embed-local.ts       # .env の DATABASE_URL が Neon を指す状態で
  ```
- **admin ロール付与**(本番 user_roles は空 — 付与しないと管理系画面に入れない):
  `neon_auth."user"` から対象ユーザーの id を確認し、`user_roles` へ INSERT(手順の実体は
  [`db-recovery.md`](./db-recovery.md) 手順5 と同一。Claude が実施可能)。
- 以後の増分は Vercel Cron(毎時)が処理。1回で終わらない量でも `sync_state.progress`(進行カーソル)で次回に続きから処理する設計。
- **展開が済んだら次は「🤖 整理ループの有効化」**([`next-actions.md`](./next-actions.md) の7項目・ユーザー操作)。

## 5. トラブルシュート

| 症状 | 原因候補 |
|---|---|
| Cron の /api/sync が 401 | Vercel の `CRON_SECRET` 未登録 or `.env` と値が不一致(サーバ側未設定は fail-closed で常に 401) |
| /api/sync が 500 で「fixture」に言及 | production に `SYNC_SOURCE=fixture` が登録されている → 削除 |
| 同期が進まない(hasMore が続く) | 変更量が多い。`SYNC_MAX_FILES` を一時的に増やすか、ローカルから `sync-local.ts` で追いつかせる |
| GitHub 401/403 | `GITHUB_TOKEN` の期限切れ → 再発行して差し替え |
| ログイン不可 | Neon Auth の許可オリジン設定 / `NEON_AUTH_*` の値を確認 |

## 6. ローカルとの並行運用

- ローカル Docker は compose が `DATABASE_URL` を**ローカル db に上書き**しているため、Vercel(Neon)とローカルは独立に動く。
- ローカルから Neon に向けて操作したいときだけ、コマンドの env で `DATABASE_URL` を Neon に指定する(compose の設定は変えない)。
