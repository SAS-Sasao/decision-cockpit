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
