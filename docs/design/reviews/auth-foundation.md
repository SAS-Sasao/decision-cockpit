# design-review: auth-foundation(M0 認証・ユーザー管理土台)

対象: docs/design/basic/auth-foundation.md

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
