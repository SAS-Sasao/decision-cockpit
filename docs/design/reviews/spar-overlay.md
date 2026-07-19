# design-review: spar-overlay(壁打ちスライドオーバー共通化)

対象: docs/design/basic/spar-overlay.md(md-render 前例の軽量1枚形式 — 詳細設計省略)

## Round 1 — 2026-07-19

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **PASS**(Med 2・Low 2) | SparPanel 自己完結・layout disabled 1箇所・ckfade 実在・軽量1枚形式の md-render 前例整合・「M4 条件読み替え不要」の §4-5b スコープ成立をすべて現物照合。Med: SparPanel の import 元パス非ピン(ローカル再実装で通る)/ 条件2 の diff 範囲 <「変更3種のみ」主張。Low: capture-spar 正典側の注記計画外 / 字体 |
| data | **FAIL**(Med 1) | **条件2 の diff 集合が「データ契約・API・DB 変更なし」を機械的に閉じない**(db/migrations・lib/search・lib/ingestion・lib/db.ts・lib/auth・components・scripts・globals.css・.env.example が非被覆)。Low 3(遷移生存と「共有しない」の文言緊張 / 二重保存の言及なし / 件数括弧書き)。非永続の一貫性・/api/spar 契約内利用・348 件の数え上げ(for ループ 9 ケース込み)は現物実証 |
| sec | **PASS**(Med 1・Low 4) | 認証境界不変(requireUser 内側・二層認証経由・実機 307×3)・告知の内蔵継承(spar-panel L158-160 現物)・非永続・.env 退避事故を踏まえた禁止明記を確認。Med: 同・条件2 の被覆不足(lib/auth 等)。Low: 補助ファイル新設の非検知 / .env ハッシュ検証なし / 遷移生存の宣言差 / db 非被覆 |

**総合: FAIL(data)** → rev.2 で決着:
1. **条件2 を2段強化**: 2a = **広域凍結 diff**(M4 条件7 型から layout.tsx のみ除外 — db・lib 全体・components・scripts・fixtures・globals.css・.env.example・全画面・設定ファイルを列挙)/ 2b = **閉包判定**(`git status --porcelain` でコード領域の変更・**untracked 新規ファイル**を spar-overlay.tsx + layout.tsx の2つに限定)。
2. SparPanel の **import パスピン**(`./capture/spar-panel` — ローカル再実装の機械排除)。
3. 条件5 に **capture-spar 正典側の注記**を追加(§0 問い#4・§2.8 の「据え置き」stale 化防止)。
4. 文言整理: 遷移生存の受容を §1 に明記(共有「機構」は作らない)/ 二重保存 = INSERT-only 契約上正当な2レコードと受容明記 / 手動確認を「閉じてから再度開く」に修正 / 件数は参考値。

## Round 2 — 2026-07-19(rev.2 を data 再レビュー)

**data PASS** — 2a の被覆(R1 非被覆パス全列挙・app 配下の除外 = layout.tsx のみを tracked 18 ファイルと突合)・2b のシェル意味論(空出力 PASS・fail-closed・untracked 検知・既知 untracked の偽 FAIL なし)・条件5 の実効性(現状 exit 1 → 注記後に成立)を現物実証。残 Low 3(2b の commit 後空振り / grep -Fv 部分文字列 / docker-compose 等の宣言防御)は rev.3 で吸収(2b の判定タイミング = 節目 commit 直前 + judge は git log --stat で列挙確認・類似名禁止・宣言防御の受容明記)。**全レンズ PASS 確定**(arch R1 / data R2 / sec R1)。

### /goal SPAR-OV への申し送り(Info・非ブロッキング)

1. 条件2b は **commit 前に実行**(commit 後は空振り)— judge は `git log main.. --stat` で全変更ファイルが spar-overlay.tsx + layout.tsx + docs に閉じることを確認。
2. `.bak` / `.orig` 等、許容パスと部分一致する紛らわしいファイル名を作らない(2b の grep -Fv が行単位のため)。
3. overlay の意匠は MoC SPAR SLIDE-OVER ブロック準拠(dim 全面・右 420px・border-left accent-spar 系・ckfade)— 数値の厳密ピンはなし(手動確認)。
4. layout.tsx の変更はボタン置換1点のみ — 生存ピン(requireUser / getLastSync / signOutAction)を割らない。
