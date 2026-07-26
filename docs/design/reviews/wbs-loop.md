# design-review: wbs-loop(基本)

- 対象: docs/design/basic/wbs-loop.md
- 実施日: 2026-07-26
- 方式: 3レンズ並行 × 3ラウンド(R3 は arch の残余1点のみ)
- 前提: 黄金ルール1 の改定(WBS 限定編集)は 2026-07-26 にユーザー承認済み(AskUserQuestion「フルループ」)

## Round 1 — **3レンズ全 FAIL**(本質的な発見多数)

| # | レンズ | 指摘(要旨) | 設計への反映 |
|---|---|---|---|
| 1 | arch/data | **照合の事実誤認**: 「stale 行は次回同期で superseded に自然解消」は誤り — store の upsert は行を消さないため、item 削除/リネームで override が**永久アクティブのゾンビ化**(しかも世代フィルタで不可視) | 照合を**3出口**に再定義: applied / superseded(外部変更)= アプリ側・最新世代基準、**superseded(不在)= CI 側・checkout 実物基準**(同期側では構造的に検出不能のため) |
| 2 | arch/data | 再移動 × 自ループ PR マージで superseded が誤発火し新しい意図が silent に消える | **base_state = 「移動直前の実効状態」**に定義変更(自ループの PR マージ = 不変判定になり、新 desired は次回 CI で送られる) |
| 3 | arch/data | PR クローズ(非マージ)後の出口が無い / no-op 移動で偽 applied | 復旧 = 再移動を正規手順として明文化(受容)/ updateBoardState が no-op を拒否 |
| 4 | sec/data | **verify の死角**: parse 前後比較だけではパーサ skip 行(重複 ID 2行目・fence 内等)の改変がすり抜ける — fixture 内に具体的反例あり | verify を**行単位バイト diff 一次基準**に再定義(skip 行含む全行のバイト不変)+ parse 二次 + (e) パス glob + before = checkout HEAD |
| 5 | sec | pr.ts の staged 閉包(PR に載る集合 = verify 済み集合)が未宣言 | `git diff --cached --name-status` 全行 'M' + glob + verify 済み集合一致(organize-loop B-2 同型) |
| 6 | sec | **共有ロールの露出面**: organize_bot 拡張だと wbs workflow 侵害で capture の個人メモ本文まで読める | **専用ロール wbs_bot 新設**(capture_inbox 到達ゼロ・UPDATE 3列限定・被害上限 = WBS 移動意図の偽装まで) |
| 7 | sec/arch | GRANT 3列の使用経路不明(resolution の書き手が曖昧) | 書き手分担を明文化: アプリ = applied/superseded(外部変更)・CI mark = superseded(不在)のみ |
| 8 | sec | 自己検証の限界(apply と verify が同一トラストドメイン)の未明記・「organize-loop より攻撃面が狭い」は過大 | リスク表に明示受容: 依存汚染時は verify 無効・最終防御 = PR 人間レビュー + branch protection + PAT スコープ・**レビュー疲れ警告を runbook へ**・主張は「プロンプト注入面ゼロ」に限定 |
| 9 | sec | DB 段階の防御ゼロ(file_path traversal 等) | 0009 に CHECK(source 固定・file_path glob 正規表現)追加 — 多層の一層 |
| 10 | arch/sec | 多ユーザーガード(M5 R-11 同型)未継承 | fetch に DISTINCT user_id >= 2 → run fail |
| 11 | arch | 契約が3ファイル(ingestion.md 漏れ — M5 R4 G-2 の再発) | **契約4ファイル**に(ingestion.md の「追加のみ」文言の改定理由も明記) |
| 12 | data | rewrite の行選定規則未定・fixture 不足(CRLF/パディング/fence) | パーサと同一の行同定(共有 module 化・先勝ち)+ changed=false 2条件 + 不整形 fixture 追加計画 |
| 13 | sec | dataTransfer の機微性評価が「公開 repo」依存 / PAT ピン語彙 / 削除 API 否定 grep | 理由づけを可視性非依存に修正 / 「PAT が現れてよい step の完全列挙」形式 / 否定 grep を条件に明記 |

## Round 2 — data PASS / sec PASS / arch FAIL(新規 G-R2-1)

- **G-R2-1**: pr_ref 付きアクティブ行が SSoT 側で不在化すると全出口の外(fetch が pr_ref IS NULL しか
  拾わない × カード不可視で再移動も不能)→ **fetch を2集合に再定義**(送信集合 = pr_ref IS NULL /
  **監査集合 = 全アクティブ** — 不在検査とマルチユーザーガードは監査集合基準)。
- data R2 問い2(stale 世代基準の誤 applied と CI 不在判定の競合)→ 「先に書いた方が勝ち・いずれも
  resolved 到達で収束目的を満たす」を明文受容。

## Round 3 — **全レンズ PASS**

- arch が G-R2-1 の反例トレースで解消を確認。副作用(不在 superseded 後の PR マージ = modify/delete
  コンフリクトで人間判断・受容済みの族)も新たな穴なし。

## 詳細設計レビュー(2026-07-26・3レンズ × 3ラウンド)

### R1 — 3レンズ FAIL(機械ピン層の穴が中心・約20点)

主要指摘と反映: **判定バグ**(複数ファイル grep -q の ANY 判定 → per-file ループ / 「overrides」空ピン →
resolveOverridesAfterSync 固有名)/ **tokenStart 算出規則の未定義**(生の行の `|` 走査・先頭 `|` 分岐・
末尾セル規則・CRLF 整合を §2.2 に明文化 + messy fixture に行頭 `|` 無し行等の反例追加)/
**allowlist 帰属矛盾**(messy fixture・board-rewrite.test.ts を WL-1 帰属に整理)/ **M5 実行形の不履行**
(awk step レンジ・uses 許可リスト・job 級 env 否定を実行形で復帰 — §0-8 として決着表に追加)/
**server-only 連鎖**(scripts/wbs に sync-local 型スタブ + ピン)/ **scripts 共通規範**(配列引数 spawn のみ・
exec 否定・hooks 中和・+refspec 否定・user_id 非漏出・ログは件数とパスのみ)/ apply の封じ込め
(startsWith assert + lstat symlink skip)/ mark への PR 成功信号(out/pr.json)/ wbs_bot の board_items
SELECT 削除(最小権限)/ date 権威(id: run + JST)/ 空 step 条件 / レビュー疲れ警告の機械ピン /
board_overrides_not_noop CHECK / LATEST_BOARD_CTE(世代選出の単一定義 + 文字同一ピン)/
board-parser.test.ts 無変更の機械ピン / db-recovery.md への復元不能クラス追記。

### R2 — data PASS / sec PASS / arch FAIL(残余3点)

A: uses 許可リストが M5 の字下げ非依存形より弱い → M5 形に差し替え。
B: awk 終端アンカー(id: apply)の実在無保証 → **8 step id の実在 + 昇順の実行形ループ** + §5「step id
削除・改名禁止」。C: user_id 非漏出ピンが恒真 → テスト側の非収録 assert ケース名ピンに置換。
軽微: CTE 別名 generations 統一・--force リテラル禁止・RegExp.exec 禁止・wbs_bot への board_items GRANT 否定。

### R3 — **全レンズ PASS**(arch が A/B/C の解消と新実行形の健全性を確認)

R3 残余観察2点も反映済み: §3 に user_id 非収録観点 / awk アンカーを実在ループと同形(dash-free)に統一。

## /goal WL-1 / WL-2 への申し送り(詳細)

- 実装順: WL-1(0009 → board-override → walker+同値性テスト → action → 合成 UI)→ WL-2(rewrite →
  scripts 5本 → workflow → role → run-sync 統合 → 契約4ファイル)。
- judge は §4 を「stdout 数値比較」で実行(FC-1/TBI-1 と同運用)。§4-R の受容一覧を「実装漏れ」と誤判定しない。
- 凍結基準 = 各 goal の分岐点 main。board-parser.test.ts は両 goal とも変更・追記禁止。
- 修正ブランチは必ず main から切る(TBI-1 の反省)。

## 合格判定

**基本 = 全レンズ PASS(R3)/ 詳細 = 全レンズ PASS(R3)** — `/goal WL-1` へ進む。

## 詳細設計への申し送り

- rewrite の行同定はパーサと**共有 module**(列挙ベースの独立実装禁止 — parseBoard の skip 4カテゴリ
  (状態3値外・ID 空・重複・**タイトル空**)と判定順を1対1で)。
- verify の「count 母集団」ピンは**監査集合基準**で固定(M5 の count 母集団論点の踏襲)。
- DB CHECK の正規表現は `..` セグメントを通す(`[^/]+` が `..` にマッチ)— 「DB は多層の一層」と主張を
  実態に合わせるか regex を厳格化するか決着(sec R2 問い1)。
- `WBS_DATABASE_URL` も「現れてよい step の完全列挙」対象に含める(sec R2 問い2)。
- listActiveOverrides の user_id 非スコープは単一ユーザー前提の意図的判断として一言残す(sec R2 問い3)。
- workflow ピン具体化は M5 の FAIL 論点(awk レンジ終端・count 母集団・uses 許可リスト)を必ず踏襲。
- `npm ci --ignore-scripts` の採用可否・日次スロット時刻(JST 21:00 仮)・PR 本文フォーマットを確定。
