# design-review: capture-trash(INBOX ゴミ箱 — 論理削除 + 復元)

対象: docs/design/basic/capture-trash.md(軽量1枚形式 — 詳細設計省略)

## Round 1 — 2026-07-20

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | **High: InboxRow への必須 `deletedAt: string \| null` 追加が凍結 tests/capture-data.test.ts の完全形 toEqual を赤にする** — toEqual が無視するのは undefined のみで **null は無視されない**(CT-1 の status が緑だったのは変換なし直接写像 = undefined 透過だったから。Date→ISO 変換を要する deletedAt では前例が再現しない)。条件3(test 緑)×6b(凍結)×条件7(tsc)の三すくみ。Med: capture.ts 契約コメント2箇所の再虚偽化(CT-1 R1 Med-4 の同型再発)。Low 3(恒真 grep / listTrash の ORDER・クランプ ピンなし / deletedAt ピンなし)。CT-1 ピン読み替えの列挙・シェル意味論・pathspec・deleted_at 選定・qs 前例は現物照合で成立 |
| data | **FAIL** | High: 同(3レンズ中2レンズが同一検出 — null 変換写像→テスト赤 / 写像省略→tsc 赤の分岐まで実証)。Med: コメント虚偽化。Low 6(restoreCapture 同名衝突(データ層 vs action)/ 恒真 grep / 「即カウントダウン」の過剰一般化(open 行限定)/ コメントの UPDATE リテラルで count=3 汚染 / 二重クリック bad_request 露出受容 / capture.md 文言は人間レビュー)。0007 DDL・冪等 SQL・バッジ整合・M5 申し送り・params 順序の対($1=id/$2=user_id)は成立 |
| sec | **FAIL** | **Med(ブロッキング): listTrash の user_id 二重ゲート不全** — 条件2 に WHERE 完全形ピンなし・条件3 assert に SQL `user_id = $1` 包含なし(バッジ側と非対称)。**body を返す新 SELECT 面**なので露出時の被害はバッジ(count)より大 — CT-1 R1 Med-1 と同類の経路。Med(非ブロッキング): 削除行が M5 で書き戻される窓(v1 受容の文書化はあり)。Low 2(保持期限 / 恒真 grep)。softDelete/restore/バッジの二重ゲート・物理 DELETE 禁止・UPDATE 3本ゲートは前例水準 |

**総合: FAIL(全レンズ)** → rev.2 で決着:
1. **InboxRow は不変(High の決着)**: listInbox は WHERE 1行の変更のみ(生存行の deletedAt は概念的に常に NULL — フィールドを追加しない)。**listTrash は専用型 `TrashRow = InboxRow & { deletedAt: string }`** を返す(ISO 文字列写像・条件3 で写像 assert)。禁止事項に「InboxRow 型の変更禁止」。
2. **WHERE 完全形ピン2本**(sec Med / 恒真 grep の決着): `WHERE user_id = $1 AND deleted_at IS NULL`(listInbox)/ `WHERE user_id = $1 AND deleted_at IS NOT NULL`(listTrash)+ 条件3 の listTrash assert に `user_id = $1` 包含 + params[0] — **全5 SQL 面(softDelete/restore/listInbox/listTrash/バッジ)で二重ゲート対称**。
3. データ層 **restoreCaptureRow** 改名(action restoreCapture との同名衝突回避)。
4. 契約コメント2箇所の成果物化 + 旧文言(「INSERT のみ」「status 単列 UPDATE のみ」)否定 grep + **コメントへの `UPDATE capture_inbox` リテラル禁止**(count=3 汚染防止)。
5. 手動確認の open 行前提化 / 期限設計時の整合注記 / M5 書き戻し窓の UI 注記要否を問い#4 に。

## Round 2 — 2026-07-20(rev.2 を全レンズ再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | High の決着を実証(toEqual の null 非無視セマンティクスの現物裏取り・SELECT 不変で成立・凍結 toContain の包含生存)。コメント否定 grep の非誤爆・count=3 の間接強制・6c 許容と §2 の一致・restoreCaptureRow の一貫を確認。Low 2(listTrash クランプ未ピン / docs 2 の内訳曖昧) |
| data | **PASS** | 反映7件を現物照合(listInbox WHERE 変更後も凍結 toContain 生存・TrashRow 合成型の TS 妥当性・CT-1 旧バッジピンは新形の部分包含で読み替え前でも割れない)。Low 4(listTrash SELECT 列の明文化 / §1-4 表現 / 弱ピン2件は条件3 動作テスト補完で受容 / 「INSERT のみ」否定の空振りは退行防止として無害) |
| sec | **PASS** | **5 SQL 面の二重ゲート対称性を表で確認**(R1 欠落面の listTrash 含め全closed)。TrashRow の追加露出は削除時刻のみ・IDOR 面なし・列挙オラクルなし維持。Low 2(ピン文字列のコメント混入は人間レビュー補完 — CT-1 前例水準 / M5 窓は M5 設計レビューで再検証) |

**総合: PASS(全レンズ)** — R2 の Low は rev.3 で吸収:
listTrash のクランプ1ケース(999→100)を条件3 に追加 / **SELECT 列の明文化**(listTrash = listInbox 列 + deleted_at・listInbox の SELECT 不変・実 SELECT 列の検出はモック不可→手動確認補完を受容)/ 6c の「docs 2」内訳明確化(.claude/rules/capture.md + capture-triage.md — 本設計書・reviews はレビュー成果物として許容)/ §1-4 を open 行表現に正確化。

### /goal CT-2 への申し送り(Info・非ブロッキング)

1. 条件6c は **commit 前に実行**。judge は `git log main.. --stat` でコード7 + docs 2 に閉じることを確認。
2. **InboxRow に deletedAt を足さない**(凍結 toEqual が null を無視しないため赤化 — 禁止事項)。listInbox の変更は WHERE 1行のみ・SELECT 不変。
3. コメントに `UPDATE capture_inbox`・WHERE 完全形ピンの文字列を書かない(count/grep 汚染)。実装レビューで listInbox / listTrash の WHERE が **AND 結合**であることを目視確認(OR 迂回の機械非検知 — 人間補完)。
4. SQL は大文字規約・ピン行は1行維持。データ層は restoreCaptureRow(action は restoreCapture — import 時の別名不要)。
5. 0007 の down は Write ツール・ローカル適用は `psql < ファイル` リダイレクト形。
