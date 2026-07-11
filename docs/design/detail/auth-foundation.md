# 詳細設計: auth-foundation(M0 認証・ユーザー管理土台)

> 対象基本設計: docs/design/basic/auth-foundation.md(design-review Round 2 全レンズ PASS)
> ステータス: **PASS**(design-review 詳細設計 Round 2 全レンズ PASS — reviews/auth-foundation.md 参照)
> 作成: 2026-07-11(主セッション執筆)/ 改訂: 2026-07-11(reviews/auth-foundation.md 詳細設計 Round 1 反映)

## 0. 基本設計からの確定事項(未解決の問い・申し送りの決着)

### Neon Auth の実体確定(基本設計 問い#3)
公式ドキュメント(neon.com/docs/neon-auth/quick-start/nextjs・/docs/auth/reference/nextjs-server、2026-07-11 参照)で確定。
**基本設計時点の想定(Stack Auth 系 SDK・env 3種)から世代交代しており、現行は以下**:

| 項目 | 確定値 |
|---|---|
| SDK パッケージ | `@neondatabase/auth`(0.4.2-beta。**peer 依存 = Next >= 16**) |
| Next.js バージョン | **16.x へアップグレード**(2026-07-11 実装時修正・ユーザー承認済み: SDK の peer 依存が Next >=16 のため 14.2 から更新。React 18.3 は peer 範囲内でそのまま)。**Next 16 では middleware.ts が `proxy.ts` に改名**されており、本書の該当箇所も proxy.ts に更新済み |
| サーバ初期化 | `createNeonAuth({ baseUrl, cookies: { secret } })`(import 元 = `@neondatabase/auth/next/server`。`lib/auth/server.ts` に配置) |
| クライアント UI import(実装時確認・確定) | `AuthView` / `NeonAuthUIProvider` = `@neondatabase/auth/react`。スタイル = `@neondatabase/auth/ui/css`(インストール済みパッケージの exports で確認) |
| env 変数(2種) | `NEON_AUTH_BASE_URL`(コンソール表示の Auth サーバ URL)/ `NEON_AUTH_COOKIE_SECRET`(32文字以上・HMAC-SHA256 用) |
| 認証ハンドラルート | `app/api/auth/[...path]/route.ts` — `export const { GET, POST } = auth.handler()` |
| セッション取得 | `auth.getSession()` → `{ data: Session \| null, error: Error \| null }`。利用する Server Component は `dynamic = 'force-dynamic'` 必須(注: getSession は cookie 依存のため実行時も動的レンダリングに落ちるが、明示指定を規約とする) |
| ルート保護 | `middleware.ts` で `auth.middleware({ loginUrl: '/login' })`。**matcher で `/login` も明示除外**し、SDK 内部の loginUrl 素通し実装に依存しない(§2.1) |
| サインイン UI | SDK 付属 `<AuthView pathname="sign-in" />`(+ Provider)。**クライアント側 import の正確なパスは SDK パッケージの exports を実装時に確認**し、実装ノート(PR 説明)に記録する(サーバ側 import は上記で確定済み) |
| サインアウト | `auth.signOut()`(Server Action)→ `redirect('/login')`。**配置は `app/logout/actions.ts` で確定** |
| email/password | サポート(`auth.signIn.email()` / `auth.signUp.email()`)→ **問い#5 決着: ID = email で確定** |

### レビュー申し送り7件の決着(reviews/auth-foundation.md 基本設計 Round 2)

| # | 申し送り | 決着 |
|---|---|---|
| 1 | `.env.example` がスキャン対象外(sec Med) | **解決**: check-no-secrets.sh は `git ls-files --cached --others --exclude-standard` の出力を走査(§2.3)。gitignore 準拠のため `.env`/`.next/` は自動除外、**`.env.example` は tracked なので走査対象** |
| 2 | 秘密クラス追加時のパターン追随の一般則 | **解決**: 一般則「**秘密クラスの追加、または既存クラスの実値形式の確定**を行う変更は、実値形式パターンの check-no-secrets.sh への追随を同一コミットに含める」を §2.3 とスクリプトヘッダに明記(既存クラスの形式後日確定 — 例: `EMBEDDING_API_KEY` を M1 で確定 — も捕捉)。`napi_`(NEON_API_KEY)を今回パターンへ追加 |
| 3 | 条件8の exit 2 マスク | **解決**: 存在するディレクトリのみ検査 + **grep の終了コードを明示採取する集計型**(§4-8)。`set -e` は `!` 反転コマンドの失敗を無視する(bash 仕様)ため、`! grep` 連鎖には依存しない。ヒット(exit 0)と grep エラー(exit ≥2)の両方を fail に集計し、マッチなし(exit 1)のみを正常とする |
| 4 | build 生成物の除外漏れ | **解決**: #1 と同じ git ls-files 方式で gitignore 準拠(`.next/` 等は自動除外) |
| 5 | 実値形式ダミー禁止の運用規約 | **解決**: §2.3 に明記。**適用範囲は接頭辞型秘密(パターン化された5クラス)の実値形式のみ**。形式のない秘密クラス(cookie secret 等)の明らかな非秘密ダミー(例: 全ゼロ 32 文字)は対象外と明文化 |
| 6 | capture.md 追随更新の機械判定 | **解決**: 受け入れ条件9として grep 判定を追加(§4-9)。※出現有無の判定であり文意までは保証しない(強制ゲートとしての限界を許容) |
| 7 | 非 `npg_` パスワードの Neon URL 非捕捉 | **記録**: 運用前提「DB パスワードは Neon 発行(`npg_` 接頭辞)のみ使用。手動 `ALTER ROLE ... PASSWORD` をしない」を明記 |

**残余リスク(記録)**:
- `NEON_AUTH_COOKIE_SECRET` は接頭辞のないランダム文字列のためパターン検知不能。緩和 = `.env`/Vercel のみに置く運用 + `.env.example` はプレースホルダ `__set_me__` 統一(走査対象のため接頭辞型の実値ペーストは検知)。
- `EMBEDDING_API_KEY` は形式未定のため現時点で検知不能。**M1 でプロバイダ確定時に一般則(§2.3-1)によりパターン追随を義務付ける**。
- `NEON_AUTH_BASE_URL` は資格情報ではなく低感度(URL)。

### その他の問いの決着
- **問い#2(admin ブートストラップ)**: 手動 SQL で確定(管理 UI なし・主利用者1名のため最小)。runbook: 初回ログイン後に Neon SQL Editor で
  `INSERT INTO user_roles (user_id, role_id) SELECT '<自分の user id>', id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING;`
- **問い#6(インデックス方針)**: §1 の DDL で確定(partial index + user 別一覧用)。**M5 の未処理消費は全ユーザー一括(created_at 順)を前提**とし、partial index のキーは `(created_at)` とする。M5 で per-user 消費に変える場合は M5 の設計で index を再検討する。
  - **capture.md 更新文言の確定(基本設計 §1-6 の括弧書きを本項が明確化)**: 「user_id スコープ前提」とは**行の所有(帰属)が user_id にある**ことを指し、**消費の単位ではない**。M0-A で capture.md に補記する文言は「各行は user_id 所有。M5 の消費は `processed_at IS NULL` の全ユーザー一括(created_at 順)で、生成物への帰属の扱いは M5 設計で確定」とする(契約ファイルと index 設計の消費モデルを一致させる)。
- **問い#1(管理 UI)**: M0 対象外のまま維持(配置先は M4 前後で再判断)。

---

## 1. スキーマ DDL

### 1.1 ファイル構成と適用経路
- `db/migrations/0001_auth_foundation.up.sql` / `db/migrations/0001_auth_foundation.down.sql`
- 適用(ローカル): `docker compose exec -T db psql -U cockpit -d cockpit -v ON_ERROR_STOP=1 -f - < <up|down>.sql`
- 適用(Neon): ブランチ検証(`create_branch` → `run_sql` → `prepare_database_migration`)→ 本番反映は人間承認(ask)。
- **冪等性**: up は `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` で再適用可能。down は `IF EXISTS`。

### 1.2 up.sql(確定 DDL)

```sql
-- 0001_auth_foundation.up.sql
-- pgvector: M0 では拡張の有効化のみ。vector(<EMBEDDING_DIM>) 列は M1+ で
-- 埋め込みモデル確定後に env の EMBEDDING_DIM を用いて作成する(本 DDL に vector 列はない)。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS roles (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id text NOT NULL,                      -- Neon Auth の user id(FK は張らない: 基本設計 §3.1)
  role_id int  NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       int NOT NULL REFERENCES roles(id),
  permission_id int NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS capture_inbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('status','issue','next_move','spar_conclusion')),
  topic        text,
  tags         text[] NOT NULL DEFAULT '{}',
  body         text NOT NULL,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,                   -- NULL = 未処理(capture 契約)
  curated_ref  text
);

-- M5 の「processed_at IS NULL のみ走査」向け partial index(基本設計 問い#6 の決着。
-- M5 は全ユーザー一括・created_at 順の消費を前提。per-user 消費に変更する場合は M5 設計で再検討)
CREATE INDEX IF NOT EXISTS capture_inbox_unprocessed_idx
  ON capture_inbox (created_at) WHERE processed_at IS NULL;
-- 個人別一覧(M4)向け
CREATE INDEX IF NOT EXISTS capture_inbox_user_created_idx
  ON capture_inbox (user_id, created_at DESC);

-- seed(基本設計 §1-2: up 内・冪等)
INSERT INTO roles (name, description) VALUES
  ('admin',  '管理者: ユーザー/ロール管理が可能'),
  ('member', '一般: 共有データ閲覧と自分のキャプチャ入力')
ON CONFLICT (name) DO NOTHING;
```

### 1.3 down.sql

```sql
-- 0001_auth_foundation.down.sql
-- 基本設計 §3.1 の整理に基づく(設計明示 + design-review + 人間承認済みの down 定義)。
DROP TABLE IF EXISTS capture_inbox;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS roles;
DROP EXTENSION IF EXISTS vector;   -- M0 時点では vector 列が存在しないため安全に削除可能
```

### 1.4 型・制約の根拠
- `user_id text`: Neon Auth の user id をそのまま保持(形式非依存)。FK なし(基本設計 §3.1。orphan は許容・問い#4 に合流)。
- `gen_random_uuid()`: PG13+ 組み込み。ローカル(pg17)/ Neon(pg18)両対応。
- `tags text[] NOT NULL DEFAULT '{}'`: 要件 §5.3 のタグ結合に備える(NULL と空配列の二義性を排除)。
- kind CHECK: capture 契約(.claude/rules/capture.md)の4語彙のみ。

---

## 2. 関数 / API インターフェース

### 2.1 認証モジュール

| ファイル | エクスポート | 契約 |
|---|---|---|
| `lib/auth/server.ts` | `auth` | `createNeonAuth({ baseUrl: env.NEON_AUTH_BASE_URL, cookies: { secret: env.NEON_AUTH_COOKIE_SECRET } })`。env 未設定時はモジュール初期化で throw(fail-fast) |
| `lib/auth/user.ts` | `getUser(): Promise<AuthUser \| null>` | `auth.getSession()` を呼び `data?.user` を `AuthUser { id: string; email: string \| null; name: string \| null }` に正規化。**`error` 非 null 時は console.error して `null` を返す(fail-closed = 未認証扱い)** |
| `lib/auth/user.ts` | `requireUser(): Promise<AuthUser>` | `getUser()` が null なら `redirect('/login')`(next/navigation)。非 null ならそのまま返す |
| `app/api/auth/[...path]/route.ts` | `GET, POST` | `auth.handler()` の再エクスポートのみ(ロジックを書かない) |
| `proxy.ts`(Next 16。旧 middleware.ts) | default / `config` | `auth.middleware({ loginUrl: '/login' })`。matcher = `"/((?!api/auth(?:/|$)|login(?:/|$)|_next/static|_next/image|favicon\\.ico).*)"` — **除外はパス境界付き**(`/api/authx` や `/loginx` は保護対象のまま)。`/login` を明示除外し SDK 内部実装に依存しない |
| `app/login/page.tsx` | ページ | SDK 付属 AuthView(sign-in)。成功後 `/` へ |
| `app/logout/actions.ts` | `signOutAction()` | `await auth.signOut()` → `redirect('/login')`(配置確定 — §0) |

- **二層防御(基本設計 §3.2 の契約の実装形)**: 保護が必要な Server Component / Server Action / Route Handler は middleware の有無に関わらず冒頭で `requireUser()`(または `getUser()` + 明示分岐)を呼ぶ。`auth.getSession()` を使うページは `export const dynamic = 'force-dynamic'` を明示する。
- **データアクセス規約(M1+ を拘束・M0 は規約のみ)**: 個人データへのクエリは `lib/data/<domain>.ts` に置き、**第1引数に `userId: string` を必須とする**。UI/Route から直接 SQL を書かない。

### 2.2 環境変数(.env.example への追記)

```
# --- Neon Auth(認証。実値は .env / Vercel のみ) ---
NEON_AUTH_BASE_URL=__neon_console_auth_url__
NEON_AUTH_COOKIE_SECRET=__set_me_32chars_min__
```

### 2.3 scripts/check-no-secrets.sh(受け入れ条件7の判定器・契約確定)

- **走査対象**: `git ls-files --cached --others --exclude-standard` の出力のうち**作業ツリーに実在するファイルのみ**
  (`[ -f ]` でフィルタ — ステージ済みだが削除されたパスで grep がエラーにならないように)。
  = tracked + 未追跡だが gitignore されていないファイル。**`.env.example` を含み**、`.env` / `.next/` / `node_modules/` は gitignore 準拠で自動除外。
- **除外**: スクリプト自身(`scripts/check-no-secrets.sh`)のみ。
- **検知パターン**(秘密の実値形式のみ。ERE):
  `npg_[A-Za-z0-9]+` / `napi_[A-Za-z0-9]+` / `ghp_[A-Za-z0-9]+` / `github_pat_[A-Za-z0-9_]+` / `sk-ant-[A-Za-z0-9-]+`
- **判定**: ヒット 0 件 → exit 0。1件以上 → ヒット一覧を stderr に出し exit 1。git リポジトリ外・git 不在 → exit 2(判定不能を成功と区別)。
- **ヘッダに明記する一般則**(申し送り #2/#5 の決着):
  1. **秘密クラスの追加、または既存クラス(例: `EMBEDDING_API_KEY`)の実値形式の確定**を行う変更は、その実値形式パターンの本スクリプトへの追随を**同一コミット**に含める。
  2. リポジトリ内のあらゆるファイルに**接頭辞型秘密(上記5クラス)**の実値形式ダミー(接頭辞+英数字)を書かない。言及は正規表現形式(`npg_[A-Za-z0-9]+` 等)で行う。形式のない秘密クラス(cookie secret 等)については、明らかな非秘密ダミー(全ゼロ等)の使用を許容する。

---

## 3. テスト観点

- **ランナー: vitest で確定**(devDependencies に追加。`npm test` = `vitest run`)。理由: TS ネイティブ・設定最小・Next.js と干渉しない。
- **実ネットワーク禁止**: `@neondatabase/auth/next/server` は `vi.mock` で全面モック。Neon Auth への実通信・実 DB 接続を `npm test` に含めない(DB 依存の検証は受け入れ条件2〜4の psql 判定に分離し、`npm test` は Docker 不要で完結)。
- **fixture**: `fixtures/` に匿名サンプルのみ。秘密実値・実ユーザーデータを置かない。

| テストファイル | 観点 | ケース |
|---|---|---|
| `tests/auth-user.test.ts` | ユニット(getUser/requireUser) | (a) セッションなし → getUser=null / requireUser が redirect('/login') を throw、(b) セッションあり → AuthUser 正規化(id/email/name)、(c) getSession が error を返す → null(fail-closed) |
| `tests/proxy.test.ts` | 契約(matcher) | proxy.ts の config.matcher の正規表現に対し **保護**: `/` `/search` `/review` `/api/authx` `/loginx`、**素通し**: `/api/auth/session` `/login` `/_next/static/x` `/favicon.ico`。loginUrl オプションの指定値(`/login`)も assert |
| `tests/check-no-secrets.test.ts` | 契約(スクリプト) | **OS の一時ディレクトリ(リポジトリ外)**に `git init` した匿名 fixture で: (a) クリーン → exit 0、(b) 実値形式(接頭辞+英数字を**テスト内で文字列連結して生成**し、リテラルを残さない)を仕込む → exit 1、(c) `.env.example` 相当ファイルに仕込んでも検知 → exit 1、(d) gitignore 済みファイルに仕込んだ場合は非検知 → exit 0 |
| `tests/capture-contract.test.ts`(任意) | 契約(DDL 静的) | up.sql に kind 4語彙の CHECK・partial index・seed の ON CONFLICT が含まれることを文字列検査(DB 不要) |

---

## 4. 受け入れ条件(機械判定)

すべて exit code で判定。前提: `docker compose up -d db` 済み(条件2〜4のみ)。
`PSQL="docker compose exec -T db psql -U cockpit -d cockpit -v ON_ERROR_STOP=1"` とする。

1. **マイグレーション必須要素**(exit 0):
   ```bash
   set -e
   f=db/migrations/0001_auth_foundation.up.sql
   grep -q "CREATE EXTENSION IF NOT EXISTS vector" "$f"
   for t in roles user_roles permissions role_permissions capture_inbox; do
     grep -Eq "CREATE TABLE IF NOT EXISTS $t\b" "$f"; done
   grep -q "WHERE processed_at IS NULL" "$f"          # partial index
   grep -q "ON CONFLICT (name) DO NOTHING" "$f"        # seed 冪等
   test -f db/migrations/0001_auth_foundation.down.sql
   ```
2. **可逆性**: `$PSQL -f - < up.sql` → `< down.sql` → `< up.sql` がすべて exit 0。
3. **seed**(exit code 判定に統一):
   `test "$($PSQL -tAc "SELECT count(*) FROM roles WHERE name IN ('admin','member');")" = "2"` が exit 0。
4. **kind CHECK 隔離**: `! $PSQL -c "INSERT INTO capture_inbox (user_id, kind, body) VALUES ('test-user','bogus','x');"` が exit 0(= INSERT が失敗する。単独コマンドの反転のため §4-8 の集計問題は生じない)。
   併せて正常系 `$PSQL -c "INSERT INTO capture_inbox (user_id, kind, body) VALUES ('test-user','status','ok');"` が exit 0。
5. **認証統合の実装物**(exit 0):
   ```bash
   set -e
   for p in app/login/page.tsx "app/api/auth/[...path]/route.ts" app/logout/actions.ts proxy.ts lib/auth/server.ts lib/auth/user.ts; do
     test -e "$p"; done
   NEON_AUTH_BASE_URL=http://localhost:9 \
   NEON_AUTH_COOKIE_SECRET=00000000000000000000000000000000 \
   npm run build
   ```
   (ビルドはダミー env で通ること = 実値・実通信なしでビルド可能な実装であること)
6. **テスト緑**: `npm test` が exit 0。§3 の必須ケース(auth-user / proxy / check-no-secrets)のテストファイルが存在する(`test -f` で判定)。
7. **秘密実値ゼロ**: `bash scripts/check-no-secrets.sh` が exit 0(契約は §2.3)。
8. **禁止事項**(集計型 — `set -e`+`! grep` 連鎖は bash 仕様で偽 PASS するため使わない):
   ```bash
   fail=0
   for d in app lib scripts tests; do
     [ -d "$d" ] || continue
     for pat in 'cc-sier-organization|ai-war-room' 'DROP TABLE|TRUNCATE|DELETE FROM'; do
       grep -RIn -E "$pat" "$d"; s=$?
       [ "$s" -ne 1 ] && fail=1   # 1=マッチなし(正常)。0=違反ヒット / 2以上=grepエラー → いずれも fail
     done
   done
   exit "$fail"
   ```
   → exit 0。違反ヒット(grep exit 0)も grep エラー(exit ≥2)も fail に集計され、偽 PASS しない。
9. **capture.md 追随**(申し送り#6): `grep -q "user_id" .claude/rules/capture.md` が exit 0。
10. **env 契約**: `grep -q "NEON_AUTH_BASE_URL" .env.example && grep -q "NEON_AUTH_COOKIE_SECRET" .env.example` が exit 0(実値は書かない — 条件7が担保)。

---

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal M0-A「DB 土台 + 秘密スキャン」(先行)
- **対象設計**: docs/design/detail/auth-foundation.md(本書。/goal 発行時にこの行を転記する)。
- **達成状態**: 受け入れ条件 **1〜4, 7〜9** がすべて exit 0。
- **成果物**: `db/migrations/0001_auth_foundation.{up,down}.sql` / `scripts/check-no-secrets.sh` / `.claude/rules/capture.md` の user_id 追随更新。
- **executor**: db-architect(マイグレーション)+ 主セッション(スクリプト・ルール更新)。
- **ターン上限**: 25。超過時は停止して報告。
- **節目 commit**: (a) マイグレーション完成 + 条件1〜4 緑、(b) スクリプト完成 + 条件7 緑。
- **先行理由**: check-no-secrets.sh を先に入れることで M0-B(env 追記を含む)の誤コミットを機械的に防ぐ。

### /goal M0-B「Neon Auth 統合」(M0-A 後)
- **対象設計**: docs/design/detail/auth-foundation.md(本書。/goal 発行時にこの行を転記する)。
- **達成状態**: 受け入れ条件 **5, 6, 10** がすべて exit 0(+ 7 を再実行して緑)。
- **成果物**: Next 16 アップグレード(package.json)/ `@neondatabase/auth` 導入 / `lib/auth/{server,user}.ts` / `proxy.ts` / `app/api/auth/[...path]/route.ts` / `app/login/page.tsx` / `app/logout/actions.ts` / `.env.example` 追記 / vitest 導入 + §3 のテスト。
- **executor**: backend-engineer(認証モジュール)+ frontend-engineer(/login・サインアウト UI)。
- **ターン上限**: 30。超過時は停止して報告。
- **節目 commit**: (a) SDK 導入 + ビルド緑(条件5)、(b) テスト整備 + 全緑(条件6)。

### 両ゴール共通の禁止事項
- `.env` / `.env.local` 等への書き込み(`.env.example` のみ可)。
- SSoT(cc-sier-organization / ai-war-room)への読み書き一切。
- `db/migrations/` 外での DROP / TRUNCATE / DELETE。
- `.claude/settings.json` / hooks の変更。
- テストからの実ネットワークアクセス(Neon Auth / Neon / GitHub すべてモック)。
- 本番(Neon main)への down 適用(人間承認なしでは不可)。

### 完了後の人間の手動アクション(実装外)
1. Neon コンソールで Neon Auth を有効化し、`NEON_AUTH_BASE_URL` を控えて `.env` / Vercel に設定。
2. `NEON_AUTH_COOKIE_SECRET` を生成(32文字以上)し `.env` / Vercel に設定。
3. 初回サインアップ後、runbook(§0 問い#2)の SQL で自分に admin を付与。
4. dev/staging で手動確認3点(基本設計 §4: 未認証リダイレクト / ログイン到達 / サインアウト後の再保護)。

---

## 次の手順

`/design-review auth-foundation`(detail)で3レンズレビュー → 全 PASS で `/goal M0-A` から実装。
