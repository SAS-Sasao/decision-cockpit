# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-07-11 終了時点**。
> **M0(認証・ユーザー管理土台)完了**: 基本設計/詳細設計とも design-review 全レンズ PASS → /goal M0-A・M0-B とも acceptance-judge 独立検証 PASS → main に push 済み。
> マイグレーション 0001 は**ローカル db と Neon 本番(production)の両方に適用済み**(ブランチ検証→承認→適用)。
> ローカル環境は Docker(Next 16.2 + Neon Auth)で稼働中: 未認証 `/` → `/login` リダイレクト・サインアップ・admin 付与(2ユーザー)まで動作確認済み。
> **秘密情報(接続文字列・トークン・パスワード)は本ファイルに実値を書かない。**

---

## 🔴 最優先(セキュリティ・すぐ終わる)

- [ ] **Neon のパスワードをリセットする**(チャットに露出した分の後始末)
  - Neon コンソール → 対象プロジェクト → **Connect** → **Reset password**。
  - リセット後、`.env` の `DATABASE_URL` を新しい接続文字列に差し替え(Vercel / GitHub Secrets に登録済みならそちらも)。
  - ローカル開発は docker の db を使うため影響なし。
- [ ] **手動確認の残り1点**(30秒): ブラウザ F12 → Application → Cookies → `localhost:3000` を全削除 → リロード → `/login` に戻れば M0 の手動確認オールクリア。

## 🟡 M1 着手前の準備(あなたの手動ステップ)

- [ ] **`GITHUB_TOKEN`(SSoT 読み取り用 PAT)を `.env` に設定**
  - GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → New。
  - 対象リポジトリ: `cc-sier-organization` / `ai-war-room` の2つ。Permissions: **Contents: Read-only** のみ。
  - `.env` の `GITHUB_TOKEN=__read_only_pat__` を差し替え。
  - 背景: 両 repo は public だが、毎時同期は無認証のレート制限(60回/h)に確実に当たるため。

## 🟢 M1 本線(取り込み基盤 + 振り返り)

進め方はプロジェクトの正道どおり: `/basic-design <topic>` → `/design-review`(全レンズ PASS)→ `/detailed-design` → `/design-review` → `/goal`。

- [ ] **`/basic-design` で M1 の基本設計**。設計に織り込むべき偵察済みの事実:
  - ⚠️ **SSoT 実構造が要件定義 v1.1 §5.1 からドリフト**: cc-sier-organization のデータは repo 直下ではなく **`.companies/<org>/` 配下**(組織単位)。
    - フルセット(.task-log / .case-bank / .quality-gate-log / .session-summaries / .conversation-log / masters)保有: `domain-tech-collection` のみ
    - `jutaku-dev-team`: docs / masters のみ。`standardization-initiative`: .task-log / docs / masters
    - → `timeline_records.org` 列がこの構造にそのまま対応する。**要件定義 §5.1 の目録更新も設計とセットで行う**
  - ai-war-room の `docs/` に **knowledge / manual / sample** が追加されている(既知は decisions / logs / templates)。取込対象に含めるか設計で判断。
  - パーサ契約はルールどおり: 冪等 upsert キー = (source, file_path, commit)。実ファイルのスキーマを **fixtures/ に匿名サンプルで固定**してから実装。
  - M0 詳細設計からの申し送り: 受け入れ条件8の「SSoT repo 名ゼロ」ゲートは M0 限定 → **M1 では lib/ に repo 名が正当に出現するためゲートを再定義**する(reviews/auth-foundation.md の Info 参照)。
  - `timeline_records` の embedding 列を M1 で作るか(要 `EMBEDDING_DIM` 確定 = research-spike)、M2 に送るかを設計で決める。
- [ ] マイグレーション 0002(timeline_records / metric_aggregates / sync_state / tag_synonyms)は設計 PASS 後に `/goal` で。

## ⏳ 後続マイルストーンが来たら(今は不要)

| いつ | やること |
|---|---|
| **M2**(検索) | 埋め込みモデル選定(research-spike)→ `.env` の `EMBEDDING_MODEL` / `EMBEDDING_DIM` / `EMBEDDING_API_KEY` 確定 + check-no-secrets.sh へパターン追随(同一コミット) |
| **M5**(自動整理) | `claude setup-token` → GitHub Secrets(`CLAUDE_CODE_OAUTH_TOKEN` / `WARROOM_PAT` / `DATABASE_URL`)+ Variables `ENABLE_DAILY_ORGANIZE=true` |
| Vercel 展開時 | 環境変数登録(`DATABASE_URL` / `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` ほか)。手順書 §2 参照 |

## 🧹 細かい積み残し(任意・手が空いたら)

- [ ] `tsconfig.tsbuildinfo`(ビルド副産物・未追跡)を `.gitignore` に追加
- [ ] guard-write hook の `*secrets*` パターン精緻化(`scripts/check-no-secrets.sh` への偽陽性。M0-A 実装時は Bash 経由で回避した)
- [ ] `next.config.mjs` の `eslint` キー削除(Next 16 で非対応の警告が出る・無害)
- [ ] `Dockerfile.dev` に非 root USER を検討(.next が root 所有になり EACCES を起こした事象の恒久対策)
- [ ] アカウント `t.s.0514.0952@gmail.com` の扱い(パスワード失念)— 当面は `笹尾テスト` アカウントを使用。必要なら Neon コンソール → Auth → Users から削除して作り直し(削除時は user_roles の orphan 行も掃除)
- [ ] dev console の script-tag / hydration 警告は SDK(0.4.2-beta)内部のテーマ処理由来・無害(hydration 側は抑止済み)。SDK アップデート時に再確認

## ✅ 完了済み(参考)

- Claude Action のサブスク認証切替(`CLAUDE_CODE_OAUTH_TOKEN` 方式・ワークフロー/docs 更新済み)
- M0 設計(basic / detail、全レンズ PASS。記録: `docs/design/reviews/auth-foundation.md`)
- /goal M0-A: 0001 マイグレーション・check-no-secrets.sh・capture.md v1.1 追随(独立検証 PASS)
- /goal M0-B: Neon Auth 統合(Next 16 化・/login・proxy・二層防御・テスト13件)+ /auth/[pathname] ビュー追加
- 0001 を Neon 本番へ適用(ブランチ検証 → 承認 → 適用 → 検証ブランチ削除)
- Neon Auth 有効確認(6/14 から有効)・`NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` / `NEON_API_KEY` を `.env` に設定済み
- サインアップ2アカウント・両方に admin 付与(ローカル db の user_roles)

## 関連ドキュメント

- セットアップ手順: [`neon-vercel-setup.md`](./neon-vercel-setup.md)
- 要件定義: [`../design/requirements.md`](../design/requirements.md)(§5.1 は M1 設計時に実構造へ更新予定)
- M0 設計: [`../design/basic/auth-foundation.md`](../design/basic/auth-foundation.md) / [`../design/detail/auth-foundation.md`](../design/detail/auth-foundation.md)
- レビュー記録: [`../design/reviews/auth-foundation.md`](../design/reviews/auth-foundation.md)
