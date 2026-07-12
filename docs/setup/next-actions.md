# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-07-12 終了時点**。
> **M0 完了**(認証・ユーザー管理土台。本番マイグレーション 0001 適用済み・実機確認済み)。
> **M1(取り込み基盤 + 振り返り)は設計完了**: 基本設計・詳細設計とも design-review 全レンズ PASS
> (記録: docs/design/reviews/ingestion-foundation.md)。**実装は未着手 — /goal M1-A から**。
> **秘密情報(接続文字列・トークン・パスワード)は本ファイルに実値を書かない。**
>
> **▶ 次セッションの再開手順(一本道)**: `/goal M1-A` → `/goal M1-B` → `/goal M1-C`(機能)
> → `/basic-design ui-shell`(意匠 — 画面 MoC 準拠のシェル/概観/ルート再編)。

---

## 🔴 最優先(持ち越し・すぐ終わる)

- [ ] **Neon のパスワードをリセットする**(チャット露出分の後始末)
  - Neon コンソール → 対象プロジェクト → **Connect** → **Reset password** → `.env` の `DATABASE_URL` を差し替え(Vercel / GitHub Secrets 登録済みならそちらも)。
- [ ] **M0 手動確認の残り1点**(30秒): ブラウザ F12 → Application → Cookies → `localhost:3000` を全削除 → リロード → `/login` に戻れば M0 の手動確認オールクリア。

## 🟢 M1 実装(次のセッションの本線)

設計は PASS 済みなのですぐ着手可能。**`/goal M1-A` と入力するだけ**(対象設計 = docs/design/detail/ingestion-foundation.md §5)。

| 順序 | /goal | 内容 | 達成状態(受け入れ条件) | ターン上限 |
|---|---|---|---|---|
| 1 | **M1-A**「スキーマ + パーサ」 | 0002 マイグレーション / パーサ5本 + normalize / fixtures(匿名)/ ルール・要件追随 | 条件 1, 2, 3(パーサ/normalize/tag-vocab 分), 7, 9-A, 11 | 30 |
| 2 | **M1-B**「同期 API + 認証境界統合」 | SourceAdapter / run-sync(進行カーソル)/ /api/sync / proxy 拡張 / sync-local.ts | 条件 4, 5, 8, 9-B + 条件3(run-sync/api-sync/proxy 分) | 30 |
| 3 | **M1-C**「振り返りビュー」 | lib/data/review.ts / app/review 差し替え | 条件 6, 10 + 条件3(review-data 分) | 25 |

各 /goal 完了 = acceptance-judge の独立検証 PASS → main マージ(M0 と同じ流れ)。

### M1 実装後の手動アクション(設計 §5 記載)

- [ ] `CRON_SECRET` を生成(`openssl rand -base64 32`)し `.env` / Vercel に設定
- [ ] 初回フル同期をローカルで実行: `npx tsx scripts/sync-local.ts`(既定 SYNC_MAX_FILES=0)→ `/review` で実データ表示を確認
- [ ] **0002 の Neon 本番適用を承認**(ブランチ検証 → 承認 → 適用。0001 と同じ流れで Claude が実施可能)

## 🎨 UI(画面デザイン MoC)対応 — M1 実装完了後

画面イメージ(7画面 + 壁打ちオーバーレイ)を整理済み: **[docs/design/ui/screen-design.md](../design/ui/screen-design.md)**
(出典 = claude.ai/design「Decision cockpit デザイン MoC」。ギャップ分析 §7 まで記載済み)。

- [ ] **`/basic-design ui-shell`** — サイドバー + トップバー + ダークテーマ(デザイントークン)+ SC-02 概観ダッシュボード + ルート再編(/knowledge・/retro・/today)を独立トピックとして設計 → review → /goal(M1-C は最小のまま先に完了させ、意匠の引き上げを一括で行う)
- [ ] SC-07 ユーザー管理 UI は M4 前後で(M0 未解決の問い#1 の決着候補)
- ⚠️ 実装時の読み替え(screen-design.md §7.2): 4シグナルのラベルは**実データ準拠**(MoC の「効率・Git規律」ではなく 完了率/成果物あり率/過剰編集率/リトライ率)/ judge スケールは 0-1 / M1-C のルートは PASS 済み設計どおり /review

## ⏳ 後続マイルストーンが来たら(今は不要)

| いつ | やること |
|---|---|
| **M2**(検索) | 埋め込みモデル選定(research-spike)→ `EMBEDDING_MODEL` / `EMBEDDING_DIM` / `EMBEDDING_API_KEY` 確定 + check-no-secrets.sh へパターン追随(同一コミット)。conversation-log 取り込みは**マスク検証方針の先行設計が前提**(設計の問い#2) |
| **M5**(自動整理) | `claude setup-token` → GitHub Secrets(`CLAUDE_CODE_OAUTH_TOKEN` / `WARROOM_PAT` / `DATABASE_URL`)+ Variables `ENABLE_DAILY_ORGANIZE=true` |
| Vercel 展開時 | 環境変数登録(`DATABASE_URL` / `NEON_AUTH_*` / `CRON_SECRET` / `GITHUB_TOKEN` ほか)。vercel.json の毎時 Cron は M1-B で定義済みになる |

## 🧹 細かい積み残し(任意)

- [ ] `tsconfig.tsbuildinfo`(ビルド副産物・未追跡)を `.gitignore` に追加
- [ ] guard-write hook の `*secrets*` パターン精緻化(`check-no-secrets.sh` への偽陽性)
- [ ] `next.config.mjs` の `eslint` キー削除(Next 16 非対応の警告・無害)
- [ ] `Dockerfile.dev` に非 root USER を検討(.next の root 所有 EACCES の恒久対策)
- [ ] アカウント `t.s.0514.0952@gmail.com`(パスワード失念)の扱い — 当面 `笹尾テスト` を使用
- [ ] dev console の script-tag 警告は SDK(0.4.2-beta)由来・無害。SDK 更新時に再確認

## ✅ 完了済み(参考・時系列)

- Claude Action のサブスク認証切替(`CLAUDE_CODE_OAUTH_TOKEN` 方式)
- **M0 完了**: 設計2段階(全レンズ PASS)→ /goal M0-A・M0-B(acceptance-judge PASS)→ Neon Auth 実機ログイン確認・admin 付与(2ユーザー)・0001 本番適用
- `GITHUB_TOKEN` 設定・検証済み(認証 5,000回/h・両 SSoT 読み取り OK。スコープはユーザー許容済み)
- SSoT 実スキーマ調査(docs/research/m1-ssot-schema.md — `.companies/<org>/` 構造・frontmatter 不在・複数レコードファイル等を確定)
- **M1 設計完了**: 基本設計(3ラウンド)・詳細設計(3ラウンド)とも全レンズ PASS。レビューが livelock・削除ファイルでのカーソル停止・サニタイズ迂回等を実装前に捕捉(記録: docs/design/reviews/ingestion-foundation.md)

## 関連ドキュメント

- M1 設計: [`../design/basic/ingestion-foundation.md`](../design/basic/ingestion-foundation.md) / [`../design/detail/ingestion-foundation.md`](../design/detail/ingestion-foundation.md)
- 画面設計(UI MoC): [`../design/ui/screen-design.md`](../design/ui/screen-design.md)
- レビュー記録: [`../design/reviews/ingestion-foundation.md`](../design/reviews/ingestion-foundation.md)
- 調査資料: [`../research/m1-ssot-schema.md`](../research/m1-ssot-schema.md)
- セットアップ手順: [`neon-vercel-setup.md`](./neon-vercel-setup.md) / 要件定義: [`../design/requirements.md`](../design/requirements.md)
