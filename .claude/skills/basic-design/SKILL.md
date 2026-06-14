---
name: basic-design
description: トピックの基本設計書を docs/design/basic/<topic>.md に作成する(主セッションで執筆)。必須セクションに「受け入れ条件(機械判定)」を含む。新機能の設計を始めるときに使う。
---

# basic-design

**設計は主セッション(human-in-loop)で執筆する。critic には書かせない。**

## 出力: docs/design/basic/<topic>.md
必須セクション:
1. 目的 / スコープ(やる・やらない)
2. アーキテクチャ上の位置づけ(3層のどこか・SSoT との関係)
3. データ / インターフェース概要
4. リスク・トレードオフ(必要なら research-spike に調査を委譲し、要約を引用)
5. **受け入れ条件(機械判定)** — 状態 / 数値 / コマンドで記述。後続 `/goal` に直結させる。
6. 未解決の問い

## 次の手順
作成後 `/design-review <topic>` へ。詳細は @.claude/rules/design.md。
