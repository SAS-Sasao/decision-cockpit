# DB(Neon + pgvector)

- スキーマ変更は **db/migrations/ の番号付きマイグレーション**で管理。手書き ad-hoc 変更は禁止。
- 検証は Neon の**ブランチ**上で行う(create_branch → run_sql → prepare_database_migration)。本番適用(complete_database_migration)は **ask**。
- 埋め込み列は pgvector の `vector(<EMBEDDING_DIM>)`。次元は埋め込みモデルに合わせ env で固定。
- 近傍検索インデックス(HNSW / IVFFlat)+ メタフィルタ用の通常インデックスを用意。
- **生の DROP / TRUNCATE / DELETE は禁止**(deny / hook で遮断)。削除が必要なら設計とマイグレーションで明示し、人間が承認。
