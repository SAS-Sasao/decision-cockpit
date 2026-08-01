# 基本設計: today-summary-sync(/today サマリーチップのレーン追随)

- 起点: 2026-07-26 ユーザー報告「/today の今日セクション(サマリーチップ)がカード移動しても変わらない」
  (docs/setup/next-actions.md 再開手順 0)。**軽量1枚設計**(表示専用の変更 — TCS-1 と同じ流れ)。

## 1. 目的 / スコープ

### 問題

チップ「オープン」「着手中」は `getTodayData().summary.open/doing` = **board_items の生 state の件数**を
表示している(lib/data/today.ts:189-)。一方、盤面は `applyBoardOverrides` 適用後の columns +
capture レーンを描画する(TBI-1 / WL-1)。結果、**カードを動かしてもレーンは変わるのに数字が不変**
(オーバーレイ移動も capture カードも数字に反映されない)。

### やる

1. **純関数 `laneCounts` を lib/data/today.ts に追加**(ユニットテスト対象):
   ```ts
   export function laneCounts(
     columns: { state: "todo" | "doing" | "done"; items: unknown[] }[],
     captureLanes: Record<"todo" | "doing" | "done", unknown[]>
   ): { todo: number; doing: number; done: number }
   // 各レーンの件数 = columns(合成後)の items 数 + captureLanes の件数。
   // 盤面に見えているカード数と定義上一致する(要素の中身は数えるだけ — unknown[] で受ける)。
   // columns に該当レーンが無い場合 = captureLanes のみの件数(テスト観点に含める — data R1)。
   // **レーン件数の正典 = laneCounts**。board.tsx:299 のレーンバッジは同型式の表示実装で、
   // 乖離が生じた場合は laneCounts 側に合わせる(board.tsx は server-only を import できないため
   // 共有はしない — arch/data R1 の問いへの決着)。
   ```
2. page.tsx: チップ「オープン」= `laneCounts(...).todo` / 「着手中」= `.doing` に置換
   (**合成後 columns と表示中の captureLanes を渡す** — 盤面と同じ入力。capture done の表示上限
   slice(8) 適用後を渡すため、done を数える場合も盤面と一致するが、今回のチップは todo/doing のみ)。
3. チップ下の注記文を実態に合わせて更新: 「『オープン』『着手中』は**盤面のカード数**
   (WBS の実効状態 + capture)です。」
4. 「手戻り率(今週)」「平均スコア(今週)」は**不変**(週次メトリクス — 本件と無関係)。

### やらない

- getTodayData の summary 契約の変更(open/doing フィールドは残す — 既存テストの凍結面。
  チップ側が読むのをやめるだけ)。
- レーン内訳の表示追加・done チップの新設・DB/スキーマ/データ層クエリの変更。

## 2. アーキテクチャ上の位置づけ

App 層のみ(表示の整合)。データ層クエリ・オーバーレイ機構(WL-1)・capture 契約に非接触。

## 3. リスク・トレードオフ

| リスク | 手当て |
|---|---|
| 「数字の意味」が変わる(WBS 生件数 → 盤面件数) | 注記文の同時更新で明示(§1-3)。盤面と数字の一致はユーザー報告の要求そのもの |
| 既存 today-data テストとの衝突 | summary 契約は不変(§やらない)。laneCounts は追記のみ |

## 4. 受け入れ条件(機械判定)

判定方式 = stdout 数値比較(FC-1 以降と同運用)。凍結基準 = goal 分岐点 main。

```bash
# 1. 純関数とテスト
grep -q "export function laneCounts" lib/data/today.ts
grep -q "laneCounts" tests/today-data.test.ts          # ユニット(合成後件数・capture 合算・空・欠落レーン)
grep -q "capture 合算" tests/today-data.test.ts        # ケース名ピン(存在だけでなく観点を固定)
# 2. チップが生 summary を読まない(オープン/着手中の2チップのみ対象)
! grep -q "data.summary.open" "app/(shell)/today/page.tsx"
! grep -q "data.summary.doing" "app/(shell)/today/page.tsx"
grep -q "laneCounts" "app/(shell)/today/page.tsx"
# 3. 注記文の更新
grep -q "盤面のカード数" "app/(shell)/today/page.tsx"
# 4. テスト(ホスト・504 + 追加分・削除行 0)/ tsc / docker dummy build / e2e 6画面 green
# 5. 閉包: lib/data/today.ts / app/(shell)/today/page.tsx / tests/today-data.test.ts /
#    docs/design/basic/today-summary-sync.md / docs/design/reviews/today-summary-sync.md /
#    docs/setup/next-actions.md
```

手動チェック(判定対象外・goal 報告): カードを移動するとチップの数字が即時(refresh 後)に増減する。

## 5. 実装の分割と禁止事項

- **/goal TSS-1**(1本・主セッション・ターン上限 6・判定 = acceptance-judge)。
- 禁止: .env 非接触 / データ層クエリ・スキーマ変更 / summary 契約の変更 / 凍結テスト本文変更 /
  §4-5 allowlist 外の変更 / 元 repo(SSoT)への接触・破壊的 SQL・force push(グローバル禁止の再掲 —
  goals.md テンプレ準拠。sec R1)。

## 6. 未解決の問い

- なし。
