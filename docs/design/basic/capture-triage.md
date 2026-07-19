# 基本設計: capture-triage(INBOX の状態管理 — 未処理 / 処理中 / 完了)

> 要求(ユーザー・2026-07-19): /capture の INBOX 行を**未処理 → 処理中 → 完了**に切り替えたい。**処理中にした時点で左上バッジ(未処理件数)がカウントダウン**すること。
> 根拠資料: .claude/rules/capture.md(現契約: processed_at NULL = 未処理・M5 の整理ループが消費)/ 0001 DDL /
> **実地偵察(2026-07-19)**: getUnprocessedInboxCount(lib/data/overview.ts)= `user_id = $1 AND processed_at IS NULL` の count・**tests/overview-data.test.ts に同関数のピンは無い**(badge SQL 変更は凍結を割らない)/
> tests/capture-data.test.ts の行写像 assert は **toEqual(undefined プロパティを無視)+ toContain** — **status 列追加でも赤にならない = 凍結例外は不要**(R1 data 検証)/
> page.tsx の行バッジは processedAt 二値(未処理/処理済み)表示。
> ステータス: **PASS**(design-review — arch R2 / data R1 / sec R2 で全レンズ PASS。reviews/capture-triage.md 参照)
> 作成: 2026-07-19(主セッション執筆・軽量1枚形式 — 実行形条件込み・詳細設計省略(md-render / spar-overlay 前例))

## 1. 目的 / スコープ

### 状態モデル(本設計の中核)
- **新列 `status`(0006)**: `'open'`(未処理・既定)/ `'in_progress'`(処理中)/ `'done'`(完了)— **ユーザーの手動トリアージ状態**。
- **`processed_at` / `curated_ref` は従来どおり M5(自動整理)専用**のまま — 本機能は触らない(消費マークと手動状態の分離)。
- **バッジ SQL(完全形 — user_id スコープ必須)**: `WHERE user_id = $1 AND processed_at IS NULL AND status = 'open'` — 処理中/完了にした瞬間にカウントダウン(要求どおり)。M5 が消費した行も従来どおり減る。**user_id 条件の保持は条件2 の grep ピン(完全形)+ 条件3 の params assert の両方で機械判定**(R1 sec Med-1 の決着)。
- 遷移は**自由(可逆)**: 3状態間をボタンで任意に移動(完了 → 未処理も可 — 誤操作の取り消しを優先)。

### やる
1. **0006 マイグレーション**: `ALTER TABLE capture_inbox ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done'))` + `CREATE INDEX IF NOT EXISTS capture_inbox_user_status_idx ON capture_inbox (user_id, status)`(素の複合 index — バッジに加え将来の一覧フィルタ(状態別タブ)を見込む。個人規模で partial との差は無視可)。down = `ALTER TABLE capture_inbox DROP COLUMN IF EXISTS status;`(**適用は人間承認のみ・in_progress/done のトリアージ状態を不可逆に失う**ことを明記)。既存行は DEFAULT で 'open'(PG の fast default — 全行未処理のままバッジ数値は移行前後で不変)。
2. **Server Action `updateCaptureStatus(id, status)`**(app/(shell)/capture/actions.ts に追加): `getUser()` null → unauthorized(DB 非接触)/ status 3語彙検証・id は UUID 形式検証(knowledge.ts の UUID_RE 前例 — 不正は bad_request・DB 非接触)/ データ層関数 `setCaptureStatus`(lib/data/capture.ts)を呼ぶ / **rowCount 0(他人の行・不存在)→ bad_request**(存在の秘匿 — 語彙外・UUID 不正・他人行が同一エラーに潰れ列挙オラクルなし)/ 成功で revalidatePath("/capture")。CSRF は既存受容(capture-spar 詳細 §0-10・§5: SameSite=strict(SDK 既定・package-lock 凍結)+ Server Action origin 検査)を継承。
3. **データ層**: lib/data/capture.ts に `setCaptureStatus(userId, id, status)` — SQL = **`UPDATE capture_inbox SET status = $1 WHERE id = $2 AND user_id = $3`**(**本人行のみ・SET は status 単列** — $n 束縛・1行維持)。listInbox の SELECT・InboxRow に `status` を追加。**契約コメントの更新(2箇所)**: ヘッダ(「書き込みは INSERT のみ」)と insertCapture の docstring(「唯一の書き込み経路」)を「INSERT + status 単列 UPDATE のみ(capture-triage)」に更新(虚偽化防止 — 機械ピン: 条件2 の旧文言否定 grep)。getUnprocessedInboxCount の WHERE を上記完全形に変更(lib/data/overview.ts — 関数名・IF・呼び出し元3箇所は不変)。
4. **UI(page.tsx の INBOX 行 — 新規ファイルは作らない・page.tsx 内に限定)**: 状態チップ3種のボタン(現在状態を強調・クリックで updateCaptureStatus)。行の枠色 = open: 琥珀(--warn)/ in_progress: --accent / done: ミュート。行バッジ表記 = 未処理 / 処理中 / 完了(processed_at 非 NULL の行は「整理済み」補助表記 — 表記の正は §5-2 で M5 設計へ申し送り)。
5. **契約更新(.claude/rules/capture.md — 主セッション)**: status 列・3語彙・「**UI は本人行の status のみ UPDATE 可**(processed_at / curated_ref は M5 専用)」を追記 + M5 申し送り参照(`capture-triage` リテラル)。
6. **正典の追随注記(主セッション — R1 arch Med-4)**: docs/design/detail/capture-spar.md の「UPDATE 禁止」3箇所(§2.1 データ層契約・§4 条件2 の UPDATE 否定 grep・§5 禁止事項)に **capture-triage で status 単列に限定解除**の読み替え注記(`capture-triage` リテラル)。
7. **Neon ブランチ検証(0006)+ ローカル適用**(主セッション — 本番適用は Vercel 展開時に 0003→0006 順・人間承認)。

### やらない
- processed_at / curated_ref の UI からの変更(M5 専用のまま)。**DELETE は引き続き禁止**。UPDATE の解禁は **capture_inbox の status 列1本に限定**(M4 の「UPDATE 禁止」は INSERT-only goal の範囲制約 — 本設計が契約を「status のみ可」へ明示拡張し、§1-6 の注記で正典側も追随)。
- M5(整理ループ)側の挙動定義(status との関係は M5 設計 — §5 申し送り)。
- kind / body / topic の編集・行の削除・並び替え・状態別フィルタタブ(実利用後)。
- 楽観更新・リアルタイム同期(revalidatePath の再描画で十分 — v1)。**既存テストの変更(凍結例外なし** — R1 で「例外不要」を実証済み。status 写像の検証は新設テスト側に置く)。

## 2. アーキテクチャ上の位置づけ

- App 層 + DB(0006 の加法変更のみ — 既存列・既存行の意味は不変)。SSoT 非接触。認可 = セッション由来 user_id を UPDATE の WHERE とバッジ count の両方に強制(アプリ層スコープの継承 — 機械判定は §4-2/3)。
- capture.md 契約の**加法拡張**(status 列)— M5 の消費契約(processed_at IS NULL・created_at 順・partial index 不変)はそのまま両立。
- 変更対象(**コード7ファイル + docs 2**): db/migrations/0006 up/down(2)・lib/data/capture.ts・lib/data/overview.ts・app/(shell)/capture/actions.ts・app/(shell)/capture/page.tsx・tests/capture-status.test.ts(新設)+ docs(capture.md・capture-spar.md 注記 — 主セッション。capture-spar の注記3箇所は1出現 grep + 人間レビュー補完)。**既存テストは全ファイル凍結(例外なし)**。

## 3. リスク・トレードオフ

1. **手動状態と M5 の意味論競合**: done の行を M5 が後で処理し得る(現契約のまま)— v1 受容・M5 設計で確定(§5)。バッジ減少は即時なので日常運用は成立。
2. **UPDATE 解禁の面**: SET status 単列・本人行 WHERE・語彙検証 + DB CHECK の四重に加え、**UPDATE 文の単一性を機械判定**(条件2: `UPDATE capture_inbox` 出現数 = 1 + SET 対象列の否定 grep — R1 sec Med-2 の決着)。DELETE は否定 grep で不変禁止。
3. 既存 timeline 行・埋め込み・検索・同期経路に非接触(条件6 の凍結 diff で機械被覆)。
4. ボタン連打 → 同一行への UPDATE 競合は最後勝ち(単列・冪等的 — 認証済み本人のみで受容)。

## 4. 受け入れ条件(機械判定)

1. **0006**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0006_capture_status.up.sql || fail=1
   test -f db/migrations/0006_capture_status.down.sql || fail=1
   grep -Fq "ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'" db/migrations/0006_capture_status.up.sql || fail=1
   grep -Fq "CHECK (status IN ('open','in_progress','done'))" db/migrations/0006_capture_status.up.sql || fail=1
   grep -Fq 'capture_inbox_user_status_idx' db/migrations/0006_capture_status.up.sql || fail=1
   grep -E "DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0006_capture_status.up.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + ローカル適用済み(`docker compose exec -T db psql -U cockpit -d cockpit -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'capture_inbox' AND column_name = 'status';"` = 1)+ Neon ブランチ検証(主セッション)。
2. **action・データ層**(集計型):
   ```bash
   fail=0
   grep -Fq 'updateCaptureStatus' "app/(shell)/capture/actions.ts" || fail=1
   grep -Fq 'setCaptureStatus' lib/data/capture.ts || fail=1
   grep -Fq 'SET status = $1 WHERE id = $2 AND user_id = $3' lib/data/capture.ts || fail=1
   [ "$(grep -c 'UPDATE capture_inbox' lib/data/capture.ts)" = "1" ] || fail=1
   grep -RIn 'UPDATE' "app/(shell)/capture"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RInE "SET[[:space:]].*(processed_at|curated_ref|kind|body)" lib/data/capture.ts; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -Fq "user_id = \$1 AND processed_at IS NULL AND status = 'open'" lib/data/overview.ts || fail=1
   grep -Fq 'getUnprocessedInboxCount' lib/data/overview.ts || fail=1
   grep -RInE "DELETE[[:space:]]+FROM" lib/data/capture.ts "app/(shell)/capture"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn 'INSERT のみ' lib/data/capture.ts; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   (バッジ SQL は **user_id = $1 込みの完全形ピン**。UPDATE は lib/data/capture.ts に**1本のみ**・SET 対象は status のみ・action/page 側に UPDATE 文を書かない。旧契約コメント「INSERT のみ」の残存を否定 grep(更新漏れ防止)。**grep 群は大文字 SQL 前提** — 小文字 SQL による回避は既存コード規約 + 人間レビュー補完で受容(capture-spar rev.2 の同型受容に倣う)。)
   **※ 追随注記(capture-trash・2026-07-20)**: 論理削除の追加により本条件2 は読み替え — **`UPDATE capture_inbox` 出現数 = 1 → 3**(status / soft-delete / restore)・**SET 許可列 = status + deleted_at の2列**(否定 grep は topic/tags まで拡張)・**バッジ完全形ピンは `AND deleted_at IS NULL` 込みの新完全形**(旧完全形は新形の部分文字列として生存)。正典 = docs/design/basic/capture-trash.md §4 条件2。
3. **テスト(新設 tests/capture-status.test.ts — 既存テストは1文字も変えない)**: `test -f tests/capture-status.test.ts` + `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE -u SPAR_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL npm test` exit 0。ケース = updateCaptureStatus(getUser null → unauthorized・query 不呼 / 語彙外・UUID 不正 → bad_request・query 不呼 / 正常 → SQL に `SET status` と **params = [status, id, セッション userId]** / rowCount 0 → bad_request)+ **getUnprocessedInboxCount(モック db): SQL に `user_id = $1` と `status = 'open'` の両方を含み params[0] = userId**(user_id スコープの assert — sec Med-1・R2 強化)+ **listInbox の status 写像**(モック行 status: 'in_progress' → InboxRow.status — 凍結例外を開かず新テスト側で被覆)。
4. **UI**: `grep -Fq '処理中' "app/(shell)/capture/page.tsx"` + `grep -Fq 'updateCaptureStatus' "app/(shell)/capture/page.tsx"` 各 exit 0(**page.tsx 内に限定 — capture 配下に新規ファイルを作らない**)+ 既存ピン生存(CAPTURE_KINDS 3行・requireUser・機微情報)+ `dangerouslySetInnerHTML` 否定(capture 配下)。
5. **契約・正典更新**: `grep -Fq "status IN ('open','in_progress','done')" .claude/rules/capture.md` / `grep -q "capture-triage" .claude/rules/capture.md` / `grep -q "capture-triage" docs/design/detail/capture-spar.md` 各 exit 0。
6. **凍結・閉包**:
   **6a(広域凍結 diff — 変更対象と既存全テストを除く全コード)**:
   ```bash
   fail=0
   git diff --exit-code main -- lib/auth lib/search lib/spar lib/ui lib/db.ts lib/ingestion lib/data/knowledge.ts lib/data/review.ts lib/data/today.ts components scripts fixtures app/api app/login app/auth app/logout app/layout.tsx app/globals.css "app/(shell)/layout.tsx" "app/(shell)/spar-overlay.tsx" "app/(shell)/page.tsx" "app/(shell)/template.tsx" "app/(shell)/knowledge" "app/(shell)/retro" "app/(shell)/today" "app/(shell)/admin" "app/(shell)/capture/spar-panel.tsx" proxy.ts db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql db/migrations/0003_search_foundation.up.sql db/migrations/0003_search_foundation.down.sql db/migrations/0004_org_docs.up.sql db/migrations/0004_org_docs.down.sql db/migrations/0005_today_board.up.sql db/migrations/0005_today_board.down.sql next.config.mjs tsconfig.json package.json package-lock.json .env.example vitest.config.ts || fail=1
   exit "$fail"
   ```
   **6b(既存テストの全凍結 — 例外なし)**:
   ```bash
   fail=0
   git diff --exit-code main -- tests/proxy.test.ts tests/proxy-post.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/capture-save.test.ts tests/capture-data.test.ts tests/spar-llm.test.ts tests/spar-route.test.ts tests/parsers tests/ingestion tests/helpers tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts tests/embedding.test.ts tests/embed-index.test.ts tests/knowledge-data.test.ts tests/api-sync-embed.test.ts tests/markdown.test.ts tests/chunk.test.ts tests/knowledge-parser.test.ts tests/org-docs-sync.test.ts tests/knowledge-aggregation.test.ts tests/knowledge-recent.test.ts tests/decision-fallback.test.ts tests/overview-data.test.ts tests/review-data.test.ts tests/board-parser.test.ts tests/board-sync.test.ts tests/today-data.test.ts || fail=1
   exit "$fail"
   ```
   **6c(閉包判定 — executor は節目 commit 直前に実行。judge は commit 後 `git log main.. --stat` + `git diff main --stat` で変更ファイル列挙が §2 の8ファイル + docs に閉じることを確認)**:
   ```bash
   fail=0
   out=$(git status --porcelain -- app lib components db scripts proxy.ts tests) || fail=1
   printf '%s\n' "$out" | grep -Fv 'db/migrations/0006_capture_status' | grep -Fv 'lib/data/capture.ts' | grep -Fv 'lib/data/overview.ts' | grep -Fv 'app/(shell)/capture/actions.ts' | grep -Fv 'app/(shell)/capture/page.tsx' | grep -Fv 'tests/capture-status.test.ts' | grep -q . && fail=1
   exit "$fail"
   ```
   (`.bak` 等の類似名を作らない — grep -Fv は行単位・人間レビュー補完。)
7. **回帰・実機**: `npm run build` exit 0(.env 非接触・ダミー env のコマンドライン上書き)→ app 復帰 /login 200 + 未認証 GET /capture = 307(curl -L なし)。
8. **新規依存なし**: package diff exit 0(6a に包含)。

**手動確認**(機械判定外): INBOX 行で 未処理 → 処理中 → バッジが即減る → 完了/未処理へ戻す → バッジ連動 → 状態別の枠色。壁打ち・保存の既存動作が無事。

## 5. M5 設計への申し送り

1. **status と自動整理の関係を M5 で確定**: 消費対象を `processed_at IS NULL` のまま(status 無視)とするか、`status = 'open'` に絞る(処理中/完了は人間が握った行として書き戻さない)か。後者が自然だが M5 設計で決める。
2. **行表記の正**: processed_at 非 NULL かつ status='open' の行(M5 消費済み・手動 open)はバッジから除外される一方、行バッジは status 基準 — 表記の正(M5 が status='done' に揃えるか)を M5 設計で確定。v1 は「整理済み」補助表記で乖離を可視化。
3. 0006 の index (user_id, status) はバッジ/一覧用 — M5 の全ユーザー一括走査は既存 partial index(processed_at IS NULL)のまま。

## 実装の分割と禁止事項

- **/goal CT-1(1 goal)**: executor = frontend-engineer・**ターン上限 15**・節目 commit: (a) 0006 + データ層 + action + テスト緑(直前に条件6c) (b) UI + build 緑。0006 の down は Write ツール・ローカル適用は `psql < ファイル` リダイレクト形。**capture.md / capture-spar.md の注記(条件5)と Neon ブランチ検証は主セッション**。
- 禁止: §2 の変更対象8ファイル以外の変更・新設(`.bak` 等の類似名も)禁止。DELETE 文・status 以外への UPDATE・processed_at / curated_ref / kind / body への書き込み・.env(退避含む)・globals.css・.claude/(capture.md は主セッションのみ)・実 API キー・実ネットワークテスト。bash で SSoT repo 名と `>` を同時に含めない。build 後 next-env.d.ts 汚れは `git checkout --`。

## 次の手順

`/design-review capture-triage`(再レビュー: arch / sec)→ 全レンズ PASS → `/goal CT-1`。
