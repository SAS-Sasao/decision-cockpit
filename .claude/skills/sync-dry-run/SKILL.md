---
name: sync-dry-run
description: GitHub からの SSoT 取り込みを書き込みなし(dry-run)で試行し、取得/差分/想定 upsert 件数を報告する。同期ロジックを安全に確認したいときに使う。
---

# sync-dry-run

## 手順
1. GitHub API(読み取り専用)で対象 repo の MD 一覧/最新 commit を取得する。
2. パーサを通して正規化レコードを生成する(**DB へは書き込まない**)。
3. 既存索引と突き合わせ、**新規 / 更新 / 不変**の想定件数を算出する(冪等キーで判定)。
4. 機微ファイルが除外されているか確認する。

## 出力
- 取得件数 / 想定 upsert(新規・更新)/ skip(機微・error)件数。実書き込みはしない。

詳細は @.claude/rules/ingestion.md。
