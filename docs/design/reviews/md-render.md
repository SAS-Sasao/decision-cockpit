# design-review: md-render(Markdown 表示部品 — 判断ログ本文の可読化)

対象: docs/design/basic/md-render.md(基本+詳細兼用 — スコープ極小のための意図的判断・全レンズが妥当と判定)

## Round 1 — 2026-07-17

| レンズ | 判定 | 核心 |
|---|---|---|
| arch | **PASS(条件付き)** | 3層責務・凍結体系・FROZEN_TESTS 22本一致・/goal 実行可能性を現物照合で確認。Med 1(**components/nav-link.tsx が凍結の穴** — components/charts に絞った結果)+ Low 2(line-chart 存置 grep の継承脱落 / M1 条件8 再実行の脱落) |
| data | **FAIL** | **stripInline 契約(インラインのみ)と §1-3 の効果主張(`#` 除去)が矛盾** — 実データの excerpt 汚染の主犯は行頭 H1(decision body は `# …` で始まることを parsers/fixture で裏取り)であり、宣言どおり実装すると発端のユーザー不満が解消されない。テスト未被覆(引用・水平線・fail-soft 肯定・Inline トークン生成)・切断入力の全域性未宣言。FROZEN_TESTS 編入は正確と確認 |
| sec | **PASS(条件付き)** | XSS 封鎖(raw HTML 型なし + React エスケープ + allowlist)は構造的に十分。Med 1(**isSafeHref の配線が presence-grep のみ** — 描画分岐に使われることの検証がない)+ Low 2(拒否ケース列挙・クリッカブル化の受容判断未記載) |

**総合: FAIL(data)** → rev.2 で決着:
1. **stripMarkdown に改名・契約拡張**(行頭ブロック記号 + インライン装飾の両方を除去)+ 切断入力の全域性を契約・テストに追加。
2. テスト拡充(引用・水平線・Inline トークン生成・fail-soft 肯定・行頭記号除去)。
3. **コンポーネント出力の要素木検査**を新設(Markdown を関数として直接呼び React 要素木を walk — javascript: で `<a>` 不在・https で `<a>` + rel 存在。jsdom 不要)— isSafeHref 配線の実効検証。
4. isSafeHref セマンティクス明文化(trim → 小文字化 → http(s) 前方一致)+ 拒否5ケース列挙 / クリッカブル化の受容判断明記 / nav-link.tsx 凍結追加 / line-chart 存置 grep・M1 条件8 再実行の復元 / Markdown props null 許容。

## Round 2 — 2026-07-17(rev.2 を再レビュー)

| レンズ | 判定 | 要点 |
|---|---|---|
| arch | **PASS** | 決着3件の実体確認・可変4ファイルと凍結列挙の非交差 + 既存ファイル被覆漏れなしを全列挙突合で確認。新規 Low 2(成果物外の新規ファイル作成が検出されない / §7.4-3 参照の文書名) |
| data | **PASS** | 契約矛盾の解消を4箇所の一貫性 + 実データフロー(H1 汚染源・120字切詰めの順序)で確認。新規 Low 1(`1.` 形式・フェンス行・切断リンクのテスト列挙) |
| sec | **PASS** | 要素木検査の**否定+肯定 assert のペア構成**が空虚な PASS を排除する自己修復的検証と評価。allowlist の fail-closed 性(タブ挿入・Unicode 迂回も前方一致失敗 → 拒否)を確認。Info 2(walk の再帰範囲 / target 非 assert) |

**総合: PASS(全レンズ)** — R2 の Low/Info は rev.3 で吸収:
テスト列挙に `1.` 形式・フェンス行・切断リンクを明記 / 要素木 assert に target="_blank" 追加 + walk の関数型要素再帰を明記 / 成果物4ファイル以外の新規ファイル作成禁止を §5 に追加 / §7.4-3 参照に文書名明示。

### /goal への申し送り(Info・非ブロッキング)

1. 対応外記法は段落素通し(fail-soft)— 誤描画を見つけたら拡張トピックで(§6-2)。
2. SC-02 の excerpt への stripMarkdown 適用は次に SC-02 を触る goal で(§6-1)。
