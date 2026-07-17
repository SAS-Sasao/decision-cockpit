# 基本設計: md-render(Markdown 表示部品 — 判断ログ本文の可読化)

> ステータス: **PASS**(全レンズ — arch/sec は Round 3・data は Round 4(rev.5)。テーブル対応(rev.4〜6)込み。R4 の Low 3件は rev.6 で吸収済み。reviews/md-render.md 参照)
> 発端: ユーザー指摘(2026-07-17)「せめて md 形式で内容表示してほしい。あまりにも見た目チープ」— SC-04 右ペインの本文が Markdown ソース(`#`・`**`・`-` が生のまま)で表示されている。
> 本書は**基本+詳細を単一文書で兼ねる**(スキーマ変更なし・関数 IF / テスト観点 / 受け入れ条件を本書に含む — スコープ極小のための意図的判断。design.md の趣旨 = 「実装前に機械判定可能な設計が PASS していること」は満たす)。
> 作成: 2026-07-17(主セッション執筆)

## 1. 目的 / スコープ

### やる
1. **lib/ui/markdown.ts(純関数・React 非依存・新設)**:
   - `parseMarkdown(text: string): Block[]` — Markdown を**型付きトークン木**に変換(HTML 文字列は一切生成しない)。
     対応記法: 見出し(`#`〜`######`)/ 箇条書き(`-` `*`)・番号付き(`1.`)/ 引用(`>`)/ フェンスコード(``` )/ 水平線(`---`)/ **GFM テーブル(rev.4 追加)**/ 段落。インライン: 強調(`**`)・コード(`` ` ``)・リンク(`[t](url)`)。
     **テーブルの認識規則(rev.5 で精密化)**:
     - **開始条件**: 行 N が `|` を含み**かつ行頭が他のブロック記号(`#` `-` `*` `1.` `>` ```` ``` ````)で始まらない**、かつ行 N+1 が**セパレータ行 = `|` を必須に含み、`-`・`:`・`|`・空白のみで構成され、`-` を含む行**。→ 行 N = ヘッダ・N+2 以降の**データ行(ヘッダと同条件 = `|` を含みブロック記号で始まらない行)**の連続。条件を満たさない行(ブロック記号行・パイプなし行・空行)でテーブルは終端し、その行は次ブロックとして再判定(rev.6)。**`|` を含まない `---` はセパレータになり得ない**(水平線 hr と衝突しない — hr が優先)。
     - **ブロック判定順(明文)**: fence → **table(2行先読み)** → hr → heading → list → quote → 段落。段落連結中も現在行がテーブル開始条件を満たしたら段落を終端してテーブルを開始する(停止条件に追加)。
     - **セル分割規約(GFM 風 — 範囲限定: 外側パイプ除去・分割・trim・ヘッダ基準正規化のみ。`\|` エスケープ非対応 = 区切りとして分割・rev.6 明記)**: 行頭・行末の `|` を除去 → `|` で分割 → 各セル trim。`| a | b |` = 2 セル。**データ行のセル数はヘッダ基準で正規化**(不足 → 空セル補完・過剰 → 切詰め)。セパレータ行のセル数は認識条件に含めない(行単位判定 — fail-soft 方針)。
     - **セパレータ行なしのパイプ行は段落素通し**(fail-soft 維持)。型追加: `{ kind: "table"; header: Inline[][]; rows: Inline[][][] }`。セル内はインライン解析(既存 Inline 型のみ)。
     **対応外の記法は段落(プレーンテキスト)として素通し**(壊れない — 最悪でも現状同等の表示)。**HTML タグはパースせずテキストとして扱う**(トークン木に raw HTML の型は存在しない)。
   - `stripMarkdown(text: string): string` — **行頭ブロック記号(`#`〜`######` + 空白 / `-` `*` リストマーカー / `>` / `1.` 形式 / フェンス行 / **hr 行(`-` のみ等の水平線行は行ごと除去 — rev.6)**)とパイプ行(**rev.5 明文: 2行文脈を持たない行単独変換** — セパレータ行(`|` 必須の新定義)は行ごと除去・その他の `|` を含む行はパイプをセル区切りとして空白連結。**parseMarkdown との判定差(セパレータなしパイプ行は parse では段落・strip ではパイプ除去)は意図的な非対称** — strip の目的はプレーン化であり excerpt 用途で過剰除去の害はなく、120字切詰め断片でも決定的)とインライン装飾記号(`**`・`` ` ``・`[t](url)` → t)の両方**を除いたプレーン文字列(excerpt 用 — 実データの excerpt 汚染の主犯は行頭 `#` のため、ブロック記号除去を契約に含める)。**全域性**: 120 文字切詰め後の**切断入力(閉じない `**`・途中で切れたリンク)でも throw せず**残りをプレーン文字列として返す(fail-soft — テスト対象)。
   - 型例: `type Block = { kind: "heading"; level: number; inline: Inline[] } | { kind: "para"; inline: Inline[] } | { kind: "list"; ordered: boolean; items: Inline[][] } | { kind: "quote"; inline: Inline[] } | { kind: "code"; text: string } | { kind: "hr" } | { kind: "table"; header: Inline[][]; rows: Inline[][][] }` / `type Inline = { kind: "text" | "strong" | "code"; text: string } | { kind: "link"; text: string; href: string }`。
2. **components/markdown.tsx(Server Component・新設)**: `<Markdown text={string | null} />`(null・空文字 → 空描画 — 呼び出し側の null 合体不要)— parseMarkdown の結果を JSX に描画。
   - **XSS の構造的封鎖**: `dangerouslySetInnerHTML` 不使用(文字列は React の自動エスケープを必ず通る)+ リンク href は `isSafeHref` の allowlist 判定を通った場合のみ `<a>` 化(それ以外 — `javascript:` / `data:` 等 — はテキスト表示)。**isSafeHref のセマンティクス(明文): trim → 小文字化 → `http://` または `https://` の前方一致**。`<a>` は `target="_blank" rel="noopener noreferrer"`。**実装制約(rev.5): インライン(Inline[])の描画は単一の関数を全ブロック種別(段落・見出し・リスト・引用・テーブルセル)で共用する**(リンク封鎖の配線が経路ごとに分岐しない)。**受容判断(明記)**: 本部品により SSoT 由来 MD 内のリンクが非クリッカブル → クリッカブルになる。SSoT は自己所有 repo であり noopener noreferrer + allowlist を条件に受容(意図的判断)。
   - スタイルは既存トークンのみ: コード = `var(--font-mono)` + `var(--panel-row)` 背景 / 引用 = `var(--line)` の左ボーダー / 見出し = サイズ段階 + 600 / リスト = 標準マーカー / **テーブル(rev.4)= `border: 1px solid var(--line)` セル・th は 600 + `var(--panel-row)` 背景・`overflow-x: auto` の div でラップ(横スクロール — 画面幅を壊さない)**。色 props は持たない(固定トークン)。
3. **適用(app/(shell)/knowledge/page.tsx のみ変更)**: 右ペインの selected 本文を `<Markdown text={selected.body} />` に置換 / 左リストの excerpt 表示に `stripMarkdown` を適用(行頭 `#`・`**` の混入除去 — §1-1 の契約と一致)。**lib/data/knowledge.ts は不変**(excerpt の整形は表示層)。
4. **テスト世代管理(docs/design/ui/screen-design.md §7.4-3)**: M2 新設テスト4本(embedding / embed-index / knowledge-data / api-sync-embed)を凍結列挙に**編入**。

### やらない
- SC-02 / SC-05 への適用(判断ログ行カードは title + tags 中心 — 必要になったら次トピック)。
- 画像・脚注・HTML パススルー・シンタックスハイライト・ネストリスト(1段のみ)・**テーブルのセル内配置指定(`:---:` 等は認識のみで整列は適用しない — 全セル左寄せ)**。
- 依存追加(react-markdown / marked 等は**不採用** — dangerouslySetInnerHTML 経路と供給網を増やさない)。
- データ層・スキーマ・SSoT への一切の変更。

## 2. アーキテクチャ上の位置づけ
App 層のみ(表示部品 + 1画面の表示置換)。Ingestion / Index/Search 非接触。SSoT 非接触。外部送信なし。

## 3. リスク・トレードオフ
| リスク | 対処 |
|---|---|
| 手書きパーサの網羅性不足 | 対応外は段落素通し(fail-soft)。実データ(ai-war-room の decision MD)は見出し・リスト・段落が主体で対応集合に収まる |
| XSS(本文は SSoT 由来 = 外部入力) | HTML 文字列を生成しない設計 + React 自動エスケープ + href スキーム allowlist(機械判定 §4-1/§4-2) |
| 誤描画(強調の取りこぼし等) | 表示のみの影響・テストで主要記法を固定 |

## 4. 受け入れ条件(機械判定)

`FROZEN_TESTS`(M2 の4本を編入): `tests/proxy.test.ts tests/review-data.test.ts tests/api-sync.test.ts tests/auth-user.test.ts tests/check-no-secrets.test.ts tests/capture-contract.test.ts tests/parsers tests/ingestion tests/helpers tests/overview-data.test.ts tests/score-level.test.ts tests/redirects.test.ts tests/chart.test.ts tests/embedding.test.ts tests/embed-index.test.ts tests/knowledge-data.test.ts tests/api-sync-embed.test.ts vitest.config.ts`。

1. **パーサとテスト**: `test -f lib/ui/markdown.ts` + `test -f components/markdown.tsx` + `test -f tests/markdown.test.ts` + `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE npm test` exit 0。テストケース(§5): 見出しレベル / リスト(順序付き・なし)/ **引用・水平線** / フェンスコード(内部の `#` が見出しにならない)/ **強調・インラインコードの Inline トークン生成** / **fail-soft の肯定テスト(対応外記法(例: 画像記法)→ 段落トークン・セパレータ行なしのパイプ行 → 段落)** / **テーブル(rev.4/5): ヘッダ + セパレータ + データ行 → table トークン(セル分割規約どおりのセル数・不足補完/過剰切詰め・セル内インライン)・`|` なし `---` は hr(テーブル化しない)・要素木に `"table"`・`"th"` が現れ overflow ラッパを持つ・**セル内 `javascript:` リンク → `"a"` 不在 / セル内 https リンク → `"a"` + rel/target 存在(セル経路の isSafeHref 配線検証)**・切詰めで分断されたテーブル断片で stripMarkdown が throw しない** / リンク(https → link トークン・URL 生値保持)/ **`isSafeHref` の単体テスト**(true = http/https のみ。拒否ケース: `javascript:`・`data:`・大文字混在(`JavaScript:`)・空白前置・`//` 相対)/ **コンポーネント出力の要素木検査**(components/markdown.tsx は関数として直接呼べる — 返却 React 要素木を walk し、`javascript:` リンク入力で type `"a"` の要素が**現れない**こと・https リンクで `"a"` + `rel="noopener noreferrer"` + `target="_blank"` が**現れる**ことを assert。walk は**関数型要素(サブコンポーネント)に遭遇したら呼び出して再帰**する(分割実装でも観測が破れない)。jsdom 不要・依存追加なし)/ HTML タグ入力 → text トークンのまま(raw HTML 型が出ない)/ `stripMarkdown`(**行頭 `#`/リストマーカー(`-` `*` と `1.` 形式の両方)/引用/フェンス行の除去・テーブル行のパイプ除去 + セパレータ行の除去(rev.4)**・強調・コード・リンクの除去・**切断入力(閉じない `**`・途中で切れたリンク)で throw しない**)/ 空文字・null の安全。
2. **描画規約**: `grep -RIn "dangerouslySetInnerHTML" app components lib` exit 1 / `grep -Fq "isSafeHref" components/markdown.tsx`(スキーム検査の使用 — **配線の実効検証は §4-1 の要素木検査テストが担う**)/ `grep -Fq "noopener noreferrer" components/markdown.tsx` / `grep -q "javascript:" tests/markdown.test.ts`(拒否ケース文字列の実在 — 実効性は要素木検査 + isSafeHref 単体テスト)。
3. **適用**: `grep -Fq 'components/markdown"' "app/(shell)/knowledge/page.tsx"` / `grep -Fq "stripMarkdown" "app/(shell)/knowledge/page.tsx"` / `grep -Fq "requireUser" "app/(shell)/knowledge/page.tsx"`(存置)/ `grep -Fq 'components/charts/line-chart"' "app/(shell)/knowledge/page.tsx"`(チャート節の存置 — M2 条件7 の継承)。
4. **凍結・退行**: `git diff --exit-code main -- lib/data lib/search lib/ingestion db/migrations lib/auth lib/db.ts proxy.ts app/api app/login app/auth app/logout next.config.mjs tsconfig.json package.json package-lock.json lib/ui/chart.ts lib/ui/score.ts components/charts components/nav-link.tsx "app/(shell)/page.tsx" "app/(shell)/retro" "app/(shell)/layout.tsx" "app/(shell)/template.tsx" "app/(shell)/today" "app/(shell)/capture" "app/(shell)/admin" app/globals.css app/layout.tsx fixtures scripts` exit 0 / `git diff --exit-code main -- <FROZEN_TESTS>` exit 0。
5. **境界再実行(M2 条件7 の継承)**: `grep -RIn "capture_inbox" lib/search lib/data/knowledge.ts "app/(shell)/knowledge"` exit 1 / `grep -RIn -E "lib/db|lib/search" "app/(shell)/knowledge"` exit 1 / `grep -RIn "as TokenColor" app components lib` exit 1 / `bash scripts/check-no-secrets.sh` exit 0 / **M1 条件8(SSoT ホスト禁止 grep)再実行 exit 0**(前例どおり)。
6. **ビルド・実機**: ダミー env build exit 0(ui-shell 詳細 §4 条件5 相当)+ 実機(同 §4 条件2・fixture env)で未認証 `/knowledge` → 307。

## 5. 実装の分割(/goal 単位)と禁止事項

### /goal MD-1「Markdown 表示部品と適用」(単一ゴール)
- **達成状態**: §4 の条件 1〜6 が全て exit 0。
- **成果物**: lib/ui/markdown.ts / components/markdown.tsx / tests/markdown.test.ts / app/(shell)/knowledge/page.tsx の表示置換。
- **executor**: frontend-engineer。**ターン上限**: 20。**節目 commit**: (a) パーサ + テスト緑 (b) 部品 + 適用 + build 緑。
- **禁止**: §4-4 の凍結対象・依存追加・**成果物4ファイル以外の新規ファイル作成禁止**(judge が git status/diff で確認)・`dangerouslySetInnerHTML`・`as TokenColor`・`capture_inbox`/`lib/db`/`lib/search` リテラル(knowledge 配下・コメント含む)・モデル名/URL リテラル(M2 条件5 の継承 — markdown.ts/tsx にも書かない)・`.env`/.claude/ 変更・SSoT 接触・push。

## 6. 未解決の問い
1. SC-02 の判断ログ excerpt にも stripMarkdown を適用するか(SC-02 は凍結対象のため本 goal では見送り — 次に SC-02 を触る goal で)。
2. ネストリストの需要(実データで頻出するようなら拡張トピック)。テーブルは rev.4 でスコープ入り(決着済み)。

## 次の手順
`/design-review md-render` → 全レンズ PASS → `/goal MD-1`。
