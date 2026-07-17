# 基本設計: org-docs-ingestion(組織ドキュメントの取り込み + ナレッジ検索の拡張)

> ステータス: draft(design-review 待ち)
> 発端: ユーザー指摘(2026-07-18)— `.companies/<org>/docs/` 配下(daily-digest 94・learning-notes 約50・組織側 decision 等)が未取り込みで「データドリブンに使えるはず」。実地調査の記録 = docs/setup/next-actions.md「📚 発見」。
> **合意済みの方針(2026-07-18 チャット)**: **2系統** — ①組織側の判断(`docs/decisions/`)は **decision 型として合流**(SC-02「最近の判断」+ SC-04 検索の既定に自然に乗る)②digest / learning-notes 等の知識は **別型で取り込み、SC-04 に type 切替を追加**して検索対象を広げる。**「判断」の枠は汚さない**(94件の digest が判断一覧を埋めない)。
> 作成: 2026-07-18(主セッション執筆)

## 1. 目的 / スコープ

### 目的
cc-sier-organization の `.companies/<org>/docs/` 配下(組織の判断・日次ダイジェスト・ドメイン知識)を索引・埋め込みし、
「最近の判断」への合流と、ナレッジ検索での横断検索(type 切替)を実現する。

### やる
1. **取り込み対象(allowlist 拡張・org 横断 = `.companies/<org>/docs/...`)**:
   | パス | type | パーサ方針 |
   |---|---|---|
   | `docs/decisions/*.md` | **decision** | ai-war-room の decision パーサ契約に整合(frontmatter 差異は詳細設計で吸収)。1ファイル=1レコード |
   | `docs/daily-digest/*.md` | **daily_log** | 日付 = ファイル名(`YYYY-MM-DD.md`)。**チャンク分割**(§1-2) |
   | `docs/secretary/learning-notes/*.md` / `docs/research/**/*.md` / `docs/retail-domain/**/*.md` / `docs/diagrams/*.md` / `docs/drawio/*.md` / `docs/info-source-master.md` | **knowledge(新型)** | 汎用ナレッジパーサ。**チャンク分割**(§1-2)。occurred_at = frontmatter の日付 or コミット日付(詳細設計で確定) |
   - **明示的に対象外**: `secretary/board.md`・`storcon-preparation-wbs.md`・`reports/`・`todos/`(**M3 の領分** — kanban/タスク文脈の構造化パースが必要)/ `CLAUDE.md`・`MEMORY.md`(エージェント内部ファイル — allowlist パターンに含めないことで構造的除外)/ `dashboard.html`・`*.yaml`(非 MD)/ **`personality-profile-sasao.md` 等の機微(既存 denylist の `profile`・`personality` パターンが遮断 — 現物確認済み・受け入れ条件で機械判定)**。
2. **チャンク分割(本トピックの中核設計)**: 40〜60KB の文書を 1レコード=1ベクトルに押し込むと検索品質が出ない(M2 の既知制限が本題化)。
   - **分割単位 = 見出し(`##` 以下)ブロック → 上限文字数で再分割**。**チャンク上限 ≒ EMBED_INPUT_MAX_CHARS(600字)に整合させる**(1チャンクが切詰めなしで丸ごと埋め込まれる — 問い#1 で 600 か 800+truncate かを確定)。
   - **冪等キー**: 既存の (source, file_path, item_key) をそのまま使用 — **item_key = チャンク識別子(連番ベース・詳細設計で確定)**。再同期は同一 item_key への upsert(M1 契約と完全整合・スキーマのキー変更なし)。
   - チャンクの title = ファイルタイトル + 見出しパス(出典の可読性)。body = チャンク本文。tags は文書レベルで付与し全チャンク共通。
   - **既知の制限**: ファイルが縮んでチャンク数が減った場合、余った旧チャンク行は残る(生 DELETE 禁止 — M1 の削除ファイル残置と同クラス。stale 設計は将来トピック・問い#2)。
   - 規模見積: 全体 ≒ 5MB / 600字 ≒ **数千チャンク**(pgvector・コストとも問題なし。埋め込み費 ≒ $0.05 未満)。
3. **type 語彙の拡張(0004 マイグレーション)**: `timeline_records.type` の CHECK に **`knowledge` を追加**(制約の付け替えのみ — **データ非破壊**。検証は Neon ブランチ → 本番適用は人間承認)。
4. **被変更側の追随(凍結例外の明示)**: `lib/data/overview.ts` の recordsByType **7 type 全列挙 → 8 type**(knowledge 追加)。これに伴い **tests/overview-data.test.ts の該当 assert を更新する — 凍結テストの明示的例外**(理由 = 型語彙の拡張は列挙 assert と不可分。変更範囲は列挙関連 assert のみと詳細設計でピン)。retro(lib/data/review.ts)は REWARD_TYPES(task/score)のみ参照で**不変**。
5. **SC-04 の type 切替 UI**: 検索パネルに **type チップ(判断(既定)/ ナレッジ / すべて)** を追加。データ層 searchKnowledge は対応済み(M2 の `type` param)— **UI の公開のみ**。`knowledge` チップは knowledge + daily_log を対象(問い#3 で確定)。recent(q 空)は decision のまま。
6. **同期・埋め込みの運用整合**: SYNC_MAX_FILES / EMBED_MAX_ROWS の既定で数千チャンクを複数周回で消化できることを確認(進行カーソル・冪等の既存機構に乗る — 新機構なし)。初回は手動バックフィル(sync-local → embed-local)。
7. **テスト世代管理**: 前 goal 新設テスト(tests/markdown.test.ts + M2 4本)を凍結列挙に編入(overview-data.test.ts のみ §1-4 の明示例外)。

### やらない
- board / WBS / reports / todos の取り込み(**M3**)。SC-03 today ビュー(M3)。
- ai-war-room 側の変更・書き戻し経路の変更。conversation-log の取り込み(マスク検証の先行設計が前提 — 従来どおり)。
- 埋め込みモデル・次元の変更。チャンクの意味的分割(embedding ベースの分割等 — 見出し + 文字数のみ)。
- 残骸チャンク・削除ファイルの stale 設計(将来トピック — §1-2)。
- SC-02「最近の判断」のロジック変更(decision 型の増加で自然に組織判断が混ざる — それが合意した挙動)。

## 2. アーキテクチャ上の位置づけ

- **Ingestion 層の拡張が主体**(allowlist + パーサ2〜3種 + チャンク分割)+ Index/Search(0004・埋め込みは既存バッチに乗るだけ)+ App(SC-04 の type チップのみ)。
- SSoT は引き続き **GitHub API 読み取りのみ**。書き戻しなし。
- **外部送信の増分(明示)**: 新たに取り込む docs 本文(数千チャンク)が埋め込みプロバイダ(OpenAI)へ送信される。対象は denylist 通過済みの非機微データのみ(personality-profile / MEMORY.md / CLAUDE.md は §1-1 で構造的除外)。
- 結合キー(時間軸・タグ)は不変。digest は日付で SC-05/SC-02 の時間軸と自然に揃う。

## 3. データ / インターフェース概要

| 対象 | 概要 |
|---|---|
| 0004 up/down | type CHECK の付け替え(7→8 種)。列・キー・データ不変。down = 逆付け替え(knowledge 行が存在する場合の down は適用不能 — 設計に明示・人間承認) |
| lib/ingestion/normalize or parsers | チャンク分割純関数(見出し → 上限分割・決定的)+ daily-digest パーサ + knowledge 汎用パーサ + decisions パーサ(既存 decision 契約へ整合)。allowlist に docs 系パターン追加(run-sync) |
| lib/data/overview.ts | RECORD_TYPES 8列挙化(+ tests/overview-data.test.ts の列挙 assert 更新 — §1-4 凍結例外) |
| app/(shell)/knowledge/page.tsx | type チップ(判断/ナレッジ/すべて)— GET param は既存 `type` を公開 |
| fixtures | docs 系の匿名 fixture 追加(digest / learning-note / 組織 decision / 機微ダミー(遮断検証用)) |
| env | 変更なし(SYNC_MAX_FILES / EMBED_MAX_ROWS は既存) |

## 4. リスク・トレードオフ

| リスク | 対処 |
|---|---|
| チャンク数の増加(数千行) | pgvector・コストとも余裕(規模見積 §1-2)。SYNC_MAX_FILES の周回で前進(既存カーソル機構) |
| ファイル更新でチャンク境界がずれ、大量再埋め込み | 許容(冪等 upsert + 埋め込み増分。コスト極小)。縮小時の残骸は既知の制限(§1-2) |
| 機微データの誤取り込み | denylist(profile/personality)は現物確認済み + **fixture による遮断の機械判定**(§5-3)。allowlist は明示パターンのみ(CLAUDE.md/MEMORY.md は構造的に対象外) |
| 凍結テスト(overview-data)の変更 | 例外を設計で宣言し変更範囲を列挙 assert のみにピン(§1-4)。他の凍結テストは不変 |
| 「判断」一覧の汚染 | 起きない構造(digest/knowledge は decision 型にしない — 合意方針。§1 冒頭) |
| 0004 の down が knowledge 行存在時に適用不能 | 設計に明示・down は人間承認のみ(0001〜0003 と同方式) |

## 5. 受け入れ条件(機械判定)

詳細設計で実行形を確定。すべて exit code / 件数 / grep。

1. **0004**: up/down 実在 + up に `'knowledge'` を含む CHECK 付け替え + 破壊 SQL(生 DROP TABLE/TRUNCATE/DELETE)の否定 grep(制約付け替えの ALTER は可 — 実行形は詳細設計で guard 非干渉に確定)+ Neon ブランチ検証 exit 0 → 本番適用 ask。
2. **パーサ・チャンク契約**(fixture・実ネットワークなし): decisions → decision 型 / digest → daily_log + ファイル名日付 / learning-note → knowledge + チャンク分割(見出し境界・上限字数・**チャンク item_key の決定性(同一入力2回 → 同一キー列)**)/ 冪等(2回同期 → 行数不変・更新のみ)。
3. **機微遮断**: fixture に `personality-profile-*.md`・`MEMORY.md`・`CLAUDE.md` 相当を配置 → 取り込み **0 件**(denylist / allowlist 非マッチの件数 assert)。
4. **型追随**: overview の recordsByType が 8 type 列挙(grep + テスト)。**tests/overview-data.test.ts の diff が列挙関連 assert のみ**(詳細設計で差分範囲をピン)。lib/data/review.ts は無差分。
5. **検索拡張**: SC-04 に type チップ(grep)+ 検索契約テスト(type=knowledge でチャンクがヒット・similarity/出典付き — M2 の契約を継承)。既定は decision のまま(grep or テスト)。
6. **凍結・退行**: `npm test` exit 0 / 凍結 diff(overview-data.test.ts を除く FROZEN_TESTS + M2/MD-1 成果物のうち本トピック可変範囲外)/ build exit 0 / 実機 未認証 `/knowledge` → 307。
7. **実データ確認(手動チェックリスト)**: 実同期 → embed-local remaining=0 → /knowledge の「ナレッジ」チップで learning-note がヒット・「最近の判断」に組織 decision が現れる。

**/goal 分割の方向性**(詳細設計で確定): **OD-A「取り込み基盤」**(0004 + パーサ + チャンク + allowlist + overview 追随 + テスト)→ **OD-B「検索 UI + 実データ」**(type チップ + 実同期/バックフィル手順 + 注記)。

## 6. 未解決の問い

1. **チャンク上限**: 600字(埋め込みと1:1)か、800〜1,000字 + 埋め込み切詰めか — 検索粒度と文脈量のトレードオフ(詳細設計で確定・研究不要)。
2. **残骸チャンク / 削除ファイルの stale 設計** — 将来トピック(M2 からの持ち越しに同種を追加)。
3. **「ナレッジ」チップの対象**: knowledge のみ / knowledge + daily_log / 「すべて」との3択構成 — 詳細設計 or 実利用後の調整。
4. **knowledge の occurred_at**: frontmatter 日付 → 無ければコミット日付 → 無ければ null の優先順位(詳細設計)。
5. **diagrams / drawio の価値検証**: 図の説明 MD が検索ノイズになるようなら allowlist から外す(実利用後の調整)。
6. **他 org への自動追随**: allowlist は `<org>` ワイルドカードのため domain-tech-collection 以外の org が docs/ を持てば自動で対象になる — それで良いか(意図どおりのはず・明示確認)。

## 次の手順

`/design-review org-docs-ingestion` → 全レンズ PASS → `/detailed-design org-docs-ingestion` → 再レビュー → `/goal OD-A` → `/goal OD-B`。
