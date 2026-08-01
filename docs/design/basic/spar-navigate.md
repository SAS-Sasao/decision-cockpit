# 基本設計: spar-navigate(壁打ちの画面操作提案 — パラメータ限定)

- 起点: 2026-08-01 ユーザー決定(codex 運用の壁打ち → 使い道2を先行)。旧「案2: AI 動的フロント」の
  安全形 = **AI はコードではなくパラメータのみを提案し、適用は常にユーザーのクリック**。
- **軽量1枚設計**(SPAR の既存封じ込めに乗る追加 — スキーマ/認可/書き込み面の変更なし)。

## 1. 目的 / スコープ

### やる

1. 壁打ち(SPAR)の応答に**画面操作の提案(ナビゲーション)**を添える。例:
   「過去の判断に類例があります → [🔍 decision で『pgvector 精度』を検索] [📅 振り返りを月粒度で]」。
   **クリックで遷移するだけ**(AI は画面を自動変更しない)。
2. **提案語彙(ホワイトリスト)v1 — 2種のみ**:
   - `{ kind: "knowledge", q: string(1..100), type?: "decision"|"knowledge"|"all" }` → `/knowledge?q=…&type=…`
   - `{ kind: "retro", g: "week"|"month" }` → `/retro?g=…`
   最大3件。**href の不変条件 = 固定リテラル `/knowledge?…` / `/retro?…` 起点で、モデル文字列は
   クエリ値としてのみ encodeURIComponent 経由で入る**(sec R1 (c): 「先頭 / のみ」では protocol-relative
   `//evil` を排除できないため、実体どおり固定リテラル起点で言明。モデルの生 URL・生 href・
   `startsWith("/")` 型の事後検証は使わない)。
   **表示ラベルの構造はサーバのテンプレートで固定**(モデル寄与は q 値のみ — sec R1 (b) の精密化)。
   **q の文字種検証**: 長さ 1..100 に加え **制御文字(改行・bidi 制御・ゼロ幅を含む Unicode カテゴリ C)を
   含む場合は破棄**(ラベルの視覚偽装面を閉じる — sec R1 (a))。
3. **モデル出力の受け口**: system プロンプトに「必要なら応答末尾に ```nav フェンスで JSON を1つ添える」旨を追記。
   **extractNavBlock の判定規則(決定的 — data R1)**: 対象 = reply の**末尾**にある完全なフェンス1個のみ
   (行頭 ```` ```nav ```` で開始・行頭 ```` ``` ```` で閉止・閉止後は空白/改行のみ許容)。
   非末尾のフェンス・本文中の ```` ``` ````・閉じ欠落・2個目以降は**対象外 = 本文にそのまま残す**。
   **検証順序と本文契約(sec R1 (d) の決着)**: フェンス候補の JSON をパース → ホワイトリスト検証
   (語彙外 kind・超過長・文字種違反・非文字列・4件目以降は破棄)。**1件以上有効なら**フェンスを除去した
   本文 + navs を返す(除去後の本文が **trim して空**なら元の reply を維持 — 空白/改行のみも空とみなす)。
   **全滅(パース失敗含む)ならフェンスを除去しない**(= 元の reply をそのまま返す・navs=[] —
   **無効 nav による本文隠蔽が構造的に不可能**。有効 nav を伴う自然文の省略はモデルが本文を書かない
   挙動と等価で本機構の守備範囲外 — 主張スコープの確定)。壁打ち本体はどの分岐でも壊れない(fail-soft)。
   実装細則(R2 残問いの決着): 開始行は**行全体一致**(```` ```nav ```` の後は行末まで空白のみ)/
   フェンス2個は「非末尾」ケースに統合(末尾の1個のみ候補)/ **抽出〜検証〜本文決定は nav.ts の合成関数
   `applyNavExtraction(reply): { body, navs }` で完結**させ、route.ts はそれを呼ぶだけ(実経路をテストする)。
4. 実装配置:
   - **`lib/spar/nav.ts`(新設・純関数・`import "server-only"` 付き — lib/spar/ の慣行に統一。arch R1)**:
     `extractNavBlock(reply): { body, rawJson }` / `buildNavs(rawJson): { label, href }[]` /
     **`applyNavExtraction(reply): { body, navs }`(合成 — 本文契約 §1-3 を単独で満たす公開 IF)**。
     決定的・ユニットテスト対象。
   - `lib/spar/prompt.ts`: system 文への nav 指示の追記(固定文字列)。
   - `app/api/spar/route.ts`: callChat 後に nav 抽出 → レスポンスへ `navs` を **additive** に追加。
   - `app/(shell)/capture/spar-panel.tsx`: assistant ターンに navs のリンクボタンを描画
     (`<a href>` — href は API 由来の検証済み相対パスのみ)。
5. コストガード: 既存呼び出しに乗る(追加 API コールなし)。maxTokens 等の既存ガード不変。
6. **受容(v1・明示)**: (a) 提案リンクをクリックすると q が URL クエリとしてブラウザ履歴・アクセスログに
   残る(会話由来文字列の新しい残留面 — 検索語相当として受容) (b) クリック時は既存 /knowledge 経路の
   埋め込み API 1回送信が発生(既存宣言済み系統) (c) 破棄(語彙外・壊れ JSON)は無音・計数なし
   (応答本文をログに出さない既存規約を優先)。

### やらない

- 提案の**自動適用**・画面状態への直接介入・新しい書き込み面 / API route の新設。
- 語彙の拡張(/today のフィルタ等は v2 — 語彙追加は本設計の §1-2 を改訂して3レンズを通す)。
- モデル・プロバイダ変更(SPAR_PROVIDER/MODEL/API_KEY の契約不変)。Codex 固有機能への依存なし。
- 絶対 URL・外部 URL・protocol-relative(`//…`)・`javascript:` 等の href(**固定リテラル `/knowledge?…` /
  `/retro?…` 起点のみ** — nav.ts の組み立てで構造的に保証。事後検証型の startsWith は使わない)。

## 2. アーキテクチャ上の位置づけ

App 層のみ。SPAR の封じ込め(env 固定・fail-closed・コスト上限・二層認証)に**そのまま乗る**。
モデル出力は「表示テキスト」と「検証済みパラメータ」以外の形でシステムに入らない
(コード実行ゼロ・href はサーバ組み立て — prompt injection が起こせるのは
「変な検索語のリンクを提案する」まで。クリックしても検索されるだけ)。

## 3. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| prompt injection で不正な提案 | 影響上限 = 検証済み2画面への遷移リンク(語彙・長さ・件数で拘束・href/ラベルはサーバ生成)。XSS 面なし(React エスケープ + dangerouslySetInnerHTML 不使用をピン) |
| nav フェンスの誤パースで応答本文が欠ける・偽 nav で本文を隠される | 末尾の完全フェンス1個のみ対象 + **有効 nav が1件も無ければフェンスを除去しない(本文復元)** — 隠蔽経路が構造的に不可能(§1-3)。境界(非末尾・閉じ欠落・2個目・除去後空)はユニットテストで固定 |
| モデルが指示に従わず nav を出さない/壊れた JSON | fail-soft(navs=[])— 機能は「出たら便利」の加点。既存の壁打ち体験は不変 |
| トークン微増 | 数十トークン程度(指示1段落 + JSON 1個)。既存 maxTokens ガード内 |

## 4. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較。凍結基準 = goal 分岐点 main。

```bash
# 1. 純関数の存在
grep -q "export function buildNavs" lib/spar/nav.ts
grep -q "export function applyNavExtraction" lib/spar/nav.ts
grep -q "export function extractNavBlock" lib/spar/nav.ts
grep -q "server-only" lib/spar/nav.ts
# 1b. テストのケース名 grep(判定に昇格 — arch/data R1。各 it 名に含める固定語)
for k in "語彙外" "4件目" "文字種" "encode" "非末尾" "閉じ欠落" "本文復元" "protocol-relative" "除去後が空"; do
  grep -q "$k" tests/spar-nav.test.ts || echo "MISSING case: $k"; done   # 出力なし = 9観点すべて実在
# 2. href の安全形(固定リテラル起点 — startsWith 型の事後検証をピンにしない。sec R1 (c))
grep -qF '"/knowledge?' lib/spar/nav.ts
grep -qF '"/retro?' lib/spar/nav.ts
! grep -q "startsWith" lib/spar/nav.ts
# 2b. 表示面(走査範囲は capture-spar §4-5b と同じディレクトリ形 — sec R1 (b))
! grep -rq "dangerouslySetInnerHTML" "app/(shell)/capture" app/api/spar lib/spar
# 3. API・プロンプト
grep -q "navs" app/api/spar/route.ts
grep -q "nav" lib/spar/prompt.ts
# 4. テスト(ホスト・507 + 追加分・削除行 0)/ tsc / docker dummy build / e2e 6画面 green
# 5. 閉包: lib/spar/nav.ts / lib/spar/prompt.ts / app/api/spar/route.ts /
#    app/(shell)/capture/spar-panel.tsx / tests/spar-nav.test.ts /
#    docs/design/basic/spar-navigate.md / docs/design/reviews/spar-navigate.md / docs/setup/next-actions.md
```

手動チェック(判定対象外・goal 報告): 壁打ちで「過去の判断を探して」等と話す → 提案リンクが出る →
クリックで /knowledge に検索済みで遷移する(SPAR env 設定済みのローカルで確認)。

## 5. 実装の分割と禁止事項

- **/goal SN-1**(1本・**主セッション実施 — 黄金ルール4 からの逸脱の明示**(FC-1/TBI-1 と同型):
  受け入れ条件に e2e・SPAR env 依存の手動確認があり往復コストが大きいため。判定分離は acceptance-judge で維持。
  ターン上限 8)。
- 禁止: .env 非接触 / 新 API route・書き込み面の新設 / SPAR の env 契約・コストガード変更 /
  モデル生 URL・生ラベルの表示 / **dangerouslySetInnerHTML・router.push/window.open/target=_blank への
  モデル由来文字列の使用** / 凍結テスト本文変更 / SSoT 接触・破壊的 SQL・force push /
  §4-5 allowlist 外の変更。

## 6. 未解決の問い

- なし(語彙 v2(/today フィルタ等)と Codex 並走(AGENTS.md・読取専用)は後続トピック —
  next-actions に記録)。
