-- 対象設計: docs/design/detail/search-foundation.md §1(design-review PASS 後に適用)
-- 埋め込み列: 次元は EMBEDDING_DIM=1536(text-embedding-3-small ネイティブ / gemini 切替時も 1536 固定)
ALTER TABLE timeline_records ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE timeline_records ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE timeline_records ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- HNSW(cosine)。m / ef_construction は pgvector 既定(16 / 64)— WITH 句なし(research §2)
CREATE INDEX IF NOT EXISTS timeline_records_embedding_hnsw_idx
  ON timeline_records USING hnsw (embedding vector_cosine_ops);
