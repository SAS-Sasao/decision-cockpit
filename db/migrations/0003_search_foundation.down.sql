-- 0003_search_foundation.down.sql(設計明示 + 人間承認対象 — 0001/0002 と同方式。データ行は消さない)
DROP INDEX IF EXISTS timeline_records_embedding_hnsw_idx;
ALTER TABLE timeline_records DROP COLUMN IF EXISTS embedded_at;
ALTER TABLE timeline_records DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE timeline_records DROP COLUMN IF EXISTS embedding;
