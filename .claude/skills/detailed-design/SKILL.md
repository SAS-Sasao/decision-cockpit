---
name: detailed-design
description: トピックの詳細設計書を docs/design/detail/<topic>.md に作成する(主セッションで執筆)。スキーマ DDL・関数 IF・テスト観点・受け入れ条件を含む。実装直前の詳細化に使う。
---

# detailed-design

**設計は主セッションで執筆する。critic には書かせない。** 対象トピックの基本設計が PASS 済みであること。

## 出力: docs/design/detail/<topic>.md
必須セクション:
1. スキーマ DDL(テーブル / 列 / 型 / インデックス、pgvector 次元、冪等キー)
2. 関数 / API インターフェース(入力・出力・エラー)
3. テスト観点(ユニット / 契約、fixture 方針、実ネットワーク禁止)
4. **受け入れ条件(機械判定)** — コマンド / 件数 / exit code で記述。
5. 実装の分割(/goal 単位)と禁止事項

## 次の手順
作成後 `/design-review <topic>` → PASS で `/goal`。詳細は @.claude/rules/design.md。
