# design-review: codex-ops(基本)

- 対象: docs/design/basic/codex-ops.md
- 実施日: 2026-08-01
- 方式: 3レンズ並行 × 2ラウンド + arch 確認ラウンド(R3)

## Round 1 — arch PASS(ギャップ4)/ data **FAIL** / sec **FAIL**

| # | レンズ | 指摘(中核) | 反映 |
|---|---|---|---|
| 1 | sec **FAIL** | AGENTS.md は**指示であって強制ではない**(注入・不服従で破れる)。読取専用サンドボックスは「書込・実行」遮断であり**読取範囲・ネットワーク・approval 昇格は保証されない**。「出力の目視」は引用検出であり**読んだ時点の送信を原理的に検出できない**。実害上限・ローテーション手順なし | **方式転換 = クリーンコピー隔離を第一層に**: `scripts/codex/review.sh` 新設(mktemp + `git archive HEAD` 展開 = 追跡ファイルのみ → gitignore 資産は構造的に不在)。サンドボックスは defense-in-depth に降格。§4 に実害上限列挙(DATABASE_URL / 広スコープ GITHUB_TOKEN / NEON_AUTH_COOKIE_SECRET / API キー)+ ローテーション参照 |
| 2 | data **FAIL** | 「リポジトリに秘密は無い」主張が誤り — 作業ツリーには .env 以外にも `e2e/.auth/state.json`(認証 Cookie)・`e2e/screenshots/`(実データ画面)がある | 同上のコピー隔離で3資産とも構造的に不在。初回受け入れ検査 (b) で不在を確認(ゲート化) |
| 3 | arch | フック不適用の前提明示・成果物境界・AGENTS.md 二重管理ドリフトの責務・判定の機械化 | §1 前提に「Codex にフックは一切効かない」を明記。追随責務 = 契約改定 goal の閉包に AGENTS.md 確認を含める。§5 を exec-form ピンに |

## Round 2 — sec PASS / data PASS / arch PASS(条件付き)→ 問いを反映

| # | レンズ | 問い | 反映 |
|---|---|---|---|
| 1 | arch(条件)| 成果物の記述ドリフト(「文書4点のみ」と「文書のみ」が review.sh と矛盾) | 「review.sh + 文書4点」に統一(§0/§3 が正) |
| 2 | arch | 条件0 ピンに `codex` 起動の存在 grep が無い | ピンループに `"codex"` `"trap"` を追加 |
| 3 | arch | Claude セッションからの `codex` 直接起動を guard-bash で遮断すべき(Hooks 第一) | **採用**。codex.md 骨子に明記 + 閉包に guard-bash.sh + §5 条件6(存在ピン) |
| 4 | arch | `git diff main` の基準・archive=HEAD の帰結が未記載 | 「分岐点コミット基準」注記 + 「レビュー対象はコミット済みのみ・手貼り禁止」を codex.md 骨子に |
| 5 | sec | ゲート (c) fail 時の「受容追記」逃げ道がヘッダ(fail=導入中止)と矛盾 | (c) fail もヘッダと同一 = 導入中止して本設計を改訂(3レンズ再通過)に統一 |
| 6 | sec | review.sh 改定で隔離ステップが静かに消える | review.sh 改定時は初回受け入れ検査 (a)(b) を**再実施**(codex.md 骨子) |
| 7 | sec | 未コミット diff・秘密のプロンプト手貼り経路が未定義 | **手貼り禁止**を codex.md 骨子に明文化(隔離の迂回) |
| 8 | sec | コピー隔離は「追跡ファイルに秘密が無い」不変条件に依存 | §4 に依存関係として明示(黄金ルール2・guard-write・匿名 fixture が担保) |
| 9 | data | ゲート (b) が3パス列挙で「クラス」を言っていない・初回限り | 「gitignore 資産全般が不在」クラス言明 + **ラッパーが毎回起動前 assert** |
| 10 | data | 異常終了時にコピーが残る | `trap` で異常終了時も破棄(仕様 + ピン) |
| 11 | data/sec | `git status` 表示の検知範囲の過大主張 | 「検知範囲は本 repo のみ(SSoT clone・DB は映らない)」と部分的検知を明示 |

## Round 3(arch 確認)— **PASS**(4条件すべて解消 ○)

- 留意点1件を設計に反映済み: guard-bash の codex deny は**実行コマンド先頭トークンのみ**に一致させる
  (§5 の判定コマンド自身が `codex` 文字列を含むため — 部分一致だと judge が自爆する。既知の guard 誤検知クラス)。
- 冒頭「性質」の数え方の揺れ(3+1 vs 4点)は正典指定(§やらない「§0/§3 が正」)により実害なしと判定。

## 合格判定

**全レンズ PASS** — /goal CO-1 へ進む。

## /goal CO-1 への申し送り

- 成果物 = **scripts/codex/review.sh + AGENTS.md + .claude/rules/codex.md + docs/setup/codex-setup.md +
  CLAUDE.md 1行 + guard-bash.sh の codex deny**。アプリコード・テスト・workflow 非接触(§5 条件5 の allowlist が正)。
- review.sh: mktemp -d → `git archive HEAD | tar -x` → 起動前 assert(.env / e2e/.auth 不在)→ codex 起動
  (読取専用 + approval 固定 — 実フラグは導入時確定)→ `trap` 破棄(`rm -r --` 形・-f なし・mktemp パス変数のみ)
  → 元 repo `git status --porcelain` 表示。
- guard-bash の deny は**先頭トークン一致のみ**(`grep -q "codex"` などの判定コマンドを誤爆させない)。
  ピン文字列をコメントに書かない(既知の count-pin 汚染)。
- 有効化はユーザー操作(M5 同型): docs/setup/codex-setup.md の初回受け入れ検査 (a)〜(e) は**ゲート**
  — 全 PASS まで運用開始しない。fail = 導入中止して本設計を改訂(3レンズ再通過)。
- Codex は critic / judge の**代替ではない**(黄金ルール4 不変)。v2(編集権限)は別設計。
