# design-review: today-view(M3 今日ビュー — SC-03・WBS kanban)

対象: docs/design/basic/today-view.md

## Round 1 — 2026-07-18

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | board_items 分離・AllowMatch "board"・件数ピン非波及(masters 前例 ok:0 のテスト実証)は現物照合で成立。**Med: screen-design.md が被変更側に無い**(SC-03 の「4列・board.md」記述が実装と逆のまま残る — 前例クラス)/ allowlist 錨形の揺れ(repo ルート形 vs .companies 形)/ タグ列・period 正規化を捨てる判断が無言。Low 3(summary 計上先未指定 / FROZEN 全列挙 / commit 列欠落) |
| data | **FAIL** | **High: 同一ファイル内 WBS ID 重複時の挙動未定義**(ON CONFLICT の無音 last-write-wins・§5-2 の行数不変判定では検出不能・空 ID 行の `''` 衝突も未規定)。Med 3: **残骸行が kanban のカードとして「現在」に露出**(timeline の希釈と質的に異なる — ファイル削除・改番ケース含め判断の所在が無い)/ summary 計上の3記述(ファイル単位/行単位/非計上)が相互矛盾・受け皿フィールド不存在 / 「流用 or 同型クエリ」が週定義の二重実装を許容(overview の「二重定義しない」規範と衝突)+ commit 列欠落。観点5(件数ピン非波及)は現物実証済み・新フィールド追加なら toMatchObject でピン不変の整理も提示 |
| sec | **FAIL** | **High: 実名(対象者)+ 案件情報を含む board_items の認可モデル宣言欠落**(search-foundation が確立した「認証済み全ユーザー可視・self-signup 開放中の意図的判断」の明示規範に不整合)。Low 4(埋め込み対象外の恒久機械判定なし / fixture の実 WBS コピー禁止文言 / sanitize 適用列「等」の曖昧 / mutation 経路否定チェック)。denylist 非干渉・down 承認・読み取り専用宣言は現物照合で健全 |

**総合: FAIL(全レンズ)** → rev.2 で決着:

1. **世代識別子による残骸の構造的不可視化(data Med の中核)**: board_items に **commit 列を追加**(ingestion 規約準拠 — arch Low-3 / data Med も同時決着)し、**表示契約 = 各 file_path の最新 commit 世代の行のみ**。行削除・ID 改番の残骸は旧世代に留まり kanban に現れない(DELETE 不要のまま解決)。ファイル自体の削除は残存 — 既知の制限として受容明記。
2. **重複 ID の規定(data High)**: 同一 (file_path, WBS ID) の2件目以降と WBS ID 空行は**行スキップ + skippedRows 計上**(決定的・行順)。テスト観点に重複・空 ID ケースを追加。
3. **summary 計上の一本化(3記述矛盾の解消)**: board 経路は ok/error/skipped に**計上しない**(masters 同型 — 既存ピン不変)。**SyncSummary に新フィールド `board: { files, items, skippedRows }`** を追加(toMatchObject のため凍結テストのピン不変 — data の整理を採用)。恒常失敗の可視化は board.files/items の観測 + 手動チェックリスト。
4. **認可モデルの明示(sec High)**: search-foundation 前例の宣言形式で §2 に明記(実名入り WBS = 認証済み全ユーザー可視・self-signup 開放中の意図的判断・閲覧制限強化は SC-07/M4 の課題)。
5. **被変更側に screen-design.md を追加**(SC-03 の読み替え注記 + grep ゲート — arch Med-1)。
6. allowlist 錨形の確定(`.companies/<org>/docs/secretary/<name>-wbs.md` — 偵察実パス準拠・org = orgFromPath)/ タグ列・period 正規化の不採用を §2 に明示(理由付き)/ 週定義は weekBucketBoundaries 再利用に一本化(「同型クエリ」併記を削除)・手戻り率は「部品は既存・単一値 KPI としては新設」と表現修正 / lib/search 配下の `board_items` 否定 grep を条件に追加(埋め込み恒久ガード)/ fixture は「実 WBS からのコピー禁止・完全創作・実名/実案件名不使用」明文 / sanitize 適用列の全列挙(title/assignee/period/deliverable/section/issue_ref)/ mutation 経路否定チェックは詳細設計で判断と明記。

## Round 2 — 2026-07-18(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | R1 決着5件の実体を現物照合(注記前例・錨形 regex の同形式・masters の ok:0 実証・toMatchObject ピン・commit 属性列の規約整合)。世代フィルタを読み側契約に置く判断は「UI は索引済みデータを読む」原則の内側で DELETE 禁止との両立解と評価。問い4(screen-design 注記の着地(§7.2 が正)/ 世代決定手続き / skippedRows 分母 / board フィールド位置) |
| data | **PASS** | 世代フィルタの実体検証(同一 run 内 commit 同値 = head 1回取得の現物・部分同期は per-file スコープが構造的に安全・--force の full 経路)・重複スキップの決定性・非波及主張(toMatchObject・last_summary 書き込み専用・/api/sync 加法拡張)をすべて現物実証。問い(世代の順序付け基準・過渡ウィンドウ・フィールド位置・恒常失敗の手動依存確定・索引要否) |
| sec | **PASS** | 認可モデル宣言が search-foundation 前例の3要素 + 機微種別の明示で前例以上の水準。恒久 grep ガード・fixture 完全創作・sanitize 全列列挙を確認。世代フィルタは削除行が UI に漏れない方向でプライバシー改善と評価。Info(mutation チェックの引き継ぎ文 / redaction ケースの認識確認) |

**総合: PASS(全レンズ)** — R2 の問い・Info は rev.3 で吸収:
screen-design 注記は **§7.2 への項目追加が正 + §5 SC-03 にポインタ** / 世代代表 = **各 file_path の max(synced_at) 行の commit**((synced_at, commit) 辞書順タイブレーク・SQL は詳細設計)/ 途中クラッシュの過渡ウィンドウ受容(次回 run 自己修復)/ skippedRows = **表内の不正行のみ** / board フィールド = **RepoSyncSummary(repo 別)** / 恒常失敗の手動チェックリスト依存を確定 / (file_path, synced_at) 索引の要否・mutation 否定チェックの要否は詳細設計判断と本文明記 / redaction 削除の残置は db.md 消し込み枠のトリガとして認識明記。

### detailed-design への申し送り(非ブロッキング)

1. 世代フィルタの SQL 実行形(max(synced_at) 世代代表・タイブレーク)と (file_path, synced_at) 索引の要否。
2. run-sync.test の件数ピン不変の再確認(board fixture 追加後 — masters ok:0 前例の board 版 assert は新テスト側)。
3. board フィールドの型定義位置(RepoSyncSummary)と /api/sync 応答・last_summary への波及列挙。
4. mutation 経路否定チェック(server action 否定 grep)の要否確定。
5. 完了列の表示上限 N・並び順・kanban 3列 grep の実行形。
6. FROZEN_TESTS の全列挙(OD 系 + OD-FIX + OD-DEC の新設テスト編入)。
