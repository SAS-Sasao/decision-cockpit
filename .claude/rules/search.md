# 検索

- 埋め込みは**多言語対応モデルを1つに固定**し、モデル名/次元を env(`EMBEDDING_MODEL` / `EMBEDDING_DIM`)で管理。混在禁止。
- クエリ埋め込みとインデックス埋め込みは**同一モデル**で生成すること。
- 検索 = pgvector の近傍検索 + メタフィルタ(source / date 範囲 / tags)。
- 結果には必ず出典(source, file_path, date)を付与し、UI から元の SSoT を辿れるようにする。
