---
name: add-migration
description: db/migrations/ に番号付きの Neon マイグレーション(up/down)を追加し、Neon ブランチ上で検証する。スキーマ変更が必要なときに使う。
---

# add-migration

## 手順
1. 詳細設計(docs/design/detail/)の DDL を確認する。
2. db/migrations/ に連番ファイルを作成する(up と down、冪等を意識)。
3. Neon の**ブランチ**で検証する(create_branch → run_sql → prepare_database_migration)。
   本番適用(complete_database_migration)は**しない**(ask)。
4. pgvector 列は `vector(<EMBEDDING_DIM>)`、近傍 + メタフィルタのインデックスを含める。

## 禁止
- 生 DROP / TRUNCATE / DELETE。本番ブランチへの破壊的操作。

詳細は @.claude/rules/db.md。
