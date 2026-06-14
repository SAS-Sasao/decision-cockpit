---
name: verify-acceptance
description: 現在の /goal または対象設計の受け入れ条件(機械判定)を独立に検証し、PASS/FAIL とギャップを集約する。実装が条件を満たすか確認したいときに使う。
---

# verify-acceptance

## 手順
1. 対象の受け入れ条件(設計書 or /goal)を読む。
2. **acceptance-judge サブエージェントに独立検証を委譲する**(コード編集なし)。
3. 機械判定: build / typecheck / test の exit code、ファイル存在、件数、frontmatter、禁止事項違反の grep。
4. 結果を集約する: 条件ごとの PASS/FAIL + 根拠、全体判定、FAIL ギャップ。

## 注意
- 判定役は修正しない。修正は executor へ回す(作業役と判定役の分離)。

詳細は @.claude/rules/goals.md / @.claude/rules/testing.md。
