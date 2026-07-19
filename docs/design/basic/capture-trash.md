# 基本設計: capture-trash(INBOX ゴミ箱 — 論理削除 + 復元)

> 要求(ユーザー・2026-07-19): capture の INBOX にゴミ箱ボタンで**削除(論理削除)**機能を追加したい。
> 根拠資料: .claude/rules/capture.md(status 契約 = capture-triage 済み)/ docs/design/basic/capture-triage.md(CT-1 の機械ピン)/
> **実地偵察(2026-07-20)**: lib/data/capture.ts の `UPDATE capture_inbox` は現在 **1本**(CT-1 条件2 が「= 1」でピン — 本設計で **3本に読み替え必須**)/
> tests/capture-status.test.ts・capture-data.test.ts の SQL assert は **toContain(包含)**・写像 assert は個別 toBe / toEqual(undefined 無視)—
> **WHERE 句・SELECT 列・写像フィールドの追加では赤にならない = 凍結例外不要** / M4 条件2 の `count(` 否定 grep が capture.ts に生存(件数クエリを capture.ts に書けない)。
> ステータス: **PASS**(design-review — 全レンズ R2 PASS。reviews/capture-trash.md 参照。rev.3 = R2 の Low 吸収(listTrash クランプ assert・SELECT 列明文化・docs 2 の内訳・open 行表現))
> 作成: 2026-07-20(主セッション執筆・軽量1枚形式 — 実行形条件込み・詳細設計省略(capture-triage 前例))

## 1. 目的 / スコープ

### 論理削除モデル(本設計の中核)
- **新列 `deleted_at timestamptz`(0007・nullable・既定 NULL)** — NULL = 生存 / 非 NULL = ゴミ箱。**status(手動トリアージ)と直交**: 削除しても status・processed_at・curated_ref は保持され、**復元で元の状態にそのまま戻る**。status 語彙拡張('deleted' 追加)は不採用 — CHECK の張り替えが必要になり、復元時に元 status を失うため。
- **物理 DELETE は引き続き禁止**(DB 上は全行残る — db.md 整合)。
- 削除・復元とも**冪等**: `SET deleted_at = now() ... AND deleted_at IS NULL` / `SET deleted_at = NULL ... AND deleted_at IS NOT NULL`(二重実行は rowCount 0)。
- **バッジ・一覧・M5 いずれからも削除行を除外する方向**(バッジ/一覧は本設計で実施・M5 は申し送り)。

### やる
1. **0007 マイグレーション**: `ALTER TABLE capture_inbox ADD COLUMN IF NOT EXISTS deleted_at timestamptz;`(加法のみ・既存行は NULL = 全行生存で意味不変)。down = `ALTER TABLE capture_inbox DROP COLUMN IF EXISTS deleted_at;`(**適用は人間承認のみ・ゴミ箱状態を不可逆に失う**)。**追加 index なし**(ゴミ箱一覧は既存 (user_id, created_at DESC) index で足りる — 削除行は少量前提。理由明記)。
2. **データ層(lib/data/capture.ts)**: `softDeleteCapture(userId, id)` — SQL = **`UPDATE capture_inbox SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`**(1行維持)/ `restoreCaptureRow(userId, id)`(**action 名 restoreCapture との同名衝突を回避する Row 接尾辞**)— **`UPDATE capture_inbox SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`**(1行維持)。いずれも返り値 = rowCount。
   **listInbox / InboxRow は型・写像とも不変**(WHERE の1行を **`WHERE user_id = $1 AND deleted_at IS NULL`** に変えるのみ — 生存行の deletedAt は概念的に常に NULL のため**フィールドを追加しない**。R1 High の決着: 凍結 tests/capture-data.test.ts の完全形 toEqual は `null` を無視しない(undefined のみ無視)ため、deletedAt を InboxRow に足すと凍結×テスト緑×tsc の三すくみになる — 追加しないことで例外なしが成立)。
   新関数 `listTrash(userId, limit)` — SQL に **`WHERE user_id = $1 AND deleted_at IS NOT NULL`**(1行・完全形ピン)+ `ORDER BY created_at DESC, id DESC` + LIMIT クランプ(listInbox 同型・条件3 でクランプ1ケースを assert)。**SELECT には listInbox の列 + `deleted_at` を含める**(listInbox の SELECT は不変 — deleted_at を足さない。SELECT 列の実体検出はモックでは不可能なため手動確認(ゴミ箱一覧の表示)で補完 — 受容)。返り型は **専用型 `TrashRow = InboxRow & { deletedAt: string }`**(削除済みは必ず非 NULL — ISO 文字列写像)。**件数クエリは書かない**(M4 の `count(` 否定 grep 生存 — ゴミ箱リンクは件数なし表記)。
   **契約コメント2箇所の更新(成果物)**: ヘッダと insertCapture docstring の「INSERT + status 単列 UPDATE のみ」→「INSERT + status / deleted_at の限定 UPDATE のみ(capture-triage / capture-trash)」(旧文言は条件2 の否定 grep 対象)。**コメントに `UPDATE capture_inbox` のリテラルを書かない**(count=3 ピンの汚染防止 — 禁止事項)。
3. **Server Action(actions.ts)**: `deleteCapture(input: { id })` / `restoreCapture(input: { id })` — getUser() null → unauthorized(DB 非接触)/ UUID 形式検証(不正 bad_request・DB 非接触)/ **rowCount 0 → bad_request**(他人の行・不存在・二重操作が同一エラー — 列挙オラクルなし)/ 成功で revalidatePath("/capture")。CSRF は既存受容(capture-spar 詳細 §0-10・§5)を継承。
4. **バッジ(lib/data/overview.ts)**: getUnprocessedInboxCount の WHERE を **`user_id = $1 AND processed_at IS NULL AND status = 'open' AND deleted_at IS NULL`(完全形・1行維持)** に変更(**open かつ未処理の行**の削除で即カウントダウン — CT-1 と同じ連動)。
5. **UI(page.tsx 内限定・新規ファイル不可)**: 各 INBOX 行に**ゴミ箱ボタン(「削除」)**→ deleteCapture(確認ダイアログなし — **復元可能なので1クリック削除を許容**する意図的判断)。INBOX 下部に「**ゴミ箱を表示**」リンク(`?trash=1` — サーバ側クエリパラメータ切替・knowledge の qs 前例)→ 削除済み一覧(listTrash・各行に**復元ボタン** → restoreCapture・「受信箱へ戻る」リンク)。既存ピン(CAPTURE_KINDS・requireUser・機微情報・処理中)生存。
6. **契約・正典更新(主セッション)**: .claude/rules/capture.md に deleted_at 列・論理削除の契約(「UI は本人行の deleted_at の付与/解除のみ・物理 DELETE 禁止」)+ M5 申し送り参照。**capture-triage.md の読み替え注記**: 条件2 の「`UPDATE capture_inbox` 出現数 = 1」→ **3**(status / soft-delete / restore)・SET 対象許可 = status + deleted_at・バッジ完全形ピン → deleted_at 込みの新完全形(いずれも `capture-trash` リテラル)。
7. **Neon ブランチ検証(0007)+ ローカル適用**(主セッション — 本番適用は Vercel 展開時に 0003→0007 順・人間承認)。

### やらない
- **物理 DELETE**(恒久禁止のまま)。ゴミ箱の自動空化・保持期限(実利用後)。
- ゴミ箱内の一括操作・完全削除 UI。
- M5(整理ループ)側の挙動定義 — **削除行を消費対象から除外するか(推奨)は M5 設計で確定**(§5 申し送り)。
- spar_conclusion 保存・kind/body 編集・既存テストの変更(**凍結例外なし** — 偵察で toContain/個別 assert を実証済み)。

## 2. アーキテクチャ上の位置づけ

- App 層 + DB(0007 の加法変更のみ)。SSoT 非接触。認可 = セッション由来 user_id を UPDATE の WHERE・一覧・バッジすべてに強制(CT-1 と同型)。
- capture.md 契約の加法拡張(deleted_at)— M5 消費契約(processed_at IS NULL・partial index)は本設計では不変(削除行の除外は M5 設計判断 — 既存 partial index が deleted を含む点も申し送り)。
- 変更対象(**コード7ファイル + docs 2**): db/migrations/0007 up/down(2)・lib/data/capture.ts・lib/data/overview.ts・app/(shell)/capture/actions.ts・app/(shell)/capture/page.tsx・tests/capture-trash.test.ts(新設)+ docs(capture.md・capture-triage.md 注記 — 主セッション)。**既存テストは全ファイル凍結(例外なし)**。

## 3. リスク・トレードオフ

1. **CT-1 ピンとの衝突**: 「UPDATE 出現数 = 1」は本設計で 3 に更新 — 正典読み替え注記(§1-6)+ 本設計の新ゲート(条件2)で機械判定を引き継ぐ。SET 対象否定 grep は (processed_at|curated_ref|kind|body|topic|tags) に拡張し、**許可 = status・deleted_at の2列のみ**を維持。
2. **確認なし1クリック削除**: 復元可能(ゴミ箱一覧 + 復元ボタン)を担保に受容。誤削除はバッジ/一覧から消えるが1クリックで戻せる。
3. **M5 との意味論**: 削除行が現契約のまま M5 に消費され得る(processed_at IS NULL なら)— v1 受容・M5 設計で除外を確定(§5)。
4. 削除・復元の連打は冪等 SQL(deleted_at IS NULL / IS NOT NULL ガード)で安全。バッジ・一覧は revalidatePath で追随。

## 4. 受け入れ条件(機械判定)

1. **0007**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0007_capture_trash.up.sql || fail=1
   test -f db/migrations/0007_capture_trash.down.sql || fail=1
   grep -Fq 'ADD COLUMN IF NOT EXISTS deleted_at timestamptz' db/migrations/0007_capture_trash.up.sql || fail=1
   grep -E "DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0007_capture_trash.up.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + ローカル適用済み(`docker compose exec -T db psql -U cockpit -d cockpit -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'capture_inbox' AND column_name = 'deleted_at';"` = 1)+ Neon ブランチ検証(主セッション)。
2. **データ層・action**(集計型):
   ```bash
   fail=0
   grep -Fq 'softDeleteCapture' lib/data/capture.ts || fail=1
   grep -Fq 'restoreCaptureRow' lib/data/capture.ts || fail=1
   grep -Fq 'listTrash' lib/data/capture.ts || fail=1
   grep -Fq 'TrashRow' lib/data/capture.ts || fail=1
   grep -Fq 'SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL' lib/data/capture.ts || fail=1
   grep -Fq 'SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL' lib/data/capture.ts || fail=1
   grep -Fq 'WHERE user_id = $1 AND deleted_at IS NULL' lib/data/capture.ts || fail=1
   grep -Fq 'WHERE user_id = $1 AND deleted_at IS NOT NULL' lib/data/capture.ts || fail=1
   [ "$(grep -c 'UPDATE capture_inbox' lib/data/capture.ts)" = "3" ] || fail=1
   grep -RIn 'UPDATE' "app/(shell)/capture"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RInE "SET[[:space:]].*(processed_at|curated_ref|kind|body|topic|tags)" lib/data/capture.ts; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -Fq 'deleteCapture' "app/(shell)/capture/actions.ts" || fail=1
   grep -Fq 'restoreCapture' "app/(shell)/capture/actions.ts" || fail=1
   grep -Fq "user_id = \$1 AND processed_at IS NULL AND status = 'open' AND deleted_at IS NULL" lib/data/overview.ts || fail=1
   grep -RInE "DELETE[[:space:]]+FROM" lib/data/capture.ts "app/(shell)/capture"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn 'INSERT のみ' lib/data/capture.ts; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn 'status 単列 UPDATE のみ' lib/data/capture.ts; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   (SQL は大文字規約・ピン行は1行維持。UPDATE は capture.ts に **3本のみ**(status / soft-delete / restore)・SET 許可列 = status・deleted_at。**listInbox / listTrash の WHERE は完全形ピン**(user_id スコープの機械判定 — R1 sec Med-1 の決着。旧「deleted_at IS NULL 単独 grep」は恒真のため撤去)。バッジは deleted_at 込みの**新完全形**。旧契約コメント2種(「INSERT のみ」「status 単列 UPDATE のみ」)の残存を否定 grep。小文字 SQL 回避は人間レビュー補完 — CT-1 と同受容。)
3. **テスト(新設 tests/capture-trash.test.ts — 既存テストは1文字も変えない)**: `test -f` + `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE -u SPAR_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL npm test` exit 0。ケース = deleteCapture / restoreCapture(getUser null → unauthorized・query 不呼 / UUID 不正 → bad_request・query 不呼 / 正常 → SQL に `SET deleted_at`・**params = [id, セッション userId]** / rowCount 0 → bad_request)+ **listInbox の SQL に `user_id = $1 AND deleted_at IS NULL`** / **listTrash の SQL に `user_id = $1` と `deleted_at IS NOT NULL` と `ORDER BY created_at DESC, id DESC` を含み params[0] = userId・クランプ1ケース(999→100)・写像(モック行 deleted_at: Date → TrashRow.deletedAt が ISO 文字列)** / **バッジ SQL に `deleted_at IS NULL` と `user_id = $1` を含み params[0] = userId**。
4. **UI**: `grep -Fq 'ゴミ箱' "app/(shell)/capture/page.tsx"` + `grep -Fq 'deleteCapture' "app/(shell)/capture/page.tsx"` + `grep -Fq 'restoreCapture' "app/(shell)/capture/page.tsx"` + `grep -Fq 'trash' "app/(shell)/capture/page.tsx"` 各 exit 0(**page.tsx 内限定**)+ 既存ピン生存(CAPTURE_KINDS 3行・requireUser・機微情報・処理中)+ `dangerouslySetInnerHTML` 否定(capture 配下)。
5. **契約・正典**: `grep -Fq 'deleted_at' .claude/rules/capture.md` / `grep -q "capture-trash" .claude/rules/capture.md` / `grep -q "capture-trash" docs/design/basic/capture-triage.md` 各 exit 0(読み替えの実体は人間レビュー補完 — CT-1 と同受容)。
6. **凍結・閉包**:
   **6a(広域凍結 diff — CT-1 条件6a の列挙に db/migrations/0006 up/down と tests/capture-status.test.ts を追加した形)**:
   ```bash
   fail=0
   git diff --exit-code main -- lib/auth lib/search lib/spar lib/ui lib/db.ts lib/ingestion lib/data/knowledge.ts lib/data/review.ts lib/data/today.ts components scripts fixtures app/api app/login app/auth app/logout app/layout.tsx app/globals.css "app/(shell)/layout.tsx" "app/(shell)/spar-overlay.tsx" "app/(shell)/page.tsx" "app/(shell)/template.tsx" "app/(shell)/knowledge" "app/(shell)/retro" "app/(shell)/today" "app/(shell)/admin" "app/(shell)/capture/spar-panel.tsx" proxy.ts db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql db/migrations/0003_search_foundation.up.sql db/migrations/0003_search_foundation.down.sql db/migrations/0004_org_docs.up.sql db/migrations/0004_org_docs.down.sql db/migrations/0005_today_board.up.sql db/migrations/0005_today_board.down.sql db/migrations/0006_capture_status.up.sql db/migrations/0006_capture_status.down.sql next.config.mjs tsconfig.json package.json package-lock.json .env.example vitest.config.ts || fail=1
   exit "$fail"
   ```
   **6b(既存テスト全凍結 — CT-1 条件6b の列挙 + tests/capture-status.test.ts)**:
   ```bash
   fail=0
   git diff --exit-code main -- tests/proxy.test.ts tests/proxy-post.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/capture-save.test.ts tests/capture-data.test.ts tests/capture-status.test.ts tests/spar-llm.test.ts tests/spar-route.test.ts tests/parsers tests/ingestion tests/helpers tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts tests/embedding.test.ts tests/embed-index.test.ts tests/knowledge-data.test.ts tests/api-sync-embed.test.ts tests/markdown.test.ts tests/chunk.test.ts tests/knowledge-parser.test.ts tests/org-docs-sync.test.ts tests/knowledge-aggregation.test.ts tests/knowledge-recent.test.ts tests/decision-fallback.test.ts tests/overview-data.test.ts tests/review-data.test.ts tests/board-parser.test.ts tests/board-sync.test.ts tests/today-data.test.ts || fail=1
   exit "$fail"
   ```
   **6c(閉包判定 — executor は節目 commit 直前に実行。judge は commit 後 `git log main.. --stat` + `git diff main --stat` でコード7 + docs 2 に閉じることを確認。docs 2 = .claude/rules/capture.md + docs/design/basic/capture-triage.md — 本設計書・reviews/ はレビュー成果物として許容)**:
   ```bash
   fail=0
   out=$(git status --porcelain -- app lib components db scripts proxy.ts tests) || fail=1
   printf '%s\n' "$out" | grep -Fv 'db/migrations/0007_capture_trash' | grep -Fv 'lib/data/capture.ts' | grep -Fv 'lib/data/overview.ts' | grep -Fv 'app/(shell)/capture/actions.ts' | grep -Fv 'app/(shell)/capture/page.tsx' | grep -Fv 'tests/capture-trash.test.ts' | grep -q . && fail=1
   exit "$fail"
   ```
   (`.bak` 等の類似名を作らない — 人間レビュー補完。)
7. **回帰・実機**: `npm run build` exit 0(.env 非接触・`docker compose run --rm -T -e DATABASE_URL=postgres://dummy:dummy@db:5432/dummy app npm run build` 形)→ app 復帰 /login 200 + 未認証 GET /capture = 307(curl -L なし)。
8. **新規依存なし**: package diff exit 0(6a に包含)。

**手動確認**(機械判定外): **未処理(open)の行**のゴミ箱ボタン → 一覧・バッジから即消える(処理中/完了の行の削除は一覧から消えるがバッジは元々非計上 — 表現の正確化)→ 「ゴミ箱を表示」→ 削除済み一覧 → 復元 → 受信箱に status ごと戻りバッジ連動。壁打ち・保存・状態トリアージの既存動作が無事。

## 5. M5 設計への申し送り

1. **削除行の消費除外を M5 で確定**(推奨: 消費対象を `processed_at IS NULL AND deleted_at IS NULL` に)— 現契約のままだと削除行も書き戻され得る(v1 受容)。
2. 既存 partial index(`(created_at) WHERE processed_at IS NULL`)は deleted 行を含む — M5 で除外を採る場合は index 追随(`AND deleted_at IS NULL` 付き partial への張り替え)も M5 のマイグレーションで判断。
3. capture-triage §5 の既存申し送り(status との関係・行表記の正)と併せて一括決着すること。

## 実装の分割と禁止事項

- **/goal CT-2(1 goal)**: executor = frontend-engineer・**ターン上限 15**・節目 commit: (a) 0007 + データ層 + action + テスト緑(直前に条件6c) (b) UI + build 緑。0007 の down は Write ツール・ローカル適用は `psql < ファイル` リダイレクト形。**capture.md / capture-triage.md の注記(条件5)と Neon ブランチ検証(0007)は主セッション**。
- 禁止: §2 の変更対象以外の変更・新設(`.bak` 等の類似名も)禁止。物理 DELETE 文・status/deleted_at 以外への UPDATE・processed_at / curated_ref / kind / body / topic / tags への書き込み・**InboxRow 型の変更(deletedAt を足さない — R1 High の決着)**・**コメントへの `UPDATE capture_inbox` リテラル(count=3 汚染防止)**・.env(退避含む)・globals.css・.claude/(capture.md は主セッションのみ)・docs(注記は主セッションのみ)・既存テスト・実 API キー・実ネットワークテスト。SQL は大文字規約。bash で SSoT repo 名と `>` を同時に含めない。build 後 next-env.d.ts 汚れは `git checkout --`。

## 6. 未解決の問い

1. ゴミ箱の保持期限・自動空化(v1 なし — 実利用後。期限設計時は「物理 DELETE 禁止」との整合(匿名化/アーカイブ等)を再検討)。
2. ゴミ箱一覧の上限(v1 は listInbox と同じクランプ 1..100・既定 50)。
3. M5 消費からの除外(§5 — M5 設計で確定)。
4. **削除済み行が M5 に書き戻される窓の UI 注記**(「削除しても整理ループは対象にし得る」等)の要否 — M5 設計まで保留(削除ユースケースに「撤回」が含まれるなら M5 で除外を採る前提)。

## 次の手順

`/design-review capture-trash` → 全レンズ PASS → `/goal CT-2`。
