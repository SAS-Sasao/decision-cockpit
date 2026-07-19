# 基本設計: capture-triage(INBOX の状態管理 — 未処理 / 処理中 / 完了)

> 要求(ユーザー・2026-07-19): /capture の INBOX 行を**未処理 → 処理中 → 完了**に切り替えたい。**処理中にした時点で左上バッジ(未処理件数)がカウントダウン**すること。
> 根拠資料: .claude/rules/capture.md(現契約: processed_at NULL = 未処理・M5 の整理ループが消費)/ 0001 DDL /
> **実地偵察(2026-07-19)**: getUnprocessedInboxCount(lib/data/overview.ts)= `processed_at IS NULL` の count・**tests/overview-data.test.ts に同関数のピンは無い**(badge SQL 変更は凍結を割らない)/
> listInbox(lib/data/capture.ts)の行写像は tests/capture-data.test.ts がモック行(processed_at: null)で assert — **status 列追加は同テストの最小差分が必要(凍結例外)**/
> page.tsx の行バッジは processedAt 二値(未処理/処理済み)表示。
> ステータス: draft(design-review 待ち)
> 作成: 2026-07-19(主セッション執筆・軽量1枚形式 — 実行形条件込み・詳細設計省略(md-render / spar-overlay 前例))

## 1. 目的 / スコープ

### 状態モデル(本設計の中核)
- **新列 `status`(0006)**: `'open'`(未処理・既定)/ `'in_progress'`(処理中)/ `'done'`(完了)— **ユーザーの手動トリアージ状態**。
- **`processed_at` / `curated_ref` は従来どおり M5(自動整理)専用**のまま — 本機能は触らない(消費マークと手動状態の分離)。
- **バッジ = `processed_at IS NULL AND status = 'open'`** の count — 処理中/完了にした瞬間にカウントダウン(要求どおり)。M5 が消費した行も従来どおり減る。
- 遷移は**自由(可逆)**: 3状態間をボタンで任意に移動(完了 → 未処理も可 — 誤操作の取り消しを優先)。

### やる
1. **0006 マイグレーション**: `ALTER TABLE capture_inbox ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done'))` + `CREATE INDEX IF NOT EXISTS capture_inbox_user_status_idx ON capture_inbox (user_id, status)`。down = `ALTER TABLE capture_inbox DROP COLUMN IF EXISTS status;`(適用は人間承認のみ)。既存行は DEFAULT で 'open'(全行未処理のまま — 意味不変)。
2. **Server Action `updateCaptureStatus(id, status)`**(app/(shell)/capture/actions.ts に追加): `getUser()` null → unauthorized(DB 非接触)/ status 3語彙検証・id は UUID 形式検証(不正は bad_request)/ SQL = **`UPDATE capture_inbox SET status = $1 WHERE id = $2 AND user_id = $3`**(**本人行のみ・SET は status 列のみ** — processed_at / curated_ref / body / kind に触らない。$n 束縛)/ **rowCount 0(他人の行・不存在)→ bad_request**(存在の秘匿)/ 成功で revalidatePath("/capture")。
3. **データ層**: listInbox の SELECT・InboxRow に `status` を追加(lib/data/capture.ts)。getUnprocessedInboxCount の WHERE を `processed_at IS NULL AND status = 'open'` に変更(lib/data/overview.ts — 関数名・IF・呼び出し元は不変)。
4. **UI(page.tsx の INBOX 行)**: 状態チップ3種のボタン(現在状態を強調・クリックで updateCaptureStatus)。行の枠色 = open: 琥珀(--warn)/ in_progress: --accent / done: ミュート。行バッジ表記 = 未処理 / 処理中 / 完了(processedAt 表示は「整理済み」補助表記として残して良い — 実装裁量)。
5. **契約更新(.claude/rules/capture.md — 主セッション)**: status 列・3語彙・「**UI は本人行の status のみ UPDATE 可**(processed_at / curated_ref は M5 専用)」を追記 + **M5 設計への申し送り**(自動整理と status の関係 — 例: done を書き戻し対象から外すか — は M5 設計で確定)。
6. **Neon ブランチ検証(0006)+ ローカル適用**(主セッション — 本番適用は Vercel 展開時に 0003→0006 順・人間承認)。

### やらない
- processed_at / curated_ref の UI からの変更(M5 専用のまま)。**DELETE は引き続き禁止**(UPDATE の解禁は status 列1本に限定 — M4 の「UPDATE 禁止」は INSERT-only goal の範囲制約であり、本設計が契約を「status のみ可」へ明示拡張する)。
- M5(整理ループ)側の挙動定義(status との関係は M5 設計 — §5 申し送り)。
- kind / body / topic の編集・行の並び替え・フィルタタブ(未処理のみ表示等 — 実利用後)。
- 楽観更新・リアルタイム同期(revalidatePath の再描画で十分 — v1)。

## 2. アーキテクチャ上の位置づけ

- App 層 + DB(0006 の加法変更のみ — 既存列・既存行の意味は不変)。SSoT 非接触。認可 = セッション由来 user_id を UPDATE の WHERE に強制(本人行以外は rowCount 0 — アプリ層スコープの継承)。
- capture.md 契約の**加法拡張**(status 列)— M5 の消費契約(processed_at IS NULL・created_at 順)は不変のまま両立(バッジからは status≠'open' が抜けるが、M5 が拾う集合は変えない — 変えるかは M5 設計)。
- 凍結例外: lib/data/capture.ts / lib/data/overview.ts / app/(shell)/capture/page.tsx / actions.ts(変更対象)+ **tests/capture-data.test.ts(status 追加の最小差分 — diff ピン)**。spar 系・proxy・他画面は不変。

## 3. リスク・トレードオフ

1. **手動状態と M5 の意味論競合**: done の行を M5 が後で処理し得る(現契約のまま)— v1 受容・M5 設計で確定(§5 申し送り)。ユーザーへの見え方はバッジ減少が即時なので日常運用は成立。
2. **UPDATE 解禁の面**: SET status 単列・本人行 WHERE・語彙 CHECK(DB)+ サーバ検証の四重で、他列・他人行への波及を構造的に遮断。DELETE は不変で禁止。
3. 既存 7,838 timeline 行とは無関係(capture_inbox のみ)。埋め込み・検索・同期経路に非接触。
4. ボタン連打 → 同一行への UPDATE 競合は最後勝ち(単列・冪等的 — 実害なし)。

## 4. 受け入れ条件(機械判定)

1. **0006**(集計型):
   ```bash
   fail=0
   test -f db/migrations/0006_capture_status.up.sql || fail=1
   test -f db/migrations/0006_capture_status.down.sql || fail=1
   grep -Fq "ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'" db/migrations/0006_capture_status.up.sql || fail=1
   grep -Fq "CHECK (status IN ('open','in_progress','done'))" db/migrations/0006_capture_status.up.sql || fail=1
   grep -Fq 'capture_inbox_user_status_idx' db/migrations/0006_capture_status.up.sql || fail=1
   grep -E "DROP[[:space:]]+TABLE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM" db/migrations/0006_capture_status.up.sql; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   + ローカル適用済み(`docker compose exec` で status 列の実在 count=1)+ Neon ブランチ検証(主セッション)。
2. **action・データ層**(集計型):
   ```bash
   fail=0
   grep -Fq 'updateCaptureStatus' "app/(shell)/capture/actions.ts" || fail=1
   grep -Fq 'SET status = $1 WHERE id = $2 AND user_id = $3' lib/data/capture.ts || fail=1
   grep -Fq "processed_at IS NULL AND status = 'open'" lib/data/overview.ts || fail=1
   grep -Fq 'getUnprocessedInboxCount' lib/data/overview.ts || fail=1
   grep -RInE "DELETE[[:space:]]+FROM" lib/data/capture.ts "app/(shell)/capture"; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
   (UPDATE 文は lib/data/capture.ts に置く — action からは capture.ts の関数(例: setCaptureStatus)を呼ぶ。SQL ピンの1行維持。)
3. **テスト**: `test -f tests/capture-status.test.ts` + `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE -u SPAR_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL npm test` exit 0。新テスト = updateCaptureStatus(getUser null → unauthorized・query 不呼 / 語彙外・UUID 不正 → bad_request・query 不呼 / 正常 → SQL に `SET status` と params [status, id, userId] / rowCount 0 → bad_request)+ バッジ SQL の変更検証(モック db で overview の count SQL に `status = 'open'` が含まれる)。
   **3b. 凍結例外(tests/capture-data.test.ts)の差分ピン**:
   ```bash
   fail=0
   git diff main -- tests/capture-data.test.ts | grep '^+' | grep -v '^+++' | grep -v 'status' | grep -q . && fail=1
   exit "$fail"
   ```
   (追加行はすべて status 関連のみ。他の既存テストは1文字も変えない。)
4. **UI**: `grep -Fq '処理中' "app/(shell)/capture/page.tsx"`・`grep -Fq 'updateCaptureStatus' "app/(shell)/capture/page.tsx"`(または行コンポーネント経由 — capture 配下)各 exit 0 + 既存ピン生存(CAPTURE_KINDS 3行・requireUser・機微情報)+ `dangerouslySetInnerHTML` 否定(capture 配下)。
5. **契約更新**: `grep -Fq "status IN ('open','in_progress','done')" .claude/rules/capture.md` exit 0 + `grep -q "capture-triage" .claude/rules/capture.md` exit 0(M5 申し送り込み)。
6. **凍結・閉包**: 広域凍結 diff(spar-overlay 条件2a の列挙から **lib/data・app/(shell)/capture を除外し db/migrations の 0001〜0005 を個別列挙**した形 — 実行形は下記)+ 閉包判定(commit 前・変更 = db/migrations 0006×2 / lib/data/capture.ts / lib/data/overview.ts / actions.ts / page.tsx / tests/capture-status.test.ts / tests/capture-data.test.ts のみ):
   ```bash
   fail=0
   git diff --exit-code main -- lib/auth lib/search lib/spar lib/ui lib/db.ts lib/ingestion lib/data/knowledge.ts lib/data/review.ts lib/data/today.ts components scripts fixtures app/api app/login app/auth app/logout app/layout.tsx app/globals.css "app/(shell)/layout.tsx" "app/(shell)/spar-overlay.tsx" "app/(shell)/page.tsx" "app/(shell)/template.tsx" "app/(shell)/knowledge" "app/(shell)/retro" "app/(shell)/today" "app/(shell)/admin" "app/(shell)/capture/spar-panel.tsx" proxy.ts db/migrations/0001_auth_foundation.up.sql db/migrations/0001_auth_foundation.down.sql db/migrations/0002_ingestion_foundation.up.sql db/migrations/0002_ingestion_foundation.down.sql db/migrations/0003_search_foundation.up.sql db/migrations/0003_search_foundation.down.sql db/migrations/0004_org_docs.up.sql db/migrations/0004_org_docs.down.sql db/migrations/0005_today_board.up.sql db/migrations/0005_today_board.down.sql next.config.mjs tsconfig.json package.json package-lock.json .env.example vitest.config.ts || fail=1
   exit "$fail"
   ```
   + FROZEN_TESTS(M4 列挙から tests/capture-data.test.ts を除外・tests/capture-save.test.ts / spar 系 / proxy-post 含む全既存)無変更。
7. **回帰・実機**: `npm run build` exit 0(.env 非接触・ダミー env)→ app 復帰 /login 200 + 未認証 GET /capture = 307(curl -L なし)。
8. **新規依存なし**: package diff exit 0(条件6 に包含)。

**手動確認**(機械判定外): INBOX 行で 未処理 → 処理中 → バッジが即減る → 完了/未処理へ戻す → バッジ連動 → 他状態の行の枠色。壁打ち・保存の既存動作が無事。

## 5. M5 設計への申し送り

1. **status と自動整理の関係を M5 で確定**: 消費対象を `processed_at IS NULL` のまま(status 無視)とするか、`status = 'open'` に絞る(処理中/完了は人間が握った行として書き戻さない)か。後者が自然だが M5 設計で決める。
2. M5 が処理完了時に status も 'done' に揃えるか(バッジは processed_at で既に減るため機能上は任意)。
3. 0006 の index (user_id, status) はバッジ/一覧用 — M5 の全ユーザー一括走査は既存 partial index(processed_at IS NULL)のまま。

## 実装の分割と禁止事項

- **/goal CT-1(1 goal)**: executor = frontend-engineer・**ターン上限 15**・節目 commit: (a) 0006 + データ層 + action + テスト緑 (b) UI + build 緑。0006 の down は Write ツール・ローカル適用は `psql < ファイル` リダイレクト形。**capture.md の契約更新(条件5)と Neon ブランチ検証は主セッション**。
- 禁止: 上記変更対象以外の変更・新設(`.bak` 等の類似名も)禁止。DELETE 文・processed_at / curated_ref / kind / body への UPDATE・.env(退避含む)・globals.css・.claude/(capture.md の契約更新は主セッションのみ)・実 API キー・実ネットワークテスト。bash で SSoT repo 名と `>` を同時に含めない。build 後 next-env.d.ts 汚れは `git checkout --`。

## 次の手順

`/design-review capture-triage` → 全レンズ PASS → `/goal CT-1`。
