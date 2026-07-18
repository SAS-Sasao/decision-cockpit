# 基本設計: today-view(M3 今日ビュー — SC-03・WBS kanban)

> ステータス: **PASS**(design-review Round 2 全レンズ PASS — reviews/today-view.md 参照。R2 の問い(世代決定手続き・skippedRows 分母・board フィールド位置・screen-design 注記の着地ほか)は rev.3 で吸収済み)
> 根拠資料: docs/design/ui/screen-design.md §5 SC-03・§7.2・§7.4 / docs/design/ui/moc/decision-cockpit.dc.html(isToday)/ **SSoT 実地偵察(2026-07-18・読み取りのみ)**: `.companies/domain-tech-collection/docs/secretary/storcon-preparation-wbs.md`(WBS 表 — | WBS | タスク | 担当 | 期間 | 成果物 | Iter | Pri | Type | Issue | ステータス | ・ステータス `[ ]`/`[~]`/`[x]`)・同 `board.md`(2026-03-23 更新停止・WBS の部分集合)・`todos/`・`reports/`
> 作成: 2026-07-18(主セッション執筆)。Round 1 の決着一覧 = docs/design/reviews/today-view.md

## 1. 目的 / スコープ

### 目的
オープンな WBS タスクから「どれに着手するか」を支援する SC-03 今日ビュー(/today)を実装する。
kanban 型のタスク一覧 + サマリ帯を、SSoT の WBS 表から索引して提供する。

### 実データに基づく読み替え(§7.2 の原則 — 無いデータをモックで飾らない)
1. **一次ソース = WBS(`.companies/<org>/docs/secretary/<name>-wbs.md`)のみ**。`board.md` は取り込まない(2026-03-23 更新停止・WBS の部分集合 — 二重ソースの状態競合を回避)。`todos/`・`reports/` も対象外(将来候補 — 問い#4)。
2. **kanban は3列**(バックログ `[ ]` / 着手中 `[~]` / 完了 `[x]`)。MoC の「レビュー」列は実データに状態が存在しないため設けない。
3. **カードの「手戻り ↺n」は表示しない**(WBS 行と task-log の確実な紐付けキーが実データに無い — 誤った紐付けはしない)。
4. **サマリ帯×4**: オープン(todo 件数)/ 着手中(doing 件数)/ **手戻り率(今週)** / **平均スコア(今週)**。後2者は timeline_records から — **意味論の部品は既存**(retry_detected の分母 = signals 非 null・reward 平均 = REWARD_TYPES・status='ok')**だが単一値 KPI としては新設**。**「今週」の境界は weekBucketBoundaries(lib/data/review.ts)の再利用に一本化**(SQL 側での週境界の二重実装は禁止 — overview の「二重定義しない」規範を継承)。
5. これらの読み替え(4列→3列・手戻り非表示・ソース=WBS のみ)は **screen-design §7.2 への項目追加を正とし、§5 SC-03 には §7.2 へのポインタ注記を置く**(rev.3 確定 — §7.4-1「読み替えは §7.2 を正とする」の規範体系に整合。grep ゲートは位置非依存)。

### やる
1. **0005 マイグレーション: 新テーブル `board_items`**(スナップショット状態は timeline_records(時系列イベント)と意味論が異なるため分離 — masters → tag_synonyms の前例と同型。**type 語彙・8列挙・KPI・retro・検索への波及ゼロ**):
   - 冪等キー = **(source, file_path, item_key)** の既存規約(item_key = WBS ID 列)。UNIQUE 制約。
   - 列: WBS ID / title(タスク)/ assignee(担当)/ period(期間・**生文字列 — 正規化しない**。理由 = W1-10 等の相対表記で日付変換の根拠が薄い・§2)/ deliverable(成果物)/ iter / pri / task_type(Type 列)/ issue_ref / **state text CHECK ('todo','doing','done')** / org / section(所属見出し)/ **commit(世代識別子 — ingestion 規約の属性列。§1-2 の表示契約の要)** / synced_at。**タグ列は持たない**(§2 に理由)。
   - **埋め込み対象外**(検索に混ぜない)。
2. **残骸の構造的不可視化(表示契約 — rev.2 の中核決着)**: 再同期のたびに全行 upsert され commit が最新 head に揃う。**/today の表示対象 = 各 file_path の最新 commit 世代の行のみ**。**世代代表の決定手続き(rev.3 確定): 各 file_path の max(synced_at) 行が持つ commit を世代代表とし、その commit を持つ行のみを表示**(同一 run 内は commit 全行同値(head を1回取得)のため実質一意。万一の同時刻・異 commit は (synced_at, commit) の辞書順で決定的に — SQL 実行形は詳細設計)。**同期の途中クラッシュで世代が部分集合になる過渡ウィンドウは受容**(done 未記録のため次回 run で自己修復)。WBS から削除された行・改番された旧 ID の行は旧 commit に留まり **kanban に現れない**(生 DELETE 禁止のまま「現在」の汚染を防ぐ)。**ファイル自体が SSoT から削除された場合はそのファイルの最新世代が残存** — 既知の制限として受容(削除ファイルの残置は M1 からの同クラス)。**SSoT 側で実名行を redaction 目的で削除したケースは旧世代に残置される — この検知・消し込みは db.md の枠(設計 + マイグレーション + 人間承認)のトリガとして認識**(rev.3 明記)。
3. **WBS パーサ + 取り込み経路**: allowlist に **`/^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/`**(錨形を確定 — 偵察実パス準拠・org = orgFromPath)を追加し、**新しい AllowMatch 種別 "board"**(masters と同型の別 store 経路)で board_items へ冪等 upsert。
   - パーサ契約: WBS 表の行を正規化・`[ ]`/`[~]`/`[x]` → todo/doing/done。**行スキップ規定(決定的)**: 表形式外・列不足・ステータス3値外・**WBS ID 空・同一ファイル内の重複 WBS ID の2件目以降(行順)** → スキップし **skippedRows に計上**(無音の last-write-wins をしない — Round 1 data High の決着)。**計上対象は表内の不正行のみ**(表外の見出し・地の文は計上外 — 恒常失敗検知のノイズにしない)。
   - **summary 計上の一本化(3記述矛盾の解消)**: board 経路は ok/error/skipped に**計上しない**(masters 同型 — run-sync.test の件数ピン(ok:13 等)は不変)。**RepoSyncSummary(repo 別)に新フィールド `board: { files, items, skippedRows }` を追加**(凍結テストは toMatchObject のため新フィールドは既存ピンを壊さない — 現物確認済みの整理)。恒常パース失敗の可視化 = board.items の観測(**手動チェックリスト依存で確定** — last_summary は1世代のみの揮発値であることを自認した判断)。
   - sanitizeAbsPaths は**自由テキスト全列に適用**: title / assignee / period / deliverable / section / issue_ref(機微不変条件の継承)。
4. **SC-03 画面(/today・Server Component)**: MoC isToday を意匠規範(§7.4)とし、サマリ帯×4(§読み替え4)+ **kanban 3列** + タスクカード(WBS ID・タイトル・担当 pill・期限(period 生表示)・Pri・成果物・org)+ 件数バッジ。完了列は直近 N 件(詳細設計)。requireUser 存置・proxy 不変。チャート部品は不要(カード/列のみ)。**状態変更 UI なし**(閲覧のみ — mutation 経路否定の機械チェック(server action 等の否定 grep)の要否は詳細設計で判断)。
5. **lib/data/today.ts(新設・server-only)**: `getTodayData()` — 最新世代フィルタ(§1-2)+ state 別グルーピング + サマリ4値(todo/doing = board_items・手戻り率/平均スコア = timeline_records 今週集計 — weekBucketBoundaries 再利用)。SQL は $n 束縛のみ。
6. **被変更側注記(主セッション担当・grep ゲート)**: ingestion-foundation(allowlist・新 store 経路・SyncSummary 拡張)/ ui-shell 詳細 §2.5(today 実装化)/ **screen-design §5 SC-03(読み替え注記 — §読み替え5)**。
7. **テスト**: WBS パーサ契約(fixture)/ today データ層(モック db — 世代フィルタ含む)/ 新テストは新ファイル。**前 goal 新設テストを凍結列挙に編入**(全列挙は詳細設計 — 前例どおり)。
   - **fixture の作成規範(明文)**: 匿名・**実 WBS からのコピー禁止(完全創作)・実名/実案件名(storcon 等)不使用**(testing.md)。状態3値・スキップ行(列不足・状態外・重複 ID・空 ID)を含む。

### やらない
- board.md・todos/・reports/ の取り込み(将来候補)。SC-02「今日の着手候補」(次トピック — 問い#3)。
- WBS 行と task-log の紐付け・カード単位の手戻り/スコア。
- board_items の埋め込み・ナレッジ検索への露出(**恒久ガード = lib/search 配下の `board_items` 否定 grep を受け入れ条件に** — §5-6)。
- timeline_records・type 語彙・既存集計(overview/review/retro)・検索画面の変更(波及ゼロ)。
- period の日付正規化・期日超過判定(生表示のみ — §1-1 の理由)。タスク詳細モーダル・kanban ドラッグ(SSoT 読み取り専用)。
- denylist の変更(`*-wbs.md` は既存9パターンと非干渉 — 現物確認済み)。

## 2. アーキテクチャ上の位置づけ

- Ingestion(WBS パーサ + allowlist + 新 store 経路)+ Index(0005 board_items — 埋め込みなし)+ App(/today)。
- SSoT は **GitHub API 読み取りのみ**(既存 SourceAdapter・denylist 取得前適用の機構)。書き戻し・状態編集 UI なし(SSoT が唯一の書き手)。
- **外部送信なし**(board_items は埋め込まない — OpenAI へ送るデータの増分ゼロ。恒久ガードは §5-6)。
- **認可モデル(明示 — search-foundation の前例規範に従う)**: board_items は**実名(担当者)・案件固有情報を含む**が、他の索引データと同じく**認証済み全ユーザーに可視**とする — self-signup が開いている現状での**意図的判断**(個人用途・実質単一ユーザー)。閲覧制限の強化(ロール別可視性等)は SC-07 / M4 の課題に紐付ける。
- 結合キー: board_items は**時間軸を持たない**(スナップショット — commit が世代を担う)。**タグ列も持たない**(意図的 — SC-03 は board 単独クエリで完結し、横断結合の需要が現時点で無い。SC-02 着手候補(問い#3)も state/pri で足りる見込み。必要になったら applyTags 流用で追加)。サマリ帯の時系列側は timeline_records の既存集計。

## 3. データ / インターフェース概要

| 対象 | 概要 |
|---|---|
| 0005 up/down | `CREATE TABLE board_items`(§1-1 の列・UNIQUE(source, file_path, item_key)・state CHECK 3値)+ 通常インデックス(state・org — 世代フィルタ用の (file_path, synced_at) 索引の要否は詳細設計で判断)。down = テーブル削除(0001/0002 と同方式・人間承認)。timeline_records 不変 |
| lib/ingestion/parsers/board.ts(仮称) | WBS 表 → BoardItem[]。スキップ規定は §1-3(決定的・skippedRows 計上)。sanitizeAbsPaths は自由テキスト全列(§1-3) |
| store(board_items 用 upsert) | 冪等 upsert(実装位置 = store.ts への追加 or 分離 — 詳細設計。upsertTagSynonyms 前例) |
| lib/ingestion/run-sync.ts | allowlist に §1-3 の錨形 regex(AllowMatch kind "board")+ SyncSummary へ `board` フィールド追加 |
| lib/data/today.ts | `getTodayData()`(最新世代フィルタ・state グルーピング・サマリ4値)。server-only・$n 束縛 |
| app/(shell)/today/page.tsx | プレースホルダ → SC-03(サマリ帯・kanban 3列・カード)。requireUser 存置 |
| fixtures | 匿名 WBS fixture(demo-org 配下・**完全創作・実名/実案件名不使用** — §1-7)。**run-sync.test の件数ピンは不変**(board 経路は ok/error/skipped 非計上 — masters の ok:0 前例をテストで実証済み)。board フィールドの検証は新テスト側 |
| 被変更側注記 | ingestion-foundation / ui-shell 詳細 / **screen-design §5 SC-03**(§1-6) |

## 4. リスク・トレードオフ

| リスク | 対処 |
|---|---|
| WBS が準備期間(〜2026-05-29)の文書で更新停止する可能性 | スナップショットの提示として正 + **今後の案件 WBS も `<name>-wbs.md` パターンで自動追随**。鮮度は同期時 commit で判別可能(表示上の鮮度提示は詳細設計 or 実利用後 — 問い#5) |
| WBS ID 重複・空 ID | 行スキップ + skippedRows 計上(§1-3 — 無音上書きをしない) |
| 残骸行の「現在」汚染 | **最新 commit 世代フィルタで構造的に不可視**(§1-2)。ファイル削除の残存のみ既知の制限 |
| SyncSummary 型の拡張が凍結テストへ波及 | 新フィールド追加のみ(toMatchObject のため既存 assert 不変 — 現物確認済み)。/api/sync 応答・sync_state.last_summary への波及は詳細設計で列挙 |
| 実名を含むデータの表示 | §2 の認可モデル明示(意図的判断 + SC-07/M4 紐付け)。外部送信なし |
| 新テーブルのコスト | timeline_records への型追加(9列挙化の全波及)より小さい — 分離判断の根拠 |

## 5. 受け入れ条件(機械判定)

詳細設計で実行形を確定。すべて exit code / 件数 / grep。

1. **0005**: up/down 実在 + up に `board_items`・`UNIQUE`・state CHECK 3値の grep + 破壊 SQL 否定 grep(**up のみ対象** — down のテーブル削除は設計明示・人間承認。0003 の前例形式)+ Neon ブランチ検証 → 本番適用 ask。
2. **パーサ契約**(fixture・実ネットワークなし): 状態3値変換 / スキップ規定の全ケース(列不足・状態外・**重複 ID の2件目スキップ・空 ID スキップ**)+ skippedRows 計上 / sanitizeAbsPaths(自由テキスト全列)/ **冪等(2回同期 → 行数不変・state 更新追随)**。
3. **取り込み経路**: allowlist の錨形 regex(grep)+ SyncSummary の `board` フィールド(新テスト assert)+ **run-sync.test の件数ピン(ok:13 / error:3 / skipped:3)が無変更で緑** + 機微遮断テスト緑維持。
4. **表示契約**: today.ts の**最新 commit 世代フィルタのテスト**(旧世代行が結果に現れない — モック db)+ state グルーピング + サマリ4値(weekBucketBoundaries 再利用の import grep)。
5. **SC-03**: /today がプレースホルダでなくなる(grep)+ requireUser + 実機 未認証 `/today` → 307 + kanban 3列(grep — 実行形は詳細設計)。
6. **凍結・退行・恒久ガード**: timeline 系(migrations 0001〜0004・lib/search・lib/data の knowledge/overview/review・他画面)凍結 diff + **`grep -RIn 'board_items' lib/search` が exit 1**(埋め込み経路への恒久非侵食)+ FROZEN_TESTS(前 goal テスト編入 — 全列挙は詳細設計)+ `npm test`(env -u 形)+ build。
7. **注記**: `grep -q "today-view" docs/design/detail/ingestion-foundation.md` / 同 ui-shell 詳細 / **同 docs/design/ui/screen-design.md** 各 exit 0。

**/goal 分割の方向性**(詳細設計で確定): **M3-A「WBS 取り込み基盤」**(0005 + パーサ + store + allowlist + fixtures + テスト + build)→ **M3-B「SC-03 画面 + 注記」**。

**手動確認チェックリスト**: 実同期(WBS 未変更なら --force)→ /today で実 WBS の kanban 表示・MoC isToday との目視比較・board.items の件数観測(恒常パース失敗の検知)。埋め込みバックフィル不要。

## 6. 未解決の問い

1. **完了列の表示上限 N・列内の並び順**(WBS ID 順 / セクション順)— 詳細設計。
2. **複数 WBS ファイル時の表示グルーピング**(ファイル横断で1 kanban か・ファイル別スイムレーンか)— 詳細設計(キーは file_path 込みで共存可能)。
3. **SC-02「今日の着手候補」** — 次トピック(board_items の todo × Pri 順で実現可能に)。
4. **todos/・reports/ の活用**(「今日の実績」帯の素材)— 将来トピック。
5. **WBS の鮮度提示**(最終同期 commit の日付表示等)— 詳細設計 or 実利用後。
6. **セクション(章)のスイムレーン表示** — 詳細設計 or 実利用後。

## 次の手順

`/design-review today-view`(再レビュー)→ 全レンズ PASS → `/detailed-design today-view` → 再レビュー → `/goal M3-A` → `/goal M3-B`。
