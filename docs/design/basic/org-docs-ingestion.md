# 基本設計: org-docs-ingestion(組織ドキュメントの取り込み + ナレッジ検索の拡張)

> ステータス: **PASS**(design-review Round 2 全レンズ PASS(data は条件付き → rev.3 で条件(retro 内訳)を決着)— reviews/org-docs-ingestion.md 参照。R2 の Low/問いは rev.3 で吸収済み)
> 発端: ユーザー指摘(2026-07-18)— `.companies/<org>/docs/` 配下(daily-digest 94・learning-notes 約50・組織側 decision 等)が未取り込みで「データドリブンに使えるはず」。実地調査の記録 = docs/setup/next-actions.md「📚 発見」。
> **合意済みの方針(2026-07-18 チャット)**: **2系統** — ①組織側の判断(`docs/decisions/`)は **decision 型として合流**(SC-02「最近の判断」+ SC-04 検索の既定に自然に乗る)②digest / learning-notes 等の知識は **knowledge 型(新設)で取り込み、SC-04 に type 切替を追加**して検索対象を広げる。**「判断」の枠は汚さない**。
> 作成: 2026-07-18(主セッション執筆)。Round 1 の決着一覧 = docs/design/reviews/org-docs-ingestion.md

## 1. 目的 / スコープ

### 目的
cc-sier-organization の `.companies/<org>/docs/` 配下(組織の判断・日次ダイジェスト・ドメイン知識)を索引・埋め込みし、
「最近の判断」への合流と、ナレッジ検索での横断検索(type 切替)を実現する。

### やる
1. **取り込み対象(allowlist 拡張・org 横断 = `.companies/<org>/docs/...`)**:
   | パス | type | パーサ方針 |
   |---|---|---|
   | `docs/decisions/*.md` | **decision** | 1ファイル=1レコード(チャンクなし)。**org 帰属 = パス由来の meta.org を設定**(既存 parseDecision は ai-war-room 前提で org:null 固定 — 拡張 or 新パーサは詳細設計。decisionOutcome の org フィルタ精度に直結) |
   | `docs/daily-digest/*.md` | **knowledge** | occurred_at = ファイル名(`YYYY-MM-DD.md`)。**チャンク分割**(§1-2)。**daily_log 型にはしない(rev.2 決着)** — daily_log は ai-war-room 日報(1ファイル=1レコード)専用のまま。粒度の二重化と retro entries(decision+daily_log の無制限描画)へのチャンク氾濫を構造的に回避 |
   | `docs/secretary/learning-notes/*.md` / `docs/research/**/*.md` / `docs/retail-domain/**/*.md` / `docs/diagrams/*.md` / `docs/drawio/*.md` / `docs/info-source-master.md` | **knowledge** | 汎用ナレッジパーサ。**チャンク分割**(§1-2)。occurred_at = frontmatter 日付 or ファイル名日付 → **無ければ null 許容**(§1-5 の契約改訂) |
   - **明示的に対象外**: `secretary/board.md`・`storcon-preparation-wbs.md`・`reports/`・`todos/`(**M3 の領分**)/ `dashboard.html`・`*.yaml`(非 MD)。
   - **機微・内部ファイルの遮断(rev.2 で二重化)**: `personality-profile-*.md` は既存 denylist(`profile`・`personality`)が遮断(現物確認済み)。**`claude.md`・`memory.md`・`agents.md` を denylist に追加し、isDenied を小文字正規化比較に変更して遮断**(rev.2/3 決着 — 再帰 glob(`docs/research/**` 等)配下に実在する CLAUDE.md が allowlist にマッチするため「allowlist 非マッチによる構造的除外」は成立しない。エージェント内部ファイルをパス位置・大文字小文字に依らず遮断する。既存6パターンは全て小文字のため正規化の影響なし。**`CLAUDE.local.md` 等の列挙外変種は防御範囲外** — §2 の手動検分で受容と明記)。受け入れ条件 §5-3 は**危険経路(再帰 glob 配下)への fixture 配置**で機械判定。
2. **チャンク分割(本トピックの中核設計)**: 40〜60KB の文書を 1レコード=1ベクトルに押し込むと検索品質が出ない(M2 の既知制限が本題化)。
   - **分割単位 = 見出し(`##` 以下)ブロック → 上限文字数で再分割**。**チャンク本文上限 = 500字**(rev.2 決着 — 埋め込み入力は buildEmbedInput が `title\ntags\nbody` を連結後に 600字で切詰めるため、title(ファイルタイトル+見出しパス)+ tags の先頭消費 ~100字を見込んで本文 500字とする。title が過長な場合の末尾切詰めは許容 — 見出し直下の本文先頭が検索上最重要という編集判断。buildEmbedInput / EMBED_INPUT_MAX_CHARS は**不変**)。
   - **冪等キー**: 既存の (source, file_path, item_key) をそのまま使用 — **item_key = チャンク連番ベース(詳細設計で確定)**。再同期は同一 item_key への upsert(M1 契約と完全整合・スキーマのキー変更なし)。**キー安定性は同一パーサ版内の契約**(パーサ改版でチャンク境界が変わった場合は全チャンク上書き + 再埋め込みで自己回復 — 冪等 upsert の性質。内容ハッシュ方式は再埋め込みコストを減らさず(synced_at 無条件更新のため)残骸を増やすだけなので不採用 — R1 data の評価どおり)。
   - チャンクの title = ファイルタイトル + 見出しパス。body = チャンク本文。tags は文書レベルで全チャンク共通。
   - **既知の制限**: ファイル縮小時の残骸チャンクは残る(生 DELETE 禁止 — M1 の削除ファイル残置と同クラス。stale 設計は将来トピック・問い#2)。
   - 規模見積: 全体 ≒ 5MB ≒ 2,700〜2,800 チャンク(単価から埋め込み費 ≒ $0.05 未満。pgvector・HNSW とも余裕)。
3. **type 語彙の拡張(0004 マイグレーション)**: `timeline_records.type` の CHECK に **`knowledge` を追加**(制約の付け替えのみ — **データ非破壊**。検証は Neon ブランチ → 本番適用は人間承認。down は knowledge 行存在時に適用不能 — 明示・人間承認のみ)。
4. **被変更側の追随(rev.2 で全列挙 — 凍結例外の明示)**:
   - `lib/ingestion/parsers/types.ts`: RecordType union に knowledge 追加(0002 CHECK との一致コメントも追随)。
   - `lib/data/overview.ts`: recordsByType の **7 type 全列挙 → 8 type**。
   - **`lib/data/review.ts`: ALL_RECORD_TYPES の 7 → 8 列挙**(rev.2 決着 — 同 SELECT は型無フィルタで knowledge 行が流入し、未初期化 counts が **NaN として /retro に表示される**実行時欠陥を防ぐ。R1 の「REWARD_TYPES のみ参照で不変」は事実誤認だった)。週次トレンドの reward/QG 平均は task/score 対象で不変。
   - **`app/(shell)/retro/page.tsx`: 内訳表示のハードコード列挙(BREAKDOWN_TYPES)に knowledge を追加**(rev.3 決着 — totalCount は counts 全和のため、内訳に knowledge が無いと「合計と内訳の乖離」が /retro で発生する(R2 data の検出)。この編入で「内訳で可視」の主張が overview / retro の両方で真になる)。
   - **review.ts の occurred_at null 行の扱い**(knowledge null 許容の波及): SQL 側での除外(`occurred_at IS NOT NULL`)か型の null 許容かを**詳細設計で明示**(現状は JS の暗黙変換で安全に落ちるが型の嘘になる — R2 data Low)。
   - **凍結テストの明示的例外 = tests/overview-data.test.ts と tests/review-data.test.ts**(いずれも**列挙関連 assert のみ**変更 — 差分範囲のピン実行形は詳細設計)。他の凍結テストは不変。
   - **件数 KPI の単位変化(宣言)**: レコード=チャンクとなるため、recordsByType / recordsThisWeek / retro の counts に knowledge チャンク行が計上される(digest は occurred_at = 当日日付のため**当週分のチャンクのみ**が今週件数に入る)。8列挙の内訳表示で単位変化は可視 — 許容と宣言。retro の entries(decision+daily_log)には knowledge は**流入しない**(§1-1 の型決着による構造的保証)。
5. **occurred_at 契約の明示改訂**: M1 パーサ契約「status='ok' は occurred_at 必須」に対し、**knowledge 型のみ null 許容**の例外を設ける(ingestion-foundation への被変更側注記 §5-8)。null 行は時間軸集計(occurred_at 範囲)に現れない — knowledge は時間軸より内容参照が主目的であり許容。**コミット日付 fallback は不採用**(SourceAdapter/ParseMeta の拡張が必要になり「新機構なし」に反する — R1 arch の指摘どおり削除)。
6. **SC-04 の type 切替 UI**: 検索パネルに **type チップ(判断(既定)/ ナレッジ / すべて)** を追加。§1-1 の型決着によりチップは**単一 type 等値**(decision / knowledge / all)で成立 — **searchKnowledge(M2)の IF 変更なし・UI の公開のみ**(rev.2 で真になった主張)。daily_log(ai-war-room 日報2件)は「すべて」でのみヒット。recent(q 空)は decision のまま。
7. **同期・埋め込みの運用整合**: SYNC_MAX_FILES はファイル単位カウント(現物確認)のため対象 ~190ファイルは2周 + 進行カーソルで消化。EMBED_MAX_ROWS=200 で数千チャンクは十数周 — 初回は手動バックフィル(§5-7)。新機構なし。
8. **被変更側注記(主セッション担当・grep ゲート §5-8)**: ingestion-foundation(allowlist 拡張・type 語彙 8種・occurred_at 例外・denylist 追加・**集計契約(counts 全 type)の 8化を含む**)/ search-foundation 詳細 §2.7(SC-04 type チップ)/ ui-shell 詳細 §2.3(overview 8列挙)。
9. **テスト世代管理**: 前 goal 新設テスト(tests/markdown.test.ts + M2 4本)を凍結列挙に編入(§1-4 の2ファイルのみ明示例外)。

### やらない
- board / WBS / reports / todos の取り込み(**M3**)。SC-03 today ビュー(M3)。
- ai-war-room 側の変更・書き戻し経路の変更。conversation-log の取り込み(マスク検証の先行設計が前提 — 従来どおり)。
- 埋め込みモデル・次元・buildEmbedInput・EMBED_INPUT_MAX_CHARS の変更(M2 成果物は凍結のまま — チャンク側で整合 §1-2)。
- チャンクの意味的分割(embedding ベース等 — 見出し + 文字数のみ)。
- 残骸チャンク・削除ファイルの stale 設計(将来トピック)。
- SC-02「最近の判断」・SC-05 retro entries のロジック変更(decision 型の増加は自然合流・knowledge は entries に流入しない構造)。
- daily_log 型の意味変更(ai-war-room 日報専用のまま)。

## 2. アーキテクチャ上の位置づけ

- **Ingestion 層の拡張が主体**(allowlist + denylist 追加 + パーサ + チャンク分割)+ Index/Search(0004・埋め込みは既存バッチ)+ App(SC-04 チップ)+ 集計層の型列挙追随(overview / review)。
- SSoT は引き続き **GitHub API 読み取りのみ**。書き戻しなし。denylist は**取得前(パス列挙段階)に適用**され機微ファイルの内容は取得すらされない(現物確認済みの既存構造)。
- **外部送信の増分(明示)**: 新規取り込みの docs 本文 ≒ 2,800 チャンクが埋め込みプロバイダ(OpenAI)へ送信される。対象は denylist(profile / personality / minefield / **claude.md / memory.md / agents.md(本トピックで追加・小文字正規化比較)** 等)通過後の非機微データのみ。**denylist の恒常防御は列挙パターンに対してのみ**であり、列挙外の名前変種・将来の新機微ファイルは手動検分が防御(下記)。**digest は二次生成物**であり機微ソースの引用可能性をパスベース遮断は検出できない — SSoT 側の digest 生成が機微(profile/minefield)を含めない運用であることを前提とし(conversation-log が「生ログで機微直含み」のため送信保留なのとの差)、**初回実送信前に digest サンプルの目視確認(直近1件 + 無作為2件以上)を手動チェックリストに含める**(§5-7)。
- **将来ファイル・新 org の自動追随(受容の明示)**: 再帰 glob 配下に将来置かれるファイル・`<org>` ワイルドカードによる新 org の docs/ は自動で取り込み対象になる。**denylist(basename バックストップ含む)が恒常防御**であり、新 org 追加はユーザー自身の SSoT 操作なので検分機会がある — 「新 org 追加時は docs 配下を検分」を手動チェックリストに追加して受容。
- 結合キー(時間軸・タグ)は不変(knowledge の occurred_at null は時間軸集計から自然に外れるのみ)。

## 3. データ / インターフェース概要

| 対象 | 概要 |
|---|---|
| 0004 up/down | type CHECK の付け替え(7→8 種)。列・キー・データ不変。down = 逆付け替え(knowledge 行存在時は適用不能 — 明示・人間承認) |
| lib/ingestion/normalize.ts | **DENY_PATTERNS に `claude.md`・`memory.md`・`agents.md` を追加 + isDenied を小文字正規化比較に**(basename バックストップ・変種吸収) |
| lib/ingestion/parsers | チャンク分割純関数(見出し → 500字再分割・決定的)+ knowledge 汎用パーサ(digest 含む)+ 組織 decision の org 帰属(parseDecision 拡張 or 新パーサ — 詳細設計)。types.ts の RecordType 8値化 |
| lib/ingestion/run-sync.ts | allowlist に docs 系パターン追加 |
| lib/data/overview.ts / lib/data/review.ts | 型列挙 7→8(§1-4。review は NaN 防止の必須追随・occurred_at null 行の扱いを詳細設計で明示) |
| app/(shell)/retro/page.tsx | BREAKDOWN_TYPES に knowledge 追加のみ(合計と内訳の乖離防止 — §1-4) |
| tests | overview-data / review-data の**列挙関連 assert のみ**更新(凍結例外)+ 新パーサ・チャンクのテストは新ファイル |
| app/(shell)/knowledge/page.tsx | type チップ(判断/ナレッジ/すべて — 単一 type・GET param は既存 `type` を公開) |
| fixtures | docs 系の匿名 fixture(digest / learning-note / 組織 decision)+ **遮断検証用ダミー(内容 = 無害ダミー・ファイル名のみ機微パターン・実在人名不使用**(例: `personality-profile-demo.md`・`CLAUDE.md`)**・配置 = 再帰 glob 配下の危険経路**(`docs/research/CLAUDE.md` 相当)。※実名 CLAUDE.md fixture は開発時に Claude Code が指示ファイルとして読み得るが内容は無害ダミー1行のため実害なし(認識済みの判断)) |
| env | 変更なし |
| 被変更側注記 | ingestion-foundation / search-foundation 詳細 / ui-shell 詳細(§1-8・grep ゲート §5-8) |

## 4. リスク・トレードオフ

| リスク | 対処 |
|---|---|
| 機微・内部ファイルの誤取り込み | denylist 二重化(既存 profile/personality + **CLAUDE.md/MEMORY.md 追加**)+ 取得前遮断(既存構造)+ **危険経路への fixture 配置による機械判定**(§5-3)。将来ファイル・新 org は §2 の受容宣言 + 手動検分 |
| digest(二次生成物)の機微引用 | §2 の前提宣言 + 初回実送信前の目視(§5-7)。恒常は denylist が backstop |
| /retro の NaN・一覧氾濫 | 構造的決着(review 8列挙 + digest=knowledge 型で entries 非流入 — §1-1/§1-4) |
| 件数 KPI の単位変化(チャンク計上) | 8列挙の内訳で可視・宣言済み(§1-4)。誤解が出たら表示側の調整を別トピックで |
| チャンク境界ずれによる大量再埋め込み | 許容(冪等 + コスト極小)。連番 vs ハッシュの評価は §1-2 に記録 |
| 凍結テスト(overview-data / review-data)の変更 | 例外2ファイルを設計で宣言・変更範囲 = 列挙関連 assert のみ(差分ピンは詳細設計) |
| 0004 down の適用不能(knowledge 行存在時) | 明示 + 人間承認のみ(0001〜0003 と同方式) |
| title 過長時の埋め込み末尾切れ | 許容と宣言(§1-2 — 本文先頭優先の編集判断)。実利用で問題なら別トピック |

## 5. 受け入れ条件(機械判定)

詳細設計で実行形を確定。すべて exit code / 件数 / grep。

1. **0004**: up/down 実在 + up に `'knowledge'` を含む CHECK 付け替え + 破壊 SQL(生 DROP TABLE / TRUNCATE / DELETE FROM)の否定 grep(**DROP CONSTRAINT は対象外** — パターンを詳細設計で guard 非干渉に確定)+ Neon ブランチ検証 exit 0 → 本番適用 ask。
2. **パーサ・チャンク契約**(fixture・実ネットワークなし): 組織 decisions → decision 型 + **org = パス由来**(assert)/ digest → **knowledge** + ファイル名日付 / learning-note → knowledge + チャンク分割(見出し境界・**本文 ≤ 500字**・**同一入力2回 → 同一チャンク列(決定性)**)/ 冪等(2回同期 → 行数不変・更新のみ)/ occurred_at null の knowledge が status='ok' で通る(契約改訂の実効)。
3. **機微遮断**: fixture の**再帰 glob 配下の危険経路**に `CLAUDE.md`・`MEMORY.md`・`personality-profile-demo.md` を配置(内容は無害ダミー・実在人名不使用)→ **取り込み 0 レコードの assert**(denylist skipped 計上の確認を含む — 実行形は詳細設計)。
4. **型追随**: overview の recordsByType 8列挙 + **review.ts の ALL_RECORD_TYPES 8列挙**(grep)+ **retro/page.tsx の内訳列挙に knowledge**(grep — 合計と内訳の乖離防止)+ knowledge 行を含む fixture で retro 集計に **NaN が現れない**(テスト)。**tests/overview-data.test.ts / tests/review-data.test.ts の diff が列挙関連 assert のみ**(差分ピンの実行形は詳細設計)。
5. **検索拡張**: SC-04 に type チップ(grep — 判断/ナレッジ/すべて)+ 検索契約テスト(type=knowledge でチャンクがヒット・similarity/出典付き)+ **既定 = decision のまま**(テスト)+ **searchKnowledge の IF 無変更**(lib/data/knowledge.ts の diff が UI 向け定数追加等の最小限 — 詳細設計でピン。可能なら無差分)。
6. **凍結・退行**: `npm test` exit 0(env -u 形)/ 凍結 diff(§1-4 の例外2テストを除く FROZEN_TESTS + lib/search + components + 他画面 + proxy 等 — 詳細設計で列挙)/ build exit 0 / 実機 未認証 `/knowledge` → 307。
7. **実データ確認(手動チェックリスト — 機械判定外)**: **前提 = §5-3 遮断テスト緑 + OD-A judge PASS**。実行 = Claude(ユーザーの指示で実施)。実同期 → **digest サンプル数件の目視(機微引用なし確認)** → embed-local remaining=0 → /knowledge「ナレッジ」チップで learning-note がヒット・「最近の判断」に組織 decision。新 org 追加時は docs 配下を検分(恒常運用)。
8. **被変更側注記**: `grep -q "org-docs-ingestion" docs/design/detail/ingestion-foundation.md` / 同 `docs/design/detail/search-foundation.md` / 同 `docs/design/detail/ui-shell.md` 各 exit 0(担い手 = 主セッション)。

**適用順序(本番)**: 現在 Vercel 未展開のため実質ローカルのみ(OD-A 内で 0004 をローカル db に適用 — 窓なし)。**Vercel 展開時は「0004 本番適用 → デプロイ」の順序を厳守**(逆順だと cron 同期が CHECK 違反 — next-actions の展開手順に明記)。

**/goal 分割の方向性**(詳細設計で確定): **OD-A「取り込み基盤」**(0004 + denylist + パーサ + チャンク + allowlist + overview/review 追随 + テスト + build)→ **OD-B「検索 UI + 注記 + 実データ」**(type チップ + 注記3件 + §5-7 の手動手順)。

## 6. 未解決の問い

1. **チャンク本文上限 500字の妥当性**(600 − title/tags 消費の見込み)— 詳細設計で title 長の実測をもって最終確定。
2. **残骸チャンク / 削除ファイルの stale 設計** — 将来トピック(M2 からの持ち越しに同種を追加)。
3. **「すべて」チップの表示**(daily_log・task 等もヒットする — 出典表示が type によって粗くならないか)— 詳細設計 or 実利用後の調整。※date フィルタ指定時に無日付 knowledge が全件除外される検索意味論は §1-5 の帰結として既知(R2 data Low-2)。
4. **diagrams / drawio の価値検証**: 図の説明 MD が検索ノイズになるようなら allowlist から外す(実利用後の調整)。
5. **overview の recordsThisWeek 表示名**: チャンク計上で数が膨らんだ場合の KPI ラベル調整(「索引レコード数」等)— 実利用後の調整。

## 次の手順

`/design-review org-docs-ingestion`(再レビュー)→ 全レンズ PASS → `/detailed-design org-docs-ingestion` → 再レビュー → `/goal OD-A` → `/goal OD-B`。
