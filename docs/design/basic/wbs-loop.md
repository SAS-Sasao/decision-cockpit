# 基本設計: wbs-loop(/today WBS カード操作 + SSoT への限定編集 PR 還流)

- 起点: 2026-07-26 ユーザー決定「/today の内容(WBS カード)を動かせるようにしたい。逆側(コックピット→SSoT)
  からも動かせるようにしたい」→ AskUserQuestion で**フルループ(第2弾 + 第3弾)を承認**。
- 前段: today-board-interactive(TBI-1)で capture カードの操作は実装済み。WBS カードは読み取り専用のまま
  「第2弾 = オーバーレイ / 第3弾 = PR 還流」として申し送られていた(本設計がその実体)。

## 0. 黄金ルール1 の改定(ユーザー承認 2026-07-26・本設計の前提)

現行: CI(Claude Action)の PR 書き戻しは**追加のみ・既存ファイルの編集禁止**。
改定: 上記に加えて **「WBS 限定編集」** を CI の PR 経由でのみ許可する:

| 制約 | 内容 |
|---|---|
| 対象ファイル | cc-sier-organization の `.companies/<org>/docs/secretary/*-wbs.md` のみ |
| 変更内容 | **既存行のステータスセルのトークン(`[ ]`/`[~]`/`[x]`)の置換のみ**。行の追加・削除・他セルの変更・見出しや地の文の変更は禁止 |
| 生成主体 | **決定的スクリプト(LLM 不使用)**。Claude はこの経路に関与しない |
| 検証 | PR 作成前に機械 verify(§3-3: 前後パースで対象 item の state 以外が完全一致) |
| ゲート | PR 経由のみ・main 直 push 禁止・force 禁止・自動マージなし(**人間レビューが最終防御** — 既存 PR ゲートと同一) |

実装 goal(WL-2)で **契約4ファイル** — CLAUDE.md / .claude/rules/actions.md / .claude/rules/architecture.md /
**.claude/rules/ingestion.md** — に上記を明文化する(M5-B と同じ形式・受け入れ条件でピン)。
ingestion.md は現行文言が「Claude Action が PR を作るための checkout → **許可パスへの追加**」であり、
決定的スクリプト + 限定編集をカバーしないため改定必須(arch レビュー R1 — M5 R4 arch G-2 の4ファイル基準を継承)。

## 1. 目的 / スコープ

### やる — A. オーバーレイ(第2弾・WL-1)

1. **0009 マイグレーション**: `board_overrides` テーブル(cockpit ローカルの差分・SSoT 不変):
   - 一意キー = `(source, file_path, item_key)`(board_items と同じ同一性・**アクティブ行は item ごとに1つ**)。
   - `desired_state` / `base_state` = CHECK 3値。**base_state の定義 = 「移動直前にユーザーが見ていた実効状態」**
     (アクティブなオーバーレイがあれば旧 desired・無ければ board の state)。この定義により
     「PR 未マージ中の再移動 → 自ループの PR マージが superseded を誤発火して新しい意図が消える」穴を
     構造的に塞ぐ(arch/data レビュー R1 穴3: 旧 desired が base になるため、自ループの PR マージは
     「不変」判定になり、新しい desired は次回 CI で PR される)。
   - **DB 段階の防御(sec R1 4-d)**: `CHECK (source = 'cc-sier-organization')` /
     `CHECK (file_path ~ '^\.companies/[^/]+/docs/secretary/[^/]+-wbs\.md$')`(traversal・対象外パスを
     テーブルの時点で拒否 — アプリ層検証の単一点依存を解消)。
   - `user_id`(帰属)/ `created_at` / `updated_at`。
   - `pr_ref`(NULL = PR 未作成)/ `resolved_at`(NULL = アクティブ)/
     `resolution` CHECK ('applied','superseded')。**物理 DELETE なし**(解決 = resolved_at)。
   - 再移動 = 同一行の UPSERT(ON CONFLICT DO UPDATE で desired/base/updated_at を更新・
     resolved_at/resolution/pr_ref をリセット)。**no-op 移動(desired = 現在の実効状態)は
     updateBoardState が受理しない**(bad_request — 偽 applied を作らない。data R1)。
   - **PR クローズ(非マージ)後の復旧 = 再移動**(UPSERT リセットで次回 CI が再送)。これを正規手順として
     受け入れ条件の手動チェックと runbook に明記する(自動の PR 状態照会は作らない — GitHub API 依存を増やさない)。
2. **/today の表示**: 実効状態 = アクティブなオーバーレイがあれば `desired_state`、無ければ board の state。
   **合成対象は最新世代フィルタ(generations 選出)後の行**(data R1 — フィルタで消えた item の override は
   カードごと非表示になるが、CI の「不在」出口(§1-7)が解消するため不可視のまま溜まらない)。
   オーバーレイ中の WBS カードには **「PR 反映待ち」バッジ**(移動が SSoT 未反映であることの可視化)。
3. **/today の操作**: WBS カードにも capture カードと同じ**ボタン + ネイティブ D&D**。
   - 新 Server Action `updateBoardState`(requireUser・入力 = source/file_path/item_key/desired の識別子と
     語彙のみ・board_items に実在する item のみ受理)→ `upsertBoardOverride`。
   - dataTransfer は**識別子のみ**(`wbs|<file_path>|<item_key>`)。本文・タイトルは載せない(TBI-1 §1-3 と同じ規範)。
     機微性評価は **repo の可視性に依存させない**(sec R1): 識別子は本人の認証済みブラウザ内 drag データに留まり、
     内容はパスと WBS ID のみ(自由文なし)。capture カード(UUID のみ)との判別はプレフィックスで行う。

### やる — B. CI 書き戻し(第3弾・WL-2)

4. **状態トークンの逆写像**(純関数・`lib/ingestion/parsers/board-rewrite.ts` 新設):
   `rewriteBoardState(content, itemKey, desired): { content, changed }` —
   `todo→"[ ]" / doing→"[~]" / done→"[x]"`(parseBoard の mapState の正確な逆)。
   - **行選定規則 = parseBoard が items に採用する行と同一**(有効行のみ・重複 ID は先勝ちの1行のみ・
     fence 内/非対象テーブル/状態3値外/ID 空の行は触らない — data R1: パーサのスキップ規定を逆写像にも写す。
     同定ロジックはパーサと共有 module 化し、二重実装しない)。
   - 置換は**該当行のステータスセルのトークンのみ**(行の他のバイト・他の全行は1バイトも変えない)。
   - `changed=false` の条件を明定: (i) ファイル/テーブル/対象行が見つからない (ii) **トークンが既に desired と
     同一**(no-op — data R1 (a))。いずれも PR に含めずスキップ。
   - 決定的・DOM/DB 非依存・ユニットテスト対象。**fixture は既存 demo-plan-wbs.md に加え、不整形 fixture
     (CRLF・不均一パディング・fence 内テーブル・対象テーブル2つ・非対象テーブル内の同名 ID・重複 ID)を追加**
     (バイト不変検証がすり抜けないため — data R1。詳細設計で確定)。
5. **workflow `.github/workflows/wbs-writeback.yml`**(決定的スクリプトのみ・LLM ジョブなし):
   - trigger = `workflow_dispatch` + 日次1回(JST 21:00 = UTC 12:00)。`vars.ENABLE_WBS_WRITEBACK == 'true'` ゲート
     (organize-loop と同じ有効化方式)。
   - 手順: cockpit checkout → npm ci → `scripts/wbs/fetch.ts`(**2集合を返す**: 送信集合 = アクティブ AND
     pr_ref IS NULL(PR 対象)/ **監査集合 = pr_ref の有無に関わらず全アクティブ行**(不在検査対象 —
     arch R2 G-R2-1: pr_ref 付きのまま SSoT 側で item が消えると全出口の外に残るため、不在検査は全アクティブに掛ける)。
     **多ユーザーガード: 全アクティブの count(DISTINCT user_id) >= 2 で run fail**(M5 R3 R-11 と同型)。
     両集合とも0件なら green skip)→ cc-sier-organization checkout(**ORGREPO_PAT**・persist-credentials: false)→
     `scripts/wbs/apply.ts`(送信集合に rewriteBoardState をファイル単位に適用。**監査集合のうち checkout 実物に
     file/item が無い override は superseded 対象として mark へ引き渡す** — 第3の出口・§1-7)→
     `scripts/wbs/verify.ts`(§3-3)→
     `scripts/wbs/pr.ts`(ブランチ `wbs/<date>` — 配列引数 spawn・`git add --`・force なし・
     **staged 閉包検査: `git diff --cached --name-status` の全行が 'M' かつ path が WBS glob かつ verify 済み集合と
     一致**(organize-loop R2 B-2 と同型 — sec R1 4-b)→ PR 作成)→
     `scripts/wbs/mark.ts`(PR 成功分の `pr_ref` 更新 + **不在 override の resolved_at/resolution='superseded'**)。
   - secrets = **`WBS_DATABASE_URL`(専用ロール `wbs_bot`)** / `ORGREPO_PAT`。**workflow 級 env なし・step 級のみ**・
     `permissions: contents: read`・ENABLE ゲート・concurrency は organize-loop の規範を踏襲(詳細設計でピン群を確定 —
     「PAT が現れてよい step の完全列挙」形式。sec R1)。
6. **DB ロール**: **専用ロール `wbs_bot` を新設**(organize_bot の拡張はしない — sec R1 3-b:
   共有ロールだと wbs workflow の侵害で capture_inbox の**本文まで読める**ため、露出面を分離する):
   - GRANT = `SELECT board_overrides(必要列)` / `SELECT board_items(source, file_path, item_key, state, commit)` /
     `UPDATE board_overrides(pr_ref, resolved_at, resolution)`。**capture_inbox への到達ゼロ**。
   - resolved_at/resolution を wbs_bot が書く経路 = **mark.ts の superseded(不在 override)のみ**(§1-5)。
     applied / superseded(外部変更)を書くのはアプリ側(§1-7)— **resolution の書き手の分担を明文化**(arch R1)。
   - `docs/setup/organize-role.sql` に wbs_bot セクションを追記('__set_me__' プレースホルダ)。
7. **照合(ループを閉じる)— 出口は3つ**(R1 の収束性 FAIL を受けて再定義):
   - **applied**(アプリ側・run-sync の board upsert 後): 対象 file_path の**最新世代**に item が存在し
     `state = desired_state` → `resolution='applied'`(ループ完了・バッジが消える)。
   - **superseded / 外部変更**(アプリ側・同上): 最新世代の `state` が `base_state` とも `desired_state` とも
     異なる → `resolution='superseded'`(**SSoT 優先**で表示は SSoT 状態に戻る)。
   - **superseded / 不在**(CI 側・§1-5): **pr_ref の有無に関わらず全アクティブ行**を対象に、checkout 実物
     (SSoT の HEAD)に file または対象 item が見つからないものを mark.ts が `resolution='superseded'` にする。
     **同期側では検出できない**(board_items は upsert のみで stale 行が残る — store.ts の現物挙動。
     R1 で判明した事実誤認の訂正)ため、SSoT 実物基準の CI が受け持つ。
   - 比較対象は**常に最新世代**(getTodayData と同じ generations 選出)。リネームされた旧 file_path 宛ての
     override も CI の「不在」出口で解消される(checkout に旧 path が無い)。
   - **出口の競合(受容)**: アプリ側照合(stale 世代基準になり得る)と CI 不在判定が競合した場合は
     **先に書いた方が勝ち**とする。いずれも resolved 到達であり収束目的は満たす — resolution 値の精度より
     収束を優先(data R2 問い2 の決着)。

### やらない

- WBS の**行追加・削除・タイトル等の他セル編集**(ステータストークン置換のみ — §0 の改定範囲)。
- 即時 PR(カード移動のたびに PR を作らない — 日次バッチ + 手動 dispatch。PR の粒度は1日1本)。
- Claude(LLM)による WBS 編集。organize-loop(capture 整理)への統合(ワークフローは独立 — 責務分離)。
- 複数ユーザーの競合解決(単一ユーザー前提 — capture.md と同じ。オーバーレイの同一 item 再移動は最後勝ち)。
- ai-war-room 側への適用(WBS は cc-sier-organization のみ)。

## 2. アーキテクチャ上の位置づけ

- **App 層**(オーバーレイ表示・操作)+ **Ingestion 層**(照合)+ **CI**(書き戻し)。
- SSoT 読み取り専用の原則は**「手元から」については完全に不変**。書き戻しは §0 の改定どおり
  **CI の限定編集 PR のみ**で、マージ判断は常に人間(既存 PR ゲートと同じ最終防御)。
- 表示の一貫性: /today は「オーバーレイ適用後の実効状態」を出す(操作が即見える)。SSoT とズレている期間は
  バッジで明示し、ループ完了(applied)か SSoT 優先(superseded)で必ず収束する — **無限にズレたままの状態を
  作らない**のが照合(§1-7)の役割。
- capture カンバン(TBI-1)との関係: レーン UI・D&D・ボタンは共通化。書き込み先だけが異なる
  (capture → capture_inbox / WBS → board_overrides)。**board_items への直接 UPDATE は作らない**
  (同期の upsert 経路を唯一の書き込みに保つ — オーバーレイ分離の理由)。

## 3. データ / インターフェース概要

### 3-1. DDL 概要(詳細設計で確定)

```sql
CREATE TABLE board_overrides (
  source text NOT NULL CHECK (source = 'cc-sier-organization'),
  file_path text NOT NULL
    CHECK (file_path ~ '^\.companies/[^/]+/docs/secretary/[^/]+-wbs\.md$'),  -- traversal/対象外パスを DB で拒否
  item_key text NOT NULL,
  desired_state text NOT NULL CHECK (desired_state IN ('todo','doing','done')),
  base_state    text NOT NULL CHECK (base_state    IN ('todo','doing','done')),  -- 移動直前の実効状態(§1-1)
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  pr_ref text, resolved_at timestamptz,
  resolution text CHECK (resolution IN ('applied','superseded')),
  PRIMARY KEY (source, file_path, item_key)
);
-- アクティブ検索用 partial index: WHERE resolved_at IS NULL
```

### 3-2. 関数 IF(詳細設計で確定)

```ts
// lib/data/board-override.ts(新設)
upsertBoardOverride(userId, key: {source,filePath,itemKey}, desired, base): Promise<void>
listActiveOverrides(): Promise<OverrideRow[]>            // /today 合成用(resolved_at IS NULL)
resolveOverridesAfterSync(): Promise<{applied,superseded}>
//   §1-7 前2出口。比較対象 = 最新世代の board_items(generations 選出を共有)。
//   run-sync の saveSyncState 到達を妨げない配置(例外は握って要約に計上 — 進行カーソルを失わない。arch R1)

// lib/ingestion/parsers/board-rewrite.ts(新設・純関数。行同定はパーサと共有 module)
rewriteBoardState(content: string, itemKey: string, desired: State): { content: string; changed: boolean }

// app/(shell)/today/actions.ts(新設 Server Action)
updateBoardState(input: {source,filePath,itemKey,desired}): Promise<Result>
//   requireUser + 語彙検証(desired 3値・source 固定値)+ board_items 実在確認
//   (意味論 = 「過去に同期された item」— upsert-only のため。最新世代限定かは詳細設計で確定)
//   + no-op 拒否(desired = 現在の実効状態 → bad_request)
```

### 3-3. verify(CI・機械判定)— **一次基準 = 行単位バイト diff**(sec/data R1 で (d) の死角を指摘され再定義)

PR 作成前に必ず、変更した各ファイルについて:
- **(一次) 行単位バイト diff**: 変更行は「対象 item ごとにちょうど1行」だけで、各変更行は
  **ステータスセルのトークン置換以外のバイト差が無い**こと。**それ以外の全行(パーサが skip する行 —
  重複 ID の2行目・状態3値外・ID 空・fence 内・他テーブル — を含む)はバイト単位で完全不変**。
- **(二次) parse 前後比較**: (a) item 数同一 (b) 対象 item_key の state だけが desired に変化
  (c) 他の全 item の全フィールド完全一致。
- **(e) パス検査**: 変更ファイルの path が `.companies/<org>/docs/secretary/*-wbs.md` glob に一致・
  `..`/絶対パスを拒否(§0 の対象ファイル制約の機械化 — DB CHECK と pr.ts の staged 閉包検査に加えた三重目)。
- before の出所 = **orgrepo checkout の HEAD(git 経由)**。apply が保存したコピーを before に使わない
  (自己検証を避ける — sec R1 4-b)。
いずれかが破れたら **PR を作らず fail**。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| 既存ファイル編集という新しい書き込み面 | §0 の多重制約(対象ファイル・トークン置換のみ・決定的スクリプト・機械 verify・PR 人間レビュー・自動マージなし)。**プロンプト注入面は構造的にゼロ**(LLM 不使用) |
| **自己検証の限界(sec R1 4-c — 明示的な受容)**: apply と verify は同一 checkout・同一 node_modules で動くため、**cockpit repo のスクリプト改ざん・npm 依存汚染に対して機械 verify は防御にならない**。侵害時は PAT で glob 外の任意 PR も作れる | organize-loop publish job と同等の**受容済みリスク**として明記する。残る独立防御 = **PR 人間レビュー + branch protection + PAT 最小スコープ**の3枚。緩和策として `npm ci --ignore-scripts` の採用可否を詳細設計で確定。**「毎日のトークン置換 PR を機械的に承認する習慣(レビュー疲れ)」が最終防御を無効化する**ことをユーザー向け runbook に明記する |
| WBS ID / ファイルが SSoT 側で変更・削除されて apply 先が見つからない | **CI の「不在」出口**(§1-7 第3出口)で mark が superseded 化 — ゾンビ化しない(同期側では検出不能: board_items は upsert のみで stale 行が残るため) |
| PR マージ前に SSoT 側で同じ行が変更される(競合) | マージ時は GitHub の通常コンフリクト解決(人間)。同期側は §1-7 の superseded(外部変更)で SSoT 優先 |
| PR をマージせずクローズ | 自動検出しない(受容 — GitHub API 照会を増やさない)。**復旧 = カードの再移動**(UPSERT リセット → 次回 CI が再送)。runbook に明記 |
| PR 未マージ中の再移動 | base_state = 実効状態の定義(§1-1)により自ループ PR のマージは「不変」判定 → 新しい desired が次回 CI で送られる。**同一 item の open PR が一時的に2本並び得る**(受容 — 人間レビューで新しい方をマージ・古い方をクローズ) |
| 単一ユーザー前提の破れ | fetch.ts の **DISTINCT user_id ガード**(2以上で run fail — M5 と同型) |
| wbs_bot の権限 | capture_inbox への到達ゼロ(専用ロール)。UPDATE は board_overrides の3列のみ。侵害時の被害上限 = 「WBS 移動意図の偽装・握り潰し」まで(個人メモには届かない) |

## 5. 受け入れ条件(機械判定)

WL-1(オーバーレイ・アプリ内で完結):
```bash
# 0009 up/down 存在 + ローカル適用で board_overrides が存在
test -f db/migrations/0009_*.up.sql && test -f db/migrations/0009_*.down.sql
# 契約テスト(ケース名 grep): upsert の ON CONFLICT リセット / active 絞り込み / 実効状態の合成 /
#   updateBoardState の実在確認・語彙検証・未認証 401
grep -q "upsertBoardOverride" tests/board-override.test.ts
grep -q "updateBoardState" tests/board-override.test.ts
# UI ピン: WBS カードの dataTransfer が識別子のみ(wbs| プレフィックス)
grep -qE 'setData\("text/plain", `wbs\|' "app/(shell)/today/board.tsx"
# 既存ガバナンス不変: capture の UPDATE 3本 / board_items への UPDATE 文が存在しない
[ "$(grep -c 'UPDATE capture_inbox' lib/data/capture.ts)" = "3" ]
! grep -rq "UPDATE board_items" lib/ app/
# npm test / tsc / build / e2e 6画面 green(FC-1 ハーネス)
```

WL-2(CI 書き戻し・照合・契約):
```bash
# rewrite 純関数: fixture 往復ユニット(対象のみ変化・changed=false 2系統(不在/no-op)・重複 ID 先勝ち・
#   不整形 fixture(CRLF/パディング/fence)でのバイト不変)
grep -q "rewriteBoardState" tests/board-rewrite.test.ts
# verify: §3-3 のケース名 grep(行単位バイト diff 一次・parse 二次・パス glob (e)・skip 行不変の反例検出)
# 多ユーザーガード: fetch の DISTINCT user_id >= 2 fail ケース
# 削除 API 否定: scripts/wbs に rmSync/unlinkSync/renameSync/git rm が無いこと(organize-loop 条件2 と同型)
# workflow 静的ピン: ENABLE_WBS_WRITEBACK ゲート / workflow 級 env なし / persist-credentials: false /
#   ORGREPO_PAT が現れてよい step の完全列挙 / permissions: contents: read / force なし / 配列引数 spawn /
#   0件 green skip / staged 閉包検査(--name-status 全行 'M' + glob 一致)
# 契約4ファイル(CLAUDE.md / actions.md / architecture.md / ingestion.md)に「WBS 限定編集」の明文(grep)
# 照合: resolveOverridesAfterSync ケース(applied / superseded 外部変更 / 不変 / 最新世代基準)+
#   mark の superseded(不在)ケース
# organize-role.sql に wbs_bot セクション(grep — capture_inbox への GRANT が増えていないことの否定 grep 含む)
```
(実行形の完全版・凍結列挙・閉包 allowlist は**詳細設計 §4 で確定** — organize-loop と同じ進め方。
workflow ピンの具体化では M5 で FAIL を繰り返した論点 — awk レンジ終端・count 母集団固定・uses 許可リスト方式 —
を必ず踏襲する。)

## 6. 実装の分割と禁止事項

- **詳細設計必須**(CI 書き戻し・DDL・verify を含むため — organize-loop の前例):
  `/detailed-design wbs-loop` → `/design-review` → 実装。
- Goal 分割:
  - **WL-1**(アプリ内オーバーレイ): 0009 + board-override データ層 + updateBoardState + /today 合成表示 +
    board.tsx の WBS 操作 + バッジ。**この時点で「動かせる」体験は完成**(SSoT 反映は WL-2 から)。
  - **WL-2**(CI 書き戻し + 照合 + 契約改定): board-rewrite + scripts/wbs 4本 + workflow + role 拡張 +
    resolveOverridesAfterSync + CLAUDE.md/actions.md/architecture.md 改定。
- 禁止(両 goal 共通): 手元から SSoT への書き込み(この開発でも clone・直編集は完全禁止 — 書くのは CI のみ)/
  `UPDATE board_items` の新設 / 物理 DELETE / .env 非接触 / 秘密の直書き(role SQL は '__set_me__')/
  workflow への Claude(LLM)ジョブ追加 / 凍結テスト本文の変更 / force push。

## 7. 未解決の問い

- PR 本文のフォーマット(含める情報 = 変更 item の一覧と from→to。capture_ids 相当の相互参照は不要か)—
  詳細設計で確定。
- 日次スロットの時刻(JST 21:00 仮置き)— 有効化時にユーザーが Variables で調整可能にするか — 詳細設計で確定。
