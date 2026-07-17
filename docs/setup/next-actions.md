# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-07-18 M2(検索)+ md-render 完了**(M2-A / M2-B / MD-1 すべて judge PASS・main 反映済み。テスト235件緑)。
> **M0 / M1 / ui-shell / ui-polish / M2 / md-render 完了**。SC-04 ナレッジ検索が MoC 準拠で稼働(pgvector 類似検索・判断後6週チャート・**判断ログ本文の Markdown 描画(テーブル対応込み)**)。
> 埋め込み = OpenAI text-embedding-3-small(1536)・不調時は Google gemini-embedding-001 へ env 2変数の変更のみで切替可(設計済み)。**0003 マイグレーションは Neon ブランチ検証済み・本番は未適用**(ローカル db は適用済み)。
> **秘密情報(接続文字列・トークン・パスワード)は本ファイルに実値を書かない。**
>
> **▶ 次にやること**:
> 1. **(あなたの操作)OpenAI API キー発行** — **project key(sk-proj- 形式)・embeddings 限定の restricted key** で発行し、`.env` の `EMBEDDING_API_KEY` にあなたが直接記入(**チャットに貼らない**)。`EMBEDDING_MODEL=text-embedding-3-small` / `EMBEDDING_DIM=1536` / `EMBED_MAX_ROWS=200` も .env.example から写す。
> 2. **(Claude が実施可)ローカル初回バックフィル** — `scripts/embed-local.ts` で全331件を埋め込み(コスト実質ゼロ)→ /knowledge で日本語クエリの体感確認(不足なら 3-large / gemini 切替を判断)。
> 3. その後: **M3(今日ビュー / SC-03・kanban)設計**へ(`/basic-design` から。MoC 準拠 + components/charts 再利用の恒久規範・前 goal 新設テスト(markdown / M2 4本)を凍結編入)。
> 4. Vercel 展開時: 0003 本番適用(人間承認)+ 本番実データ同期 + 本番バックフィル。

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
- [x] **POLISH-B 完了**(2026-07-12・judge PASS): SC-02 リッチ化(KPI Mono+差分 pill+スパークライン/横断タイムライン/gauge+内訳バー/判断ログ行カード+タグ pill)+ SC-05 チャート(judge 3軸 0-1・報酬×QG 複合・4シグナル横バー granularity 連動)+ ckblink ドット + ckfade template + overview.ts tags + 注記2件。実機 307 確認済み
- [ ] **ui-polish の手動確認(あなたの操作・機械判定外)**: ログインして `/`(概観)と `/retro` を MoC(docs/design/ui/moc/decision-cockpit.dc.html をブラウザで開く)と目視比較 — 基本設計 §5 末尾のチェックリスト5点。違和感があれば次セッションで微調整(実画面のスクリーンショットは repo/PR に保存しない)
  - 目視時の観点(実装時の裁量判断 — MoC に厳密な指定がなく executor が決めた点。気になれば微調整対象):
    1. 差分 pill = MoC どおり「プラスのみ緑(14% アルファ)・ゼロ/マイナス/null はミュート色」(赤にしていない)
    2. KPI 数値・スパークラインの色 = スコアレベル連動(good/warn/bad)。横断タイムラインの凡例色は系列固定(reward=good 緑 / QG=accent)
    3. 品質ゲート内訳バー = pass が `--good` / 非 pass が `--bad`
    4. 記録件数・未処理キャプチャの KPI カードには差分 pill もスパークラインも無し(元データに差分/系列が無いため — 設計どおり)
    5. 14% アルファ表現は `color-mix(in oklch, var(--…) 14%, transparent)`(トークン由来を維持・oklch 直書きなし)
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
