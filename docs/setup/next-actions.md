# 次にやること(明日以降のアクション)

> 状態スナップショット: **2026-07-26 TBI-1(/today カンバン操作 + UI モーション)完了** — **M0〜M5 + TCS-1 + FC-1 + TBI-1 完了**
> (vitest **463件**緑・44ファイル + **e2e 6画面 green**)。**Vercel 本番稼働中**。
> M5(organize-loop)は**有効化待ち**(ユーザー操作)。
> **⚠ 2026-07-20 に DB 全消失事故が発生し復旧済み**(詳細は下記「2026-07-20 の事故と再発防止」)。
> ローカル db(復旧後)= timeline_records **8,013行**(ok・error 9)/ board_items 59行 / **埋め込み 8,013行(完了)** /
> タグ 564行 / **capture_inbox 0行(事故で消失・復元不能)** / admin ロール2ユーザー再付与済み。
> **本番マイグレーション: 0001〜0008 まで全適用済み**(0003→0008 は 2026-07-25 に人間承認のうえ適用・構造検証済み —
> embedding vector(1536)/ HNSW / board_items / capture status・deleted_at / consume_idx)。本番データはまだ0行。
> **⚠ 既知の SDK 欠陥(記録)**: @neondatabase/auth 0.4.2-beta の middleware は保護パスへの POST を常に 307 にする —
> proxy.ts の GET 正規化ラッパーで回避中。**SDK 更新時はラッパー不要化と CSRF 前提(SameSite=strict)を再評価**。
> **概観の「今週」KPI が空なのは正常**(週の切り替わり — 組織側 score/quality の最新が先週分。新しい記録が入れば埋まる)。
> **秘密情報は本ファイルに実値を書かない。**
>
> **▶ 次セッションの再開手順**(どれから始めてもよい):
> 0. ~~🐛 /today カンバンでカードを掴んで動かせない~~ → **解決(2026-07-26 診断・機能は正常)**。
>    **根本原因 = capture_inbox が0行**(07-20 事故の消失後、メモ未再投入)で、掴めるカード(capture 由来)が
>    1枚も存在しなかった。WBS カードは仕様どおり読み取り専用。**実ブラウザの一気通貫診断で全5ステップ PASS**
>    (メモ作成 → カード表示 → ボタン移動 → **D&D 移動** → ゴミ箱)。再発防止 = capture カード0件時に
>    /today へ案内を表示する UX 修正(fix/today-empty-capture-hint — **main から分岐**・463テスト + e2e 6画面 green)。
>    **使い方**: /capture で「次の一手」か「課題」を保存 → /today でそのカードをボタン / D&D で動かせます。
> 1. ~~🔧 コールドスタートのタグ空問題の恒久修正~~ → **完了(2026-07-25 TCS-1・judge PASS)**。
>    masters 優先パーティション + mergeTagVocab のラン内マージで**初回同期からタグが付く**(設計
>    docs/design/basic/tag-cold-start.md・3レンズ一発 PASS)。tsc の「2件エラー」は**幻**(古い
>    tsconfig.tsbuildinfo が原因)と判明 — .gitignore 追加 + sync-local.ts の `export {};` で再発防止。
> 2. ~~🚀 Vercel 展開~~ → **完了(2026-07-25)**: マイグレーション 0003→0008 適用 / Vercel Import + env 登録 + Deploy
>    (cron は Hobby 制限で**日1回 JST 06:00** — `vercel.json` 変更済み)/ 初回同期 **8,283行**(タグ587行が
>    **1回で付与 = TCS-1 本番実証**・error 9 は既知)/ 埋め込みバックフィル **8,283/8,283・失敗0**(~$0.4)/
>    admin 2ユーザー付与。**env のキー名注意: 埋め込みは `EMBEDDING_API_KEY`**(OPENAI_API_KEY ではない — 手順書修正済み)。
>    **🔴 残り1点: Neon パスワードリセット(必須)** — 2026-07-25 の作業中に接続文字列がチャットへ再露出。
>    リセット → `.env` 更新(ユーザーのみ)→ **Vercel の `DATABASE_URL` も差し替え + Redeploy** の3点セットで完了。
> 3. **🤖 整理ループの有効化**(展開後): 下記「整理ループの有効化」の7項目(organize_bot 作成 → Secrets 4本 →
>    Variables → branch protection → 0行 skip 確認 → 実データ確認 → 復旧手順の把握)。
> 4. ~~🎨 ステップ2: today-board-interactive~~ → **完了(2026-07-26 TBI-1・judge 判定済み)**。詳細は完了済みリスト参照。
>    - 案1第1弾: /today にカンバン(カード = **capture の next_move / issue**・CT-1 の status を
>      レーンにマップ・D&D で status 更新 = 既存契約のまま衝突ゼロ。WBS カードは読み取り専用チップ)。
>    - 案3: チャート・数値のモーション(CSS/SVG ネイティブ・ライブラリ追加なし・prefers-reduced-motion 尊重・
>      front-check の e2e が安全網)。
>    - 将来弾(別設計): 第2弾 = WBS カードのオーバーレイ移動(cockpit 側差分・SSoT 不変)/
>      第3弾 = organize-loop の PR 書き戻しで WBS へ還流(許可パス拡張 = 契約改定・「todos の還流」と同枠)。
> 5. **🤖 AI 動的フロント(案2・保留 — 狙いの確認待ち)**: 「実行時に AI がフロントのコードを書き換える」形は
>    **不採用**(設計→レビュー→judge の統治が効かない / front-check の前提が崩れる / LLM 生成コード実行は
>    XSS 級の攻撃面 / SPAR の封じ込め(env 固定・fail-closed・コスト上限)が崩壊)。安全な代替3形のどれが
>    狙いに近いかユーザーに確認してから設計する:
>    (a) レイアウト設定の DB 化(ウィジェット並び替え・表示切替 — SDK 不要の決定的カスタマイズ)
>    (b) 開発ループでの AI 改善(現行の Claude Code フローそのもの)
>    (c) **AI がパラメータのみ操作する SPAR 拡張**(生成物はコードではなく検索条件・期間・タグ等に限定 —
>        SPAR と同じ封じ込めで安全。3案の中では最有力)
> 6. **M6 候補**(organize-loop §4-R の受容項目から): provenance の索引化 / タグ付与の床 / todos の還流(allowlist 追加) /
>    整理ループの head-of-line 監視。**SC-07 ユーザー管理**の配置判断もこの前後。
>
> **2026-07-20 の完了サマリ**: capture-trash(CT-2)→ **organize-loop 設計(基本3R + 詳細8R の全レンズ PASS** — livelock・
> 時間軸汚染・PAT 流出経路・スクリプト改ざん経路などを実装前に構造で除去)→ **M5-A**(0008 + 消費スクリプト5本 +
> frontmatter 剥離とパーサ拡張で**還流を実際に閉じた**)→ **M5-B**(3-job 分離 workflow + プロンプト + 契約4ファイル改定)。
> 途中で DB 全消失事故が発生し、**復旧 + 再発防止(guard hook + ルール + runbook)まで完了**。
>
> **2026-07-25 の完了サマリ**: **TCS-1(tag-cold-start)** — 軽量1枚設計 → 3レンズ**一発 PASS** → 実装 → judge 全条件 PASS。
> masters 優先の安定パーティション + `mergeTagVocab` ラン内マージ(凍結例外1件の反転 + 新規テスト5件)。
> 副産物: tsc「2件エラー」は tsconfig.tsbuildinfo の幻と判明(.gitignore + `export {};` で再発防止)/
> **app コンテナに git が無い**ため `npm test` 条件は**ホスト実行が正**(check-no-secrets が動かない — 設計 §5-1 に注記)。
>
> **運用メモ**: allowlist 拡張直後の同期は `--force` / `--force` は全量再埋め込みを招く(コスト意識)/
> **空 DB からの初回同期も1回でタグが付く(TCS-1 恒久修正済み・部分復元状態のみ対処 B)** / モデル切替時は検索が一時 0件(ガードの過渡状態)/
> **DB ボリュームの破棄は禁止**(guard-bash.sh で遮断・復旧は [`db-recovery.md`](./db-recovery.md))/
> **UI を触った後は `npm run e2e`**(5画面のフロント整合性チェック・state 失効時は `npm run e2e:auth` を再実行)/
> Vercel 展開時 env: `EMBEDDING_MODEL=text-embedding-3-large` / `EMBEDDING_DIM=1536` /
> `SPAR_PROVIDER` / `SPAR_MODEL` / `SPAR_API_KEY` / `CRON_SECRET`。

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

## ⚠️ 2026-07-20 の事故と再発防止(記録)

**事象**: ローカル DB のボリュームが作り直され(`docker compose down -v` 相当)、**全テーブルが消失**。
M5-A の executor 稼働中に発生。

**復旧結果**(docs/setup/db-recovery.md の手順で実施):
- 復旧: スキーマ(0001〜0008)/ timeline_records **8,013行**(ok・error 9)/ board_items 59行 / タグ 564行 /
  埋め込み 8,013行(バックフィル ~$0.4)/ admin ロール2ユーザー
- **復元不能**: `capture_inbox`(UI 入力のメモ・課題・壁打ち結論)— SSoT に無いため消失

**再発防止(実装済み)**:
1. `.claude/hooks/guard-bash.sh` に**ボリューム破棄コマンドの遮断**を追加
   (`docker compose down -v` / `--volumes` / `docker volume rm|prune` / `docker system prune` / `cockpit-db-data` の削除)。
   12ケースで動作検証済み(禁止形6件 BLOCKED・正常形6件 allowed)。
2. `CLAUDE.md` 黄金ルール6 と `.claude/rules/db.md` に禁止と**復旧義務**を明記。
3. **復旧 runbook を新設**: [`db-recovery.md`](./db-recovery.md)(実際に復旧できた手順をそのまま収録)。

**あわせて判明した既存バグ → 2026-07-25 に両方決着(TCS-1)**:
- **コールドスタートでタグが空になる** → **恒久修正済み**。masters を優先処理する安定パーティション +
  `mergeTagVocab` によるラン内語彙マージ(lib/ingestion/run-sync.ts / tag-vocab.ts)。凍結例外1件(旧契約
  ピンの反転)+ 新規テスト5件(ユニット3・コールドスタート契約・クロス adapter 契約)。設計 =
  docs/design/basic/tag-cold-start.md(3レンズ一発 PASS)。**「同期を2回」回避策は不要になった**
  (部分復元状態のみ db-recovery.md 手順3 の対処 B が残る)。
- `npx tsc --noEmit` の2件エラー → **幻エラーと判明**(実体は古い `tsconfig.tsbuildinfo` が削除済みの一時
  スクリプトを参照し続けていたもの。キャッシュ削除で exit 0)。再発防止: `.gitignore` に tsbuildinfo 追加 +
  `scripts/sync-local.ts` をモジュールスコープ化(`export {};`)。

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
| **M5**(自動整理・**実装完了 2026-07-20**) | 有効化手順は下記「🤖 整理ループの有効化」を参照 |
| Vercel 展開時 | **手順書あり: [`vercel-deploy.md`](./vercel-deploy.md)**(事前条件・環境変数・Cron・初回同期・トラブルシュートまで記載。現時点でデプロイ不要) |

## 🤖 整理ループ(M5 organize-loop)の有効化 — あなたの操作

**実装は完了済み**(M5-A / M5-B・judge PASS)。以下はすべて**ユーザー操作**で、Vercel 展開(本番 DB に capture が入る)後に実施する。
それまでは workflow_dispatch で手動実行しても **0行 green skip** で安全。

1. **専用 DB ロールの作成**: `docs/setup/organize-role.sql` を Neon 本番で実行(パスワードは Neon 側で設定)。
   作成後、**capture_inbox 以外に到達できないこと**を確認(被害上限 = 3列 UPDATE の前提)。
2. **GitHub Secrets**(repo Settings → Secrets):
   - `CLAUDE_CODE_OAUTH_TOKEN`(ローカルで `claude setup-token`)
   - `DATABASE_URL` — **organize_bot の接続文字列**(所有者ロールではない)
   - `WARROOM_PAT`(ai-war-room 用: contents:write + pull_requests:write のみ)
   - `ORGREPO_PAT`(cc-sier-organization 用: 同上)— **どちらも admin 権限・マージ権を与えない**
3. **GitHub Variables**: `ENABLE_DAILY_ORGANIZE=true`(+ 任意で `ORGANIZE_ALLOWED_ORGS`。既定 `domain-tech-collection`)
4. **両 repo の branch protection**: main へのレビュー必須 / force push 無効 / ブランチ削除保護 / **PAT に自分の PR をマージさせない**
5. **手動実行で確認**: workflow_dispatch → 0行なら generate/publish がスキップされ green。
6. **実データでの確認**(展開後): 両 repo に PR が立つ / frontmatter と H1 が正しい / mark で INBOX が「完了・整理済み」になる /
   **次回同期で ok 行として還流**(error 行が増えない)/ **morning スロットの生成日付が JST 当日**(設計 §4 条件8)。
7. 詰まった場合の復旧: PR をクローズ + `organize/<date>-<slot>` ブランチを削除して再実行(マージ済みなら次スロットを待つ)。

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
- **capture-trash(CT-2)完了**(2026-07-20): 0007 deleted_at 論理削除 + ゴミ箱ボタン + `?trash=1` 一覧 + 復元(InboxRow 不変 + TrashRow 専用型で凍結例外ゼロ・UPDATE 3本ゲート・全5 SQL 面 user_id 二重ゲート)。capture.md 契約更新済み・0007 ブランチ検証済み・本番未適用
- **M5(自動整理ループ / organize-loop)完了**(2026-07-20): 設計は**基本3R + 詳細8R の全レンズ PASS**(3-job 分離・決定的ファイル名で livelock 除去・state/run.json アンカー・organize_bot で被害上限を3列 UPDATE に封じ込め)。M5-A(0008 + scripts/organize 5本 + frontmatter 剥離 + パーサ拡張 = 還流の成立)・M5-B(workflow 全面改修 + プロンプト + 契約4ファイル)とも judge PASS。**有効化はユーザー操作**(下記「整理ループの有効化」)
- **TCS-1(tag-cold-start)完了**(2026-07-25): コールドスタート時に全行 tags 空になる既存バグの恒久修正。
  run-sync の masters 優先パーティション + `mergeTagVocab` ラン内マージ(repo 横断で語彙が効く)。
  本番初回同期は**1回でタグが付く**ようになり「2回走らせる」回避策は廃止(部分復元状態のみ db-recovery.md 対処 B)。
  設計 = docs/design/basic/tag-cold-start.md(3レンズ一発 PASS)・judge 7条件 + 追加確認4点 PASS
- **FC-1(front-check: Playwright フロント整合性チェック)完了**(2026-07-25): 目視 OK 禁止をフロント表示に拡張。
  `npm run e2e` = 5画面の console error / 横はみ出し / **SVG テキスト重なり**を機械判定(chromium・キャプチャ全 off・
  localhost 固定・`npm test` とは完全分離)。認証は `npm run e2e:auth` の手動ログイン1回(state は gitignore)。
  **fail→fix→pass を実証**: 重なり4件(折れ線の目盛り×Xラベル3画面 + ゲージ中央×キャプション)と
  横はみ出し2件(1fr グリッドの min-content 押し広げ + nowrap テーブル)を検出→修正→全 green
  (証跡 = e2e/evidence-fc1.md)。設計 = front-check(3レンズ 2R PASS・実装中の発見3件は §8 で設計改訂)
- **TBI-1(today-board-interactive: /today カンバン操作 + UI モーション)完了**(2026-07-26):
  /today に capture カード(next_move/issue)が合流し、**ボタン + ネイティブ D&D で status 移動**
  (書き込みは既存 own-row Action 1本に収斂・UPDATE 3本不変・dataTransfer は id のみ)。WBS カードは読み取り専用のまま。
  モーション = 折れ線/弧の描画アニメ(pathLength 方式)+ バー伸長 + カード入場 + **数値カウントアップ**
  (全て CSS/rAF ネイティブ・依存追加ゼロ・prefers-reduced-motion 尊重・総時間 ≤450ms で e2e 静定内)。
  e2e は 6画面に拡大(/today 追加・"/" の誤名 "today"→"overview" 修正)。463テスト + e2e 6 green。
  設計 = today-board-interactive(3レンズ 2R PASS — sec の dataTransfer 指摘を含む13点反映)。
  **反省の記録**: 実装途中、settings 修正ブランチを goal ブランチから切って main へマージし、**TBI 途中状態が
  main に早期着地**(force push 禁止のため巻き戻さず、検証済みの最終状態で上書き決着。以後「修正ブランチは
  必ず main から切る」)。

## 関連ドキュメント

- M1 設計: [`../design/basic/ingestion-foundation.md`](../design/basic/ingestion-foundation.md) / [`../design/detail/ingestion-foundation.md`](../design/detail/ingestion-foundation.md)
- 画面設計(UI MoC): [`../design/ui/screen-design.md`](../design/ui/screen-design.md) / MoC 実 HTML: `../design/ui/moc/`
- ui-shell / ui-polish 設計: [`../design/basic/ui-shell.md`](../design/basic/ui-shell.md) / [`../design/detail/ui-shell.md`](../design/detail/ui-shell.md) / [`../design/basic/ui-polish.md`](../design/basic/ui-polish.md)(レビュー記録: reviews/ui-shell.md・reviews/ui-polish.md)
- レビュー記録: [`../design/reviews/ingestion-foundation.md`](../design/reviews/ingestion-foundation.md)
- 調査資料: [`../research/m1-ssot-schema.md`](../research/m1-ssot-schema.md)
- セットアップ手順: [`neon-vercel-setup.md`](./neon-vercel-setup.md) / 要件定義: [`../design/requirements.md`](../design/requirements.md)
