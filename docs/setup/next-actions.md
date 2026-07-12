# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-07-12 POLISH-A 完了(チャート部品・基盤)**。
> **M0 / M1 / ui-shell(UI-A・UI-B)/ POLISH-A 完了**(すべて acceptance-judge PASS・main 反映済み。テスト140件緑)。
> 実データ同期済み(ローカル db・331件)・0002 本番適用済み。**ダークテーマ + サイドバー + SC-02 概観 + /retro が稼働中**。
> POLISH-A 成果 = lib/ui/chart.ts(純関数)+ components/charts/ 5部品 + SIGNAL_DIRECTION + トークン拡張 + IBM Plex セルフホスト(部品は未使用 — B で画面適用)。
> **秘密情報(接続文字列・トークン・パスワード)は本ファイルに実値を書かない。**
>
> **▶ 次セッションの再開手順**: **`/goal POLISH-B`**(画面適用+注記 — SC-02 リッチ化 / SC-05 チャート / template.tsx / overview.ts tags / 注記2件)。
> 対象設計 = docs/design/detail/ui-polish.md §5(条件6 の inbox ピンは -F 表記に修正済み)。
> その後 M2(検索)の設計へ(**M2 以降は MoC 準拠 + components/charts 再利用が恒久規範**)。

---

## 🔴 最優先(持ち越し・すぐ終わる)

- [ ] **Neon のパスワードをリセットする**(チャット露出分の後始末)
  - Neon コンソール → 対象プロジェクト → **Connect** → **Reset password** → `.env` の `DATABASE_URL` を差し替え(Vercel / GitHub Secrets 登録済みならそちらも)。
- [ ] **M0 手動確認の残り1点**(30秒): ブラウザ F12 → Application → Cookies → `localhost:3000` を全削除 → リロード → `/login` に戻れば M0 の手動確認オールクリア。

## 🟢 M1 仕上げの手動アクション(実装は完了済み)

- [x] `CRON_SECRET` を生成し `.env` に追記済み(2026-07-12・Claude が対応)。**Vercel 展開時に同値を Vercel 環境変数へ登録するのはあなたの操作**
- [x] **初回フル同期(実データ・ローカル db)**: 完了(2026-07-12)。ok 331件(task 155 / score 159 / quality 3 / decision 12 / daily_log 2)+ error 9件(frontmatter 無しの初期 task-log 等・設計どおりレコード化)。github-source 実疎通 OK・denylist 1件遮断・error body の絶対パス残存 0
- [x] **0002 の Neon 本番適用**: 完了(2026-07-12。ブランチ検証全緑 → 承認 → 適用 → 検証ブランチ削除)
- [ ] (任意)**Neon 本番への実データ同期** — 本番の timeline_records はまだ空。Vercel 展開時の Cron に任せるか、ローカルから `DATABASE_URL=<Neon> npx tsx scripts/sync-local.ts` で先行投入(Claude が実施可能)

## 🎨 UI(画面デザイン MoC)対応 — 進行中

- [x] **ui-shell 完了**(2026-07-12): 共通シェル(サイドバー/トップバー/ダークテーマ)+ SC-02 概観(最小版)+ ルート再編(/today /knowledge /retro /capture /admin/users・旧 URL 308)+ ログアウト接続。UI-A/UI-B とも judge PASS
- [x] **POLISH-A 完了**(2026-07-12・judge PASS): 共通チャート部品5本(スパークライン/面グラフ/円形ゲージ/横バー/複合)+ chart.ts 純関数 + SIGNAL_DIRECTION + トークン/keyframes 拡張 + @fontsource セルフホスト(IBM Plex Sans JP/Mono・exact pin・layout import 7本)。テスト140件緑・build 緑
- [ ] **POLISH-B(次の実装)**: SC-02 リッチ化(KPI/スパークライン/gauge+内訳バー)+ SC-05 チャート追加 + layout ドット(ckblink)+ template.tsx + overview.ts tags 追加 + 注記2件(screen-design §7 / ui-shell 基本 §1)。**再開 = `/goal POLISH-B`**
  - 完了後の手動確認: MoC スクリーンショット(sc02/sc05)との目視比較5点(設計 §5 末尾のチェックリスト。実画面のスクリーンショットは repo/PR に保存しない)
- [ ] SC-07 ユーザー管理 UI は M4 前後で(M0 未解決の問い#1 の決着候補)
- 恒久規範(ui-polish 基本設計 §1-7): **M2 以降の新画面は MoC 該当ブロックを意匠規範とし components/charts を再利用** / 前 goal の新設テストは次 goal の凍結列挙に編入

## ⏳ 後続マイルストーンが来たら(今は不要)

| いつ | やること |
|---|---|
| **M2**(検索) | 埋め込みモデル選定(research-spike)→ `EMBEDDING_MODEL` / `EMBEDDING_DIM` / `EMBEDDING_API_KEY` 確定 + check-no-secrets.sh へパターン追随(同一コミット)。conversation-log 取り込みは**マスク検証方針の先行設計が前提**(設計の問い#2) |
| **M5**(自動整理) | `claude setup-token` → GitHub Secrets(`CLAUDE_CODE_OAUTH_TOKEN` / `WARROOM_PAT` / `DATABASE_URL`)+ Variables `ENABLE_DAILY_ORGANIZE=true` |
| Vercel 展開時 | **手順書あり: [`vercel-deploy.md`](./vercel-deploy.md)**(事前条件・環境変数・Cron・初回同期・トラブルシュートまで記載。現時点でデプロイ不要) |

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
- **M1 設計完了**: 基本/詳細とも全レンズ PASS(livelock・削除カーソル停止・サニタイズ迂回を実装前に捕捉)
- **M1 実装完了**(2026-07-12): /goal M1-A(0002+パーサ5本+fixtures)・M1-B(SourceAdapter+run-sync+/api/sync+proxy 統合。冪等/認可は実地再現済み)・M1-C(/review 実スコア集計)— いずれも judge PASS。テスト98件・ビルド緑
- **M1 仕上げ完了**(2026-07-12): CRON_SECRET 生成 / 実データ初回同期(331件)/ 0002 本番適用(ブランチ検証→承認→適用)
- **ui-shell 実装完了**(2026-07-12): 設計2段階 PASS → UI-A(集計/トークン基盤)・UI-B(シェル+画面再編)judge PASS。テスト120件。/knowledge・/retro 開通・実機確認済み
- **ui-polish 基本設計 PASS**(2026-07-12): MoC 実 HTML を MCP で取得(docs/design/ui/moc/)→ 視覚仕様抽出(docs/research/ui-polish-moc-spec.md)→ 3レンズ2ラウンドで PASS。ゲージ内訳は pass/非pass 導出・null 契約・SIGNAL_DIRECTION・judge 0-1 軸・フォントセルフホスト(exact pin)を確定

## 関連ドキュメント

- M1 設計: [`../design/basic/ingestion-foundation.md`](../design/basic/ingestion-foundation.md) / [`../design/detail/ingestion-foundation.md`](../design/detail/ingestion-foundation.md)
- 画面設計(UI MoC): [`../design/ui/screen-design.md`](../design/ui/screen-design.md) / MoC 実 HTML: `../design/ui/moc/`
- ui-shell / ui-polish 設計: [`../design/basic/ui-shell.md`](../design/basic/ui-shell.md) / [`../design/detail/ui-shell.md`](../design/detail/ui-shell.md) / [`../design/basic/ui-polish.md`](../design/basic/ui-polish.md)(レビュー記録: reviews/ui-shell.md・reviews/ui-polish.md)
- レビュー記録: [`../design/reviews/ingestion-foundation.md`](../design/reviews/ingestion-foundation.md)
- 調査資料: [`../research/m1-ssot-schema.md`](../research/m1-ssot-schema.md)
- セットアップ手順: [`neon-vercel-setup.md`](./neon-vercel-setup.md) / 要件定義: [`../design/requirements.md`](../design/requirements.md)
