# design-review: auth-foundation(M0 認証・ユーザー管理土台)

対象: docs/design/basic/auth-foundation.md(基本設計 Round 1–2)/ docs/design/detail/auth-foundation.md(詳細設計 Round 1–2)

---

## Round 1 — 2026-07-11

| レンズ | 判定 | 核心 |
|---|---|---|
| arch(design-arch-reviewer) | **PASS** | 3層配置・SSoT 非接触・結合キー将来整合・粒度すべて適合。改善提案あり(下記) |
| data(design-data-reviewer) | **FAIL** | 受け入れ条件7の grep が現リポジトリで必ずヒット(恒久 FAIL 化)。データモデル本体(観点1〜5)は健全 |
| sec(design-sec-reviewer) | **FAIL** | 同じく条件7が実行不能 + M0 が導入する当の秘密クラス(Neon Auth key)を検知しない。他観点は妥当 |

**総合: FAIL** — ギャップを設計書に反映し再レビュー。

### 集約ギャップ(重複統合)

**High**
1. **受け入れ条件7(秘密実値 grep)が破綻**(data / sec 一致):
   - `postgres(ql)?://[^U]` が `docker-compose.yml:37` と `docs/setup/neon-vercel-setup.md:144` の非機密ローカル dev URL(`postgres://cockpit:cockpit@...`)に誤マッチ。
   - 設計書自身の `npg_` 記載に自己マッチ。
   - M0 が新規導入する Neon Auth secret key / GitHub PAT 形式(`ghp_` 等)を検知対象に含まない(sec)。
   - → 設計判断が必要: 非機密ローカル dev URL の扱い / パターンの置き場所(自己マッチ回避)/ env 名確定(問い#3)とパターン更新の紐づけ。

**Med**
2. 受け入れ条件8に判定コマンドがない(data / arch)。
3. middleware 例外に Neon Auth SDK の認証ハンドラルート(/handler/* 相当)が漏れる。API Route / Server Action の二層防御(データ境界での requireUser() 必須)が契約化されていない(sec)。
4. `.claude/rules/capture.md` が要件 v1.1 に未追随(user_id 所有が契約カラムにない)。更新の担い手・時期が未定(arch)。
5. 条件7の grep パターン確定を detailed-design の受け入れ条件に含める接続規定がない(arch / sec)。

**Low**
6. 条件1の for ループが echo 方式で exit code 単独判定にならない(arch / data)。
7. seed の置き場所(0001 up 内か否か)が未確定で、up→down→up 後の条件3成立と依存(data)。
8. 条件4のテスト INSERT が NOT NULL 違反と CHECK 違反を区別できない書き方(data)。
9. テストランナー未導入・未選定が暗黙(arch)。
10. Neon Auth ユーザー削除時の orphan 行(user_roles / capture_inbox)の扱い未記述(data)。
11. processed_at IS NULL 走査用の partial index への言及なし → detailed-design 検討事項化(data)。
12. down 適用の実行経路・承認フロー(hook との折り合い)が未記載(arch)。※data critic が guard-bash は `psql -f` を遮断しないことを確認済み。
13. 「DB ブランチと一緒に分岐」はローカル Docker db に非適用(ローカルに neon_auth スキーマなし)である旨が一段暗黙(arch)。
14. `--exclude=".env"` が `.env.local` 等を除外しない(sec)。
15. 実環境での手動確認項目(未認証リダイレクト等)が列挙されていない(sec)。

### Round 1 を受けた設計更新(設計者判断)

- 条件7を **`scripts/check-no-secrets.sh`(exit code 判定)** に再定義。秘密「実値」パターンのみ検知(`npg_` / `ghp_` / `github_pat_` / `sk-ant-` 等)、`.env*`・`node_modules`・`.git`・スクリプト自身を除外。**ローカル dev URL(cockpit:cockpit)は設計上「非機密」と定義**。Neon Auth の key 形式は env 名確定時(detailed-design)にパターンへ追加し、その更新を detailed-design の受け入れ条件に含める。
- 条件8に具体コマンドを付与(SSoT repo 名への言及ゼロ / migrations 外の破壊的 SQL ゼロ)。
- §3.2 に SDK ハンドラルートの例外と「二層防御」契約(API Route / Server Action はデータ境界で requireUser() 必須)を追加。
- capture.md の v1.1 追随更新を M0 スコープに追加。
- seed は 0001 up 内(ON CONFLICT DO NOTHING)と明記。条件1を exit code 一本化。条件4の INSERT を NOT NULL 供給済みに修正。
- テストランナー導入をスコープに明示(選定は detailed-design)。
- orphan 行 = 許容リスクとして明記し、検出は RLS 導入時期(問い#4)に合流。partial index は detailed-design 検討事項に追加。
- down 適用経路(ローカル psql / Neon ブランチ / 本番は人間承認)とローカル dev での Neon Auth の位置づけを明記。

---

## Round 2 — 2026-07-11(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | Round 1 ギャップ6件すべて解消。条件7の新契約を実リポジトリで検証し 0 ヒット(恒久 FAIL 再発なし)。条件8 も現状成立を確認 |
| data | **PASS** | FAIL 事由(条件7)の解消を**実測で確認**(追跡ファイル・.claude/・.github/・.next/ すべて 0 ヒット。自己マッチも正規表現形式のため構造的に回避)。他ギャップ5件解消。データモデル本体の退行なし |
| sec | **PASS** | 条件7 は「実行可能かつ本物の秘密を捕捉するゲート」として成立(Neon パスワードは `npg_` 接頭辞で URL パターンなしでも捕捉/サブスク OAuth トークンも `sk-ant-` 圏内)。二層防御・単一ヘルパ経路・手動確認項目すべて解消。退行なし |

**総合: PASS(全レンズ)— 実装(detailed-design → /goal)へ進んでよい。**

### detailed-design への申し送り(Round 2 で挙がった非ブロッキング項目)

1. **[sec Med] `.env.*` 除外が `.env.example` を巻き込む** — `.env.example` はコミットされる唯一の env ファイルで誤ペーストが最も起きやすい。check-no-secrets.sh のスクリプト契約確定時に、走査対象へ戻す(除外は gitignore 済み実値ファイルに限定)方向で確定する。再包含しても現状誤検知なしは確認済み。
2. **[sec Low] 秘密クラス追加時のパターン追随を一般則化** — `NEON_API_KEY`(`napi_`)・`EMBEDDING_API_KEY`(形式未定)が現パターン外。「.env.example に秘密クラスを追加したら実値形式をパターンへ追随」の一般規定の置き場所を決める。
3. **[data Low] 条件8の exit 2 マスク** — 列挙ディレクトリ不存在時に grep が exit 2 → `!` 反転で誤 PASS し得る。存在するディレクトリのみを渡す判定に格上げする。
4. **[data Low] 条件7の走査除外に build 生成物(`.next/` 等)がない** — gitignore 準拠(git grep / rg)にするか明示除外するかをスクリプト契約で確定。
5. **[data Note] 自己マッチ回避の運用規約** — ドキュメントに秘密の実値形式ダミー(例: npg_ + 英数字)を書かない。書けば検知される(望ましい挙動)。
6. **[arch Low] capture.md 追随更新(スコープ項目6)の機械判定がない** — `.claude/rules/capture.md` の `user_id` 出現 grep を /goal の受け入れ条件に追加するか、/goal 対象外として別管理かを detailed-design で確定。
7. **[sec Low] 手動設定パスワード(非 `npg_`)の Neon URL は非捕捉** — 運用上発生させない前提(パスワードは Neon 発行のみ使用)。記録として残す。

---

# 詳細設計(docs/design/detail/auth-foundation.md)

## Round 1 — 2026-07-11

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **FAIL** | 受け入れ条件8が `set -e` + `! grep` の bash 仕様(errexit は `!` 反転コマンドの失敗を無視)により**違反があっても偽 PASS** し得る構造。他 Med 1(matcher の /login 除外なし・SDK 内部仕様依存)・Low 5 |
| data | **FAIL** | 同じく条件8の偽 PASS を独立に特定(申し送り#3 の exit 2 マスクは解消したが別経路のマスクを導入)。DDL 本体は実照合で全パターン一致を確認し健全。他 Low 4 |
| sec | **PASS** | git ls-files 方式の実効性を実測確認(.env.example 走査対象・.env/.next 除外・自己マッチなし)。Med 1(一般則1が既存クラスの形式後日確定を捕捉しない)・Low 4 |

**総合: FAIL** → rev.2 で反映。主な設計更新: 条件8を**集計型**(grep の exit code を明示採取、1=正常 / 0 と ≥2 を fail)に再定義 / matcher を境界付き(`api/auth(?:/|$)`・`login(?:/|$)`)にし /login を明示除外 / 一般則1を「既存クラスの実値形式の確定」まで拡張 / 規約2の適用範囲を接頭辞型に限定・形式なしクラスのダミー許容を明文化 / サインアウト配置を app/logout/actions.ts に確定・条件5に追加 / 条件3を test 包みで exit code 化 / 条件1に語境界 \b / [-f] フィルタ / テスト一時ディレクトリはリポジトリ外を明示 / 両 /goal に対象設計行を追加。

## Round 2 — 2026-07-11(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | High(条件8)は全分岐トレースで偽 PASS 排除を確認。Med/Low 5 件すべて解消。基本設計の8条件は詳細側で同等以上に強化(弱体化なし)。goals.md テンプレ適合 |
| data | **PASS** | 条件8を現リポジトリで実測(クリーン → exit 0)+ 全分岐検証(違反=exit 1 / grep エラー=fail)。DDL 退行なし。条件1の \b 有効性確認 |
| sec | **PASS** | 一般則1の拡張・matcher 境界・[-f] フィルタ・一時ディレクトリ明示すべて解消。集計型のゲート性質(違反ヒットで必ず非ゼロ exit)回復を確認。機微データ・SSoT 非接触の退行なし |

**総合: PASS(全レンズ)— /goal M0-A から実装へ進んでよい。**

### Round 2 で決着した文言矛盾(data Low)
基本設計 §1-6 の「M5 の processed_at IS NULL 消費契約が user_id スコープ前提」という括弧書きと、詳細設計の「全ユーザー一括消費(created_at 順)」決着の間の矛盾 → **詳細設計 §0 問い#6 で明確化**: 「user_id スコープ」= 行の所有(帰属)であり消費単位ではない。capture.md 更新文言も同項で確定(基本設計の当該表現を詳細設計が明確化・上書き)。

### 実装への非ブロッキング申し送り(Info)
1. §4-8 スニペットは `set -e` 継承環境では偽 FAIL 方向に壊れる(安全側)。各条件は個別 exit code で判定する前提を維持すること。
2. 条件8の「SSoT repo 名ゼロ」ゲートは M0 スコープ限定。M1 の ingestion 実装では repo 名が lib/ に正当に出現するため、M1 設計でゲートを再定義すること。
3. matcher の `_next/static` 等は境界なし前方一致(Next.js 標準 idiom・二層防御で被覆)。
4. M0-A の「主セッション(スクリプト・ルール更新)」実施は黄金ルール4 に対する意図的な例外(軽微な成果物のため)。判定役の分離(acceptance-judge 独立検証)は維持する。

### 詳細設計への PASS 後修正(2026-07-11・M0-B 実装時)
`@neondatabase/auth`(0.4.2-beta)の peer 依存が **Next >= 16** であることがインストール時に判明(設計時のドキュメント調査では不可視)。ユーザー承認の上で以下を修正:
- Next.js を 14.2 → **16.x** にアップグレード(React 18.3 は peer 範囲内で据え置き)。
- Next 16 の改名に伴い **middleware.ts → proxy.ts**(§2.1 / §3 / §4-5 / §5 成果物)。
- クライアント UI の import を実装時確認で確定: `AuthView` / `NeonAuthUIProvider` = `@neondatabase/auth/react`、CSS = `@neondatabase/auth/ui/css`(§0 に追記)。
機械判定の等価性: 条件5のファイルリストの名称変更のみで判定構造は不変。設計レビューの PASS 判定を覆す性質の変更ではない(認証契約・二層防御・スキャン契約は不変)。
