# Codex 並走(読取専用セカンドオピニオン)

正典 = docs/design/basic/codex-ops.md + docs/design/basic/codex-spar.md(いずれも3レンズ PASS)。
v1 = 読取専用。起動経路は2つ(端末レビュー / 壁打ち Codex モード)。

## 使う場面 / 使わない場面

- 使う: (a) 設計書のセカンドオピニオン(3レンズ critic の**補完 — 代替ではない**)
  (b) マージ前 PR / diff の別視点レビュー (c) バグの仮説出し。
- 使わない: 実装・コミット・SSoT / 秘密に触れる調査・**judge の代替**
  (判定役は acceptance-judge のまま — 黄金ルール4 不変)。

## 起動

- **起動は次の2つのみ**(いずれもクリーンコピー隔離 — git archive HEAD 展開 = 追跡ファイルのみ):
  (1) `scripts/codex/review.sh`(端末レビュー) (2) `npm run codex:serve`(壁打ち Codex モードの
  dev ランナー — codex-spar)。直接 `codex` を repo で起動しない。
- **Claude Code セッション内からの起動は guard-bash.sh が機械遮断**(deny は実行コマンドの
  先頭トークンのみに一致 — 引数・パス中の文字列には一致させない)。**人間の端末が正規経路**。
  **Claude セッションから 127.0.0.1:8788(ランナー)を HTTP で叩くことも禁止**(規律 —
  ランナーの Origin 必須検証が素の curl を 403 にする)。
- **レビュー対象はコミット済み内容のみ**(archive = HEAD の帰結 — **UI 経路(壁打ち Codex モード)も
  同様**で、未コミットの作業中コードは見えない)。未コミット diff・秘密の**プロンプト手貼り・
  質問文貼りは禁止**(隔離の迂回になる)。
- **Codex 応答を「結論として保存」(spar_conclusion)に乗せない**(capture_inbox → organize-loop →
  SSoT 書き戻しへの合流を遮断 — パネルは構造的に除外済み。手動コピペでも行わない)。
- `git status` 表示による事後検知の範囲は本 repo のみ(SSoT clone・DB への逸脱は映らない)。

## 結果の扱い

- Codex の指摘は**参考意見**。採用する指摘は Claude Code の通常フロー(設計改訂 or main から切る
  fix ブランチ)に乗せる。Codex の提案をターミナルへ**手でコピペ実行しない**(統治の迂回)。

## 保守の責務

- **契約ファイル(CLAUDE.md / .claude/rules/)を改定する goal は、閉包に AGENTS.md の追随確認を含める**
  (二重管理ドリフトの防止)。
- **review.sh を改定する場合は初回受け入れ検査 (a)(b) を再実施**(docs/setup/codex-setup.md —
  隔離ステップの静かな除去の防止)。
- 編集権限の付与(専用ブランチでの小修正)は **codex-ops v2 として別設計**(**3レンズ**再通過)。
