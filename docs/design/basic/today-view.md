# 基本設計: today-view(M3 今日ビュー — SC-03・WBS kanban)

> ステータス: draft(design-review 待ち)
> 根拠資料: docs/design/ui/screen-design.md §5 SC-03・§7.2(読み替え原則)・§7.4(MoC 準拠 + charts 再利用の恒久規範)/ docs/design/ui/moc/decision-cockpit.dc.html(isToday ブロック)/ **SSoT 実地偵察(2026-07-18・読み取りのみ)**: `docs/secretary/storcon-preparation-wbs.md`(WBS 表 — 行ごとに `[ ]`/`[~]`/`[x]` ステータス・担当・期間・Pri・Type・Issue・成果物)・`docs/secretary/board.md`(2026-03-23 で更新停止のスナップショット・WBS の部分集合)・`todos/`・`reports/`(日次活動レポート)
> 作成: 2026-07-18(主セッション執筆)

## 1. 目的 / スコープ

### 目的
オープンな WBS タスクから「どれに着手するか」を支援する SC-03 今日ビュー(/today)を実装する。
kanban 型のタスク一覧 + サマリ帯を、SSoT の WBS 表から索引して提供する。

### 実データに基づく読み替え(§7.2 の原則 — 無いデータをモックで飾らない)
1. **一次ソース = WBS(`docs/secretary/*-wbs.md`)のみ**。`board.md` は取り込まない — 2026-03-23 で更新停止したスナップショットで WBS の部分集合であり、二重ソースの状態競合を避ける(将来 board.md の運用が復活したら別トピック)。`todos/`・`reports/` も本トピックでは対象外(将来候補 — 問い#4)。
2. **kanban は3列**(バックログ `[ ]` / 着手中 `[~]` / 完了 `[x]`)。MoC の「レビュー」列は**実データに対応する状態が存在しないため設けない**。
3. **カードの「手戻り ↺n」は表示しない** — WBS 行と task-log を確実に紐付けるキーが実データに無い(task-log の topic は slug・WBS 列に対応 ID なし)。ベストエフォートの誤った紐付けはしない。
4. **サマリ帯×4 の読み替え**: オープン(todo 件数)/ 着手中(doing 件数)/ **手戻り率(今週)** = task-log 全体の retry_detected 率(タスク単位でなく組織全体 — 既存 SIGNAL の意味論)/ **平均スコア(今週)** = reward 平均(既存 KPI と同一定義)。後2者は timeline_records の既存集計を流用。

### やる
1. **0005 マイグレーション: 新テーブル `board_items`**(スナップショット状態は timeline_records(時系列イベント)と意味論が異なるため分離 — masters → tag_synonyms の前例と同型):
   - 冪等キー = **(source, file_path, item_key)** の既存規約(item_key = WBS ID 列)。UNIQUE 制約。
   - 列: WBS ID / title(タスク)/ assignee(担当)/ period(期間・生文字列)/ deliverable(成果物)/ iter / pri / task_type(Type 列)/ issue_ref / **state text CHECK ('todo','doing','done')** / org / section(所属見出し)/ synced_at。
   - **埋め込み対象外**(検索(timeline_records)に混ぜない — type 語彙・8列挙・KPI・retro への波及ゼロ)。
   - 削除された WBS 行の残骸は残る(生 DELETE 禁止 — 既知クラス。state 更新は upsert で追随)。
2. **WBS パーサ + 取り込み経路**: allowlist に `docs/secretary/*-wbs.md` を追加し、**新しい AllowMatch 種別 "board"**(masters と同型の別 store 経路)で `board_items` へ冪等 upsert。パーサ契約: WBS 表(`| WBS | タスク | … | ステータス |`)の行を正規化・`[ ]`/`[~]`/`[x]` → todo/doing/done・表形式外の行はスキップ(fail-soft)・パース失敗はファイル単位で summary に計上(timeline_records の error レコードは作らない — テーブル分離のため。実行形は詳細設計)。
3. **SC-03 画面(/today・Server Component)**: MoC isToday ブロックを意匠規範(§7.4)とし:
   - サマリ帯×4(§読み替え4 — 手戻り率・平均スコアは既存 lib/data の集計流用 or 同型クエリ)。
   - **kanban 3列**(グリッド)+ タスクカード(WBS ID・タイトル・担当 pill・期限(period)・Pri・成果物・org)。件数バッジ。完了列は直近 N 件に絞る(全53行を並べない — 詳細設計で確定)。
   - requireUser 存置・proxy 不変(既存保護 URL)。チャート部品は不要(カード/列のみ — charts 再利用規範は「必要な場合に限る」の適用)。
4. **lib/data/today.ts(新設・server-only)**: board_items の取得(state 別グルーピング)+ サマリ集計。SQL は $n 束縛のみ。
5. **テスト**: WBS パーサ契約(fixture — 匿名の WBS 表・状態3値・冪等2回・スキップ行)/ today データ層(モック db)/ 新テストは新ファイル。**前 goal 新設テスト(tests/decision-fallback.test.ts 等)を凍結列挙に編入**(世代管理規範)。
6. **被変更側注記**: ingestion-foundation(allowlist・新 store 経路)/ ui-shell 詳細 §2.5(today プレースホルダの実装化)へ grep ゲート付き注記(主セッション)。

### やらない
- board.md・todos/・reports/ の取り込み(§読み替え1 — 将来候補)。
- SC-02「今日の着手候補」ブロック(SC-03 への導線を持つ SC-02 側の拡張 — 次トピック・問い#3)。
- WBS 行と task-log の紐付け・カード単位の手戻り/スコア表示(§読み替え3)。
- board_items の埋め込み・ナレッジ検索への露出。timeline_records・type 語彙・既存集計(overview/review/retro)の変更(**8列挙のまま — 波及ゼロが本設計の分離判断の狙い**)。
- タスク詳細モーダル・kanban のドラッグ操作(閲覧のみ — SSoT 読み取り専用のため状態変更 UI は作らない)。
- 機微・内部ファイルの扱い変更(denylist 不変 — `*-wbs.md` パターンは secretary 直下の対象ファイルのみ)。

## 2. アーキテクチャ上の位置づけ

- Ingestion(WBS パーサ + allowlist + 新 store 経路)+ Index(0005 board_items — 埋め込みなし)+ App(/today)。
- SSoT は **GitHub API 読み取りのみ**(既存 SourceAdapter・denylist 取得前適用の機構に乗る)。書き戻しなし・kanban 状態の編集 UI なし(SSoT が唯一の書き手)。
- **外部送信なし**(board_items は埋め込まない — 本トピックで OpenAI へ送るデータの増分ゼロ)。
- 結合キー: board_items は時間軸を持たない(スナップショット)。org・タグ体系とは org 列で整合。サマリ帯の時系列側(手戻り率・平均スコア)は timeline_records の既存集計。

## 3. データ / インターフェース概要

| 対象 | 概要 |
|---|---|
| 0005 up/down | `CREATE TABLE board_items`(§1-1 の列・UNIQUE(source,file_path,item_key)・state CHECK 3値)+ 通常インデックス(state, org)。down = テーブル削除(0001〜0004 と同方式・人間承認)。timeline_records 不変 |
| lib/ingestion/parsers/board.ts(仮称) | WBS 表 → 正規化 BoardItem[]。`[ ]`/`[~]`/`[x]` → todo/doing/done。表以外・列不足行はスキップ。sanitizeAbsPaths を title/deliverable 等に適用(機微不変条件の継承) |
| lib/ingestion/store.ts or 新 store | board_items への冪等 upsert(masters → tag_synonyms の前例に倣い分離 — 実装位置は詳細設計) |
| lib/ingestion/run-sync.ts | allowlist に `docs/secretary/*-wbs.md`(AllowMatch kind "board")追加 |
| lib/data/today.ts | `getTodayData()`: state 別グルーピング + サマリ4値(todo/doing 件数 = board_items・手戻り率/平均スコア = timeline_records 今週集計)。server-only・$n 束縛 |
| app/(shell)/today/page.tsx | プレースホルダ → SC-03 実装(サマリ帯・kanban 3列・カード)。requireUser 存置 |
| fixtures | 匿名 WBS fixture(demo-org 配下・状態3値/スキップ行/列不足を含む)— **run-sync.test.ts の件数ピンへの影響は詳細設計で確定**(board 経路は timeline_records の ok/error に計上しない設計なら不変・summary へ board 件数を足すなら件数ピン改訂) |
| 被変更側注記 | ingestion-foundation / ui-shell 詳細(§1-6) |

## 4. リスク・トレードオフ

| リスク | 対処 |
|---|---|
| WBS が準備期間(〜2026-05-29)の文書で今後更新されない可能性 | それでも「オープンタスクの一覧・状態」として現に有効(未着手 40+ 行)。今後の案件 WBS も `*-wbs.md` パターンで自動追随。更新停止時も表示は正(スナップショットの提示) |
| board.md との二重ソース競合 | 取り込まない判断で回避(§読み替え1・根拠 = 更新停止 + 部分集合) |
| kanban 状態の記法ゆれ(`[x]` 以外の表記) | 3値以外はスキップ + summary 計上(fail-soft)。実データは3値のみを偵察で確認済み |
| 新テーブル追加のコスト | timeline_records への型追加(8→9列挙・KPI/retro/テスト波及)より総コストが小さい — 分離判断の根拠。スナップショットと時系列の意味論分離としても正しい |
| SC-02 着手候補との整合 | 本トピックでは SC-03 のみ(SC-02 拡張は次トピック — MoC の導線は問い#3 に記録) |

## 5. 受け入れ条件(機械判定)

詳細設計で実行形を確定。すべて exit code / 件数 / grep。

1. **0005**: up/down 実在 + up に `board_items`・`UNIQUE`・state CHECK 3値の grep + 破壊 SQL(生 DROP TABLE 等)否定 grep は **up のみ対象**(down のテーブル削除は設計明示・人間承認 — 0001/0002 前例)+ Neon ブランチ検証 → 本番適用 ask。
2. **パーサ契約**(fixture・実ネットワークなし): `[ ]`/`[~]`/`[x]` → todo/doing/done / 列不足・表外行スキップ / sanitizeAbsPaths / **冪等(2回同期 → 行数不変・state 更新は追随)**。
3. **取り込み経路**: allowlist に `*-wbs.md` パターン(grep)+ 機微遮断の再実行(denylist は不変 — 危険経路 fixture の遮断テスト緑維持)+ **run-sync.test.ts の件数整合**(詳細設計で確定した方針どおり — 不変 or ピン改訂のどちらかを機械判定)。
4. **SC-03**: /today が placeholder でなくなる(grep — kanban 見出し等)+ requireUser 存置 + 実機 未認証 `/today` → 307 + **kanban 3列・レビュー列なし**(grep — 「レビュー」の否定 grep は誤爆リスクを詳細設計で判断)。
5. **データ層**: lib/data/today.ts の server-only + $n 束縛 + テスト(state グルーピング・サマリ4値・モック db)。
6. **凍結・退行**: timeline_records 系(migrations 0001〜0004・lib/search・lib/data の knowledge/overview/review・検索画面ほか)全凍結 diff + FROZEN_TESTS(前 goal テスト編入済み列挙)+ `npm test`(env -u 形)+ build + 実機。
7. **注記**: `grep -q "today-view" docs/design/detail/ingestion-foundation.md` / 同 ui-shell 詳細。

**/goal 分割の方向性**(詳細設計で確定): **M3-A「WBS 取り込み基盤」**(0005 + パーサ + store + allowlist + fixtures + テスト + build)→ **M3-B「SC-03 画面 + 注記」**。

**手動確認チェックリスト**: 実同期(増分で WBS が変更されていなければ --force)→ /today で実 WBS の kanban 表示・MoC isToday との目視比較。埋め込み不要(バックフィルなし)。

## 6. 未解決の問い

1. **完了列の表示上限**(直近 N 件 — N の値)・列内の並び順(WBS ID 順 / セクション順)— 詳細設計。
2. **`*-wbs.md` が複数ファイルになったときの扱い**(ファイル横断で1つの kanban に合流 — file_path がキーに入っているので自然に共存)— 詳細設計で表示グルーピングを確定。
3. **SC-02「今日の着手候補」**(MoC の SC-02→SC-03 導線)— 次トピック(board_items ができれば「todo から Pri 順に3件」等が可能になる)。
4. **todos/・reports/ の活用**(日次活動レポートは「今日の実績」帯の素材になり得る)— 将来トピック。
5. **WBS のセクション(章)を kanban のスイムレーン表示にするか** — 詳細設計 or 実利用後。

## 次の手順

`/design-review today-view` → 全レンズ PASS → `/detailed-design today-view` → 再レビュー → `/goal M3-A` → `/goal M3-B`。
