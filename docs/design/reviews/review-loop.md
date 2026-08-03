# design-review: review-loop(基本)

- 対象: docs/design/basic/review-loop.md
- 実施日: 2026-08-03
- 方式: 3レンズ並行 × 2ラウンド + sec 確認ラウンド(R3)

## Round 1 — **3レンズ全 FAIL**

| # | レンズ | 指摘(中核) | 反映 |
|---|---|---|---|
| 1 | arch **FAIL** | **状態機械の「排他」主張が数値レベルで破綻** — stale 15分 vs CI 最悪所要 ~25分の窓で error(stale)→done の上書きが可能(writeback に CAS なし)。job3 の素の `if: always()` は gate off・claim 不成立でも走り、claim していない行に error を書き得る | **全書き手 CAS + 先勝ち・後着 no-op** に再設計(writeback = `WHERE status='running'`)。stale 閾値を根拠づけ(pending 15分 / running 60分)。job3 = 「gate 成立 AND claim 成功 AND 未キャンセル」の合成条件(素の always() 不使用) |
| 2 | data **FAIL** | 同上(running 遷移の書き手2つ・CAS 未定義)+ **review_bot の GRANT がテーブル単位** — 前例(organize_bot / wbs_bot の列限定)より粗く、question 改ざん = 注入踏み台・created_at 改ざん = 日次カウント汚染が可能 | **列限定 GRANT**: SELECT (id, status, question, created_at, started_at — requested_by 非取得)/ UPDATE (status, started_at, completed_at, result, result_truncated, error_kind, run_ref) |
| 3 | sec **FAIL** | (G-1) **allowedTools ピンなし = プロンプト規律のみ** — 注入経由の Bash で共用 OAuth(M5)持ち出しが最悪ケースなのに過小評価 (G-2) **PAT 実害上限の過小評価**(他 workflow dispatch = SSoT への PR 経路間接起動・run cancel・artifact 読取・痕跡消去)(G-3) persist-credentials 未言及 (G-4) retention 未指定・機微規律なし・private 前提未明記 (G-5) CI 上の repo 設定(CLAUDE.md/settings/hooks)の帰結未検討 | allowedTools 完全一致(Read/Grep/Glob/Write(out/**))+ Bash/WebFetch/mcp__* 否定ピン / PAT 実害4系統列挙 + 「workflow 単位に絞れない」制約明記 + 受容根拠 / persist-credentials: false 全 checkout / retention 1日・UI 注記・private 前提 + ゲート (g) / settings.json 除去 + CLAUDE.md 受容 + 引数が正 |
| 4 | 共通 | error_kind CHECK・completed_at 経路・run_ref 記録時点・result 切り詰め単位・一覧上限・judge 代替禁止・ChatTurn 合流・閉包 allowlist 等 | すべて v2 に反映(§1-1・§1-6・§1-7) |

## Round 2 — arch PASS / data PASS / sec **FAIL(1点に収斂)**

- arch: 再設計後の状態機械を突き合わせ(二重 dispatch・sweep×claim 競合・cancel・concurrency 占有)— 穴なし。
- data: CAS の READ COMMITTED 下での成立・列 GRANT と claim 書き込みの整合・sweep 判定列の独立を確認。
- sec **FAIL**: **追跡済み `.mcp.json` が job2 ワークスペースに残留**(npx で外部コード取得・起動すれば
  OAuth 保持プロセスの子)— 「持ち出し経路が構造的に不在」がデフォルト挙動頼み。
  settings.local.json(MCP 承認を含む)の gitignore 未整備。settings.json 除去根拠が
  フック衛生のみ(セキュリティ load-bearing の記録なし)。

→ 反映: **job2 の除去対象 = settings.json + `.mcp.json`(+ settings.local.json)**・除去根拠3点
(承認拡張防止 / MCP 起動の構造遮断 / フック誤動作防止)+ **巻き戻しは sec 再通過**・
`.gitignore` に settings.local.json(追跡ガード)・question は**ファイル渡し**(式展開注入面の回避)・
claim = **単一 UPDATE RETURNING**(green skip 時に question を artifact 化しない)・
DDL 整合制約追加(running ⇒ started_at NOT NULL / done,error ⇒ completed_at NOT NULL)。

## Round 3(sec 確認)— **PASS**(N-1/N-2/N-3・問い5件すべて ○)

## 合格判定

**全レンズ PASS** — `/detailed-design review-loop` へ進む。

## /detailed-design review-loop への申し送り(3レンズの残問い)

- **DDL**: 整合制約の SQL 形(⇔ / ⇒ の CHECK 化)・requested_by FK の実形・インデックス。
  claim の**単一 UPDATE 文**(CAS + started_at + run_ref + RETURNING question)をそのまま DDL/スクリプトに。
- **claim スクリプト**: 不正 UUID の request_id 入力の挙動(green skip に丸めるか fail か)を確定。
- **API**: isAdmin の**ハンドラ単位**機械判定ピン / JST 日次カウントの WHERE 句(AT TIME ZONE・DB now() 基準)/
  dispatch_failed CAS(claim 先勝ち時の「502 後に done」は仕様)。
- **workflow の完全形ピン**(wbs-loop 同様の粒度で): step-bound secrets / allowedTools 完全一致 +
  否定(Bash・WebFetch・WebSearch・mcp__)/ persist-credentials: false 全 checkout / retention-days: 1
  全 artifact / **除去 step(settings.json + .mcp.json)が claude-code-action の前にある**こと /
  prompt に `${{ }}` の question 展開が**無い**こと(ファイル渡し)/ job3 の合成 if(素の always() 否定)/
  workflow 級 permissions contents: read のみ・job 級なし・env は step 級のみ。
- **result**: 上限値・文字単位切り詰めの実装(UTF-8 セーフ)・result_truncated の UI 表示。
- **UI**: パネルのモードセレクタ(3値)と ChatTurn.mode(2値・凍結)の**型を混ぜない**ピン /
  run_ref 前置一致リンク化のテスト。
- **テスト観点**: 純関数化の範囲(検証・上限・CAS SQL 文・run_ref 検証)と件数。
- **goal 別閉包 allowlist(実行形)を詳細設計 §4 に置く**(RL-1 / RL-2)。
- 同時1件はアプリ層の努力目標(単一ユーザー受容)— DB 層担保はしない決着を維持。
