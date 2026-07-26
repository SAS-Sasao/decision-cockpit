# 詳細設計: wbs-loop(/today WBS カード操作 + SSoT への限定編集 PR 還流)

- 基本設計: docs/design/basic/wbs-loop.md(3レンズ×3R PASS)。レビュー記録 = docs/design/reviews/wbs-loop.md。
- 本書は申し送り7点の決着(§0)+ DDL / IF / テスト / 受け入れ条件の確定を行う。

## 0. 申し送りの決着

| # | 申し送り | 決着 |
|---|---|---|
| 1 | rewrite の行同定はパーサと共有 module | **board.ts に `locateAdoptedRows` を新設**し、parseBoard と**同一の内部 walker** を共有(§2.2)。列挙ベースの独立実装はしない。skip 4カテゴリと判定順(状態3値外 → ID 空 → 重複 → タイトル空)は processRow の現物そのまま |
| 2 | count 母集団 | 多ユーザーガード・不在検査の母集団 = **監査集合(全アクティブ行)**で固定(§2.5 fetch) |
| 3 | DB CHECK の `..` | regex CHECK に加え **`position('..' in file_path) = 0` の CHECK を追加**(§1)。主張は「多層の一層」(verify (e)・staged 検査・実在確認と重畳) |
| 4 | WBS_DATABASE_URL のピン | 「現れてよい step の完全列挙」対象に含める: **fetch / mark の2 step のみ**(§4 条件3)。ORGREPO_PAT = **checkout-orgrepo / pr の2 step のみ** |
| 5 | listActiveOverrides の user_id 非スコープ | **意図的**(単一ユーザー前提・多ユーザーガードは CI 側)。関数コメントに明記(§2.1) |
| 6 | `npm ci --ignore-scripts` | **不採用(受容)**: tsx→esbuild の postinstall 依存が環境依存で決定性を損なう。防御は基本設計 §4 の3枚(人間レビュー・branch protection・PAT スコープ)を正とする |
| 7 | 日次スロット / PR 本文 | cron = `0 12 * * *`(UTC 12:00 = JST 21:00)。時刻変更は yml 編集(ユーザー)。PR タイトル = `wbs: state updates <date>`・本文 = 変更一覧(item_key / file / from→to / updated_at)+ 機械生成の注意書き。**レビュー疲れ警告**は有効化手順(next-actions)に記載し **§4 で grep ピン**(散文依存にしない — sec R1) |
| 8 | **M5 FAIL 論点の踏襲**(R1 で脱落を指摘され復帰) | §4 の workflow ピンは M5 の実行形をそのまま踏襲: **secrets の step 束縛 = awk step レンジ(«step id 行〜次の `- ` step 行» で終端固定)の実行形** / **uses 許可リスト**(actions/checkout 以外の `uses:` を否定)/ **workflow 級 `^env:` と job 級・step 直下の字下げ `env:` の否定は「step 内 env のみ許可」の awk 検査** / 契約ファイル grep は **per-file ループ(ALL 判定)** / count ピンは母集団コメント + 位置束縛(awk)とセット |
| 9 | **server-only 連鎖**(arch R1): scripts/wbs は board.ts(→ normalize.ts の `import "server-only"`)を踏む | **scripts/sync-local.ts 前例の require キャッシュスタブ**を scripts/wbs の各エントリ(apply/verify)冒頭に置く。§4 にスタブ存在ピン |
| 10 | **run-sync → lib/data の依存方向**(arch R1・初出) | 意図的に許容: 照合は Ingestion 層の責務だが、`UPDATE board_overrides` を1ファイルに集約するガバナンス(§2.1)を優先し関数は lib/data に置く。逆方向(lib/data → lib/ingestion)は従来どおり発生させない |

追加の実装上の確定事項:
- **トークン3種は全て3バイト**(`[ ]`/`[~]`/`[x]`)— 置換で行長・桁揃え・後続オフセットが不変。
  rewrite は**絶対オフセットでの同長スプライス**にでき、CRLF・パディングは構造的に保存される。
- SyncSummary に **`overrides?: {applied:number; superseded:number} | {error:true}`** を追加(additive。
  照合の例外は握ってここに `{error:true}` を計上 — saveSyncState 到達を妨げない)。

## 1. スキーマ DDL(0009)

`db/migrations/0009_board_overrides.up.sql`:
```sql
CREATE TABLE IF NOT EXISTS board_overrides (
  source     text NOT NULL CHECK (source = 'cc-sier-organization'),
  file_path  text NOT NULL
    CHECK (file_path ~ '^\.companies/[^/]+/docs/secretary/[^/]+-wbs\.md$')
    CHECK (position('..' in file_path) = 0),
  item_key   text NOT NULL CHECK (item_key <> ''),
  desired_state text NOT NULL CHECK (desired_state IN ('todo','doing','done')),
  base_state    text NOT NULL CHECK (base_state    IN ('todo','doing','done')),
  CONSTRAINT board_overrides_not_noop CHECK (base_state <> desired_state),  -- no-op の DB 層拒否(data R1)
  user_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  pr_ref     text,
  resolved_at timestamptz,
  resolution text CHECK (resolution IN ('applied','superseded')),
  PRIMARY KEY (source, file_path, item_key)
);
CREATE INDEX IF NOT EXISTS board_overrides_active_idx
  ON board_overrides (source, file_path) WHERE resolved_at IS NULL;
```
down = `DROP TABLE IF EXISTS board_overrides;`(down は復旧用の定型 — 運用では人間承認なしに実行しない)。

## 2. 関数 / API インターフェース

### 2.1 lib/data/board-override.ts(新設・server-only)

```ts
export type OverrideKey = { source: string; filePath: string; itemKey: string };
export type BoardState = "todo" | "doing" | "done";
export type OverrideRow = OverrideKey & {
  desiredState: BoardState; baseState: BoardState;
  prRef: string | null; updatedAt: string;
};

/** 移動の記録(UPSERT)。再移動は同一行を更新し pr_ref/resolved_at/resolution をリセット。 */
export async function upsertBoardOverride(
  userId: string, key: OverrideKey, desired: BoardState, base: BoardState
): Promise<void>
// INSERT ... ON CONFLICT (source, file_path, item_key) DO UPDATE SET
//   desired_state=$, base_state=$, user_id=$, updated_at=now(),
//   pr_ref=NULL, resolved_at=NULL, resolution=NULL

/** アクティブ行(resolved_at IS NULL)。user_id 非スコープは意図的(単一ユーザー前提 —
 *  破れの検知は CI の DISTINCT user_id ガード側。基本設計 §1-5)。 */
export async function listActiveOverrides(): Promise<OverrideRow[]>

/** 最新世代選出の SQL 断片(単一定義)。resolve と updateBoardState の実在確認の両方がこれを使う
 *  (3重コピーの乖離防止 — data R1 G4-1)。**文字同一の比較単位 = 選出式リテラル
 *  `(array_agg(commit ORDER BY synced_at DESC, commit DESC))[1]`**(CTE 別名ではない — data R2。
 *  以下のスケッチも today.ts に合わせ別名 generations を使う)。 */
export const LATEST_BOARD_CTE: string

/** 照合(基本設計 §1-7 の前2出口)。比較対象 = 最新世代(LATEST_BOARD_CTE)。
 *  1本の UPDATE で applied / superseded(外部変更)を同時に解決する。 */
export async function resolveOverridesAfterSync(): Promise<{ applied: number; superseded: number }>
// WITH generations AS (SELECT source, file_path,
//        (array_agg(commit ORDER BY synced_at DESC, commit DESC))[1] AS commit
//        FROM board_items GROUP BY source, file_path),
//      latest AS (SELECT b.source, b.file_path, b.item_key, b.state
//        FROM board_items b JOIN generations g
//          ON b.source=g.source AND b.file_path=g.file_path AND b.commit=g.commit)
// UPDATE board_overrides o
//    SET resolved_at = now(),
//        resolution = CASE WHEN l.state = o.desired_state THEN 'applied' ELSE 'superseded' END
//   FROM latest l
//  WHERE o.resolved_at IS NULL
//    AND l.source=o.source AND l.file_path=o.file_path AND l.item_key=o.item_key
//    AND (l.state = o.desired_state
//         OR (l.state <> o.base_state AND l.state <> o.desired_state));
// 戻り値の内訳は RETURNING resolution を集計。
```
**`UPDATE board_overrides` の出現はこのファイル(1箇所: resolve)と scripts/wbs/mark.ts(2箇所)のみ**
(§4 のファイル数ピン。コメントにこのリテラルを書かない — capture の count ピンと同じ汚染防止)。

### 2.2 board.ts の共有 walker + board-rewrite.ts(新設・純関数)

```ts
// lib/ingestion/parsers/board.ts に追加 export(内部 walker を parseBoard と共有 — 挙動不変)
export type AdoptedRow = {
  itemKey: string; state: "todo" | "doing" | "done";
  /** content 内の絶対オフセット: ステータスセルの trim 済みトークン3バイトの位置 */
  tokenStart: number;
};
export function locateAdoptedRows(content: string): AdoptedRow[]
// parseBoard(content).items と同数・同順・同 itemKey/state を返す(§3 で同値性をテスト)。
// 実装: 既存 walk を関数抽出し、行開始オフセット表(\n 走査)からセル絶対位置を算出。
// **tokenStart の算出規則(data R1 G3-1 — trim 済みセルの再構成をしない)**:
//   生の行に対する `|` 走査で決める: (1) 行頭空白をスキップ (2) 先頭が `|` なら1バイト消費
//   (行頭 `|` 無し行も isTableRowCandidate は行候補にするため、この分岐は必須)
//   (3) 以降、セル区切り `|` の実位置からステータスセルの生バイト範囲 [cellStart, cellEnd) を得る。
//   **行末 `|` が無い場合、最終セルは行末(改行の手前)まで**(splitCells の trailing strip と同値 —
//   data R2: ステータス列が末尾セルの行での off-by-one を防ぐ規則)
//   (4) tokenStart = cellStart + セル内先頭空白長(トークンは3バイト固定)。
//   CRLF: 行開始オフセットは元 content の `\n` 走査 — split(/\r?\n/) のセグメントと 1:1 に整列し、
//   トークンは常に行末 `\r?\n` より前なので絶対オフセットは正確。

// lib/ingestion/parsers/board-rewrite.ts(新設)
export function rewriteBoardState(
  content: string, itemKey: string, desired: "todo" | "doing" | "done"
): { content: string; changed: boolean }
// locateAdoptedRows で対象行(採用行・先勝ち1行)を特定し、
// content.slice(0, tokenStart) + TOKEN[desired] + content.slice(tokenStart + 3) の同長スプライス。
// changed=false: (i) 採用行に itemKey が無い (ii) 現トークンが既に desired。
// content の他のバイトには一切触れない(CRLF・パディング・skip 行は構造的に保存)。
```

### 2.3 app/(shell)/today/actions.ts(新設 Server Action)

```ts
export async function updateBoardState(input: {
  source: string; filePath: string; itemKey: string; desired: string;
}): Promise<{ ok: true } | { ok: false; error: "unauthorized" | "bad_request" }>
```
検証(順序どおり・全て bad_request): (1) getUser → 無ければ unauthorized (2) desired が3値
(3) source === 'cc-sier-organization'(固定値)(4) filePath が DB CHECK と同じ regex + '..' 不含
(5) itemKey 非空・≤200 (6) **実在確認** = 最新世代の board_items に (source,file_path,item_key) が存在
(意味論 = 「現に /today に出る item」。過去世代のみの item は拒否 — 操作は表示中カードからしか
発生しないため)(7) **no-op 拒否** = 実効状態(アクティブ override の desired、無ければ最新世代 state)と
desired が同じなら bad_request。**upsert に渡す base = この手順7で算出した実効状態**(最新世代 state を
素で渡さない — CHECK board_overrides_not_noop・再移動セマンティクスと同値になる唯一の導出。data R2)。
通過後 upsertBoardOverride → revalidatePath("/today")。

### 2.4 /today 合成(WL-1)

- `lib/data/today.ts` に純関数 **`applyBoardOverrides(columns, overrides): { columns, overriddenKeys }`** を追加
  (WBS カードを実効レーンへ移し替える。決定的・ユニットテスト対象)。`TodayCard` に
  `filePath: string` と `overridden?: boolean` を **additive** に追加(既存テストは toMatchObject/個別
  フィールド比較のため非破壊 — §3 で確認済みの前提を凍結 diff 条件で担保)。
- page.tsx: `listActiveOverrides()` を並列取得し合成。board.tsx: WBS カードに capture カードと同じ
  ボタン + D&D(dataTransfer = `wbs|${filePath}|${itemKey}`)。onDrop はプレフィックスで
  updateCaptureStatus / updateBoardState に分岐。オーバーレイ中カードに「PR 反映待ち」バッジ。

### 2.5 scripts/wbs/*(WL-2・すべて env 入力・JSON 出力・exit code)

**scripts/wbs 共通規範**(全5本): 子プロセスは**配列引数 spawn のみ**(execSync / シェル文字列連結の禁止 —
file_path をシェルに渡さない。sec R1: DB CHECK の文字集合は `$( )` 等のシェルメタ文字を排除しないため、
verify を含む全 git 呼び出しが対象)。**ログは件数・パスのみ**(user_id の値・本文を出さない — M5 の規範)。
overrides.json に **user_id を含めない**(多ユーザーガードは fetch 内の COUNT(DISTINCT) のみで値は取得しない)。
apply/verify のエントリ冒頭に **sync-local 前例の server-only スタブ**(§0-9)。git 実行は
`-c core.hooksPath=`(hooks 中和 — organize pr.ts 前例)。refspec に `+` を付けない。

| script | 入力(env) | 責務 |
|---|---|---|
| fetch.ts | WBS_DATABASE_URL, WBS_OUT | 送信集合(active AND pr_ref IS NULL)+ **監査集合(全 active)**を `out/overrides.json` に書く(**user_id 非収録**)。**多ユーザーガード: 監査集合の COUNT(DISTINCT user_id) >= 2 → exit 1**。両集合0件 → `empty=true` を GITHUB_OUTPUT に |
| apply.ts | WBS_OUT, ORG_DIR | 送信集合に rewriteBoardState を適用。**書き込み前に resolve(ORG_DIR, file_path) が ORG_DIR 配下であることを assert**・**lstat で symlink なら書かず changed=false 扱い**(sec R1)。**監査集合の不在検査**(ORG_DIR 実物に file/採用行が無い)→ `out/absent.json`。changed=false はスキップ計上 |
| verify.ts | WBS_OUT, ORG_DIR | §3-3(基本設計)の実行: **一次 = 行単位バイト diff**(before = `git show HEAD:<path>` — 配列引数 spawn・path は単一引数で連結・オブジェクト DB 読みのため FS/symlink を辿らない)— 変更行は送信 item ごとに1行・各行はトークン3バイトの差のみ・他の全行バイト不変 / 二次 = parse 前後比較 (a)(b)(c) / (e) パス glob + '..' 拒否。破れ = exit 1(PR を作らない) |
| pr.ts | ORGREPO_PAT, WBS_OUT, ORG_DIR, WBS_DATE | ブランチ `wbs/<WBS_DATE>`・**staged 閉包検査 = `git diff --cached --name-status` の全行 'M' かつ glob 一致かつ verify 済み集合と一致**(**commit より前**)・`git add --`・push は `HEAD:refs/heads/wbs/<date>`(`+` なし)・force 禁止・PR 作成(タイトル/本文 = §0-7)。**結果を `out/pr.json`({created, number, branch} — 送信集合0件なら created=false)に書く**(mark への成功信号 — organize の pr-repos.json 前例) |
| mark.ts | WBS_DATABASE_URL, WBS_OUT | **out/pr.json の created=true の場合のみ**送信集合の pr_ref 更新。不在集合(absent.json): resolved_at + resolution='superseded'(**送信0件・不在ありのケースでも mark は実行される** — empty 判定は両集合基準のため)。**PR 失敗時は pr_ref を書かない**(次回再送) |

workflow `.github/workflows/wbs-writeback.yml`(単一 job・LLM なし):
```
on: schedule('0 12 * * *') + workflow_dispatch / permissions: contents: read /
concurrency: wbs-writeback / job if: vars.ENABLE_WBS_WRITEBACK == 'true'
steps:
  - id: run           # 日付の唯一の権威(M5 R4 data G-1 と同型): TZ=Asia/Tokyo date +%F → outputs.date
  - id: checkout-cockpit(persist-credentials: false) → npm ci
  - id: fetch(env: WBS_DATABASE_URL, WBS_OUT)→ outputs.empty
  - id: checkout-orgrepo(if: empty != 'true', token: ORGREPO_PAT, path: orgrepo, persist-credentials: false)
  - id: apply / - id: verify / - id: pr(env: ORGREPO_PAT, WBS_DATE=steps.run.outputs.date)/ - id: mark
    (apply〜mark はすべて if: empty != 'true' — green skip が赤 run 化しない)
```
secrets の出現 step(完全列挙・§4 条件3 の awk レンジで機械束縛): **ORGREPO_PAT = checkout-orgrepo, pr の
2 step のみ** / **WBS_DATABASE_URL = fetch, mark の2 step のみ**。workflow 級・job 級 env なし(step 級のみ —
§4 で `^env:` 否定 + 字下げ env の awk 検査)。`uses:` は **actions/checkout のみ**(許可リスト方式 — M5 踏襲)。

### 2.6 run-sync 統合

`runSync` の adapters ループ後に:
```ts
let overrides: SyncSummary["overrides"];
try { overrides = await resolveOverridesAfterSync(); } catch { overrides = { error: true }; }
```
summary に含めて return(**saveSyncState は各 syncRepo 内で完了済み** — 照合の失敗が進行カーソルを
壊さない配置。arch R1 の問い(b) の決着)。

## 3. テスト観点(すべて機械判定・実ネットワークなし・匿名 fixture)

新規 fixture(`fixtures/cc-sier-organization/.companies/demo-org/docs/secretary/`)— **WL-1 で導入**
(locateAdoptedRows の同値性・tokenStart 検証に必要なため。arch R1 の帰属矛盾の決着):
- `demo-messy-wbs.md`: CRLF 行末・不均一パディング・fence 内テーブル・対象テーブル2つ・
  非対象テーブル内の同名 ID・重複 ID・状態3値外・ID 空・タイトル空・
  **行頭 `|` 無しのテーブル行・行頭インデント行・行末 `|` 無し行(ステータスセルを末尾に配置 —
  最終セル規則 §2.2(3) の反例)**(data R1 G3-2 — tokenStart の off-by-one を検出する反例。
  isTableRowCandidate は `|` を含む行を全て候補にするため実在し得る形)。

| テスト | 観点(ケース名 grep の対象) |
|---|---|
| tests/board-rewrite.test.ts(**WL-1 新設・WL-2 で追記**) | WL-1 分: locateAdoptedRows と parseBoard の**同値性**(items と同数・同順・同 key/state — 両 fixture)+ **tokenStart の実バイト検証**(tokenStart 位置の3バイトが現トークンと一致 — 行頭 `|` 無し行・CRLF 行を含む)。WL-2 分(追記): トークン置換の**バイト精密性**(置換後、対象行のトークン3バイト以外が全バイト一致・CRLF 保存)/ changed=false 2系統(不在・no-op)/ **重複 ID は先勝ち行のみ**(2行目不変)/ fence 内・非対象テーブルの同名 ID 不変 |
| tests/board-override.test.ts(新規) | upsert の SQL(ON CONFLICT・リセット3列)/ listActive の述語 / resolve の SQL(最新世代 CTE・applied/superseded/不変の3ケース)/ **LATEST_BOARD_CTE が today.ts の generations 式と文字同一**(3重コピー乖離の検知 — data R1 G4-1)/ updateBoardState の検証7段(未認証・語彙・source 固定・regex・実在・no-op)|
| tests/wbs-verify.test.ts(新規・CLI 契約) | 一次バイト diff: 正常(トークンのみ)PASS / **skip 行改変の反例が fail** / パディング正規化が fail / 追加・削除行が fail / (e) glob 外・'..' が fail |
| tests/wbs-scripts.test.ts(新規・CLI 契約) | fetch の2集合・多ユーザーガード fail・**overrides.json のキー集合に user_id 非収録** / apply の不在検査 / mark の PR 失敗時非更新 / pr の staged 閉包(モック git) |
| tests/today-data.test.ts(追記) | applyBoardOverrides(レーン移し替え・overridden フラグ・アクティブのみ) |
| 凍結 | 既存ケースの本文・名前・期待値は不変(追記のみ)。board-parser.test.ts は**無変更(追記も不可)** — §4 で `git diff <base> -- tests/board-parser.test.ts | wc -l` = 0 の機械ピン(walker 抽出後も全緑 = 挙動不変の証明。data R1 G5-2) |

## 4. 受け入れ条件(機械判定)

判定方式: FC-1/TBI-1 と同じ(stdout 数値比較・`# = N` コメント基準)。凍結基準 = **goal 分岐点の main**。

**WL-1(オーバーレイ)**:
```bash
# 1. migration
test -f db/migrations/0009_board_overrides.up.sql && test -f db/migrations/0009_board_overrides.down.sql
grep -q "position('..' in file_path) = 0" db/migrations/0009_board_overrides.up.sql
grep -q "board_overrides_not_noop" db/migrations/0009_board_overrides.up.sql
# 2. テスト(ホスト・凍結 diff 削除行 0)+ ケース名 grep
grep -q "upsertBoardOverride" tests/board-override.test.ts
grep -q "updateBoardState" tests/board-override.test.ts
grep -q "applyBoardOverrides" tests/today-data.test.ts
grep -q "locateAdoptedRows" tests/board-rewrite.test.ts   # 同値性(WL-1 分)
grep -q "tokenStart" tests/board-rewrite.test.ts          # 実バイト検証ケースの存在
grep -q "LATEST_BOARD_CTE" tests/board-override.test.ts   # 世代選出の文字同一ピン
# 2b. board-parser.test.ts は無変更(追記も不可 — 挙動不変の証明)
git diff <goal分岐点> -- tests/board-parser.test.ts | wc -l   # = 0
# 3. ガバナンス
[ "$(grep -c 'UPDATE capture_inbox' lib/data/capture.ts)" = "3" ]
! grep -rq "UPDATE board_items" lib/ app/
[ "$(grep -rl 'UPDATE board_overrides' lib/ app/ | wc -l)" = "1" ]   # board-override.ts のみ(resolve 実装は WL-1)
# 4. UI ピン
grep -qE 'setData\("text/plain", `wbs\|' "app/(shell)/today/board.tsx"
grep -q "PR 反映待ち" "app/(shell)/today/board.tsx"
grep -q 'revalidatePath("/today")' "app/(shell)/today/actions.ts"
# 5. tsc / build(docker dummy)/ e2e 6画面 green / 閉包(§5 allowlist)
# 6. board_overrides は SSoT から復元不能クラス(未送信の移動意図)— db-recovery.md の復元不能リストに追記し、
#    同 runbook のスキーマ再適用ループを 0001→0009 に更新(両方とも同ファイルの変更範囲)
grep -q "board_overrides" docs/setup/db-recovery.md
grep -q "0009" docs/setup/db-recovery.md
```

**WL-2(CI 書き戻し・照合・契約)**:
```bash
WF=.github/workflows/wbs-writeback.yml
# 1. scripts 5本 + 否定 grep(削除 API — organize-loop 条件2 と同幅に拡大)+ 実行形規範
for f in fetch apply verify pr mark; do test -f scripts/wbs/$f.ts || echo "MISSING $f"; done   # 出力なし
! grep -rEq "rmSync|unlinkSync|renameSync|rmdirSync|\.rm\(|promises\.unlink|\"rm\"" scripts/wbs/
! grep -rEq "execSync|exec\(" scripts/wbs/                                    # 配列引数 spawn のみ(共通規範)
grep -q "stubServerOnly" scripts/wbs/apply.ts && grep -q "stubServerOnly" scripts/wbs/verify.ts
grep -q "core.hooksPath" scripts/wbs/pr.ts                                    # hooks 中和
grep -q "startsWith" scripts/wbs/apply.ts                                     # ORG_DIR 封じ込め assert の存在
grep -q "lstat" scripts/wbs/apply.ts                                          # symlink skip の存在
! grep -q '+HEAD:' scripts/wbs/pr.ts                                          # +refspec force の否定
grep -q "HEAD:refs/heads/wbs/" scripts/wbs/pr.ts                              # push 形の正ピン
! grep -rEq "HEAD:main|refs/heads/main" scripts/wbs/
# scripts/wbs の lib import 許可リスト(organize R4 arch G-3 同型): parsers/board(-rewrite) 以外の lib を import しない
[ "$(grep -rhoE "from \"\.\./\.\./lib/[a-z/-]+\"" scripts/wbs/ | sort -u | grep -cv "lib/ingestion/parsers/board")" = "0" ]
# user_id 非漏出(arch R2-C: 恒真ピンを廃し、テスト側の非収録 assert でピン —
# wbs-scripts.test.ts の fetch 契約に「overrides.json のキー集合に user_id 不在」ケースを必須化)
grep -q "user_id 非収録" tests/wbs-scripts.test.ts
# 2. verify のケース名 grep(反例検出の実在)
grep -q "skip 行" tests/wbs-verify.test.ts && grep -q "バイト" tests/board-rewrite.test.ts
grep -q "DISTINCT" scripts/wbs/fetch.ts
# 3. workflow 静的ピン(実行形 — M5 §4 条件3 の形式を踏襲)
grep -q "ENABLE_WBS_WRITEBACK" $WF
grep -qE "^permissions:" $WF && grep -q "contents: read" $WF
! grep -qE "^env:" $WF                                                        # workflow 級 env なし
! grep -qE "^    env:" $WF                                                    # job 級 env なし(step 級のみ許可)
[ "$(grep -c 'persist-credentials: false' $WF)" = "2" ]                       # 母集団 = checkout 2件(下と一致)
[ "$(grep -c 'actions/checkout' $WF)" = "2" ]
# uses 許可リスト(M5 R3 R-9 の字下げ非依存形 — `- uses:` 直書きも捕捉。arch R2-A)
[ "$(grep -E '^[[:space:]]*(-[[:space:]]*)?uses:' $WF | grep -vc 'actions/checkout')" = "0" ]
! grep -iqE "claude|anthropic" $WF                                            # -i 付き(sec R1)
# step id の実在 + 順序(awk レンジのアンカー保証 — arch R2-B。M5 の「順序の実行形 + id 改名禁止」を踏襲)
prev=0
for s in run checkout-cockpit fetch checkout-orgrepo apply verify pr mark; do
  ln=$(grep -n "id: $s" $WF | head -1 | cut -d: -f1)
  { [ -n "$ln" ] && [ "$ln" -gt "$prev" ]; } || echo "ORDER/MISSING: $s"
  prev=$ln
done                                                                          # 出力なし = 8 step 実在・昇順
# secrets の step 束縛(awk レンジ実行形: step id 行〜次の「- 」step 行。count とセット)
[ "$(grep -c 'ORGREPO_PAT' $WF)" = "2" ]
awk '/id: checkout-orgrepo/,/id: apply/' $WF | grep -q "ORGREPO_PAT"      # 1本目 = checkout-orgrepo 内
awk '/id: pr/,/id: mark/' $WF | grep -q "ORGREPO_PAT"                     # 2本目 = pr 内
[ "$(grep -c 'WBS_DATABASE_URL' $WF)" = "2" ]
awk '/id: fetch/,/id: checkout-orgrepo/' $WF | grep -q "WBS_DATABASE_URL" # 1本目 = fetch 内
awk '/id: mark/,0' $WF | grep -q "WBS_DATABASE_URL"                         # 2本目 = mark 内(最終 step)
grep -q "id: run" $WF && grep -q "Asia/Tokyo" $WF && grep -q "date +%F" $WF   # 日付権威(§2.5)
! grep -qE -- "--force" $WF scripts/wbs/pr.ts
# pr.ts の順序ピン(アンカー確定): 行番号比較で name-status < commit < push
NS=$(grep -n -- "--name-status" scripts/wbs/pr.ts | head -1 | cut -d: -f1)
CM=$(grep -n '"commit"' scripts/wbs/pr.ts | head -1 | cut -d: -f1)
PU=$(grep -n '"push"' scripts/wbs/pr.ts | head -1 | cut -d: -f1)
[ "$NS" -lt "$CM" ] && [ "$CM" -lt "$PU" ]
# 4. 契約4ファイル(per-file ループ = ALL 判定。ANY 判定の grep -q 複数引数は使わない — R1 判定バグ修正)
for f in CLAUDE.md .claude/rules/actions.md .claude/rules/architecture.md .claude/rules/ingestion.md; do
  grep -q "WBS 限定編集" "$f" || echo "MISSING: $f"; done                      # 出力なし = 4ファイル全部
# 5. role(配置非依存の行単位検査 — grep -A の位置依存を排除)
grep -q "wbs_bot" docs/setup/organize-role.sql
! grep -E "ON capture_inbox TO wbs_bot" docs/setup/organize-role.sql | grep -q "GRANT"   # capture へ到達しない
! grep -E "ON board_(items|overrides) TO organize_bot" docs/setup/organize-role.sql | grep -q "GRANT"
! grep -E "ON board_items TO wbs_bot" docs/setup/organize-role.sql | grep -q "GRANT"     # board_items SELECT も無し(最小権限)
# 6. 照合統合(空ピン修正: "overrides" は既存テストの AdapterOverrides に既出のため固有名でピン — R1 G6-2)
grep -q "resolveOverridesAfterSync" lib/ingestion/run-sync.ts
grep -q "resolveOverridesAfterSync" tests/ingestion/run-sync.test.ts
# 7. レビュー疲れ警告(受容構造の1枚目 — 機械ピン)
grep -q "レビュー疲れ" docs/setup/next-actions.md
# 8. npm test / tsc / build / e2e 6画面 green / 凍結 diff 削除行 0 / 閉包(§5 allowlist)
```
※ wbs_bot の GRANT から **board_items の SELECT を削除**(基本設計 §1-6 からの変更): 詳細フローでは
fetch は board_overrides しか読まず、不在検査は checkout 実物基準のため不要(sec R1 — 最小権限)。

**§4-R 受容一覧**(judge は「実装漏れ」と誤判定しない): PR クローズの自動検出なし(復旧 = 再移動)/
同一 item の open PR 一時2本 / 出口競合は先勝ち / 自己検証の限界(依存汚染時は verify 無効 —
防御は人間レビュー・branch protection・PAT スコープ)/ --ignore-scripts 不採用 / 不在 superseded の
false positive は復活しない(SSoT 優先)/ 時刻変更は yml 編集 /
**updateBoardState の実在確認〜upsert 間の TOCTOU**(同時 sync で世代交代 — 単一ユーザー・低頻度で受容。
resolve/CI が事後収束させる)/ **base=desired 行が混入した場合の applied ラベルの偽陽性**(DB CHECK
board_overrides_not_noop で通常は作れない。混入しても必ず resolved に到達 — 精度より収束優先の族)/
**SSoT 側ファイルの symlink 置換**(apply は lstat で skip = changed=false → 不在系と同じく収束。
verify の before は git blob 読みで symlink 非追従)/ 削除 API・exec 否定 grep は正規表現の網羅に限界
(意図的回避はコードレビューと judge の目視が受け持つ)。

## 5. 実装の分割(/goal 単位)と禁止事項

- **/goal WL-1**(主セッション・ターン上限 12・判定 = acceptance-judge): 0009 → board-override.ts →
  locateAdoptedRows(+同値性テスト)→ updateBoardState → 合成表示 + board.tsx 拡張 → §4 WL-1 全条件。
  節目 commit = (a) DB+データ層 (b) UI。**この時点で移動体験は完成**(SSoT 還流なし)。
- **/goal WL-2**(主セッション・ターン上限 15・判定 = acceptance-judge): board-rewrite → scripts/wbs 5本 +
  テスト → workflow → role SQL → run-sync 統合 → 契約4ファイル → next-actions 有効化手順
  (Secrets 2本: WBS_DATABASE_URL / ORGREPO_PAT(既存流用可)・Variables・**レビュー疲れ警告**)→ §4 WL-2 全条件。
  節目 commit = (a) rewrite+scripts (b) workflow+契約。
- 閉包 allowlist(WL-1): db/migrations/0009_* / lib/data/board-override.ts / lib/data/today.ts /
  lib/ingestion/parsers/board.ts / app/(shell)/today/{page,board,actions}.tsx|ts /
  tests/{board-override,board-rewrite,today-data}.test.ts /
  **fixtures/cc-sier-organization/.companies/demo-org/docs/secretary/demo-messy-wbs.md**(§3 — WL-1 帰属)/
  **docs/setup/db-recovery.md**(復元不能リスト追記)/ docs(design detail/reviews・next-actions)。
  ※ tests/board-parser.test.ts は**両 goal とも allowlist 外**(無変更が挙動不変の証明)。
- 閉包 allowlist(WL-2): lib/ingestion/parsers/board-rewrite.ts / scripts/wbs/** /
  .github/workflows/wbs-writeback.yml / docs/setup/organize-role.sql / lib/ingestion/run-sync.ts /
  tests/{wbs-verify,wbs-scripts,**board-rewrite**,ingestion/run-sync}.test.ts(board-rewrite は WL-2 分の追記)/
  CLAUDE.md / .claude/rules/{actions,architecture,ingestion}.md / docs(design・next-actions)。
- 禁止(基本設計 §6 を継承): 手元から SSoT への書き込み完全禁止 / UPDATE board_items 新設 / 物理 DELETE /
  .env 非接触 / 秘密の直書き('__set_me__')/ LLM ジョブ追加 / 凍結テスト本文変更 / force push /
  parseBoard の**挙動変更**(walker 抽出は board-parser.test.ts 無変更・全緑が証明)/
  コメントに `UPDATE board_overrides` リテラルを書かない /
  **workflow の step id(run〜mark の8つ)の削除・改名禁止**(§4 の awk レンジと順序ピンのアンカー —
  M5 §5 と同型)/ **scripts/wbs・yml のコメントに `--force` リテラルを書かない**(否定 grep の汚染防止)/
  **`RegExp.prototype.exec` を scripts/wbs で使わない**(`exec\(` 否定 grep と衝突するため。
  マッチは String.match / matchAll を使う)。
