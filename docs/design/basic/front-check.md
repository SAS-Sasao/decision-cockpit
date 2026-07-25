# 基本設計: front-check(Playwright によるフロント整合性チェック)

- 起点: 2026-07-25 ユーザー報告「グラフの目盛りや表示が重なっている箇所がある。フロントチェックに Playwright を
  入れるなどしてフロントの整合性を確認する仕組みを作りたい」。
- 位置づけ: testing.md「曖昧な目視 OK は不可」の精神を**フロントの見た目**にも拡張する。重なり・はみ出し・
  console エラーを**機械判定**にし、スクリーンショットを証跡として残す。

## 1. 目的 / スコープ

### やる

1. **Playwright(chromium のみ)** を devDependencies に追加。`playwright.config.ts` + **`e2e/` ディレクトリ(リポジトリ直下)**。
   - vitest とは二重に隔離: vitest の include は `tests/**/*.test.ts` のまま不変更・Playwright は `e2e/*.spec.ts`。
   - **Playwright の組み込みキャプチャは全て無効化**(config で `trace: "off"` / `video: "off"` /
     `screenshot: "off"`・reporter は `list` のみで HTML レポートを生成しない)。**理由**: trace / video / HAR には
     Cookie ヘッダやログイン POST のボディ(パスワード)が記録され得るため(sec レビュー R1 指摘)。
     加えて既定成果物パス(`test-results/` / `playwright-report/`)も **.gitignore に追加**して二重に防ぐ。
2. npm scripts: **`e2e`**(チェック実行)/ **`e2e:auth`**(認証状態の生成ヘルパ)。**`npm test` には組み込まない**。
3. 認証: `npm run e2e:auth` が headed ブラウザで `/login` を開き、**ユーザーが手動ログイン** → `/` 到達を検知して
   `e2e/.auth/state.json`(**gitignore**)に storageState を保存。以後の `npm run e2e` はこれを再利用。
   - **state.json はセッショントークンの平文保存である**ことを前提として明示する。境界 =
     **セッション state の保存先は `e2e/.auth/state.json` ただ1つ**・内容の表示/ログ出力/コピーは禁止・
     失効時は再生成(`/` が /login へ 307 されたら「state 失効 — e2e:auth を再実行」と明示 fail)。
     作業終了後の削除は任意(gitignore + ローカル限定で残置を許容)。
   - **資格情報(パスワード)はリポジトリ・スクリプト・env・ログのいずれにも書かない/残さない。**
     ログイン POST の記録は §1-1 のキャプチャ全無効化により構造的に発生しない(e2e:auth も同一 config で走る)。
4. チェック対象 = 5 画面: `/login`(未認証)+ `/`(今日)・`/knowledge`・`/retro`・`/capture`(認証済み)。
   各画面で以下を assert:
   - ページ到達(HTTP 2xx・`waitUntil: "load"` + 主要要素の可視待ち。dev サーバの HMR websocket があるため
     `networkidle` は使わない)
   - **console の error レベル = 0**(warning は数えない)。allowlist は **helpers.ts の `CONSOLE_ALLOWLIST` に
     メッセージ全文アンカーの正規表現で固定**し、初期エントリは次の2つのみ(いずれも next-actions 記録済みの
     Neon Auth SDK 0.4.2-beta 既知事象): (1) NeonAuthUIProvider のテーマ FOUC 防止 script-tag に関するもの
     (2) それに起因する hydration mismatch。**`/hydration/i` のような無限定パターンは禁止**(アプリ本体の
     hydration バグを握り潰すため)。**抑制した件数と一致パターンは JSON サマリの `suppressed` に必ず出力**
     (握り潰しの可視化)。
   - **横はみ出しなし**: `document.documentElement.scrollWidth <= clientWidth + 1`
   - **SVG テキスト重なり = 0**: 同一 `<svg>` 内の `<text>` 要素ペアの矩形交差判定(`getBoundingClientRect`・
     許容 0.5px)。**今回報告の目盛り重なりを直接検出するチェック**
   - スクリーンショットを `e2e/screenshots/`(**gitignore**)へ保存。**前提の明示**: 実 DB に対して走るため
     capture の個人メモ・判断ログ等の**実データが写り込む**。用途は**ローカルでの人間確認のみ** —
     docs/・コミット・PR・チャットへのコピーは禁止(§6 禁止事項)。
5. 出力 = 画面ごとの JSON サマリ(`overlapPairs` / `overflow` / `consoleErrors` / `suppressed`)+ exit code(機械判定)。
   **fail→fix→pass の証跡はこの JSON サマリの数値を正とする**(スクリーンショットは証跡の正にしない)。
   修正前後のサマリ(画面ごとの overlapPairs 件数と対象 svg の aria-label のみ・実データ本文は含めない)を
   **`e2e/evidence-fc1.md` にコミット**し、acceptance-judge がそれを確認する。
6. **検出されたグラフ重なりの修正**(同 goal 内・fail→fix→pass の実証):
   - 原因候補(コード読解で特定済み): `components/charts/line-chart.tsx` は X ラベルを**全データ点に描画**
     (line-chart.tsx:138-150)するため点数が多いと隣接ラベルが交差する。また `PAD_BOTTOM = 8` に対し
     X ラベルは `y = height - 2`(fontSize 9)で描かれ、**プロット下端(height-8)とラベル帯が干渉**する。
   - 修正方針: (a) **X ラベルの間引き**(推定ラベル幅 = 文字数 × fontSize × 0.62 から重ならない間隔 k を決定的に
     算出し k 個おきに描画。SSR なので実測不可 → 推定式で決定的に)(b) **PAD_BOTTOM をラベル帯ぶん拡大**
     (8 → 20)して X ラベルをプロット外に出す。他チャート(bar-line-chart / gauge)にも同種があれば同方針。
   - **実証手順**: ハーネス導入直後の実行で重なり検出 >0 をログに記録(fail)→ チャート修正 → 再実行で 0(pass)。
     修正前後のスクリーンショットを証跡として保存。

### やらない

- **ピクセル差分(ビジュアル回帰)** — 環境依存でフレーキー。将来の拡張候補(スクリーンショット保存までが今回)。
- **CI 組み込み** — 認証が対話的(手動ログイン)・実ブラウザ・実サーバ前提のため**ローカル専用の運用ツール**とする。
- **base URL の env 上書き(E2E_BASE_URL 等)は作らない** — `http://localhost:3000` **固定**(sec レビュー R1:
  本番を指せると本番セッション cookie の平文保存・本番実データのスクリーンショット保存が起きるため、機構ごと不採用)。
- vitest スイートへの変更(vitest.config.ts 不変更)。**「凍結」の定義 = 既存テストケースの本文・名前・期待値の
  不変**であり、**既存ファイルへのケース追加は凍結違反ではない**(tests/chart.test.ts への xLabelStep ユニット
  追記は可 — data レビュー R1 の指摘を受け定義を明文化)。チャート以外の UI 修正。
- ハーネスからの操作系イベント(クリック・フォーム送信・入力)は行わない。
  ※「POST が発生しない」とまでは主張しない — ページ内のアプリ JS(Neon Auth のセッション処理等)が発する
  通信はハーネスの制御外(sec レビュー R1 の指摘を受け主張を制御可能な範囲に修正)。

## 2. アーキテクチャ上の位置づけ

- 3層の **App 層の検証ツール**。データ層・Ingestion には触れない。
- **実ネットワークの扱い(testing.md との整合)**: 「テスト中の実ネットワーク禁止」は `npm test`(vitest・機械判定
  スイート)への規約。E2E は (1) `npm test` から完全分離 (2) CI で走らない (3) 対象はローカル
  アプリ(localhost 固定)— ただしアプリ経由で Neon Auth(セッション検証)と DB への実アクセスが発生する。
  これは**開発者がブラウザで目視確認する行為の自動化**であり、fixture 化の対象ではない。
  **arch レビュー R1 の異議により、この適用範囲を `.claude/rules/testing.md` に追記する**(「本規約の対象は
  `npm test` の機械判定スイート。Playwright E2E(`npm run e2e`)はローカル専用の運用ツールで CI・`npm test` には
  組み込まない — 正典 = front-check 設計」の趣旨1行)。testing.md を閉包 allowlist に追加する。

## 3. データ / インターフェース概要

```
e2e/
  pages.spec.ts     — 5画面のチェック本体(1画面1 test・共通ヘルパで判定)
  helpers.ts        — collectSvgTextOverlaps(page) / hasHorizontalOverflow(page) /
                      CONSOLE_ALLOWLIST(全文アンカーの正規表現・初期2エントリ固定 — §1-4)
  auth.setup.ts     — e2e:auth 用(headed で /login → 手動ログイン → state.json 保存)
  evidence-fc1.md   — fail→fix→pass の証跡(コミット対象・数値と svg aria-label のみ)
  .auth/            — gitignore(state.json)
  screenshots/      — gitignore(<page>.png)
playwright.config.ts — testDir './e2e' / baseURL 'http://localhost:3000' 固定(env 上書き機構なし)/
                      chromium のみ / trace・video・screenshot すべて "off" / reporter 'list' のみ /
                      outputDir は e2e/test-results(gitignore)/ storageState は spec 内で明示ロード
                      (/login は未認証コンテキスト)
package.json        — scripts: "e2e": "playwright test", "e2e:auth": "playwright test auth.setup --headed"
                      (auth.setup は config の testIgnore で通常実行から除外)
.gitignore          — e2e/.auth/ e2e/screenshots/ e2e/test-results/ playwright-report/ test-results/ を追加
```

- `collectSvgTextOverlaps`: 各 svg 内の text 要素の `getBoundingClientRect` を総当たり交差判定(許容 0.5px)し、
  `{svgLabel, a, b}[]` を返す。**0件で PASS**。
- チャート修正 IF(配置確定・条件節なし): **`lib/ui/chart.ts` に純関数を新設**:
  `xLabelStep(n: number, plotWidth: number, maxLabelChars: number, fontSize: number): number`
  (戻り値 k ≥ 1・k=1 なら全表示。決定的・DOM 非依存。**tests/chart.test.ts にユニット追加**)。
  line-chart.tsx は `i % k === 0` のラベルのみ描画 + `PAD_BOTTOM` 拡大(8 → 20)。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| WSL2 に chromium の system 依存ライブラリが無い | `npx playwright install chromium` は sudo 不要(~/.cache へ DL)。起動失敗時のみ `sudo npx playwright install-deps chromium` を**ユーザーに1回依頼**(goal 内で明示報告) |
| `e2e:auth` は headed ブラウザ必須(WSLg 前提) | Windows 11 の WSLg で動く想定。開けない場合は代替(ローカル Windows 側ブラウザでの手動 cookie 移植)を検討せず**ブロッカーとして報告**(勝手に回避策を広げない) |
| storageState の失効(Neon Auth セッション切れ) | e2e 実行時に `/` が /login へ 307 されたら「state 失効 — `npm run e2e:auth` を再実行」と**明示メッセージで fail**(原因不明の赤を出さない) |
| SSR ではラベル実幅を測れない(フォント未ロード時の推定誤差) | 間引きは**保守的な推定式**(0.62em/文字 + マージン)で決定的に。E2E の重なり判定が実測側の安全網になる |
| 重なりが SVG text 以外(HTML ラベル)由来だった場合 | 検出関数を該当要素に拡張して fail を再現してから直す(**検出できないまま直さない** — fail→fix→pass の順序を守る) |
| dev サーバの初回コンパイル遅延でタイムアウト | 各 test の前に対象ページへ1度アクセスして捨てる or timeout 30s。実装ノートに記載 |

## 5. 受け入れ条件(機械判定)

```bash
# 1. 導入(キャプチャ全無効化と成果物パスの遮断を含む)
npx playwright --version                                      # exit 0
grep -q '"e2e"' package.json && grep -q '"e2e:auth"' package.json
grep -qE "testDir:\s*['\"]\./e2e['\"]" playwright.config.ts
grep -q "localhost:3000" playwright.config.ts
! grep -q "E2E_BASE_URL" playwright.config.ts                 # env 上書き機構が無いこと
grep -qE "trace:\s*['\"]off['\"]" playwright.config.ts
grep -qE "video:\s*['\"]off['\"]" playwright.config.ts
for p in 'e2e/.auth' 'e2e/screenshots' 'e2e/test-results' 'playwright-report' 'test-results'; do
  grep -qF "$p" .gitignore || echo "MISSING: $p"; done         # 出力なし = 5パス全部 gitignore 済み

# 2. vitest 非汚染(凍結スイート不変)
env -u GITHUB_TOKEN -u DATABASE_URL -u OPENAI_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL -u SPAR_API_KEY npm test
#   → exit 0。ベースライン = 455件(2026-07-25 main 実測)+ xLabelStep 追加分。
#   凍結の定義(§1)どおり既存ケースの本文・名前・期待値は不変(git diff main -- tests/ に削除行なし)

# 3. 型・ビルド
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit                # exit 0
docker compose run --rm -T -e DATABASE_URL=postgres://dummy:dummy@db:5432/dummy app npm run build   # exit 0

# 4. ハーネス実働(前提: app 起動 + state.json 存在。state.json はユーザーの e2e:auth 1回操作で生成 —
#    未生成の時点で judge を呼ばない。judge 実行時に不在なら前提未達として FAIL 報告)
npm run e2e                                                    # exit 0(5画面 PASS)
grep -q "overlapPairs" e2e/evidence-fc1.md                     # 証跡ファイルの存在と形式
grep -qE "修正前|before" e2e/evidence-fc1.md                   # 修正前の overlap > 0 の記録
#   fail→fix→pass: 修正前サマリに svg text overlap > 0、修正後サマリに 0 が記録されていること
#   (検出ゼロのまま修正だけ進めるのは不可。重なりが SVG text 以外由来なら検出関数を拡張して fail を再現してから直す)

# 5. 間引きユニット(ケース名 grep)
grep -q "xLabelStep" tests/chart.test.ts

# 6. 変更の閉包: git diff main --name-only の全行が次に含まれる
#    package.json / package-lock.json / playwright.config.ts / e2e/(新規: pages.spec.ts, helpers.ts,
#    auth.setup.ts, evidence-fc1.md)/ .gitignore /
#    components/charts/line-chart.tsx / components/charts/bar-line-chart.tsx / components/charts/gauge.tsx /
#    lib/ui/chart.ts / tests/chart.test.ts / .claude/rules/testing.md /
#    app/(shell)/retro/page.tsx / app/(shell)/knowledge/page.tsx(§8 の発見による追加)/
#    docs/design/basic/front-check.md / docs/design/reviews/front-check.md / docs/setup/next-actions.md
#    ※ gauge.tsx は「E2E が重なりを検出した場合のみ」触る(検出されなければ無変更 — data レビュー R1 の
#      デッドロック指摘を受け閉包に追加)→ 実際に検出されたため修正対象(§8)
```

## 6. 実装の分割と禁止事項

- **/goal FC-1**(1本・**主セッション実施**・判定 = acceptance-judge・ターン上限 12):
  - **主セッション実施の理由(黄金ルール4/5 からの逸脱の明示 — arch レビュー R1)**: 手順3 の対話認証で
    ユーザー操作を挟む往復が必須なため executor 分離だと往復コストが大きい。作業役と判定役の分離という
    ルールの本質は「判定 = acceptance-judge」で維持する(M5-B / TCS-1 と同形式)。
  1. ハーネス導入(§5-1,2,3)→ 節目 commit
  2. `/login` の未認証チェックが green であることを確認(認証不要ぶんの動作実証)
  3. **ユーザーに `npm run e2e:auth` の1回実行を依頼**(対話ログイン — ここだけユーザー操作)
  4. 全画面実行 → 重なり検出の記録(evidence-fc1.md・fail)→ チャート修正 → green(§5-4,5)→ 節目 commit
  5. judge は手順4 完了後に呼ぶ(state.json 不在の時点では呼ばない)
- 禁止:
  - `.env` 非接触 / vitest.config.ts の変更 / 既存テストケースの本文・名前・期待値の変更(追記は可 — §1 の凍結定義)
  - **資格情報(パスワード)の保存・表示・ログ出力**。セッション state の保存先は `e2e/.auth/state.json` の
    1箇所のみ(内容の表示・コピー禁止)
  - **スクリーンショット(e2e/screenshots/)の gitignore 外へのコピー禁止**(docs/・コミット・PR・チャット)
  - 認証系コード(`proxy.ts` / `lib/auth/` 配下)の変更
  - Playwright の trace / video / HTML レポートの有効化
  - §5-6 allowlist 外のファイル変更。

## 7. 未解決の問い

- ピクセル回帰(スクリーンショット差分)と CI 組み込みは将来トピック(認証の非対話化が前提になるため
  M6 以降で別設計)。

## 8. FC-1 実装中の発見(設計改訂・2026-07-25)

ハーネス初回実行(fail 記録)で、設計時の想定(チャート内の重なり)に加えて **横はみ出し2件が
「ページレイアウト由来」** であることが判明した(診断で原因要素を特定済み):

1. **重なり(想定どおり + gauge)**: 折れ線の最下段 y 目盛りと X ラベルの干渉(/ ・/knowledge・/retro の
   3画面)= §1-6 の PAD_BOTTOM 修正で対処。**gauge の中央値とキャプションの干渉も実際に検出**
   (「—」fontSize 26 の bbox 下端とキャプション上端が ~2px 交差)→ y オフセット分離(値 center-6・
   キャプション center+24)で対処。
2. **はみ出し(想定外・レイアウト由来)**:
   - 原因A: `1fr` グリッドは**子の最小コンテンツ幅がトラックを押し広げる**(CSS 仕様)。
     retro:178 `"1.5fr 1fr"`・knowledge:208 `"1fr 1fr"` が該当(同リポジトリの retro:205 は既に
     `minmax(0, 1fr)` で対策済みの前例あり)→ **`minmax(0, Nfr)` 化**。
   - 原因B: チャート svg の**固定 width 属性**(bar-line-chart 520 等)がトラック幅より広い →
     svg に `style={{ maxWidth: "100%", height: "auto" }}` を追加(viewBox があるため縦横比は保持)。
   - 原因C: knowledge 詳細パネル内の**分割不能な長い code スパン**が min-content を押し広げる →
     詳細コンテナに `overflowWrap: "anywhere"`(継承プロパティ)を指定。
   → 対処に `app/(shell)/retro/page.tsx` と `app/(shell)/knowledge/page.tsx` の**レイアウト行のみ**の
   変更が必要なため、§5-6 の閉包に両ファイルを追加する(変更はグリッド定義と wrap 指定に限定 —
   データ取得・表示ロジックには触れない)。
