# design-review: organize-loop(M5 自動整理ループ — capture 消費 + 2-repo PR 書き戻し)

対象: docs/design/basic/organize-loop.md(§0 = 黄金ルール1 改定(cc-sier への PR 書き戻し解禁)— ユーザー承認済み 2026-07-20 を前提に審査)

## Round 1 — 2026-07-20

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | **High: 還流の主張がパーサ契約と構造矛盾**(logs の slot 付きファイル名は parseDailyLog 非対応・frontmatter 先頭は両パーサの1行目 H1 契約と矛盾 — 生成物が全て error 行化し「循環が閉じる」が不成立)。Med 2(checkout PAT 残存 — persist-credentials 既定 true で generate 中の直 push が可能 / 帰属未決着)。Low 4 |
| data | **FAIL** | High 3(同・ファイル名 / frontmatter vs H1 / **パーサ適合の機械判定ゼロ**)。Med 3(mark IF が集約粒度と矛盾(単一 ref × ids 配列)/ 帰属 / capture_ids 重複を合併一致が素通し)。Low 5。消費 SQL・0008・count 勘定(scripts と capture.ts の別勘定)・status='done' の UI 整合は現物実証 |
| sec | **FAIL** | **High 3: (1) persist-credentials 残留 → generate 中に PAT で main 直 push 可能(PR ゲートの機構的迂回)(2) Claude が可書のワークスペースに verify/mark スクリプト・.git が同居 — 改ざんで防御崩壊・DATABASE_URL で任意 SQL (3) 機微ファイル読み取り→生成 MD への流出は verify(書き込み検査)で原理的に検知不能 — マージ後に索引へ還流する洗浄経路**。Med 5(generate env の PAT ピンなし / ツール・ネットワーク未定義 / 帰属 / branch protection / DB ロール先送り)。Low 6 |

**総合: FAIL(全レンズ)** → rev.2 で決着:
1. **パイプライン順序の再設計**: generate(Claude)を**書き戻し先 checkout より前**に移動 — Claude 実行時に SSoT repo も secrets(DATABASE_URL・PAT)も存在しない。出力は `out/files.json` マニフェスト + `out/md/`。verify(CI 内 judge)→ checkout(persist-credentials: false)→ 配置(script copy・追加のみ)→ pr(PAT はこのステップのみ)→ mark。ツールは Read/Write に制限・PR 本文は script 固定テンプレート。
2. **パーサ拡張を M5-A に編入**(還流を実際に閉じる): frontmatter 剥離・parseDailyLog のファイル名拡張・生成規約の適合・凍結例外(追加のみ diff ピン)+ **生成物 fixture → 両パーサ ok のユニットテスト**(機械判定化)。
3. mark = ファイル単位反復(検証済みマニフェストの (パス↔ids))/ verify = **分割一致**(欠落・捏造・重複 fail)/ 帰属 = 書かない(単一ユーザー前提・capture.md 更新)/ actions.md 条件文言更新 / branch protection 確認を条件7 へ / DB 専用ロール = 詳細設計の必須セクション化。

## Round 2 — 2026-07-20(rev.2)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **FAIL(G-1)** | R1 決着はすべて確認(パーサ拡張の現物整合・順序再設計・帰属)。**残 = generate の Write が無スコープ**: cockpit checkout(verify/pr/mark の実体)が generate 時に存在し、Write で改ざん → 後続が秘密付きで改ざん済みスクリプトを実行 — 「Claude の権限 = out/ のみ」が不成立 |
| data | **PASS** | High 3件の決着を現物突合(拡張 RE は厳密上位互換・LOGS_RE はディレクトリ判定でルータ変更不要・frontmatter 剥離は既存入力に無害・分岐2 H1 で ok 化)。分割一致・mark 反復・帰属も決着。残 Low(剥離ヘルパの置き場 / body の frontmatter 除去 / status キー名前衝突)は詳細設計送り |
| sec | **FAIL(High-A)** | 同・スクリプト改ざん経路の残存(攻撃連鎖: インジェクション → verify.ts/mark.ts 上書き → PAT 流出・任意 SQL)。Med-1(files.json のソース `file` 未検証 — ランナー上ファイルの持ち出し)。他の R1 指摘は決着 |

→ rev.3 で決着: **(a) cockpit/ サブディレクトリ隔離(out/ は checkout 外)(b) `Write(out/**)` パススコープ(静的ピン)(c) integrity 検査 = workflow YAML インライン(checkout スクリプト非依存・Claude は実行中 workflow を書き換え不能)で `git -C cockpit status --porcelain` 空を verify 前に確認**の三重 + ソース `file` の out/md/ 境界検証 + 「秘密ゼロ」表現の精密化(OAuth トークンの被覆宣言)+ 内容持ち出し = 人間レビュー依存の受容宣言 + 剥離意味論(body・status 非マップ・occurred_at)の必須項目化。

## Round 3 — 2026-07-20(rev.3 を arch/sec 再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | G-1 の三重決着を確認(物理分離・パススコープ・インライン integrity — 逃げ道検討: パススコープ不奏効でも integrity が実行前検知・out/ 外は実行経路なし・持ち出しはソース境界で fail)。新規要素(cockpit/ path・integrity)の整合・表現統一・剥離必須項目化も確認 |
| sec | **PASS**(持ち越し Med 1・Low 2) | High-A 決着(攻撃連鎖は各リンクで切断)。**持ち越し Med: 分割一致の基準集合(rows.json)が Claude 可書域 — 自己参照化の穴** / Low: PAT ピンと step5 checkout token の整合 / pr.ts の commit 対象範囲 |

**総合: PASS(全レンズ — arch R3 / data R2 / sec R3)** — sec R3 持ち越しは rev.4 で吸収:
**信頼アンカー = `state/ids.json`**(workspace 直下・cockpit 外かつ out 外 = Write スコープ外)に fetch が ID 集合を複製し、verify の分割一致はこちらを基準にする(条件3 に grep ピン)/ PAT 参照ピンを「checkout(2 repo)+ pr のみ(generate 以前に無い)」に修正 / **pr の `git add` はマニフェスト列挙形(`-A` 否定 grep)**。

### detailed-design への申し送り(非ブロッキング)

1. **DB 専用ロール(organize_bot: SELECT + 3列 UPDATE 限定)の採否 + GRANT 設計 — 詳細設計の必須セクション**(sec R1 Med-8 の条件化)。
2. **剥離の意味論3点**(§1-C-5): body = 剥離後本文 / frontmatter `status` をレコード status に非マップ / occurred_at・ファイル名日付・frontmatter date の優先関係。
3. 剥離ヘルパの置き場(各パーサ内 or normalize.ts — FROZEN 全列挙で確定)。
4. `Write(out/**)` の claude-code-action での表現可否を実地確認(不奏効でも integrity が二段目 — 主張の書き分けを維持)。
5. 集約ファイル(logs)の frontmatter kind/status の値語彙(例: kind: mixed・status: curated)。
6. step5 checkout の token 設計(PAT 入力)とピン文言の整合・pr.ts の push 認証形。
7. cc-sier decisions/ の既存 MD 規約の現物偵察(生成規約との整合)。
8. workflow 静的ピンの実行形(fenced block 化)と M5-A/M5-B の条件割付・FROZEN_TESTS_M5 全列挙(scripts/organize・parsers 例外2 + テスト2 を除く)。

---

# 詳細設計(docs/design/detail/organize-loop.md)

## Round 1 — 2026-07-20

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | High: 還流の主張がパーサ契約と構造矛盾(logs の slot 付きファイル名・frontmatter 先頭が両パーサの1行目 H1 契約と衝突 → 生成物が全て error 行化)。Med 6・Low 群 |
| data | **FAIL** | High 3(同・パーサ適合の機械判定ゼロ)。Med(mark IF が集約粒度と矛盾・重複を合併一致が素通し)ほか |
| sec | **FAIL** | **High 3: persist-credentials 残留で generate 中の直 push / Claude が verify・mark スクリプトを改ざん可能 / 機微ファイル読み取り流出が verify で検知不能**。Med 11 |

→ rev.2: **3-job 分離**(Claude の job に checkout・secrets・スクリプト実体が存在しない構造)+ パーサ拡張の編入 + 帰属の決着。

## Round 2 — 2026-07-20

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | G-1: `persist-credentials: false` の count が 3(実際は checkout 4本)— **ピンが誤った是正(guard 外し)を誘導** |
| data | **PASS**(Med 1) | High 3件の決着を現物突合。Med: revalidatePath 相当の穴なし・残 Low |
| sec | **FAIL** | B-2: `--name-status` 検査が commit 後で常に空振り / B-3: artifact に capture 本文が既定90日永続 / B-4: 機微ファイル文言の脱落 |

→ rev.3: count 修正・検査順序の是正・`retention-days: 1`・固定文言の復帰。

## Round 3 — 2026-07-20

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | A-1: **CI 層 → Ingestion 層の import 境界が未宣言**(server-only は tsx で throw・テスト緑のまま CI だけ落ちる false-green) |
| data | **FAIL** | **D-5: 前進保証がない**(denylist 語が日常語 → slug 混入 → run 全体 fail → キュー先頭が恒久停止 = livelock)/ **D-6: date/slot を供給する主体が存在しない** |
| sec | **PASS** | 3-job 分離で High-1/2/3 が構造的に消滅したことを確認 |

→ rev.4: **ファイル名の決定化(slug 廃止)**で livelock の発火源を除去 + **`state/run.json`** で date/slot/org をアンカー化 + frontmatter.ts を依存ゼロの純モジュールに。

## Round 4・5・6 — 2026-07-20

| ラウンド | arch | data | 決着 |
|---|---|---|---|
| R4 | FAIL(pr の date 供給・clone 契約・server-only grep の不発) | FAIL(date 権威の二重化・JST の機械ピンゼロ・org 供給断線) | rev.5: 権威を workflow step に一本化・ingestion.md を契約更新に追加・許可リスト形の import ピン |
| R5 | FAIL(G-A: allowed_orgs が job B に届かない) | FAIL(B-1 同・B-2 JST が存在ピンのみ) | rev.6: **rows.json の内容契約を確定**(`{date, slot, allowed_orgs, rows}`)+ `date +%F` の契約化 |
| R6 | **PASS** | FAIL(TZ と date の同居が未保証・checkFrontmatter に manifest が渡らない) | rev.7: **step レンジで同居を検査**(`id: run` 〜 `id: checkout-cockpit`)+ IF 修正 |

## Round 7・8 — 2026-07-20(最終)

| ラウンド | data | 決着 |
|---|---|---|
| R7 | FAIL(D-1: **awk レンジの終端アンカーが未ピン** — 失効するとレンジが EOF まで広がり TZ 経路が復活) | rev.8: **両アンカーの存在 + 行番号順序を実行形で保証**(R2 G-4 と同基準)+ §5 で id の削除・改名を禁止 + 条件8 に JST 当日の手動確認 |
| R8 | **PASS** | 供給鎖(算出 → env → run.json → verify / pr)が端から端まで機械ピンで閉じたことを確認。残 Low 4件を rev.9 で吸収(アンカーの一意性・近接性 / `date` オプション後置形の否定 / 版ポインタから版数を撤去 / org 名の deny 語衝突を §4-R に明記) |

**総合: PASS(全レンズ — arch R6 / data R8 / sec R3)**

### 最終的な防御構造(8ラウンドの帰結)

1. **3-job 分離**: Claude が動く job には checkout・node_modules・`.git`・workflow secrets のいずれも存在しない(改ざん対象が同一 FS に無い)。
2. **信頼アンカーの非対称**: `state/ids.json`(分割一致の基準)は job B に渡さない。date/slot/allowed_orgs は決定に必要なので渡すが、**verify は必ず run.json 基準**で突合。
3. **決定的ファイル名**: 自由語 slug を廃止し `<date>-<slot>[-d<nn>]` に固定 — denylist 衝突による **livelock の発火源を構造的に除去**。
4. **CI 内 judge(verify)**: 許可パス正規化・ソース域限定・分割一致・H1・frontmatter(capture_ids 集合一致含む)・org・重複 path・run メタ書式。
5. **DB 専用ロール**: organize_bot(SELECT 10列 / UPDATE 3列)で**被害上限を3列 UPDATE に封じ込め**。
6. **多ユーザーガード**: `count(DISTINCT user_id) ≥ 2` で run fail(単一ユーザー前提の破れを機械検知)。
7. **PR ゲート**: force / main push の否定・`git add --` のパス列挙・`--name-status` 全 A(commit 前)・branch protection(条件8)。
8. **人間レビュー**: 最終防御。機械で検知できない範囲(内容の持ち出し・意味論の妥当性)は §4-R に受容として宣言。

### /goal への申し送り(Info)

1. 条件3 の awk レンジは `id: run` / `id: checkout-cockpit` の**一意性・順序・近接(12行以内)**に依存する — workflow 編集時に壊さない(§5 禁止事項)。
2. 条件4 のケース名 grep は**抜き取り**(主要ケースが黙って落とされていないことまで)。アサーションの妥当性は人間レビュー。
3. §4-R の15項目は**既知の制限の受容宣言** — M5 で解決しない事項(provenance 非索引化・タグ床なし・todos 非還流・head-of-line ほか)は M6 送りとして明示済み。
4. M5-B は主セッション実施だが**判定は acceptance-judge**(黄金ルール4)。
