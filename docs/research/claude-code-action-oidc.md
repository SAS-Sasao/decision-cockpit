# 調査: claude-code-action の `id-token: write`(OIDC)は何を意味するか

- 実施: 2026-08-09(review-loop の本番初回実行が失敗したことを受けた緊急調査・research-spike)
- 契機: `Could not fetch an OIDC token. Did you remember to add 'id-token: write' to your
  workflow permissions?` で review job が失敗(run 31294550301)。

## 結論: **`id-token: write` を足してはいけない。`github_token` を明示指定する。**

`anthropics/claude-code-action` は `github_token` input が**未指定のときだけ** GitHub OIDC を要求し、
そのトークンを Anthropic の交換エンドポイント
(`https://api.anthropic.com/api/github/github-app-token-exchange`)へ送って
**GitHub App の installation token** を取得する(`src/github/token.ts` の `getOidcToken()` /
`exchangeForAppToken()`)。

- 交換で得られるトークンの既定権限は **`contents: write` / `pull_requests: write` /
  `issues: write`**(ソース内 `DEFAULT_PERMISSIONS` にハードコード・公式 docs も「常に含まれる」と明記)。
- **この権限は workflow の `permissions:` ブロックとは無関係**(`permissions:` が支配するのは
  自動 `GITHUB_TOKEN` のみ)。つまり `permissions: contents: read` にしていても、Claude 本体は
  write 可能なトークンを持つ。
- したがって `id-token: write` を足すと、review-loop 基本設計 §2 / §4 の中核不変量
  「**この CI は本 repo に書き込めない**」が崩れる。

**採った対処**: action に `github_token: ${{ secrets.GITHUB_TOKEN }}` を明示指定する。
`OVERRIDE_GITHUB_TOKEN` が真になり OIDC 交換は**一切呼ばれない**(`setupGitHubToken()` の早期 return)。
Claude が使う GitHub トークンは workflow 級 `contents: read` に支配される。
トレードオフ = GitHub App 前提の機能(`claude[bot]` の sticky comment 等)は使えないが、
本ループは PR もコメントも作らないため影響なし。

## 波及: daily-organize.yml(organize-loop)も同じ問題

`permissions: contents: read` のみで claude-code-action を使っているため、有効化すると
**同じエラーで generate job が失敗する**(fail-closed — publish は needs 連鎖で skip されるため
PR も mark も走らない = 可用性の問題でセキュリティ事象ではない)。

- 対処は同じく **`github_token` の明示指定**。ただし正典が別(organize-loop.md §2.5 / §4)なので
  **別 goal で改訂 + 3レンズ再通過**(review-loop の閉包 allowlist に daily-organize.yml は無く、
  閉包を守らせる goal の中で閉包を破るのは機構の自己無効化 — sec の判定)。
- **それまで `ENABLE_DAILY_ORGANIZE=true` にしない**(運用ゲート)。
- wbs-writeback.yml は claude-code-action を使わない(決定的スクリプトのみ)ため影響なし。

## 残る留意点

- `@v1` は**可変メジャータグ**(パッチリリースのたびに再ポイント)。SHA ピン留めは未採用
  (採用する場合は §4 の uses 完全一致 allowlist の同時改訂が必要)。
- 過去に「id-token 付与時に Claude セッションが `ACTIONS_ID_TOKEN_REQUEST_*` を継承し任意の OIDC を
  発行できる」不具合が報告されている(issue #1010・修正済みとされる)。本設計は id-token を
  付与しないため該当しない。
- 交換エンドポイントの実装は非公開のため、`additional_permissions` で read に絞れるかは
  一次情報で確認できず(docs は write 固定と読める)。

## 追記(2026-08-09・同日の第2の発見): `Write(path)` は無効な権限記法

OIDC を直した次の run で、Claude のレビュー自体は成功(25ターン・157秒・is_error:false)したのに
**`permission_denials_count: 2` で `out/review.md` が書けず** upload step が失敗した。

原因: **`Write(out/**)` は Claude Code が「受理するが照合に使わない」記法**
(公式 docs: "If you write a path rule for `Write`, `NotebookEdit`, `Glob` … Claude Code accepts the
rule but never consults it, and warns at startup. Use `Edit(docs/**)` in place of `Write(docs/**)`")。
→ **正しくは `Edit(out/**)`**(Edit ルールが Write / Edit / NotebookEdit を一括で覆う)。

- 本設計は `--allowedTools` の完全一致をピンしていたが、**ピンされていたパターン自体が無効記法**だった。
  「形は固定されているが意味は成立していない」典型で、OIDC の件と同じ「実行しないと分からない層」。
- **daily-organize.yml も `--allowedTools "Read,Write(out/**)"`** で同じ欠陥を持つ(organize-loop の
  設計 §4 もこの文字列をピンしている)。有効化前の改訂に**この修正も含めること**。
- 再混入を防ぐため、ci-review.yml には `Write(` の出現 = 0 の否定ピンを追加した。

## 再発防止(設計プロセスへの教訓)

受け入れ条件 §4 は **形(YAML の構造・文字列)しか見ておらず、実行可能性を一切検証していない**。
RL-2 は 16/16 PASS でマージされたが、本番で初めて「そもそも action が起動しない」ことが判明した。
**CI を伴う goal では「手動ゲートで実 run を1回通す」まで完了と見なさない**運用にする
(review-loop-setup.md §5 のゲートがまさにそれ — マージ後だが必須)。

主要出典: github.com/anthropics/claude-code-action の `src/github/token.ts` / `action.yml` /
`docs/{faq,security,configuration}.md` / `examples/pr-review-comprehensive.yml`。
