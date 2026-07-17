# design-review: org-docs-ingestion(組織ドキュメント取り込み + ナレッジ検索拡張)

対象: docs/design/basic/org-docs-ingestion.md

## Round 1 — 2026-07-18

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | **High: 「retro は REWARD_TYPES のみ参照で不変」が事実誤認** — lib/data/review.ts に第3の7型列挙(ALL_RECORD_TYPES)+ 型無フィルタ SELECT があり、knowledge 行流入で `counts[type]` が NaN → /retro の totalCount に NaN 表示。§5-4 の「review.ts 無差分」ピンはこの退行を強制する判定。Med 5(type チップ「knowledge+daily_log」が searchKnowledge の単一 type IF と矛盾 / コミット日付 fallback の実現手段が SourceAdapter に無い / occurred_at null と M1 契約の未調停 / daily_log の粒度二重化 / チャンク600字と buildEmbedInput の title 先頭消費)。観点5 FAIL: **被変更側注記の欠落(前例逸脱)** |
| data | **FAIL** | **High×2: review.ts の第3列挙 → NaN** / **digest チャンク(daily_log)が retro entries(decision+daily_log 無制限描画)を数百行で氾濫**。Med 4(件数 KPI の粒度変化未宣言 / 組織 decision の org 帰属がパーサ契約の分岐点 / 再帰 glob 配下の CLAUDE.md / 2型フィルタ前提)。チャンク連番 item_key の冪等性・0004 非破壊性・規模見積・SYNC_MAX_FILES 周回は現物照合で成立を確認(内容ハッシュ方式でも再埋め込みコストは減らない — 連番選択は妥当との評価) |
| sec | **FAIL** | **High: CLAUDE.md の「構造的除外」主張が再帰 glob(docs/research/** 等)と自己矛盾** — 実在する docs/research/CLAUDE.md が allowlist にマッチし denylist も素通り(agent-memory は MEMORY.md に不一致)→ 索引 + OpenAI 送信に到達。Med 2(将来ファイル・新 org 自動追随の無検分送信 / §5-3 fixture の配置パス未指定で偽 PASS)。Low 3(digest = 二次生成物の機微引用可能性 / fixture 機微ダミーの形 / 実送信の主体・前提ゲート)。denylist の fetch 前適用・0004 の guard 非干渉経路の実在・personality-profile の二重防御は現物確認で健全 |

**総合: FAIL(全レンズ)** → rev.2 で決着:

1. **digest を daily_log でなく knowledge 型に統一**(構造的決着 — retro entries 氾濫と daily_log 粒度二重化が同時に消滅・type チップも単一 type(判断/ナレッジ/すべて)で成立し「UI の公開のみ」が真になる)。
2. **denylist に `CLAUDE.md`・`MEMORY.md` の basename バックストップを追加**(normalize.ts — エージェント内部ファイルの categorical 除外)+ §5-3 の fixture 配置パスを**危険経路(再帰 glob 配下)に固定** + 将来ファイル・新 org 追随の受容/検分をリスク表と手動チェックリストに明文化。
3. **被変更側の拡大**: lib/data/review.ts(ALL_RECORD_TYPES 8化)+ lib/ingestion/parsers/types.ts(RecordType union)を可変範囲に編入。凍結例外 = overview-data.test.ts + **review-data.test.ts**(いずれも列挙関連 assert のみ — 実行形は詳細設計)。
4. **チャンク本文上限 = 500字**(buildEmbedInput の title+tags 先頭消費 ~100字を見込み 600 に収める。title 過長時の末尾切詰めは許容と主張を修正)。
5. **occurred_at 契約の明示改訂**: knowledge 型は「frontmatter / ファイル名日付 → 無ければ null 許容」(M1 の「ok は occurred_at 必須」への明示的例外 — 時間軸集計は knowledge 非対象または null 除外で無影響と宣言)。コミット日付 fallback は**削除**(SourceAdapter 拡張不要 —「新機構なし」が真に)。
6. **組織 decision の org 帰属**をパーサ契約に明示(meta.org パス由来 — 詳細設計で parseDecision 拡張 or 新パーサ)。
7. **被変更側注記を条件化**(ingestion-foundation / search-foundation / ui-shell への grep ゲート・主セッション担当)。
8. 件数 KPI の単位変化(レコード=チャンク)を宣言(recordsByType 8列挙で内訳可視・digest の当週チャンクのみ今週件数に入る)/ fixture 機微ダミーの形(内容無害・実在人名不使用)/ 実送信ゲート(遮断テスト緑 + OD-A judge PASS を前提・実行 = Claude・ユーザー同席)/ 「件数 assert」→「取り込み 0 レコード assert」表現修正 / チャンクキーの安定性はパーサ版内契約(改版時は全上書きで自己回復)。

## Round 2 — 2026-07-18(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | R1 決着の実体を現物照合(review.ts の NaN 実在・digest=knowledge が合意方針への回帰であること・「判断枠を汚さない」の3箇所の型等値による構造保証・「UI の公開のみ」が真・500字算術・凍結非交差・OD-A/B 被覆と build 窓なし)。問い3(OD-A の 0004 適用順序 / 注記内容の被覆 / denylist 大小文字 — sec へ申し送り) |
| data | **PASS(条件付き)** | digest=knowledge の再計算(entries 非流入・NaN 消滅・週次トレンド不変)と occurred_at null の波及(SQL 自然排除・formatDate null 安全)を現物確認。**新 Med 1: /retro の内訳表示は page 側ハードコード5種で、knowledge が合計に入るのに内訳に現れない乖離** — (a) 受容宣言 or (b) retro/page.tsx 編入の調停が PASS 条件。Low 2(ReviewRow の型の嘘 / date フィルタと無日付 knowledge) |
| sec | **PASS** | denylist 追加の適用位置・fail-closed 性・skipped 計上の整合を現物確認。問い3(isDenied の大小文字と列挙外変種(claude.md 小文字・CLAUDE.local.md・AGENTS.md)の防御範囲 / digest 目視の選定基準 / 実名 CLAUDE.md fixture の自動読込認識) |

**総合: PASS(全レンズ — data の条件を rev.3 で決着)**:
1. **retro/page.tsx を可変範囲に編入**(BREAKDOWN_TYPES に knowledge 追加 — 合計と内訳の乖離防止・「内訳で可視」が両画面で真に)。
2. **denylist を小文字正規化比較 + `claude.md`/`memory.md`/`agents.md`** に確定(大小文字変種を吸収・`CLAUDE.local.md` 等の列挙外変種は防御範囲外と明示し手動検分で受容)。
3. その他吸収: review.ts の occurred_at null 行の扱い(SQL 除外 or 型許容)を詳細設計で明示 / 0004 の本番適用順序(Vercel 展開時「適用 → デプロイ」厳守)を明記 / ingestion-foundation 注記に集計契約 8化を含める / digest 目視の選定基準(直近1 + 無作為2以上)/ 実名 CLAUDE.md fixture の自動読込は認識済みと明記 / date フィルタと無日付 knowledge の検索意味論を既知化。

### detailed-design への申し送り(非ブロッキング)

1. **[data] 凍結例外2テストの「列挙関連 assert のみ」差分ピンの実行形**(overview-data / review-data)。
2. **[data] review.ts の occurred_at null 行**: SQL `occurred_at IS NOT NULL` か ReviewRow 型の null 許容か。
3. **[arch] 0004 の DROP CONSTRAINT を含む実行形**(制約名確定・guard 非干渉パターン)と §5-1 否定 grep の確定。
4. **[sec] チャンクパーサの決定性テスト・危険経路 fixture の具体パス列挙**。
5. **[arch] OD-A/OD-B の §5-6 再実行帰属の確定**。
6. **[data] チャンク連番 item_key の形式**(`c0001` 等)と title の見出しパス結合形式。
