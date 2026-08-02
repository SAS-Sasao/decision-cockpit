# 基本設計: codex-spar(壁打ちに Codex エージェント応答モードを追加 — ローカル開発限定)

- 起点: 2026-08-02 ユーザー決定 — 「Codex SDK をアプリ側で起動する形」の狙い = **壁打ち(SPAR)パネルに
  Codex の応答モードを追加**し、repo・設計書を読んで答えられる読取専用の相棒を UI から使う。
- 前提: codex-ops(CO-1・3レンズ PASS 済み)の隔離原則を継承する — **クリーンコピー隔離が第一層・
  読取専用・judge/critic の代替禁止**。本設計はその「第2の起動経路(SDK)」の追加 = **codex.md の契約改定を含む**。
- R1 反映(2026-08-02): sec FAIL(CSRF/DNS rebinding — CORS は送達を止めない)→ **受理3検証を IF 契約に昇格**。
  data FAIL(結論保存経路への合流・外部送信範囲の受容欠落)→ **Codex 応答を結論保存から除外 + 受容行とゲートを完全化**。

## 1. 目的 / スコープ

### 方式の骨格(最重要のアーキ決定 — コンテナ内実行の不採用)

**Codex はホスト側ランナー(dev 専用・ユーザーが手動起動)で実行し、ブラウザが 127.0.0.1 へ直接
fetch する。アプリサーバ(Next.js)は Codex に一切関与しない。**

コンテナ内実行(app コンテナで SDK を spawn)を不採用とする根拠(実測):
1. compose は `.:/app` の **bind mount** — コンテナ内から **`/app/.env` が素で可読**。クリーンコピーを
   作っても隣に原本があり、サンドボックス無しでは AGENTS.md(指示層)しか防壁がない = CO-1 R1 で
   否定済みの構造。
2. **app コンテナに git が無い**(既知) — `git archive` によるクリーンコピー生成が不可。
3. コンテナ内では codex のサンドボックス(landlock)が動く保証がない。
4. app プロセスの環境変数(DATABASE_URL 等)を子プロセスが継承する(スクラブ漏れ・/proc 経由の残余)。

ホストランナー方式はこれらを全て回避する: ホストには git がある / ランナーは `.env` を読まない
(**dotenv 不使用・source 禁止規範のまま** — ホストシェルの素の env で起動)/ クリーンコピーは
review.sh と同じ `git archive HEAD` 展開 / ブラウザから 127.0.0.1 で直接届くため**コンテナの
ネットワークにもアプリサーバにも触れない**(WSL2 では Windows 側ブラウザ → localhost forwarding
経由 — 実到達はゲート (a) で実証)。

### やる

1. **`scripts/codex/serve.ts` + `scripts/codex/serve-lib.ts`(新設)** — dev 専用 Codex ランナー:
   - Node http サーバ。**bind = 127.0.0.1 のみ**(LAN 非露出)。ポートは固定 8788。
   - **受理3検証(sec R1 の中核 — 検証に落ちないリクエストは処理せず 4xx で拒否)**:
     (i) **Origin ヘッダ = `http://localhost:3000` の完全一致必須**(欠落・不一致 = 403。素の curl は
     Origin が無いため構造的に 403 — Claude セッションからの HTTP 起動も同時に塞がる)
     (ii) **Content-Type = application/json 必須**(text/plain 等の simple request = 415。JSON CT は
     プリフライトを強制し、CORS 不許可オリジンの実 POST はブラウザが送信しない)
     (iii) **Host ヘッダ = `127.0.0.1:8788` または `localhost:8788` の完全一致必須**(DNS rebinding =
     攻撃者ドメインを 127.0.0.1 に向ける古典を遮断)。
     CORS 応答ヘッダは (i) の固定オリジンのみに付与。**3検証は serve-lib.ts の純関数**(テスト対象)。
     **OPTIONS(プリフライト)の扱いを明確化**(sec R2): OPTIONS は Origin/Host 検証のみ通過で
     CORS ヘッダ返却のみ(本処理なし・Content-Type 検証は課さない — プリフライトに CT は無いため)。
     **実 POST は3検証フル適用**。この区別を実装時に緩めない(緩和 = 設計逸脱)。
   - 受け付けは **POST /review・直列1件のみ**(実行中の追加リクエストは 429)。入力 = 質問文
     (trim 後 1..4000 文字・それ以外は 400)。
   - 1リクエストの処理: 一時 dir に **`git archive HEAD` を展開**(追跡ファイルのみ)→ コピー先に
     `.env`・`e2e/.auth`・`e2e/screenshots` が**無いことを assert** → **@openai/codex-sdk**
     (devDependency)で作業ディレクトリ = コピー・**サンドボックス = read-only** のスレッドを開始し
     単発実行 → 応答テキストを返す → **finally でコピーを破棄**(破棄対象は**一時 dir 生成が返した
     パス変数のみ**・固定パスの直書き禁止・force 系フラグなし — review.sh の `rm -r --` 原則と同位)
     → **元 repo の `git status --porcelain`
     を起動時スナップショットと比較し、差分があればコンソールへ警告**(事後検知 — review.sh とパリティ。
     検知範囲は本 repo のみ)。
   - **SIGINT/SIGTERM でも一時 dir を破棄**して終了(プロセス kill 時の残骸はクリーンコピー =
     追跡ファイルのみで機微低 — 残余として §4 で受容)。
   - **タイムアウト上限**(10分)で打ち切り。**会話は単発**(スレッド継続なし — v2 候補)。
   - **子プロセス(Codex)へ渡す env は allowlist で最小化**(PATH・HOME・Codex 認証に必要な変数のみ —
     実変数名は導入時確定。ホストシェル env の丸ごと継承をしない)。構築は **serve-lib.ts の純関数
     `buildChildEnv`**(テスト対象・§5 に実使用ピン — 丸ごと継承への退行を機械検知。sec R2)。
   - **質問文・応答をランナーのログに出さない**(出すのは件数・所要時間・検証拒否の種別のみ)。
   - SDK の実 API 名・認証方式(既存 `~/.codex` ログインの継承 or `CODEX_API_KEY`)・**承認/昇格
     ポリシーの固定方法(昇格不可設定があれば必ず固定)**は**導入時に確認して serve.ts に確定**
     (CO-1 の CODEX_ARGS と同じ「バージョンドリフトを1ファイルに局所化」原則)。ただし §5 のピン語
     ("read-only" 等)は**コード実体(SDK 呼び出し引数)で満たす**こと(コメントで満たすのは禁止 —
     CO-1 R3 申し送りの継承)。
   - 起動 = **人間の端末から `npm run codex:serve`**(package.json に script 追加)。
2. **SPAR パネルのモード追加(`app/(shell)/capture/spar-panel.tsx` 改修 + `spar-panel-lib.ts` 新設)**:
   - **`NEXT_PUBLIC_CODEX_SPAR === "1"` のときだけ**モード切替チップ「SPAR / Codex」を表示
     (未設定 = 本番 Vercel では**チップごと非表示** — spar_not_configured と同型の fail-closed)。
   - Codex モードの送信先 = **`http://127.0.0.1:8788/review` への直接 fetch**(固定リテラル)。
     アプリの API(/api/spar)は**経由しない・変更しない**。**アプリは `http://localhost:3000` で
     開くことが前提**(127.0.0.1:3000 で開くと Origin 検証で 403 — エラー文言に確認案内を含める)。
   - 応答は**「Codex(参考意見)」ラベル付きの素テキスト描画**(React 既定エスケープ。
     生 HTML 差し込み禁止 — 既存 SPAR と同じ)。nav 抽出・refs は**適用しない**(SPAR 専用契約のまま)。
   - **結論保存(spar_conclusion)の対象は SPAR 応答のみ — Codex 応答は除外**(data R1 の中核:
     Codex 出力は repo 全文コンテキスト由来の参考意見であり、capture_inbox → organize-loop → SSoT
     書き戻しの経路に**乗せない**)。ChatTurn に mode を持たせ、保存初期値の選定を
     **`spar-panel-lib.ts` の純関数 `latestSparConclusion(turns)`**(codex ターンをスキップ)に
     切り出してテストする。**SPAR 応答が1つも無い会話では結論保存ボタンを表示しない**
     (空エディタを出さない — data R2)。
   - **SPAR モード送信時の history から codex ターンを除外する**(data R2: Codex 応答(repo 追跡
     ファイル由来の派生テキスト)を SPAR 側の外部 API へ送らない — 逆方向のクロス送信も遮断。
     history の構築も `spar-panel-lib.ts` の純関数 `sparHistory(turns)` に切り出してテストする)。
   - **Codex モード表示中の注記文言**: 「Codex モードでは **repo の追跡ファイル全文**が外部
     (OpenAI)に送信されます。対象は**コミット済み(HEAD)の内容のみ**。質問に秘密・未コミット
     diff を貼らないこと」(既存 SPAR 注記の Codex 版 — 送信範囲の開示)。
   - ランナー未起動(fetch 失敗)時のエラー文言 = 「Codex ランナー未起動(`npm run codex:serve` で
     起動。アプリは localhost:3000 で開くこと)」。
3. **guard-bash 追補**: Claude セッションからのランナー起動も遮断。deny する実行形(先頭トークン規律 =
   CO-1 と同一・パイプテストで deny/allow 両側を検証):
   `npm run codex:serve` / `(npx )?tsx scripts/codex/serve.ts` / `node` による serve.ts 実行形。
   引数・grep 対象文字列としての `codex:serve` には一致させない(判定コマンドの誤爆防止)。
   HTTP 経由の駆動(curl → 8788)は Origin 必須検証が素の curl を 403 にする + codex.md の規律で扱う
   (ヘッダ偽装まで機械遮断はしない — 統治は正直な誤りを防ぐ層。§4 受容)。
4. **契約改定**: `.claude/rules/codex.md` に第2経路(SDK ランナー)を追記 — 起動は review.sh /
   codex:serve の**2つのみ**(いずれも人間の端末・読取専用・参考意見)・**UI 経路も HEAD 限定**
   (未コミット内容はレビュー不可)・質問文に秘密を貼らない・**Claude セッションは 8788 を叩かない**・
   **Codex 応答は spar_conclusion に保存しない**。**AGENTS.md の追随**(ワークスペースは review.sh
   **または** serve.ts が展開した一時コピー、と述べ直し)— codex.md の保守責務の初回適用。
5. **導入手順**: docs/setup/codex-setup.md に SDK ランナー節を追加(初回受け入れ検査の**正 = 本設計
   §5 のゲート (a)〜(h)**)。`.env.example` に `NEXT_PUBLIC_CODEX_SPAR` プレースホルダ追記。

### やらない

- **本番(Vercel)対応** — サーバレスでは SDK(バイナリ spawn)が動かない。フラグ未設定で UI 非表示・
  ランナーは 127.0.0.1 のみで構造的に到達不能。
- **書き込み権限・コード変更の実行** — 読取専用のみ(codex-ops v2 の領分)。
- **実行時のフロント動的変更**(元・案2)— 不採用決着のまま(コード書き換えはしない)。
- 会話のスレッド継続・応答ストリーミング・DB への会話保存(会話は SPAR 同様 useState 揮発)。
- `/api/spar`(route.ts)・lib/spar/ の変更 — SPAR 本体は非接触。
- judge / critic の代替(黄金ルール4 不変)。

## 2. アーキテクチャ上の位置づけ

アプリ3層の外に「**dev 専用ローカルサービス**」を1つ追加する(App 層はチップと fetch 先が増えるだけ)。
正典は `.claude/rules/codex.md` に置き、**architecture.md は改定しない**(意図的判断: ランナーは
アプリ構成物ではなく開発プロセス層のツール — 「開発は Docker でローカル完結」の原則はアプリに
ついて不変。ランナーは使うときだけ手動起動する付属ツール)。
SSoT 非接触: ランナーが読むのは**本 repo のクリーンコピーのみ**(../ の SSoT clone・DB・GitHub API の
いずれにも触れない)。データフロー: ブラウザ → 127.0.0.1:8788(ホスト)→ クリーンコピー → OpenAI。
アプリサーバ・db コンテナはこの経路に**存在しない**。

## 3. データ / インターフェース概要

- スキーマ変更なし・DB アクセスなし。**capture_inbox への新規流入経路もなし**(Codex 応答は結論保存の
  対象外 — §1 やる-2)。
- ランナー IF: `POST /review`。**受理条件 = Origin/Content-Type/Host の3検証(§1 やる-1)を全て通過
  したリクエストのみ**(不通過は**処理しない**)。OPTIONS = プリフライト応答のみ(§1 やる-1)。
  入力 `{ question: string }`(1..4000 文字)→ 出力 `{ reply: string, durationMs: number }` / エラーの
  写像(data R2 で完全化): **Origin/Host 不一致・欠落 = 403 `forbidden`** / **Content-Type 非 JSON =
  415 `unsupported_media`** / 入力不正 = 400 `bad_request` / 実行中 = 429 `busy` /
  実行失敗 = 502 `codex_failed` / 上限超過 = 504 `timeout`。
- SPAR モードの送信 history は SPAR ターンのみ(codex ターン除外 — `sparHistory` 純関数。§1 やる-2)。
- 外部送信の範囲(明示): **質問文 + repo 追跡ファイル全文(HEAD)** が OpenAI へ送られる(§4 で受容)。
- パネル: ChatTurn に mode("spar" | "codex")を追加。Codex 応答は refs/navs 無し・参考意見ラベル・
  結論保存対象外(`latestSparConclusion` — 純関数・テスト対象)。
- 成果物 = serve.ts / serve-lib.ts / spar-panel.tsx 改修 / spar-panel-lib.ts / tests/codex-spar.test.ts /
  package.json(+lock)/ .env.example / guard-bash.sh / codex.md / AGENTS.md / codex-setup.md。

## 4. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| **cross-site POST(CSRF)・DNS rebinding による 8788 への到達**(CORS は応答読取の制御であり送達を止めない — sec R1 中核) | **受理3検証で構造遮断**: Origin 完全一致必須(欠落 = 403)+ Content-Type application/json 必須(simple request 不成立・プリフライト強制)+ Host 完全一致(rebinding 遮断)。3検証は serve-lib 純関数としてテスト + §5 ピン。**トークン認証は検討の上で不採用**(3検証で web-origin 経路は閉止・同一ホストのローカルプロセスは単一ユーザー機の信頼境界内と受容 — ランナー自体が読取専用で秘密を持たない) |
| **ホストの `.env` 原本は read-only サンドボックスでも読める**(読取制限は保証されない — CO-1 R1 確定事実) | クリーンコピー隔離で**ワークスペースには不在**。残余 = 絶対パス注入 — **CO-1 §4 と同一の受容**。受理3検証により注入源は「自己管理コンテンツ + 本人がタイプする質問文」に**限定が回復**する(web-origin は到達不能)。実害上限とローテーションは codex-setup.md §5 |
| **repo 追跡ファイル全文 + 質問文の外部(OpenAI)送信 — UI からの低摩擦・日常的な第2経路**(data R1) | **CO-1 §4 の受容を明示継承した上で別個に受容**(端末レビューより頻度が上がる)。手当て: UI に送信範囲の注記を常時表示(§1 やる-2)+ データ保持・学習設定の確認をゲート (h) で SDK 認証経路にも適用 + 質問文に秘密を貼らない規範を codex.md に明記 |
| **Codex 応答の SSoT への合流**(結論保存 → capture_inbox → organize-loop → PR 書き戻し — data R1 中核) | **構造で遮断**: 結論保存の対象は SPAR 応答のみ(`latestSparConclusion` が codex ターンをスキップ — 純関数テスト + §5 ピン)。codex.md にも規律として明記 |
| ランナーの露出(他プロセス・LAN) | **127.0.0.1 バインド固定**(LAN 構造的不可・ゲート (d) で実証)+ 受理3検証。同一ホストの他プロセスがヘッダを偽装して叩く経路は単一ユーザー機として受容(実害 = コスト消費のみ — 読取専用・秘密なし) |
| 連投によるコスト消費(直列化は並行を防ぐが連投は防がない) | web-origin 遮断(受理3検証)後の連投 = 本人操作のみ → 受容。+ 4000字上限・10分タイムアウト・単発スレッド・手動起動(常駐なし)。従量キーの場合は上限設定をゲート (h) で確認 |
| Codex 応答経由の XSS | **素テキスト描画のみ**(React 既定エスケープ)。`dangerouslySetInnerHTML` はディレクトリ走査の否定ピンで機械遮断(capture-spar と同形) |
| ホストシェル env の子プロセス継承(コンテナ不採用理由4の縮小形) | **子プロセス env は allowlist で最小化**(§1 やる-1)。ホストシェルは .env を source しない既存規範が前提 |
| SDK の API/認証のバージョンドリフト | serve.ts 1ファイルに局所化(導入時に実 API 確認)。ピン語はコード実体で満たす(コメント汚染禁止 — CO-1 R3 継承) |
| 本番ビルドへの混入 | クライアントに入るのは**フラグ分岐と 127.0.0.1 への fetch コードのみ**(秘密なし・未設定なら UI 非表示)— 受容。route.ts / lib/spar 非接触は閉包 allowlist で機械担保 |
| 統治迂回(Claude セッションからの起動・駆動) | guard-bash に起動形 deny を追補(§1 やる-3・パイプテスト検証)。**HTTP 駆動は Origin 必須検証が素の curl を 403 にする** + codex.md の規律(ヘッダ偽装の機械遮断まではしない — 受容)。judge/critic 代替禁止は不変 |
| `~/.codex` へのセッション記録の局所永続・一時 dir の残骸(kill 時) | 導入時に記録の有無を確認して codex-setup.md に記録(内容 = 質問文 + 追跡ファイル由来 — ホスト内・機微低)。残骸は追跡ファイルのみで機微低 — いずれも受容 |
| AGENTS.md / codex.md の二重管理ドリフト | 本 goal 自体が契約改定 goal — **閉包に AGENTS.md 追随を含める**(codex.md の保守責務の初回適用) |

## 5. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較。凍結基準 = goal 分岐点 main(既存テストの本文・名前・期待値の不変)。
**/goal CS-1**(ランナー + パネル改修 + 契約追随・ターン上限 6)。

**ピン語は §5 の全条件についてコード実体で満たす**(コメント・エラー文字列での充足は禁止 —
CO-1 R3 継承・sec R2 で §5 全体への適用を明示)。grep ピンは存在の下限であり、受理3検証・
`latestSparConclusion` / `sparHistory` / `buildChildEnv` の**実体の担保は条件5 の新規テスト**
(judge はテスト内容まで確認する — sec R2 の受容)。

```bash
# 0. ランナー(運用の正)
test -f scripts/codex/serve.ts && test -f scripts/codex/serve-lib.ts
for k in "127.0.0.1" "git archive" "read-only" "8788" "finally" "git status --porcelain" "buildChildEnv"; do
  grep -qF "$k" scripts/codex/serve.ts || echo "MISSING serve: $k"; done   # 出力なし
for k in "Origin" "content-type" "Host" "4000" "buildChildEnv"; do
  grep -qiF "$k" scripts/codex/serve-lib.ts || echo "MISSING lib: $k"; done # 出力なし(受理3検証 + 上限 + env)
grep -q "codex:serve" package.json                                          # script 追加
# 1. パネル(フラグ非表示 + 直接 fetch + 素テキスト + 結論保存の除外 + history 分離)
grep -qF 'NEXT_PUBLIC_CODEX_SPAR' "app/(shell)/capture/spar-panel.tsx"
grep -qF 'http://127.0.0.1:8788' "app/(shell)/capture/spar-panel.tsx"
grep -qF 'latestSparConclusion' "app/(shell)/capture/spar-panel.tsx"        # 純関数を実使用
grep -qF 'sparHistory' "app/(shell)/capture/spar-panel.tsx"                 # history 分離を実使用
grep -rln "dangerouslySetInnerHTML" "app/(shell)/capture" | wc -l           # = 0
# 2. SPAR 本体の非接触(閉包 allowlist — 下記以外の変更 0 行)
git diff main --name-only | grep -vxF \
  -e 'scripts/codex/serve.ts' -e 'scripts/codex/serve-lib.ts' -e 'app/(shell)/capture/spar-panel.tsx' \
  -e 'app/(shell)/capture/spar-panel-lib.ts' -e 'tests/codex-spar.test.ts' \
  -e 'package.json' -e 'package-lock.json' -e '.env.example' \
  -e '.claude/hooks/guard-bash.sh' -e '.claude/rules/codex.md' -e 'AGENTS.md' -e 'docs/setup/codex-setup.md' \
  -e 'docs/design/basic/codex-spar.md' -e 'docs/design/reviews/codex-spar.md' \
  -e 'docs/setup/next-actions.md' | wc -l                                   # = 0
# 3. 契約追随
grep -q "codex:serve" .claude/rules/codex.md && grep -q "serve" AGENTS.md
grep -q "codex:serve" docs/setup/codex-setup.md
grep -q "NEXT_PUBLIC_CODEX_SPAR" .env.example
# 4. guard 追補(deny/allow はパイプテストで検証 — goal 内で実施しログを judge が確認)
grep -q "codex:serve" .claude/hooks/guard-bash.sh
# 5. テスト・型(serve-lib 受理3検証 + latestSparConclusion の新規テストを含む・既存は凍結)
#    npm test = ホスト実行・exit 0(件数 = 分岐点実測 521 + 新規)/ npx tsc --noEmit = exit 0
# 6. e2e 6画面 green(npm run e2e — UI 変更のため必須)
```

手動チェック(**ゲート — 本リストが正**。有効化 = ユーザー操作。全 PASS まで運用開始しない・
fail = 導入中止して本設計を改訂(3レンズ再通過)):
- (a) `npm run codex:serve` → **localhost:3000 で開いた** UI の Codex モードで1問 → 応答表示 +
  元 repo の `git status --porcelain` が空(ランナーの警告が出ない)
- (b) ランナー停止中はエラー文言表示(アプリは正常のまま)
- (c) `NEXT_PUBLIC_CODEX_SPAR` 未設定でチップ非表示(本番相当)
- (d) LAN の別端末から 8788 に到達できない
- (e) 出力に秘密の引用が無い(補助 — 限界は CO-1 §4 と同一)
- (f) **サンドボックス内ネットワーク到達試験**(質問で curl 実行を依頼 → 遮断されること。
  到達できたら fail = 導入中止)— CO-1 ゲート (c) の SDK 経路再実施
- (g) **昇格/approval 挙動確認**(サンドボックス外実行・書き込みの承認要求が出ない/出ても承認
  しない設定であること)— CO-1 ゲート (d) の SDK 経路再実施
- (h) **SDK 認証経路のデータ保持・学習設定の確認**(CODEX_API_KEY を使う場合は従量上限の設定も)+
  `~/.codex` のセッション記録の有無を確認し codex-setup.md に記録

## 6. 未解決の問い

- **スレッド継続(会話文脈)・応答ストリーミング** — v1 は単発。運用感触を見て v2 で判断。
- **ランナーの常駐化**(compose サービス化)— `.env` 隔離とクリーンコピー原則を壊さない形が
  あるかは別途設計(現状は「使うときだけ手動起動」が安全側)。
- ポート 8788 の衝突時の切替(env 化)— v1 は固定リテラル(受容)。
- CO-1 端末版(review.sh)との使い分けガイド — 運用実績が付いたら codex.md に追記。
