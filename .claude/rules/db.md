# DB(Neon + pgvector)

- スキーマ変更は **db/migrations/ の番号付きマイグレーション**で管理。手書き ad-hoc 変更は禁止。
- 検証は Neon の**ブランチ**上で行う(create_branch → run_sql → prepare_database_migration)。本番適用(complete_database_migration)は **ask**。
- 埋め込み列は pgvector の `vector(<EMBEDDING_DIM>)`。次元は埋め込みモデルに合わせ env で固定。
- 近傍検索インデックス(HNSW / IVFFlat)+ メタフィルタ用の通常インデックスを用意。
- **生の DROP / TRUNCATE / DELETE は禁止**(deny / hook で遮断)。削除が必要なら設計とマイグレーションで明示し、人間が承認。
- **ローカル DB ボリューム(`cockpit-db-data`)の破棄は禁止**(2026-07-20 の全データ消失事故を受けて追加・guard-bash.sh で遮断):
  - `docker compose down -v` / `--volumes` / `docker volume rm` / `docker volume prune` / `docker system prune` は**すべて禁止**。
  - コンテナだけ落とすときは `docker compose stop`(推奨)か `-v` を付けない `docker compose down` を使う。
  - **理由**: timeline_records / board_items は SSoT から再同期できるが、**`capture_inbox`(UI で入力したメモ・課題・壁打ち結論)は SSoT に無く復元不能**。
  - **どうしても DB を初期化する必要がある場合**は、(1) 人間に理由と影響(capture_inbox の消失)を伝えて承認を得る (2) `capture_inbox` を事前に
    エクスポート(`\copy` 等)する (3) 実行後は必ず **docs/setup/db-recovery.md の復旧手順を最後まで完了させる**(スキーマ再適用 → 再同期 →
    タグ修復 → 再埋め込み → admin 付与)。**復旧を完了させずに作業を終えない。**
