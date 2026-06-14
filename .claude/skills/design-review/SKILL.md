---
name: design-review
description: 対象設計書を arch/data/sec の3 critic に並行委譲し、PASS/FAIL とギャップを集約して docs/design/reviews/ に出力する。全レンズ PASS で合格。設計の実装に進む前のゲート。
---

# design-review

対象設計書(docs/design/basic/ or detail/)を3レンズの critic に**並行委譲**する。critic は読み取り専用で設計を書かない。

## 手順
1. 対象設計書のパスを特定する。
2. 3 critic に委譲し、各レンズの PASS/FAIL + ギャップを要約で受け取る:
   - design-arch-reviewer(アーキ整合)
   - design-data-reviewer(データ / SSoT 整合)
   - design-sec-reviewer(セキュリティ / プライバシー)
3. 集約して docs/design/reviews/<topic>.md に出力する(各レンズの判定・根拠・ギャップ)。

## 合格条件
- **全レンズ PASS で合格。** 1つでも FAIL なら、ギャップを設計者(主セッション)が設計書に反映し再レビュー。
- 「受け入れ条件(機械判定)」セクションの有無も必ず確認する。詳細は @.claude/rules/design.md。
