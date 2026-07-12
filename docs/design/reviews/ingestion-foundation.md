# design-review: ingestion-foundation(M1 取り込み基盤 + 振り返り)

対象: docs/design/basic/ingestion-foundation.md(根拠資料: docs/research/m1-ssot-schema.md)

---

## Round 1 — 2026-07-12

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | High: `/api/sync` の Bearer 認可が **M0 proxy.ts matcher(api/auth・login・静的のみ除外)に弾かれ到達不能** — 条件5が現構成で不成立(M0 と同型の「判定器が成立しない」欠陥)。M0 成果物(proxy + テスト)への波及が設計スコープ外だった。Med: 条件8の判定アンカー未決 / Vercel Cron は GET 起動なのに IF が POST / §3.2 の参照先「正規化マッピング表」が調査資料に不存在 |
| data | **FAIL** | High: JSONL の item_key=行ハッシュは**同一内容行が黙って合体**し件数・合格率を歪める(受け入れ条件は決定性のみ検証で捕捉不能)/ 正規化マッピング表の宙吊り参照(type 語彙・抽出規則が未確定)。Med: status='ok' フィルタ未明記(error 汚染)/ スコア集計契約欠落(1-5→0-1 の式・プール/分離・null 分母)/ 条件4が更新パスを検証しない |
| sec | **FAIL** | High: **error レコードの body(元テキスト保持)がサニタイズを迂回** — 「個人環境情報を索引に持ち込まない」不変条件と矛盾。Med: /review での error 行の扱い未定義 / errors[]・warnings[] 内の絶対パス混入未評価。Low: conversation-log 見送り理由の本文未記録 / lib/ingestion のサーバ専用明記なし ほか |

**総合: FAIL** → rev.2 で反映。

### rev.2 での主な設計決着

1. **M0 認証境界との統合を新設**(§1-2): proxy matcher に `api/sync(?:/|$)` 除外を追加 + tests/proxy.test.ts 境界ケース + auth-foundation 詳細設計への注記追随。受け入れ条件6・9で機械判定。
2. **Cron = GET + Bearer / 手動 = POST + admin** にメソッド分離(Vercel Cron の GET 起動仕様と整合)。
3. **正規化マッピングの規範表を設計本文 §3.2 に内蔵**(5ソース × type/occurred_at/title/topic/スコア。type は要件 §5.2 の既存語彙に収まる — 要件側変更なし)。
4. **JSONL item_key = sha256(生行) + 出現順序 suffix** — 同一内容行を別イベントとして数える(合体による過少計上を排除)。条件3-e に「同一内容行×2 → 異なるキー」を追加。
5. **サニタイズを ok/error 両パスの不変条件に昇格**(target + errors[]/warnings[]/checklists[] 内の絶対パスも対象)。条件3-f で error パスを機械判定。
6. **集計契約 §3.4 を新設**: status='ok' のみ / judge 正規化は (x-1)/4 / source 横断プール / null は分母除外 / 週・月バケット定義。
7. **条件8の判定アンカー確定**: GitHub アクセスを SourceAdapter 1ファイルに閉じ込め、「アダプタ外のホスト言及ゼロ + アダプタ内 GET のみ」の構造判定に(check-no-secrets と同じ「構造で保証・grep は逸脱検知」型)。
8. **FixtureSource を IF に追加**(冪等性・認可ゲート判定の実ネットワークなし実行口)。条件4に**更新パス検証**(内容変更 → 件数不変かつ反映)を追加。
9. allowlist 6パターンを repo スコープ付きで本文確定(cc-sier docs/decisions との名前衝突は構造的に回避)。
10. conversation-log 見送り理由(マスク保証がサンプリングのみ)を本文に記録し、M2 取り込みの前提条件(マスク検証方針の先行設計)と session-summaries `log_file` の注意を問い #2 に明記。lib/ingestion は `server-only` 規約。CRON_SECRET は定数時間比較を detailed-design 言及事項に。

---

## Round 2 — 2026-07-12(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Round 1 の High(proxy 合成)/Med 3/Low 3 すべて解消を確認(proxy.ts 現物と matcher 除外の同型性まで照合)。新規は Low 3(auth-foundation 注記の機械判定なし / 条件8走査範囲に scripts なし / POST 認可形が redirect 型) |
| data | **FAIL(狭域)** | Round 1 の High/Med/Low 全件解消(規範表は調査資料と全セル照合済み)。ただし新規 Med 1: **§3.4 が契約する「4シグナル達成率」のデータ経路(signals の格納列・抽出規則)が §3.1/§3.2/要件 §5.2 のどこにも存在しない**。Low 2: org 共通規則が case-bank/quality-gate に適用不能 / case id 日時部フォールバックの成立性未検証 |
| sec | **PASS** | High(error body サニタイズ迂回)は不変条件昇格 + 条件3-f で解消。/api/sync の proxy 除外は M0 二層防御・/api/auth 前例と同型で許容。GET=Bearer 単独の CSRF 構造回避を確認。新規 Low 3(POST 未認証時挙動 / 条件8走査範囲 / 条件3-b の列挙) |

**総合: FAIL(data のみ・狭域)** → rev.3 で反映。

### rev.3 での決着(data Med/Low + arch/sec の Low 申し送りを一括反映)

- **signals 経路の一気通貫**: §3.1 に `signals jsonb`(bool×4・task-log のみ)追加 / §3.2 に抽出規則(`## reward > signals` の4キー)/ §3.4 分母 = signals 非 null / 条件3-b に抽出ケース / 要件 §5.2 への追記を §1-7 追随に含め条件9 で grep ゲート。
- **org 規則**: パス `.companies/<org>/` セグメントを正とし、frontmatter org / org_slug は突合検証(不一致 = error)。5ソース適用可能に。
- **case id 日時部**: fixture 確認前の「仮説」であることを明記(確認できなければフォールバック不使用・両方欠損は error)。
- arch/sec Low: POST 認可形 = getUser + 401/403(redirect 不使用)/ GET は Bearer 単独(Cookie フォールバックなし)/ 条件8-a の走査を M0 同様の4ディレクトリに拡大 + ローカルランナーも SourceAdapter 経由必須 / 条件3-b に warnings[]/checklists[] 追加 / 条件5 に「セッションなし POST → 401」/ 条件9 に auth-foundation 注記 grep 追加 / SameSite 確認を detailed-design 言及事項に。

## Round 3 — 2026-07-12(rev.3 を data レンズのみ再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| data | **PASS** | signals 経路の一気通貫(格納→抽出→集計→判定)を確認。抽出キー名は調査資料の実スキーマと完全一致。org 規則は5ソースで適用可能。Round 2 PASS 箇所の退行なし。arch/sec 主管の rev.3 変更もデータ観点で害なし(むしろ整合性向上) |

arch / sec は rev.2 で PASS 済み。rev.3 の変更は両レンズの Low 申し送りをそのまま反映した強化方向のみのため判定は維持(変更内容は上記のとおり本記録に明示)。

**総合: PASS(全レンズ)— /detailed-design ingestion-foundation へ進んでよい。**

### detailed-design への申し送り(非ブロッキング)

1. **[data L3] 負のシグナルの表示反転** — `excessive_edits` / `retry_detected` は true=悪。/review 表示時の反転・ラベル設計を detailed-design で確定(§3.4 の「true 率」定義自体は一義的)。
2. **[data L1/L2] 決着済みの微修正** — §1-7 の列挙に §5.2 signals を明示 / case id 形式を「fixture 確認予定の仮説」に修正(rev.3 最終版で反映済み)。
3. **[arch L3/sec L1] Route Handler 認可形の実装確定** — getUser + 401/403 の具体 IF / GET の Bearer 単独(Cookie フォールバックなし)の契約明文化 / Neon Auth Cookie の SameSite 確認と記録。
4. **[sec L3] テストマトリクス** — warnings[]/checklists[] の各1ケースを含める(条件3-b に反映済み・detailed のテスト観点表で列挙)。
5. **[arch] 条件1 の grep** — UNIQUE 制約の実 DDL 表記(名前付き制約/INDEX/改行)と割れないよう、detailed-design で実 DDL に照合してから確定(M0 の教訓)。
6. **[基本設計 問い #3]** 初回フル同期の Vercel 時間制限試算(分割実行の要否)。
7. **[基本設計 問い #5]** case-bank `outcome.files_written[]` のパス性質確認とサニタイズ要否。

