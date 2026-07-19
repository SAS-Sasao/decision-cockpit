# design-review: capture-triage(INBOX 状態管理 — 未処理/処理中/完了)

対象: docs/design/basic/capture-triage.md(軽量1枚形式 — 詳細設計省略)

## Round 1 — 2026-07-19

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | Med 4: 閉包判定の実行形欠落(spar-overlay 条件2b 前例から退行)/ tests の凍結が機械非被覆 / 条件3b が追加行のみ検査 / **capture-spar 正典の stale**(「UPDATE 禁止」3箇所 + capture.ts コメントが実装後に虚偽化)。Low 2(「行コンポーネント経由」の非決定 / UPDATE 個数ピンなし)。バッジ変更が凍結を割らない主張・条件6 pathspec の実在・M4 UPDATE 禁止の三重記述は現物照合済み |
| data | **PASS**(Med 1) | **凍結例外の根拠不成立を実証**: tests/capture-data.test.ts は toEqual(undefined プロパティ無視)+ toContain のため status 追加でも赤にならない — 例外を開かず新テスト側で被覆すべき。バッジ意味論3点(移行直後不変・処理中/完了で減・M5 消費で減)・fast default・rowCount 実行可能性・M5 両立を現物実証。Low 5(コメント虚偽化 / 第2 UPDATE 非検査 / down データロス / M5 後の行表記 / index 形) |
| sec | **FAIL** | **Med-1: バッジ WHERE の文言が user_id 脱落を誘発**(§1 の「WHERE を変更」が不完全形・条件2/3 のどのゲートも user_id を検証しない — 全機械ゲート通過のまま全ユーザー横断 count になる経路)。Med-2: 「SET status 単列・1本のみ」の機械判定なし。Low 3(DROP COLUMN 非捕捉 / コメント虚偽化 / CSRF 言及なし)。updateCaptureStatus 単体の認可(rowCount 0 秘匿・列挙オラクルなし)は前例水準 |

**総合: FAIL(arch/sec)** → rev.2 で決着:
1. **バッジ SQL を完全形で全面ピン**(sec Med-1): §1 に `WHERE user_id = $1 AND processed_at IS NULL AND status = 'open'` 明記 + 条件2 に完全形 grep -F ピン + 条件3 に params[0] = userId assert(二重ゲート)。
2. **UPDATE 単一性の機械判定**(sec Med-2): `grep -c 'UPDATE capture_inbox'` = 1 + capture 配下の UPDATE 否定 + SET 対象列(processed_at|curated_ref|kind|body)否定 grep。
3. **凍結例外の撤回**(data Med / arch Med-3): 既存テストは全ファイル凍結(条件6b で全列挙 diff)— status 写像・バッジ SQL の検証は新設 tests/capture-status.test.ts 側。
4. **閉包判定の実行形**(arch Med-1): 条件6c(git status --porcelain + 許容6パス)+ judge 手順(git log main.. --stat)。
5. **正典 stale の解消**(arch Med-4): capture-spar.md の UPDATE 禁止3箇所へ読み替え注記(条件5 grep)+ capture.ts 契約コメント更新の成果物化。
6. Low 群: DROP COLUMN を条件1 否定 grep に追加 / down のデータロス明記 / CSRF 継承明示 / page.tsx 内限定(新規ファイル不可)/ index 選定理由 / M5 申し送りに行表記の正を追加。

## Round 2 — 2026-07-19(rev.2 を arch/sec 再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | 決着6件の反映を現物照合(6b の列挙 = tests/ 全38ファイル過不足なし・6a/6c の除外集合と §2 の一致・toEqual 非赤化の実物裏取り・capture-spar の UPDATE 禁止3箇所特定)。Low 4(insertCapture docstring も更新対象に / コメント更新の機械ピン / 注記3箇所の 1出現 grep / 「8ファイル」の数え方) |
| sec | **PASS** | Med-1/Med-2 の二重ゲート成立(`\$1` の bash 二重引用符展開の妥当性・count=1 と -F ピンの組合せで「唯一の UPDATE = SET status 単列」が閉じる)を確認。Low 4(大文字 SQL 前提の受容明記 / コメントピン / CSRF 引用節番号 / test SQL assert への user_id 追加) |

**総合: PASS(全レンズ — arch R2 / data R1 / sec R2)** — R2 の Low は rev.3 で吸収:
insertCapture docstring も更新対象化 / 旧文言「INSERT のみ」の否定 grep を条件2 に追加(コメント更新の機械ピン)/ 大文字 SQL 前提の受容明記 / テストの count SQL assert に `user_id = $1` も追加 / CSRF 引用を §0-10・§5 に修正 / 「コード7ファイル + docs 2」表記 / capture-spar 注記3箇所は1出現 grep + 人間レビュー補完と明記。

### /goal CT-1 への申し送り(Info・非ブロッキング)

1. 条件6c は **commit 前に実行**。judge は `git log main.. --stat` で変更ファイルがコード7 + docs 2 に閉じることを確認。
2. SQL は大文字規約で書く(条件2 の grep 群は大文字前提 — 小文字回避は人間レビューで弾く)。
3. tests/capture-data.test.ts は**触らない**(status 写像の検証は tests/capture-status.test.ts 側 — toEqual の undefined 無視で既存は緑のまま)。
4. 0006 の down(DROP COLUMN 行)は Write ツールで作成・ローカル適用は `psql < ファイル` リダイレクト形(guard 対策)。
5. バッジ SQL の変更は lib/data/overview.ts の**1行内で完結**させる(完全形 -F ピンが割れないよう改行しない)。
