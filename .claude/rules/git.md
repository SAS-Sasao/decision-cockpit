# Git

- **1ゴール = 1ブランチ**。`main` への直接コミット/直 push はしない。
- 節目(設計 PASS・スキーマ確定・主要機能・テスト緑)ごとに小さく commit する。
- `git push --force` / `--force-with-lease` は**禁止**(deny)。`git push` は **ask**。
- コミットは目的が分かる粒度で。生成物(node_modules / .next / .env)の混入は禁止。
