# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-07-19 M4(capture + 壁打ち / SC-06)完了** — M4-A(フォーム + INBOX)/ M4-B(壁打ち /api/spar + パネル)/ **M4-FIX**(Neon Auth SDK の POST 欠陥への proxy GET 正規化)/ **SPAR-OV**(トップバー壁打ちボタン活性化・全画面スライドオーバー)/ **CT-1**(INBOX 状態管理: 未処理/処理中/完了 + バッジ連動)すべて judge PASS。
> **M0 / M1 / ui-shell / ui-polish / M2 / md-render / org-docs-ingestion / M3 / M4 完了**(テスト**355件**緑・38ファイル)。
> ローカル db = timeline_records 7,838行 + board_items 59行 + **capture_inbox 稼働**(status 列 = open/in_progress/done・0006 適用済み)。壁打ちは実応答確認済み(SPAR env 設定済み・gpt-4o-mini・文脈 = pgvector 判断 top-3)。
> **本番未適用マイグレーション: 0003 → 0004 → 0005 → 0006**(Vercel 展開時にこの順で人間承認のうえ適用。いずれも Neon ブランチ検証済み)。
> **⚠ 再埋め込み待ち 7,838行**(M3 の --force 同期由来・検索は現行埋め込みで正常稼働・バッチ実行時 ~$0.4 — 「バックフィルして」で実行)。
> **⚠ 既知の SDK 欠陥(記録)**: @neondatabase/auth 0.4.2-beta の middleware は保護パスへの POST を常に 307 にする(get-session へ method 転送)— proxy.ts の GET 正規化ラッパーで回避中。**SDK 更新時はラッパー不要化と CSRF 前提(SameSite=strict)を再評価**。
> **秘密情報は本ファイルに実値を書かない。**
>
> **▶ 次セッションの再開手順**:
> - **🗑 capture INBOX のゴミ箱ボタン(論理削除)** — ユーザー要求(2026-07-19)。INBOX 行にゴミ箱ボタンを付け**論理削除**できるようにする(物理 DELETE は禁止規範のまま — 実現は 0007 で `deleted_at` 列 or status 語彙拡張のどちらか・設計時判断)。論点: 削除行の非表示(listInbox の WHERE)/ バッジ・M5 消費対象からの除外 / 復元 UI の要否 / capture.md 契約更新。**capture-triage と同じ軽量1枚設計 → 3レンズ → 小 goal(例: CT-2)** で1周。
> - その後 **M5(自動整理ループ / Claude Action)設計** — capture 消費(processed_at)と status/論理削除の関係を確定(capture-triage §5・capture.md の申し送り参照)。SC-07 ユーザー管理の配置判断もこの前後。
>
> **2026-07-19 の完了サマリ**: capture-spar 設計(基本 2R + 詳細 2R 全レンズ PASS)→ M4-A/M4-B(judge PASS)→ 実機で SDK の POST 欠陥発見 → M4-FIX(proxy GET 正規化・judge PASS)→ spar-overlay(設計→レビュー→実装・judge PASS)→ capture-triage(設計 2R → CT-1・judge PASS・0006 Neon ブランチ検証済み)。壁打ち・保存・状態トリアージすべて実機確認済み。
>
> **運用メモ**: allowlist 拡張直後の同期は `--force` / `--force` は全量再埋め込みを招く(コスト意識)/ モデル切替時は検索が一時 0件(ガードの過渡状態)/ Vercel 展開時 env: `EMBEDDING_MODEL=text-embedding-3-large` / `EMBEDDING_DIM=1536` / **`SPAR_PROVIDER` / `SPAR_MODEL` / `SPAR_API_KEY`(壁打ち — 3つとも明示必須・未設定時は壁打ちのみ 4xx)** / CRON_SECRET。

---|---|---|
| `daily-digest/` | 94ファイル(日付付き・7〜60KB) | 組織活動の日次サマリ — タイムライン素材そのもの |
| `secretary/learning-notes/` | 約50ファイル(WBS 番号付き・10〜60KB) | ドメイン知識の本体 — ナレッジ検索の主役候補 |
| `decisions/` | 1件 | **組織側の判断ログ**(現状 decision は ai-war-room の12件のみ) |
| `secretary/board.md` / `storcon-preparation-wbs.md` | — | **M3 が必要とする kanban / WBS** |
| `diagrams/` `drawio/` `research/` `retail-domain/` `reports/` `todos/` | 45+ファイル | 図解説・用語集・日報・TODO |

org-docs-ingestion 設計時の必須論点:
1. **機微データの同居**: `secretary/personality-profile-sasao.md`(既存 denylist の profile/personality パターンが捕捉する想定 — **設計で必ず検証**)・`secretary/MEMORY.md` の扱い判断。
2. **チャンク分割**: 見出し単位分割等の設計(冪等キーの item_key 拡張と相性良し)。埋め込み済み 331件との共存・再埋め込み方針。
3. 大容量ファイル(60KB 級)の SYNC_MAX_FILES / EMBED_MAX_ROWS への影響。

## 🔍 ナレッジ検索の既知の仕様(2026-07-18 確認)

- SC-04 の既定フィルタは **type=decision**(設計どおり — 「過去の判断」の再利用が目的)。cc-sier 由来の task/score/quality(317件・埋め込み済み)は**検索対象に含まれるがヒットしない**(データ層 searchKnowledge は type:"all"/個別指定に対応済み・UI が未公開なだけ)。**UI に type 切替チップを足す小改修**はいつでも可能(md-render と同じ軽量設計 → レビュー → 小 goal で1周)。org-docs 取り込みとセットでやると効果的。

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
| **M4**(capture + 壁打ち) | SC-06 実装(capture_inbox 契約 = .claude/rules/capture.md 準拠・user_id 所有・kind 4語彙)。SC-07 ユーザー管理の配置判断もここで |
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
- **M2(検索)完了**(2026-07-17): dual-provider 埋め込み(OpenAI 主・Google 切替可・fail-closed)+ pgvector 近傍検索 + SC-04(M2-A / M2-B judge PASS)。後日 text-embedding-3-large(1536)へ移行(全行再埋め込み済み)
- **md-render / org-docs-ingestion / OD-FIX / OD-DEC 完了**(2026-07-18): 安全 MD レンダラ(GFM 表対応)・組織 docs 取り込み(knowledge 型 8種列挙 + /knowledge type チップ)・recent の type/tag バグ修正・org decision H1 フォールバック(decision 13件)
- **M3(今日ビュー)完了**(2026-07-18): today-view 設計(基本 2R + 詳細 3R 全レンズ PASS)→ M3-A(0005 board_items + parseBoard + board 経路 + lib/data/today.ts)・M3-B(SC-03 画面 + 注記3件)とも judge PASS → 実 WBS 同期(59行・skippedRows 0)。0005 はブランチ検証済み・本番未適用
- **M4(capture + 壁打ち)完了**(2026-07-19): capture-spar 設計(基本 2R + 詳細 2R 全レンズ PASS — 認証二層化・外部送信2系統・fail-closed dispatch)→ M4-A(フォーム + INBOX)・M4-B(lib/spar + /api/spar + パネル)judge PASS。**M4-FIX**: SDK middleware の POST 欠陥(get-session へ method 転送 → 保護パス POST が常に 307)を実機で発見・proxy.ts の GET 正規化ラッパーで回避(judge PASS)
- **spar-overlay 完了**(2026-07-19): トップバー壁打ちボタン活性化・全画面スライドオーバー(SparPanel 再利用・layout ボタン置換のみ・judge PASS)
- **capture-triage(CT-1)完了**(2026-07-19): 0006 status 列(open/in_progress/done)+ INBOX 状態ボタン + バッジ連動(user_id 完全形ピン・UPDATE 単一性ゲート)。capture.md 契約更新済み・0006 ブランチ検証済み・本番未適用

## 関連ドキュメント

- M1 設計: [`../design/basic/ingestion-foundation.md`](../design/basic/ingestion-foundation.md) / [`../design/detail/ingestion-foundation.md`](../design/detail/ingestion-foundation.md)
- 画面設計(UI MoC): [`../design/ui/screen-design.md`](../design/ui/screen-design.md) / MoC 実 HTML: `../design/ui/moc/`
- ui-shell / ui-polish 設計: [`../design/basic/ui-shell.md`](../design/basic/ui-shell.md) / [`../design/detail/ui-shell.md`](../design/detail/ui-shell.md) / [`../design/basic/ui-polish.md`](../design/basic/ui-polish.md)(レビュー記録: reviews/ui-shell.md・reviews/ui-polish.md)
- レビュー記録: [`../design/reviews/ingestion-foundation.md`](../design/reviews/ingestion-foundation.md)
- 調査資料: [`../research/m1-ssot-schema.md`](../research/m1-ssot-schema.md)
- セットアップ手順: [`neon-vercel-setup.md`](./neon-vercel-setup.md) / 要件定義: [`../design/requirements.md`](../design/requirements.md)
