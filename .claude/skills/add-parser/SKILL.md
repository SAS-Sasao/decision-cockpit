---
name: add-parser
description: SSoT の Markdown を正規化レコードに変換するパーサを追加し、冪等 upsert と fixture テストを用意する。新しい MD 形式の取り込みが必要なときに使う。
---

# add-parser

## 手順
1. 対象 MD の frontmatter / 本文構造を確認する(機微ファイルは対象外)。
2. パーサを実装する: 出力 = (source, file_path, commit, date, tags, title, body, …)。
3. **冪等 upsert キー = (source, file_path, commit)** で保存する経路に接続する。
4. fixtures/ の**匿名サンプル**でユニットテストを追加する(実ネットワーク禁止)。

## 禁止
- 元 repo の clone / 書き込み。実データの fixture 化。機微データの索引。

詳細は @.claude/rules/ingestion.md。
