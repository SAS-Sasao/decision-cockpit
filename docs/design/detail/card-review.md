# 詳細設計: card-review(/today のカードから AI レビューを依頼する)

- 基本設計: docs/design/basic/card-review.md(3レンズ PASS・2026-08-09)。
  申し送り = docs/design/reviews/card-review.md 末尾の10項目。本書はそれらを確定する。
- 実装分割: **/goal CR-1**(0011 + submit.ts 抽出 + route 書き換え + card-prompt + lookup + テスト)→
  **/goal CR-2**(/today UI + 取得 + e2e)。

## 0. 申し送り1の決着 — route.ts の正典と既存ピンの成否

**route.ts に残すもの** = ①認可(`getUser` + `isAdmin`)②リクエスト本文のパースと `validateQuestion`
③ **error 語彙 → HTTP status の写像** ④レスポンス生成。
**submit.ts へ移すもの** = PAT 検査以降の受理シーケンス全体(§2.1)。

この分割により **review-loop 詳細 §4 RL-1 #3 の既存ピンは2つとも成立し続ける**:
`await isAdmin(` = 2(POST/GET 各1・変更なし)/ 4語彙の grep(`STATUS_BY_ERROR` のキーとして route.ts に
残る)。**したがって review-loop.md の §4 は改訂不要**。ただし §2.2 の「POST の処理順」は実装の所在が
変わるため、**§2.2 の POST 手順2〜7(PAT 検査以降)の記述を「PAT 検査以降は lib/review/submit.ts に
移設(正典 = card-review 詳細 §2.1)」の**ポインタ1行に**置換する**(追記ではない — 誤った全文と
正典ポインタが同居すると、次に受理シーケンスを変える人がどちらを直すか決まらない。R2 arch 1-b)。
成果物・閉包 allowlist に含める。

## 0b. 既存受容の更新 — WBS の実名・案件情報が外部送信される(R1 sec S-13)

`docs/design/basic/today-view.md` は board_items を「**実名(担当者)・案件固有情報を含む**」とし、
その受容根拠に「**外部送信なし**」を挙げている。本設計は WBS の `title` とファイルパス
(組織名・案件名を含み得る)を question に埋めて **GitHub Actions と Anthropic に送る**ため、
**この受容は破れる**。既存の恒久ガード(埋め込み経路への grep)は緑のままなので、
記録しないと不変量だけが静かに崩れる。

**決着**: 本設計で**受容し直す**。根拠 = private repo・admin 限定・確認ステップで人が読む・
CI の機械防御(allowedTools に Bash/ネットワーク系なし)・artifact 保持1日。
**確認パネルの注記に「WBS のタイトルとファイルパス(組織名・担当者名を含む場合があります)が
送信されます」を明記**し、review-loop の「実名を書かない」注記が**カード経路では
システム側の挿入により成立しない**ことを利用者に開示する。
**`docs/design/basic/today-view.md` への追記の形**(R2 sec T-1): 同書の「外部送信なし」は
括弧内で「**board_items は埋め込まない — OpenAI へ送るデータの増分ゼロ**」と**埋め込み経路に限定**して
定義されている。追記は「**埋め込み経路は不変。ただし card-review により CI レビュー経路で
title とパスが外部送信される(card-review 詳細 §0b で受容)**」と**書き分ける**
(限定形を一般形にすり替えて「埋め込みはしていないので不変」で終わらせない)。
**成果物・閉包 allowlist に含め、追記されたことを §4 でピンする**(R2 sec T-2 — allowlist だけでは
無改訂でも PASS してしまう)。

## 1. スキーマ DDL(0011_review_card_ref)

**再実行安全にする**(申し送り5 / data 1-d): 列は `ADD COLUMN IF NOT EXISTS`、制約は
`pg_constraint` 存在検査つきの `DO` ブロックで冪等化する。これにより db-recovery.md の
replay(`ON_ERROR_STOP=1` で up を順に流す)が2回目でも停止しない。

```sql
-- 0011_review_card_ref.up.sql
-- 対象設計: docs/design/detail/card-review.md §1(design-review PASS 後に適用)
-- review_requests に「依頼元カード」の参照を additive に足す(既存行は全列 NULL のまま)。
-- CI(review_bot)は列限定 GRANT のため新列を読めない・書けない(意図的)。
ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS card_kind       text,
  ADD COLUMN IF NOT EXISTS card_source     text,
  ADD COLUMN IF NOT EXISTS card_file_path  text,
  ADD COLUMN IF NOT EXISTS card_item_key   text,
  ADD COLUMN IF NOT EXISTS card_capture_id uuid,
  ADD COLUMN IF NOT EXISTS card_title      text;

DO $$
BEGIN
  -- 値域(0009 board_overrides と同水準。nullable と両立させるため IS NULL OR … 形)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_kind_domain' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_kind_domain
      CHECK (card_kind IS NULL OR card_kind IN ('wbs','capture'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_source_domain' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_source_domain
      CHECK (card_source IS NULL OR card_source = 'cc-sier-organization');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_path_shape' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_path_shape
      CHECK (card_file_path IS NULL OR (
        card_file_path ~ '^\.companies/[^/]+/docs/secretary/[^/]+-wbs\.md$'
        AND position('..' in card_file_path) = 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_item_key_nonempty' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_item_key_nonempty
      CHECK (card_item_key IS NULL OR card_item_key <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_requests_card_title_len' AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_title_len
      CHECK (card_title IS NULL OR char_length(card_title) <= 500);
  END IF;
  -- 形状(**CASE 全域形**)。※`card_kind_domain` と**組で load-bearing**: 形状 CHECK の `''` 分岐は
  -- `coalesce(card_kind,'')` なので **空文字の kind** も「参照列すべて NULL」なら通す。未知値を弾くのは
  -- domain CHECK 側の責務(両方を §4 でピンする — R2 data N6)。OR 連結は使わない — card_kind が NULL の行では `card_kind = 'wbs'` が
  -- NULL に評価され、**式全体が NULL = CHECK 合格**になる(R1 data G1)。
  -- 実測(2026-08-09・ローカル db): OR 形は「kind NULL + capture_id」「kind NULL + wbs 完全形」を
  -- 受理してしまい、部分欠落形だけを弾く(最も気づきにくい分類)。CASE + coalesce 形は
  -- 正常3形を受理・違反5形すべてを拒否することを実測済み。
  -- WBS は card_title 必須(差異注記の入力)。capture は topic が nullable なので card_title も nullable。
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'review_requests_card_ref_shape'
                    AND conrelid = 'review_requests'::regclass) THEN
    ALTER TABLE review_requests ADD CONSTRAINT review_requests_card_ref_shape
      CHECK (
        CASE coalesce(card_kind, '')
          WHEN ''        THEN (card_source IS NULL AND card_file_path IS NULL
                               AND card_item_key IS NULL AND card_capture_id IS NULL
                               AND card_title IS NULL)
          WHEN 'wbs'     THEN (card_source IS NOT NULL AND card_file_path IS NOT NULL
                               AND card_item_key IS NOT NULL AND card_title IS NOT NULL
                               AND card_capture_id IS NULL)
          WHEN 'capture' THEN (card_capture_id IS NOT NULL AND card_source IS NULL
                               AND card_file_path IS NULL AND card_item_key IS NULL)
          ELSE false
        END
      );
  END IF;
END $$;

-- カード別最新1件(DISTINCT ON)の順序供給用。ORDER BY と同じ方向・同じ列順にする
-- (前5列 ASC + created_at DESC の混在。NULLS 位置は両側とも ASC 既定 = NULLS LAST)。
CREATE INDEX IF NOT EXISTS review_requests_card_latest_idx
  ON review_requests (card_kind, card_source, card_file_path, card_item_key, card_capture_id,
                      created_at DESC, id DESC)
  WHERE card_kind IS NOT NULL;
-- 末尾 id DESC は CARD_LATEST_SQL のタイブレーク(§2.5)と方向まで一致させる。
-- 90日窓は6列目の範囲述語なので前方一致には使えない(順序供給とフィルタのみ)— 0010 の
-- 日次カウントと同型の受容。
```

```sql
-- 0011_review_card_ref.down.sql
-- 適用は人間の承認手順のみ(列 DROP = カード参照履歴の不可逆消失を伴う)。
DROP INDEX IF EXISTS review_requests_card_latest_idx;
ALTER TABLE review_requests
  DROP CONSTRAINT IF EXISTS review_requests_card_ref_shape,
  DROP CONSTRAINT IF EXISTS review_requests_card_title_len,
  DROP CONSTRAINT IF EXISTS review_requests_card_item_key_nonempty,
  DROP CONSTRAINT IF EXISTS review_requests_card_path_shape,
  DROP CONSTRAINT IF EXISTS review_requests_card_source_domain,
  DROP CONSTRAINT IF EXISTS review_requests_card_kind_domain,
  DROP COLUMN IF EXISTS card_title,
  DROP COLUMN IF EXISTS card_capture_id,
  DROP COLUMN IF EXISTS card_item_key,
  DROP COLUMN IF EXISTS card_file_path,
  DROP COLUMN IF EXISTS card_source,
  DROP COLUMN IF EXISTS card_kind;
```

**review_bot の GRANT は変更しない**(列限定 GRANT は列追加で自動拡張されない = 新列は CI から不可視)。

**ただし `question` 列経由の到達は残る**(R2 sec S-14 / data G14 — 受容として記録する):
`docs/setup/organize-role.sql` は review_bot を分離した理由を「共有すると review workflow の侵害で
**capture_inbox 本文まで読める**ため」と書いているが、本設計は capture 本文(≤500字)を `question` に
複製し、`question` は review_bot の SELECT 対象(claim 行に限らず**履歴全行**)である。
つまりロール分離が守っていた性質は**複製経由で部分的に崩れる**。**受容**する根拠 =
(a) 複製されるのは admin が確認パネルで**目視して送った**本文のみ (b) 500字に切り詰め済み
(c) 元々 CI の artifact・実行ログにも同じ本文が出る(review-loop §4 の既存受容)。
**organize-role.sql のコメントに「question 経由の到達は card-review §1 で受容済み」を追記する**
(成果物・閉包 allowlist に含める — 分離理由の記述と実態を食い違わせない)。
**db-recovery.md** の migration 列挙を **0009 → 0011** に更新し、「0010・0011 も replay 可能」と明記する。

## 2. 関数 / API インターフェース

### 2.1 `lib/review/submit.ts`(新設・受理シーケンスの正典)

```ts
export type ReviewSubmitError =
  | "review_not_configured" | "busy" | "daily_limit" | "dispatch_failed";

export type ReviewCardRef =
  | { kind: "wbs"; source: string; filePath: string; itemKey: string; title: string }
  | { kind: "capture"; captureId: string; title: string | null };

export async function submitReview(
  input: { requestedBy: string; question: string; card?: ReviewCardRef }
): Promise<{ ok: true; id: string } | { ok: false; error: ReviewSubmitError }>;
// テストは vi.mock("../db") と globalThis.fetch のスタブで順序を記録する(公開引数を増やさない)。
```

**処理順(この順序が契約 — テストで記録する)**:
1. `REVIEW_DISPATCH_PAT` 未設定 → `review_not_configured`(**INSERT より前・fail-closed**)
2. `SWEEP_PENDING_SQL` → `SWEEP_RUNNING_SQL`(この2文の順序も固定)
3. `INFLIGHT_SQL` → true なら `busy`
4. `DAILY_COUNT_SQL` → `>= DAILY_LIMIT` なら `daily_limit`
5. INSERT: `card` 無し = `INSERT_SQL`(2列)/ `card` 有り = `INSERT_WITH_CARD_SQL`
6. dispatch(`DISPATCH_URL` へ POST)→ 204 以外は `DISPATCH_FAILED_SQL` + `dispatch_failed`

**`server-only` 方針**(sec S-4): `submit.ts` と `card-lookup.ts` は **`import "server-only"` を付ける**
(PAT と DB に触るため。vitest は server-only をスタブに alias 済みなのでテストから import できる)。
`card-prompt.ts` / `card-key.ts` は純関数のみ = 付けない(client からも使う)。
**`SubmitDeps` は公開引数に出さない**(sec S-3): `submitReview` の公開シグネチャは
`(input): Promise<…>` の1引数に固定し、テスト用の輸出(`__setDepsForTest` 等)も作らない。
差し替えの形は**2つに分ける**(R2 arch N-5 / sec 新-B):
**DB = `vi.mock("../db")`(モジュール境界の差し替え)**・
**dispatch = 呼び出し時に `globalThis.fetch` を参照する**(モジュール評価時に const へ束縛しない —
束縛すると `vi.stubGlobal("fetch", …)` が効かず、実ネットワークに出るか秘密衛生のアサートが
静かに落ちる)。用途のない `now` は持たない。

**秘密衛生の契約**: PAT を含むヘッダ・リクエストをログに出さない / GitHub のエラーボディ・status を
戻り値に載せない(返すのは `ReviewSubmitError` の4リテラルのみ)/ ログは固定文言 + request id。
**question の非空は呼び出し側の責務**(route = `validateQuestion` / action = `buildCardQuestion` が
非空を保証)。DB の `btrim(question) <> ''` が最終防御(申し送り9)。

### 2.2 `lib/review/api-lib.ts`(追記のみ・既存は不変)

```ts
export const INSERT_WITH_CARD_SQL = `
  INSERT INTO review_requests
    (requested_by, question, card_kind, card_source, card_file_path, card_item_key,
     card_capture_id, card_title)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
export const CARD_LATEST_SQL = `…`;   // §2.5
export const STALE_PENDING_MINUTES = 15;   // UI(isStaleReview)と SQL の同値を保つための定数
export const STALE_RUNNING_MINUTES = 60;
export const INFLIGHT_ACTIVE_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM review_requests
     WHERE (status = 'pending' AND created_at >= now() - interval '15 minutes')
        OR (status = 'running' AND started_at >= now() - interval '60 minutes')
  ) AS inflight`;                          // 括弧付けを含めて確定(stale 超過は母集団から外す)
```

**goal 割り当て**(arch 6-c): `INSERT_WITH_CARD_SQL` と `STALE_*_MINUTES` は **CR-1**、
`CARD_LATEST_SQL` と `INFLIGHT_ACTIVE_SQL` は **CR-2**(api-lib は両 goal の allowlist に入る)。

`SWEEP_*_SQL` は現状のリテラル(`interval '15 minutes'` / `'60 minutes'`)のまま変更しない
(R1 arch 1-a / data G3): 定数から組み立てると **review-loop 詳細 §4 RL-1 #2 の
`grep -qF "15 minutes" lib/review/api-lib.ts` が落ちる**。既存ピンを壊さず二重定義の乖離だけを防ぐため、
**定数と SQL 文字列の同値をテストでピン**する(`SWEEP_PENDING_SQL` に
`` `interval '${STALE_PENDING_MINUTES} minutes'` `` と等価な文字列が含まれることを assert)。
`INFLIGHT_ACTIVE_SQL` も同じリテラル形にし、同値テストの母集団に加える。
→ **§0 の「review-loop.md §4 は改訂不要」はこの決着によって成立する**(#2 も #3 も無傷)。

### 2.3 `app/api/review/route.ts`(書き換え・振る舞い不変)

```ts
const STATUS_BY_ERROR: Record<ReviewSubmitError, number> = {
  review_not_configured: 503, busy: 409, daily_limit: 429, dispatch_failed: 502,
};
// POST: getUser → 401 / isAdmin → 403 / json parse → 400 / validateQuestion → 400
//       → submitReview({ requestedBy: user.id, question })
//       → !ok なら { error } を STATUS_BY_ERROR[error] で返す / ok なら { id } 200
// GET: 変更なし
```

### 2.4 `lib/review/card-prompt.ts`(新設・純関数)

```ts
export const CARD_BODY_MAX_CHARS = 500;
export type CardForPrompt =
  | { kind: "wbs"; title: string; filePath: string; itemKey: string }
  | { kind: "capture"; captureKind: "next_move" | "issue"; topic: string | null; body: string };

export function buildCardQuestion(card: CardForPrompt): string;
```

- 固定文言は関数内リテラル。可変部(title / body / topic)は **コードポイント単位で 500 字**に切り詰め。
- **最後に question 全体を `QUESTION_MAX_CHARS`(2000)で切り詰める**(部品の和に依存しない)。
- 切り詰めは既存 `truncateResult` と同単位(サロゲート非分断)。**空文字を返さない**
  (テンプレートの固定文言が常に含まれるため構造的に非空)。

### 2.5 `lib/data/today.ts`(追記)

```ts
export type LatestCardReview = {
  cardKey: string;                // cardKeyOf() の結果(server 側で埋める)
  status: "pending" | "running" | "done" | "error";
  result: string | null; resultTruncated: boolean; errorKind: string | null;
  runRef: string | null; createdAt: string; startedAt: string | null;
  cardTitle: string | null;       // 依頼時のスナップショット(表示側で現在の title と突き合わせる)
};
// user_id 非スコープは意図的(単一ユーザー前提 — board-override.ts の家風と同じ。R2 sec S-15)。
// WBS カードは共有物なので他 admin の依頼結果も見える。呼び出しは admin 限定(§2.8)。
// **capture 由来行も同じ配列に入る**(cardTitle = topic のスナップショット・result = その本文を
// 踏まえたレビュー)。capture.md の「参照は所有者本人のみ」に対しては**単一ユーザー前提で受容**する
// (盤面に一致するカードが無ければ表示されないだけで、行自体は admin のクライアントに渡る)。
// 複数ユーザー運用に移行する場合は requested_by スコープを足すこと(R3 data A4)。
export async function listLatestCardReviews(): Promise<LatestCardReview[]>;  // 配列(Map ではない)
export async function hasInflightReview(): Promise<boolean>;   // グローバル同時1件の判定(申し送り4)
```

`CARD_LATEST_SQL`:
```sql
SELECT DISTINCT ON (card_kind, card_source, card_file_path, card_item_key, card_capture_id)
       card_kind, card_file_path, card_item_key, card_capture_id, card_title,
       status, result, result_truncated, error_kind, run_ref, created_at, started_at
  FROM review_requests
 WHERE card_kind IS NOT NULL
   AND created_at >= now() - interval '90 days'
 ORDER BY card_kind, card_source, card_file_path, card_item_key, card_capture_id,
          created_at DESC, id DESC
```
(**このフェンスが正典** — 散文と食い違わせない。R2 data N1 / arch N-1)
**窓を入れる**(R1 data G8): 物理 DELETE なし × 日次10件で行が単調増加し、`result`(最大30000字)を
全件フェッチすると /today の表示ごとに重くなる。`WHERE card_kind IS NOT NULL AND created_at >=
now() - interval '90 days'` を加える(90日より古いカードのレビューは UI に出さない — 履歴は
壁打ちパネル側で参照可能)。**タイブレーク**は `created_at DESC, id DESC`(同時刻の非決定を排除・
capture.ts の家風と同じ。索引末尾にも `id` を含める)。

`hasInflightReview()` は **`INFLIGHT_ACTIVE_SQL`**(§2.2 で本文確定)を使い、**stale 超過行を
母集団から外す**(`isStaleReview` と同じ閾値。境界の扱いは §3 の決着(経過 >= で stale・SQL は経過 > )に従う)。

### 2.5b `lib/review/card-key.ts`(新設・純関数のみ・CR-1)

```ts
export type CardRef =
  | { kind: "wbs"; filePath: string; itemKey: string }
  | { kind: "capture"; captureId: string };
export function cardKeyOf(ref: CardRef): string;   // 配列の突き合わせ用・内部専用表記
// CardRef は**識別子のみの2 variant に固定**する(R2 sec S-8)。理由と v2 の扱いは
// **本設計書 §2.5b を参照**(実装ファイルには写さない — §4 の計数ピンに掛かる語を含むため)。
export function isStaleReview(
  r: { status: string; createdAt: string; startedAt: string | null }, nowMs: number): boolean;
```

**配置の理由**(R1 arch 6-a): §3 は両者を CR-1 のテスト対象としているが、`lib/data/today.ts` は
CR-2 の成果物。`server-only` の today.ts に置くと CR-1 の閉包と矛盾し、かつ **client component の
board.tsx から引き当てに使えない**。純関数だけを本モジュール(server-only を付けない)に切り出し、
today.ts / board.tsx の双方が import する。`isStaleReview` の閾値は `STALE_*_MINUTES` を参照する。

### 2.6 カード lookup(`lib/data/card-lookup.ts` 新設 — 配置の確定・申し送り6)

```ts
export async function findWbsCardForReview(filePath: string, itemKey: string)
  : Promise<{ title: string } | null>;      // 最新世代限定・source 固定・形式検証つき
// title は **500 コードポイントで切り詰めて返す**(R2 data G2): board_items.title は無制限で、
// 501 字以上だと 0011 の card_title_len CHECK 違反 = INSERT 例外になる。差異注記(§2.8)の
// 比較も「切り詰め後の値どうし」で行う。
export async function findCaptureCardForReview(userId: string, captureId: string)
  : Promise<{ captureKind: "next_move" | "issue"; topic: string | null; body: string } | null>;
```

- WBS: 入力検証は **`updateBoardState` と同じ定数を共有する**(`WBS_SOURCE` / `FILE_PATH_RE` を
  actions.ts から本モジュールへ移して両者が import — コピーを作らない。R1 data G5/G7)。
  **移設先を card-lookup.ts にする理由**(R2 data の問い): 依存の向きは
  `actions.ts → lib/data/card-lookup.ts → lib/data/board-override.ts` で、いずれも
  「Server Action → データ層 → データ層」の既存方向に沿う。`board-override.ts` は
  **board_overrides(書き込み対象)の正典**であり、board_items の**読み取り検証**定数を置くのは
  責務が混ざる。両者とも `lib/data` 内なので層はまたがない。
  検証は **TS 側**(`FILE_PATH_RE.test()` + `filePath.includes("..")` + itemKey 非空・長さ)で行う
  (SQL 側の `position('..'` は 0011 の DDL が持つ — §4 のピンもそれに合わせる)。
  最新世代限定は **`LATEST_BOARD_CTE` を import して `board_items` に再結合**する
  (選出式を写した4本目のコピーを作らない = 乖離の余地をなくす。R1 data G7)。
- **`isUuid` は `lib/review/card-key.ts` に置く**(純関数・server-only なし)。`scripts/review/sql.ts`
  にも同名関数があるが、**App 層が CI スクリプト層に依存する向きを作らない**ため import しない
  (同一述語の2実装 = 意図的な重複。**挙動の同値をテストでアサート**する — 同じ入力群(正規 UUID / 大文字 / ハイフン欠落 / 空 / 非文字列)で両者が一致すること。`scripts/review/sql.ts` は正規表現を export しておらず、export させると CI 側の凍結を破るため、リテラルの文字同一ではなく挙動で比べる — R4 arch)。
- capture: **先に UUID 形式を検証**(不正なら DB を叩かず null — 叩くと 22P02 例外になり存在秘匿が
  破れる。R1 data G6 / sec S-9)→ `WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
  AND kind IN ('next_move','issue')`。
- どちらも**見つからない理由を区別しない**(null 一択 = 存在秘匿)。
- Server Action 側は **`ref.kind` の網羅分岐**(2値以外は null 相当)+ lookup の例外を catch して
  `not_found` に潰す(既存 `updateBoardState` の try/catch 規律と同型)。

### 2.7 `app/(shell)/today/actions.ts`(追記・既存 updateBoardState は不変)

```ts
export type CardReviewError = "unauthorized" | "not_found" | ReviewSubmitError;
export async function prepareCardReview(ref: CardRef)
  : Promise<{ ok: true; question: string } | { ok: false; error: CardReviewError }>;
export async function submitCardReview(ref: CardRef)
  : Promise<{ ok: true } | { ok: false; error: CardReviewError }>;
```

- `CardRef` = `{ kind: "wbs"; filePath: string; itemKey: string } | { kind: "capture"; captureId: string }`
  — **識別子のみ**(質問文・タイトル・本文は受け取らない)。**`CardRef` の宣言は `lib/review/card-key.ts` の1箇所のみ**(actions.ts は import する —
  再宣言すると `cardKeyOf` の入力型と静かに乖離する。R3 arch X-5)。**両 action の
  シグネチャは `(ref: CardRef)` の1行**にする(§4 の関数レンジ抽出が `/^}$/` 終端で正しく効くため —
  インライン引数型だと `}): Promise<…> {` でレンジが閉じる。実測で確認済み)。
- 両関数とも先頭で `getUser()`(null → `unauthorized`)+ `await isAdmin()`(false → `unauthorized`
  = 権限の有無を区別しない)。**認可は各関数レンジ内に1回ずつ**(§4 でレンジ抽出して判定)。
- `prepareCardReview` = lookup → `buildCardQuestion` を返すだけ(**DB 変更なし・dispatch なし**)。
- `submitCardReview` = **再 lookup → 再生成** → `submitReview({ …, card })` → `revalidatePath("/today")`。
  **確認時の文字列は受け取らない**(TOCTOU は基本設計 §4 で受容 — 再生成物が正)。
- **確認ステップはサーバで強制しない**(R2 sec S-12 の受容): `submitCardReview` は Server Action なので
  `prepareCardReview` を経ずに単独で呼べる(確認は UI の順序でしか担保されない)。**prepare 出力に
  紐づく nonce は持たない** — 脅威モデルは「admin 本人のみ」で、本人が確認を飛ばすことは
  同意ガードの目的(見ずに送らせない)に照らして許容範囲。基本設計 §1 の「確認ステップを必須」は
  **UI 上の必須**の意。
- 既存 `updateBoardState` の error 語彙(`unauthorized` / `bad_request`)とは**別立て**にする
  (申し送り8): カード経路は存在秘匿のため `not_found` に集約し、受理系は `ReviewSubmitError` を透過。

### 2.8 `/today` の UI(board.tsx / page.tsx)

- `page.tsx`: `isAdmin` を評価し、**admin のときだけ** `listLatestCardReviews()` と
  `hasInflightReview()` を呼ぶ(非 admin では**呼ばず・prop も渡さない**)。
  `<TodayBoard canReview={admin} reviews={admin ? rows : []} inflight={…} />`。
  **`reviews` は配列**(React 18 では Map を client component の prop にできない — R1 arch 4-b)。
  client 側は `cardKeyOf()` で引き当てる(§2.5b)。
- `board.tsx`: カードに `[レビュー]` ボタン(`canReview` のときのみ)。押下 → `prepareCardReview` →
  **確認パネル(素テキストの `<pre>` 描画)** → `[送信]` で `submitCardReview`。
- バッジ: `pending`/`running` かつ非 stale = 「AI レビュー中」/ stale 超過 = 「中断(時間切れの可能性)」
  + ボタン再有効化 / `done` = 折りたたみで `<Markdown>` 描画 / `error` = 理由表示。
- `card_title` が現在の title と異なる場合は「カード内容が変わっています」を併記。
- **実行中の行がある間だけ 10 秒ポーリング**(`router.refresh()`。DB 状態を述語にする)。
- `inflight === true` の間は**全カードのボタンを無効化**。
- 既存契約(dataTransfer / 移動ボタン / laneCounts / motion)は不変。

## 3. テスト観点(実ネットワーク禁止・実 DB 接続なし)

- **テストの goal 分割**(R2 data N2 / arch N-2): `tests/card-review.test.ts` は CR-1 で作り、
  **CR-1 時点では CR-1 の export のみを import する**。`CARD_LATEST_SQL` / `INFLIGHT_ACTIVE_SQL`
  (= CR-2 の成果物)に関するケースは **CR-2 で同ファイルに追記**する(CR-1 で参照すると未定義 export で
  `tsc` が落ちる)。CR-2 の追記は「既存テストの凍結」の例外(追記は許容・既存ケースは不変)。
- `tests/card-review.test.ts`(CR-1):
  - **`submitReview` の受理順序**(申し送り3): `vi.mock("../../lib/db")` と `globalThis.fetch` の
    スタブで記録し、
    **呼び出された SQL の順序配列**が `[SWEEP_PENDING, SWEEP_RUNNING, INFLIGHT, DAILY_COUNT, INSERT]`
    であることをアサート。PAT 未設定時は **1本も query が呼ばれない**(fail-closed の順序)。
    busy / daily_limit で **INSERT が呼ばれない**。dispatch 失敗で `DISPATCH_FAILED_SQL` が呼ばれる。
  - **card 分岐**(arch 7-c): `card` 有りの呼び出しで **`INSERT_WITH_CARD_SQL` が $1..$8 で呼ばれる**
    こと(`INSERT_SQL` ではないこと)。card 無しでは `INSERT_SQL`。これが無いと
    「カード表示機能が丸ごと空振りしても CR-1 が全条件 PASS」になる。
  - **stale 閾値の同値(CR-1 分)**: `STALE_*_MINUTES` と `SWEEP_*_SQL` の文字列が一致すること。
    `isStaleReview` の境界は「**経過 >= 閾値で stale**」= SQL の `created_at < now() - interval`
    (経過 > 閾値)と**ちょうど境界の1点だけずれる**。UI 側を stale 寄り(>=)に倒すのは意図的
    (境界の瞬間は「中断」表示になるがボタンは無効のまま = 安全側)— R2 data N4 の決着。
  - **秘密衛生**: dispatch 失敗時の戻り値が `{ ok: false, error: "dispatch_failed" }` のみ
    (GitHub の status/body を含まない)。console 出力に PAT が現れない(スパイ)。
  - `buildCardQuestion`: 境界(title 500 超 / body 500 超 / 両方超過で question が 2000 以内)/
    サロゲート非分断 / 非空 / 固定文言の存在 / **クライアント由来値が固定文言を上書きしない**。
  - `cardKeyOf`: wbs / capture の表記 / 同一入力の安定性。
  - `findWbsCardForReview` の **card_title 切り詰め境界**(`vi.mock("../db")` で 501字の title を
    返し、戻り値が 500 コードポイントになること — R3 data A6)。
  - `isUuid` の**挙動**が `scripts/review/sql.ts` の同名関数と一致すること(同じ入力群で同じ真偽 —
    X-4 の重複管理。リテラル比較ではない: CI 側は正規表現を export していない)。
  - `isStaleReview`: 15/60 分の境界(pending は created_at 基準・running は started_at 基準)。
  - SQL 定数(CR-1 分): `INSERT_WITH_CARD_SQL` の**列数8・列名の完全列挙**・`$1..$8` の連番 /
    `STALE_*_MINUTES` が `SWEEP_*_SQL` の文字列に現れる(二重定義の同値ピン)。
    ※ `CARD_LATEST_SQL` / `INFLIGHT_ACTIVE_SQL` のケースは **CR-2 で追記**(上記の分割ルール)。
  - **`card-lookup.ts` が選出式リテラルを持たない**こと(`array_agg(commit ORDER BY` を含まない)—
    import 方針なので「文字同一」テストは自明成立して無意味になる。**4本目のコピーが無いことの
    否定形**で守る(R2 arch N-3 / data G7)。
  - `findWbsCardForReview` が `LATEST_BOARD_CTE` を import していること(結合の起点)。
  - **CR-2 で追記**: `CARD_LATEST_SQL` の `DISTINCT ON` 列群と `ORDER BY` 先頭一致・90日窓・
    `id DESC` タイブレーク / `INFLIGHT_ACTIVE_SQL` の括弧付けと `STALE_*_MINUTES` との同値。
- 既存テストは凍結(本文・名前・期待値の不変・削除行 0)。
- **`npm test` では 0011 の CHECK を検証できない** → §4 の手動ゲートで**違反形の拒否を実測**する
  (0010 の前例と同水準)。

## 4. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較。**ピンは実装形に合わせて実測してから書く**(review-loop の教訓)。
**ピン語はコード実体で満たす**(コメント・文字列での偽装充足は禁止)。**awk のレンジアンカー
(`export async function …`)をコメントに書かない**(レンジが二重化する)。

### CR-1(0011 + submit.ts + route 書き換え + card-prompt + lookup + テスト)

```bash
# 1. DDL(制約名・値域・再実行安全)
test -f db/migrations/0011_review_card_ref.up.sql && test -f db/migrations/0011_review_card_ref.down.sql
for k in "review_requests_card_ref_shape" "review_requests_card_source_domain" \
         "review_requests_card_path_shape" "review_requests_card_title_len" \
         "review_requests_card_kind_domain" "review_requests_card_item_key_nonempty" \
         "review_requests_card_latest_idx" "cc-sier-organization" "position('..'" \
         "created_at DESC, id DESC" \
         "card_capture_id uuid" "ADD COLUMN IF NOT EXISTS" "conrelid" \
         "CASE coalesce(card_kind" "ELSE false"; do
  grep -qF "$k" db/migrations/0011_review_card_ref.up.sql || echo "MISSING ddl: $k"; done
# OR 連結形の再混入を遮断(NULL 素通り — R1 data G1 の実測で確定)
test "$(grep -c "OR (card_kind =" db/migrations/0011_review_card_ref.up.sql)" = "0"
grep -qF "承認手順" db/migrations/0011_review_card_ref.down.sql
grep -qF "0011" docs/setup/db-recovery.md && grep -qF "0010" docs/setup/db-recovery.md   # replay 列挙の追随
grep -qF "card-review" docs/design/basic/today-view.md          # 外部送信の受容追記(T-2)
grep -qF "card-review" docs/setup/organize-role.sql             # question 経由の到達の追記(S-14)
# 2. 受理シーケンスの正典が1つ(route は認可 + status 写像だけを持つ)
test -f lib/review/submit.ts
grep -qF "submitReview" app/api/review/route.ts                   # 肯定ピン(正典を経由する — S-2)
test "$(grep -c "fetch(" app/api/review/route.ts)" = "0"
test "$(grep -c "process.env.REVIEW_DISPATCH_PAT" app/api/review/route.ts)" = "0"
test "$(grep -c "process.env.REVIEW_DISPATCH_PAT" lib/review/submit.ts)" = "1"
# PAT / dispatch の唯一性を lib/ app/ 横断で確認(新モジュールに第2の利用点を作らない — S-1)
# 環境変数の**参照**だけを数える(実測: 素の "REVIEW_DISPATCH_PAT" は spar-panel.tsx の
# エラー文言にも現れ、正しい実装でも 2 になる)
test "$(grep -rl "process.env.REVIEW_DISPATCH_PAT" lib app | wc -l)" = "1"
test "$(grep -rl "DISPATCH_URL" lib app | grep -v "api-lib.ts" | wc -l)" = "1"   # submit.ts のみ
grep -qF "STATUS_BY_ERROR" app/api/review/route.ts
# route の 403/401 の分岐・応答が**消えていない**ことを検出する(条件の反転は検出できないが、
# 反転すれば admin 自身が 403 を食うので手動ゲート (e) で即座に露見する — R2 sec S-5)
test "$(grep -c '"forbidden"' app/api/review/route.ts)" = "2"     # POST/GET 各1
test "$(grep -c '"unauthorized"' app/api/review/route.ts)" = "2"
# 3. review-loop の既存ピンが成立し続ける(§0 の決着)
test "$(grep -c "await isAdmin(" app/api/review/route.ts)" = "2"
for k in "review_not_configured" "daily_limit" "busy" "dispatch_failed"; do
  grep -q "$k" app/api/review/route.ts || echo "MISSING status map: $k"; done
grep -qF "submit.ts" docs/design/detail/review-loop.md            # §2.2 の置換(ポインタ化)
# 置換されたこと = §2.2 の POST 手順の実文言(sweep 2文の列挙)が消えていること(実測で
# アンカーを選定: 現物に1回だけ出現する)
test "$(grep -cF "sweep 2文(SWEEP_PENDING_SQL → SWEEP_RUNNING_SQL)" docs/design/detail/review-loop.md)" = "0"
# 4. 質問生成・lookup(述語)
grep -qF "QUESTION_MAX_CHARS" lib/review/card-prompt.ts
grep -qF "500" lib/data/card-lookup.ts                            # card_title の切り詰め(G2)
# ↑ 緩い数値ピンなので、§3 に**境界テスト**(501字の title を返すモックで 500 に切り詰まる)を置く
# 検証は TS 側(SQL の position('..' は 0011 の DDL 側でピン済み — §2.6 の決着に合わせる)
for k in "deleted_at IS NULL" "next_move" "user_id" "isUuid" "FILE_PATH_RE" 'includes("..")'; do
  grep -qF "$k" lib/data/card-lookup.ts || echo "MISSING lookup: $k"; done
grep -qF "isUuid" lib/review/card-key.ts                          # 実体は card-key(CI 層に依存しない)
test "$(grep -c "position('..'" lib/data/card-lookup.ts)" = "0"   # SQL 断片を足して通さない
# 5. Server Action(2段・認可は関数レンジ内に1回ずつ)
for k in "prepareCardReview" "submitCardReview" "buildCardQuestion"; do
  grep -qF "$k" "app/(shell)/today/actions.ts" || echo "MISSING action: $k"; done
# レンジ終端は **`/^}$/`(行全体が })** — `/^}/` だとインライン引数型の `}): Promise<…> {` で
# 即閉じる(実測: updateBoardState で6行しか取れず 0 件になる)。合わせて **引数は名前付き型を使い
# シグネチャを1行**にする(§2.7 の CardRef)。
test "$(awk '/export async function prepareCardReview/,/^}$/' "app/(shell)/today/actions.ts" \
  | grep -c "await isAdmin(")" = "1"
test "$(awk '/export async function submitCardReview/,/^}$/' "app/(shell)/today/actions.ts" \
  | grep -c "await isAdmin(")" = "1"
# submit は正典を経由する / prepare は副作用を持たない(同意ガードの前提 — S-2 / S-11)
test "$(awk '/export async function submitCardReview/,/^}$/' "app/(shell)/today/actions.ts" \
  | grep -c "submitReview(")" = "1"
awk '/export async function prepareCardReview/,/^}$/' "app/(shell)/today/actions.ts" > /tmp/cr-prepare.txt
test "$(grep -cE "submitReview\(|INSERT|fetch\(" /tmp/cr-prepare.txt)" = "0"
# 識別子のみ受理: 両 action の引数型は CardRef のみ(question / title / body を受け取らない)
grep -cE "function (prepareCardReview|submitCardReview)\(ref: CardRef\)" "app/(shell)/today/actions.ts"  # = 2
# CardRef は識別子のみ(2 variant・フィールドは kind + 識別子のみ)— S-8
test "$(grep -c "kind:" lib/review/card-key.ts)" = "2"
test "$(grep -cE "note|question|title|body" lib/review/card-key.ts)" = "0"
# 6. 凍結(CI・ロール・codex-spar 契約)
git diff main -- .github/workflows/ci-review.yml scripts/review \
  "app/(shell)/capture/spar-panel-lib.ts" | wc -l                                   # = 0
# organize-role.sql は **コメント追記のみ許可**(§1 の S-14 受容の記録)。
# GRANT の実体が不変であることは行の計数で担保する(diff 0 では追記と両立しない — R3 の三竦み)。
test "$(grep -c "TO review_bot" docs/setup/organize-role.sql)" = "4"
test "$(grep -cE "^GRANT" docs/setup/organize-role.sql)" = "12"          # 3ロール × 4文(実測値。CR-1 分岐点で再確認)
test "$(git diff main -- docs/setup/organize-role.sql | grep -c '^+GRANT')" = "0"    # GRANT 行の追加なし
# 削除行なし(= コメント追記のみ)。**`grep -c '^-'` は使わない** — `--- a/…` のヘッダ行に必ず
# 一致して確定 false FAIL になる(実測で確認)。`^-[^-]` も SQL コメント行(`-- …`)の削除を
# 取り逃すため、**numstat の削除数**で判定する(実測: コメント追記 → 0 / GRANT 1行削除 → 1)。
test "$(git diff main --numstat -- docs/setup/organize-role.sql | awk '{s+=$2} END {print s+0}')" = "0"
# 追記位置は review_bot ブロックの近傍(ファイル中間)にする。**EOF に追記する場合は再計測**
# (末尾に改行が無い状態だと最終行が delete+add になり削除数 1 になり得る — R5 data)
# 7. 閉包(CR-1 allowlist 外の変更 0)
git diff main --name-only | grep -vxF \
  -e 'db/migrations/0011_review_card_ref.up.sql' -e 'db/migrations/0011_review_card_ref.down.sql' \
  -e 'lib/review/submit.ts' -e 'lib/review/api-lib.ts' -e 'lib/review/card-prompt.ts' \
  -e 'lib/review/card-key.ts' -e 'lib/data/card-lookup.ts' -e 'app/api/review/route.ts' \
  -e 'app/(shell)/today/actions.ts' -e 'tests/card-review.test.ts' \
  -e 'docs/setup/db-recovery.md' -e 'docs/design/basic/today-view.md' \
  -e 'docs/setup/organize-role.sql' \
  -e 'docs/design/detail/review-loop.md' -e 'docs/design/detail/card-review.md' \
  -e 'docs/design/reviews/card-review.md' -e 'docs/setup/next-actions.md' | wc -l   # = 0
# 8. npm test(ホスト)exit 0 / npx tsc --noEmit exit 0(CR-1 は UI 非接触 — e2e 不要)
```

### CR-2(/today UI + 取得 + e2e)

```bash
# 1. 取得(自由入力行の除外・DISTINCT ON・グローバル判定・stale 純関数)
# SQL の正典は api-lib(today.ts は import して使う — R1 data G4 の矛盾を解消)
for k in "card_kind IS NOT NULL" "DISTINCT ON" "INFLIGHT_ACTIVE_SQL"; do
  grep -qF "$k" lib/review/api-lib.ts || echo "MISSING api-lib: $k"; done
for k in "CARD_LATEST_SQL" "INFLIGHT_ACTIVE_SQL" "cardKeyOf" "hasInflightReview" "isStaleReview"; do
  grep -qF "$k" lib/data/today.ts || echo "MISSING today: $k"; done
grep -c "DISTINCT ON" lib/data/today.ts                                             # = 0(SQL を複製しない)
# 2. UI(admin 限定・素テキスト確認・安全描画・既存契約の不変)
# 結果の供給元(page.tsx)で admin ゲートが効いていること(S-6 — R1 sec I の実装点)
grep -qF "isAdmin" "app/(shell)/today/page.tsx"
grep -qF "admin ?" "app/(shell)/today/page.tsx"                  # 非 admin では呼ばない/渡さない形
# 確認パネル: 素テキスト描画 + 注記3点(同意ガードの本体 — S-10 / S-13)
grep -qF "<pre" "app/(shell)/today/board.tsx"
# 文言は実装とバイト一致させる(既存 spar-panel は「送られます」— コピーすると偽 FAIL する)
for k in "CI(GitHub Actions)の Claude に送られます" "履歴に残ります" "担当者名"; do
  grep -qF "$k" "app/(shell)/today/board.tsx" || echo "MISSING notice: $k"; done
grep -qF "canReview" "app/(shell)/today/board.tsx"
grep -qF "prepareCardReview" "app/(shell)/today/board.tsx"
grep -qF "<Markdown" "app/(shell)/today/board.tsx"
grep -rln "dangerouslySetInnerHTML" "app/(shell)/today" | wc -l                     # = 0
grep -qF 'wbs|${item.filePath}|${item.itemKey}' "app/(shell)/today/board.tsx"       # TBI-1 不変
grep -qF 'setData("text/plain", card.id)' "app/(shell)/today/board.tsx"             # capture 側も不変
# 3. 閉包(CR-2・実行形)
git diff main --name-only | grep -vxF \
  -e 'lib/data/today.ts' -e 'lib/review/api-lib.ts' -e 'app/(shell)/today/board.tsx' \
  -e 'app/(shell)/today/page.tsx' -e 'tests/card-review.test.ts' \
  -e 'docs/design/detail/card-review.md' -e 'docs/design/reviews/card-review.md' \
  -e 'docs/setup/next-actions.md' | wc -l                                           # = 0
# 4. npm test exit 0 / tsc exit 0 / npm run e2e 6画面 green
```

手動ゲート(ユーザー操作): (a) **Neon ブランチで検証してから本番適用**(main マージ前・db.md の規約)+ **違反形の拒否を実測**。
違反形は **NULL 評価で素通りする形を名指しする**(R1 data G1 — OR 形はこの2つを通した):
① `card_kind NULL + card_capture_id あり` ② `card_kind NULL + wbs 完全形` ③ `wbs で capture_id 同時`
④ `wbs で card_title 欠落` ⑤ 不正 file_path ⑥ source 違い ⑦ 未知の card_kind。
**正常3形(kind NULL 全 NULL / wbs 完全 / capture)は受理**されること。
+ **同じ up.sql を2回流して2回目も成功する**こと(再実行安全)
(b) カードから依頼 → 確認パネルに質問文(素テキスト)→ 送信 → バッジ → 完了後に Markdown 表示
(c) 実行中は全カードのボタンが無効 (d) 非 admin ではボタンも結果も出ない
(e) 壁打ちパネルの CI レビュー(既存経路)が引き続き動く(submit.ts 抽出の非退行)
(f) 削除済み capture・盤面外 kind では依頼できない。

## 5. 実装の分割(/goal 単位)と禁止事項

- **/goal CR-1**(ターン上限 6): §4 CR-1 の全条件。**0011 の本番適用は人間の承認手順**(判定対象外)。
- **/goal CR-2**(ターン上限 6): §4 CR-2 の全条件。
- **禁止事項(両 goal 共通)**:
  - CI 側(ci-review.yml / scripts/review)・`review_bot` GRANT・`spar-panel-lib.ts` の変更。
  - **クライアントから質問文・タイトル・本文を受け取ること**(Server Action の入力は識別子のみ)。
  - 確認パネルを Markdown 描画にすること(素テキスト固定 — 表示とバイト列を一致させる)。
  - `updateBoardState` の入出力・dataTransfer 文字列・`laneCounts` の変更。
  - **ピン側を書き換えて通すこと**(落ちたら実装を直すか、設計改訂として3レンズ再通過)。
  - **§4 が数える語をコメントに書くこと**(計数ピンの母集団を汚染して偽 FAIL する — review-loop §5 と
    同じ原則。特に `"forbidden"` / `"unauthorized"` / `process.env.REVIEW_DISPATCH_PAT` /
    `DISPATCH_URL` / `INSERT` / `fetch(` / `submitReview(` / `OR (card_kind =` / `position('..'` /
    **`note` / `question` / `title` / `body` / `kind:`**(card-key.ts)/ **`DISTINCT ON`**(today.ts)/
    **`array_agg(commit ORDER BY`**(card-lookup.ts)/ awk のレンジアンカー)。
    prepare 関数の中に「INSERT しない」等の説明コメントを書かない。
    **organize-role.sql への追記文言も同様**: `TO review_bot` / `requested_by` を含めない
    (同ファイルには review-loop §4 RL-2 #7 の計数ピンが掛かっている — R4 data B2)。
    追記してよい文言の例 = 「question 経由の到達は card-review §1 で受容済み」。
  - **organize-role.sql に GRANT / ALTER / CREATE ROLE の行を足すこと**(追加してよいのは
    コメント行のみ — 計数ピンは `^GRANT` 以外の追加行を通す。上記「受容の記録(R5 sec)」を参照)。
    **設計書の注記をそのままコードへ写さない**(設計書の注記には §4 が数える語が含まれ得るため。§2.5b は
    この理由から地雷語を除いてある — R3 arch X-3 / sec 新-E)。
  - 破壊的 SQL / `.env` 接触 / ボリューム破棄。
  - **既存テストの変更**(本文・名前・期待値の不変・削除行 0)。
    ただし **CR-2 での `tests/card-review.test.ts` への追記は例外**(§3 の goal 分割 — 追記のみ・
    CR-1 で書いたケースは不変。R3 arch X-2)。
- **受容の記録(R5 sec)**: organize-role.sql の凍結を「diff 0」から**計数**に置き換えた代償として、
  **`^GRANT` 以外の追加行は4本のピンをすべて通過する**(`ALTER ROLE review_bot SUPERUSER;` /
  行頭 `ALTER DEFAULT PRIVILEGES …` / 小文字 `grant …`)。**受容する**根拠 = このファイルは
  CI・アプリから実行されず**人間が手で適用**する(review-loop の決着・PR レビューが最終防御)/
  ファイル自体は閉包 allowlist 内で diff が可視 / repo には review-loop §4 RL-2 の強い検査
  (`ALTER DEFAULT PRIVILEGES|TO PUBLIC` = 0・危険形 GRANT の除外)が既にある(CR-1 では走らないが
  RL-2 の判定時に効く)。**追加してよいのはコメント行のみ**(§5 の禁止事項)。
- 決着の記録: route.ts は認可 + status 写像を残す(review-loop の既存ピンは成立)/ TOCTOU は受容
  (再生成物が正)/ `card_title` は WBS のみ必須 /
  question の非空は呼び出し側の責務 / 0011 は**再実行安全**(DO ブロック)/
**stale 閾値は SQL のリテラルを維持**し(review-loop §4 のピンを壊さない)定数との同値をテストで担保
(※「定数に単一化」は R2 で**撤回**した案 — 旧記述を残さない)/
確認ステップは **UI 上の必須**でサーバ強制はしない / `question` 経由の capture 本文の
review_bot 到達は受容(§1 に記録)。
