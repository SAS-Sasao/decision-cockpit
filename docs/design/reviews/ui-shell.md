# design-review: ui-shell(画面シェル + 概観 + ルート再編)

対象: docs/design/basic/ui-shell.md(入力: docs/design/ui/screen-design.md)

---

## Round 1 — 2026-07-12

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **PASS(条件付き)** | proxy matcher 不変・M1-C 受け入れ条件を壊さない・条件7の再実行が誤 FAIL しないことを現物照合で確認。Med 2: **redirects は proxy(middleware)より先に評価される — 設計の記述が逆** / 条件7の `git diff` が exit code を返さない(偽 PASS)。Low: 条件1に旧 app/page.tsx 非存在がない / 週境界の共有未明示 / プレースホルダの第2層 / 条件5「現れない」判定 |
| data | **FAIL** | High 2: **週バケット定義(月曜起点・UTC)の継承が未定義**+「直近週」(部分週か完了週か)未定義で条件4(a) の期待値が設計から導出不能 / **「前週差分×4」と OverviewData 型(delta 2つ)が設計書内で矛盾**(inbox の前週値は定義不能)。Med: KPI 分母の §3.4 参照なし / recordsByType 型域未定義。capture_inbox・sync_state・DB 変更なしは現物照合で整合 |
| sec | **PASS(条件付き)** | 認可・個人データ・ログアウト(Server Action=POST)・redirects 固定値・新規秘密なしは整合。Med 2: **/admin/users への非 admin 直アクセスの挙動が未決定**(表示制御≠アクセス制御)/ **新設ページ側の requireUser が契約化されていない**(layout は soft navigation で再実行されない) |

**総合: FAIL(data)** → rev.2 で反映。

### rev.2 での決着

1. **集計規範の明示**(data High-1): §3.4(月曜起点・UTC)を完全継承し、週境界ロジックは review.ts から共有(二重定義しない)。**「今週」= 進行中の部分週**と定義し、UI に「今週(進行中)」を明記(部分週と完了週の差分の歪みを注記で許容)。分母定義(reward: type∈task,score / QG: type=quality)を明示。error 行の純関数側防御 + テストケース化。
2. **前週差分は reward/QG の2カードのみ**(data High-2): 型を正とし §1-4 の文言を限定。inbox はスナップショットで差分なし。recordsByType = 件数>0 の type のみ。6週は MoC スパークライン由来と明記。
3. **redirects の実行順を修正**(arch Med-1): redirects → proxy の順が事実。未認証の旧 URL は 308 → 307 の2段(保護は等価)。条件2に旧 URL の 308 期待値を追加。
4. **条件7を `git diff --exit-code` に修正**(arch Med-2 — M0 申し送り#3 と同クラスの偽 PASS 排除)。
5. **条件1に旧3ファイルの非存在を追加** / **条件5の「現れない」判定を削除**(構造判定で代替 — 判定器の脆さ排除)。
6. **/admin/users は非 admin に notFound()(404)**(sec Med-1): プレースホルダ段階から。条件6で isAdmin + notFound を grep。
7. **全ページに requireUser を配置**(sec Med-2 / arch Low): layout は補助(ナビ用)と位置づけ、条件6で全6ページの requireUser を grep 強制。
8. proxy.test.ts は**無変更**に統一(条件4(d) の字義衝突解消)。

## Round 2 — 2026-07-12(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Round 1 の Med 2 / Low 4 すべて解消を確認(redirects 実行順・--exit-code・旧ファイル非存在・週境界共有・全ページ requireUser・条件5縮小)。条件6/1 の bash を机上検証し成立(括弧クォート・`--`・errexit)。新規 Low 1: §3.3 影響表に lib/data/review.ts(週境界 export + 週数パラメータ化)が無い |
| data | **PASS** | High 2 / Med 2 / Low 3 すべて解消(§3.4 三点一致・now 固定テストが主経路で書ける水準と判定)。「部分週で低く出る」は件数系のみ真という文言の不正確さを指摘。新規 Low: 差分の null 伝播未定義 / lastSync の「行不在=未同期」機構 / review.ts 影響表 / **ファイル所在の不一致(detail/ に置かれていた)** |
| sec | **PASS** | Med 2 解消(admin=404 の決定は 403 より妥当と所見・全ページ requireUser の契約化は auth-foundation §2.1 と整合)。redirects 修正・旧 URL 308 の条件2組み込みも確認。Info 2(proxy.test への新 URL 追加の帰属 / バッジ取得元の条項化) |

**総合: PASS(全レンズ)** — R2 の Low/Info は rev.3 で以下のとおり反映済み:

1. 差分の null 伝播 = **片側 null なら delta=null('na')**・na 抑制閾値は設けない(明記)/「低く出る」文言を正確化(平均・率は不偏・分母小でぶれやすい)。
2. lastSync = **固定 repo リスト起点**で構築(行不在 = 未同期表示)。
3. §3.3 影響表に **lib/data/review.ts**(週境界 export + 週数パラメータ化・ロジック不変・既存テスト無変更が退行網)を追加。
4. バッジ件数の取得元 = overview.ts 経由(userId 第1引数)を layout 契約に明記(共用/専用は detailed-design)。
5. **ファイル所在**: レビュー中に basic/ → detail/ へ移動されていたため basic/ に復帰(design.md ルールどおり。基本設計は docs/design/basic/)。

### detailed-design への申し送り(非ブロッキング)

1. **[sec Info-1] tests/proxy.test.ts への新 URL(保護集合)追加の帰属** — 本ゴールでは無変更。次に matcher を変更する設計(M2 以降)の責務として申し送る。
2. **[arch] 週境界共有の形**(review.ts に export 追加 — 週数パラメータ化の関数シグネチャ)と条件4(a) の期待値表を detailed-design で確定。
3. **[data] 分母極小時の差分の乱高下**は「今週(進行中)」注記で許容(na 抑制閾値なしを明示決定済み)。
4. バッジ件数関数(専用軽量 or getOverviewData 共用)の確定。

---

# 詳細設計(docs/design/detail/ui-shell.md)

## Round 1 — 2026-07-12

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **PASS(条件付き)** | /goal 割付の全数確認で M1 型の矛盾なし・weeks=6 窓の十分性を机上検証・条件4 の diff 列挙が既存14テストを全カバーすることを確認。Med 2: 申し送り#2 後半(期待値表)未決着 / **tests/helpers・vitest.config.ts が diff ゲート外**。Low 5(条件1部分の非明示・条件5 の /admin/users 脱落・getLastSync シグネチャ・eslint 判定器・weekBucketBoundaries 直接テスト) |
| data | **FAIL** | Med 3: **aggregateOverview の戻り型が「inbox 除く」と自己矛盾**(Pick に unprocessedInbox 含む)/ **条件3 の grep -c は行数計上で §2.4 の CSS 例と自己矛盾**(6行 < 9)/ **recordsByType の順序が 7 type 中5つのみ**(session/conversation の扱い未定義)。6週窓・参照列・export 互換・REPOS 突合は実地照合で PASS |
| sec | **PASS(条件付き)** | バッジ関数条項化・ログアウト POST・実機手順の秘密非依存を照合済み。Med 1: **lib/auth・app/logout が diff ゲート外**(認可の土台の改変を機械検知できない)。Low 3(依存固定の機械判定なし / tests/helpers 漏れ / 順序の grep 限界)。Info 2(retro 行の requireUser 非明記 / 条件2 の「fixture DB」表現と実態) |

**総合: FAIL(data)** → rev.2 で反映:

1. `OverviewAggregates = { kpis: Omit<..., 'unprocessedInbox'>, weeklyTrend }` に型修正(自己矛盾解消)。
2. 条件3を**出現数ベース**(`grep -o | wc -l`)に変更(整形非依存)。
3. recordsByType を **7 type 全列挙順**で確定(recordsThisWeek は全 type 合計)。
4. **diff ゲート拡張**: 条件4に tests/helpers・vitest.config.ts / 条件7に lib/auth・app/logout・app/api・package.json・package-lock.json(依存固定の機械判定)。
5. 期待値の正 = テストコード(テスト内コメントで手計算根拠)と明示的決定(§0-2)。
6. buildLastSync を純関数に切り出しテスト対象化 / getLastSync シグネチャ確定 / weekBucketBoundaries の weeks=6/8 直接 assert / 週境界の両側テスト / 条件5に /admin/users / 条件1に eslint キー非存在 grep / UI-A の条件1部分を1行転記 / retro 行に requireUser 維持明記 / 条件2 の DB 表現を実態(ローカル dev db・ステータスコードのみ判定)に修正。

## Round 2 — 2026-07-12(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Med 2 / Low 5 全解消(diff 列挙が既存14テスト + helpers + vitest.config を全カバー・app/api ゲートが両 /goal で成立・eslint 判定器の実在まで現物照合)。新規 Low 1(条件1の正典二重定義)+ Info 2 |
| data | **PASS** | Med 3 全解消を実照合(OverviewAggregates の Omit / oklch 出現数 = 10 ≥ 9 / 7 type 列挙が ALL_RECORD_TYPES・CHECK 制約と完全一致)。Low 4 解消・退行なし。Info 2(基本設計の5 type 列挙残存 / buildLastSync 行在ケース) |
| sec | **PASS** | Med 1(lib/auth・app/logout・app/api の凍結)/ Low(依存固定・helpers)解消。diff ゲート拡張と成果物の衝突なし(凍結モジュールへの依存は import のみで成立)を突合確認。新規 Low 1(app/login・app/auth の凍結非対称)+ Info 2(fixture DB 残滓 / auth CSS import) |

**総合: PASS(全レンズ)** — R2 の Low/Info は rev.3 で反映済み:
条件1の正典一意化(eslint grep = UI-A 固有)/ 条件7に app/login・app/auth 追加 / §5 の fixture DB 残滓修正 / app/layout.tsx の auth CSS import 維持を明記 / recordsByType の詳細化注記 / buildLastSync の行在ケース追加 / 条件5 のベア `/` 対象外の明記。

### /goal への申し送り(Info・非ブロッキング)

1. diff ゲートは「節目 commit 済み」前提(未追跡の新規ファイルは git diff main に現れない — M0/M1 と同クラスの許容)。
2. admin ページの isAdmin→notFound の**順序**は grep 判定外(条項明記 + acceptance-judge の independent 検証で担保)。
3. 期待値の正 = テストコード(テスト内コメントに手計算根拠 — §0-2 の明示的決定)。

