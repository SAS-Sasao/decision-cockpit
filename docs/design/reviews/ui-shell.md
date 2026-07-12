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

