# 基本設計: spar-overlay(壁打ちスライドオーバー共通化 — トップバーボタン活性化)

> 対象: screen-design §5「共通: 壁打ちスライドオーバー」/ §7.1「壁打ちスライドオーバー = M4(全画面共通化は UI シェル対応時)」行の消化。
> 根拠資料: MoC(docs/design/ui/moc/decision-cockpit.dc.html の SPAR SLIDE-OVER ブロック — **実地抽出(2026-07-19)**:
> 既定 `sparOpen: false`・トップバー「壁打ち」= toggle・背景ディム `oklch(0.1 0.01 255 / 0.55)` 全面(クリックで閉)・
> パネル = `position:fixed; right:0; width:420px; z-index:41`・border-left = accent-spar 35%・`ckfade 0.25s`・構成は SC-06 壁打ちと同一)/
> capture-spar 詳細(M4 実装済み資産: spar-panel.tsx・/api/spar)/ 実地偵察: **layout.tsx の `disabled` は壁打ちボタンの1箇所のみ**(否定 grep 可能)。
> 経緯: capture-spar 設計では layout 凍結を優先して据え置き(問い#4)→ M4 完了後にユーザーが共通化を選択(2026-07-19)。
> ステータス: draft(design-review 待ち)
> 作成: 2026-07-19(主セッション執筆・md-render 前例の軽量1枚形式 — 実行形条件まで本書に含め詳細設計は省略)

## 1. 目的 / スコープ

### やる
1. **`app/(shell)/spar-overlay.tsx`(新設・`"use client"`)**: トップバーの「壁打ち」ボタン(活性)+ スライドオーバー(背景ディム全面クリックで閉・右 420px パネル・✕ ボタン・ckfade)を1つの client component に閉じる。パネルの中身は **既存 `SparPanel`(app/(shell)/capture/spar-panel.tsx)をそのまま import して再利用**(壁打ちロジックの二重実装禁止)。
2. **layout.tsx の disabled ボタンを `<SparOverlay />` に置換**(凍結例外 — 変更は該当ボタン部のみ。requireUser / NAV / inbox バッジ / getLastSync / signOutAction は不変)。
3. 被変更側注記(実装後・主セッション): ui-shell 詳細(layout 行の「壁打ちボタン disabled」+ capture 行の「disabled のまま」)/ screen-design(§7.1 行・§7.2-6 の「据え置き」)を **spar-overlay で活性化済み**に読み替え更新(各注記に `spar-overlay` リテラル)。

### やらない
- **会話の永続・画面間共有**: overlay を閉じたら会話は破棄(unmount — inline パネルと同じ非永続思想)。/capture の inline パネルとも状態独立。
- **/capture の inline パネル撤去**(MoC も両方持つ。overlay と二重に開ける状態は受容 — 状態独立・実害なし)。
- spar-panel.tsx・/api/spar・lib/spar・認可モデルの変更(**M4 成果物は1文字も変えない**)。
- Esc キー・フォーカストラップ等のアクセシビリティ強化(実装裁量 — 機械判定に含めない)。

## 2. アーキテクチャ上の位置づけ

- **App 層のみ**。データ契約・API・DB 変更なし(/api/spar は既存のまま)。認証は shell layout の requireUser 内側 — overlay からの fetch は既存の二層認証(M4-FIX 済み proxy + handler getUser)をそのまま通る。
- **凍結例外 = app/(shell)/layout.tsx のみ**。spar-panel.tsx は無変更 diff をピン(capture-spar §4-5b の test -f / "use client" / `外部 API` / `spar_conclusion` ピンが全て生存 — M4 受け入れ条件の読み替え不要)。
- ui-shell 詳細 §2.5 の layout 行(「壁打ちボタン disabled」)は本設計で仕様が更新される — 注記で読み替え(§1-3)。

## 3. インターフェース概要

| 部品 | 契約 |
|---|---|
| `app/(shell)/spar-overlay.tsx`(client) | props なし。`const [open, setOpen] = useState(false)`。ボタン = 現行トークン(`--accent-spar` 縁取り・opacity 1・cursor pointer・disabled/title 撤去)。open 時: 背景ディム(`position: fixed; inset: 0`・クリックで閉・トークン系半透明)+ パネル(`position: fixed; right: 0; top: 0; bottom: 0; width: 420`・`--panel` 系背景・border-left は accent-spar の color-mix・`ckfade` 再利用)+ ヘッダ(タイトル + ✕)+ `<SparPanel />`。閉 = unmount(会話破棄) |
| `app/(shell)/layout.tsx` | disabled ボタン(title="M4 で実装予定" 含む)を削除し `<SparOverlay />` に置換。**他の行は変更しない** |
| spar-panel.tsx | **無変更**(import されるだけ) |

- SparPanel は現状 client component で props なし・自己完結(fetch/保存/告知文言込み)— overlay 内でそのまま動く(实地確認: "use client"・useState のみ・useRouter 使用は layout 配下でも可)。

## 4. リスク・トレードオフ

1. **二重パネル(/capture)**: inline + overlay が同時に開ける — 状態独立で実害なし(受容)。統合は実利用の不満が出てから。
2. **layout 凍結の解除**: 変更をボタン置換1点に限定し、無変更部は §5-1 の grep ピン(requireUser / getLastSync / signOutAction 生存)で防御。
3. **z-index**: 既存 UI に fixed 要素なし(サイドバー/トップバーは static)— 前面固定で干渉なし。
4. UI コンポーネントの単体テストは既存規範に無い(RTL 依存なし・新規依存禁止)— 機械判定は grep ピン + build + 実機・視覚は手動確認(既存 UI goal と同水準)。

## 5. 受け入れ条件(機械判定)

1. **overlay・layout**(集計型):
   ```bash
   fail=0
   test -f "app/(shell)/spar-overlay.tsx" || fail=1
   grep -Fq '"use client"' "app/(shell)/spar-overlay.tsx" || fail=1
   grep -Fq 'SparPanel' "app/(shell)/spar-overlay.tsx" || fail=1
   grep -Fq 'SparOverlay' "app/(shell)/layout.tsx" || fail=1
   grep -RIn 'disabled' "app/(shell)/layout.tsx"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn 'M4 で実装予定' "app/(shell)/layout.tsx"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -Fq 'requireUser' "app/(shell)/layout.tsx" || fail=1
   grep -Fq 'getLastSync' "app/(shell)/layout.tsx" || fail=1
   grep -Fq 'signOutAction' "app/(shell)/layout.tsx" || fail=1
   grep -RIn -E "lib/db|lib/ingestion" "app/(shell)/spar-overlay.tsx"; s=$?; [ "$s" -ne 1 ] && fail=1
   grep -RIn 'dangerouslySetInnerHTML' "app/(shell)/spar-overlay.tsx"; s=$?; [ "$s" -ne 1 ] && fail=1
   exit "$fail"
   ```
2. **M4 資産の不変**: `git diff --exit-code main -- "app/(shell)/capture" app/api lib/spar lib/data proxy.ts tests` exit 0(**spar-panel.tsx 含む capture 配下・API・データ層・proxy・既存テストは1文字も変えない** — 変更ファイルは spar-overlay.tsx(新規)+ layout.tsx + docs のみ)。
3. **回帰**: `env -u DATABASE_URL -u EMBEDDING_API_KEY -u EMBEDDING_SOURCE -u SPAR_API_KEY -u SPAR_PROVIDER -u SPAR_MODEL npm test` exit 0(37 files / 348 tests — 新テストなし)+ `npm run build` exit 0(ダミー env・.env 非接触)+ app 復帰 /login 200。
4. **実機(curl -L なし)**: 未認証 GET /capture = 307・未認証 POST /api/spar = 307・未認証 GET / = 307(layout 変更後も保護不変)。
5. **注記**: `grep -q "spar-overlay" docs/design/detail/ui-shell.md` / 同 `docs/design/ui/screen-design.md` 各 exit 0(§1-3 の読み替え更新)。
6. **新規依存なし**: `git diff --exit-code main -- package.json package-lock.json` exit 0。

**手動確認**(機械判定外): 任意の画面でトップバー「壁打ち」→ 右 420px パネルが開き実応答 → 背景クリック / ✕ で閉じる → 再度開くと会話が初期化されている(非永続)→ /capture の inline パネルと独立。

## 6. 未解決の問い

1. Esc キーで閉じる(v1 実装裁量 — 入れても機械判定外)。
2. overlay を開いたまま画面遷移した場合の挙動(client component は layout 配下なので遷移で生存し得る — v1 は成り行き・不満が出たら遷移時クローズを検討)。
3. /capture の inline パネル撤去・overlay への一本化(実利用後)。

## 実装の分割と禁止事項

- **/goal SPAR-OV(1 goal)**: executor = frontend-engineer・**ターン上限 10**・節目 commit 1回(実装 + 条件1〜4・6 緑)。注記(条件5)は主セッション。
- 禁止: spar-panel.tsx・capture 配下・/api/spar・lib/・proxy.ts・既存テスト・package.json・.env(退避含む)・globals.css・.claude/ の変更。新規依存禁止。dangerouslySetInnerHTML / lib/db・lib/ingestion の文言(コメント含む)を overlay に書かない。実 API キー不使用。bash で SSoT repo 名と `>` を同時に含めない。

## 次の手順

`/design-review spar-overlay` → 全レンズ PASS → `/goal SPAR-OV`。
