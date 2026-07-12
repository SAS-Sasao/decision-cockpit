-- 0002_ingestion_foundation.down.sql(設計明示 + design-review + 人間承認済みの down 定義)
-- 本番(Neon main)への適用は人間承認必須。
DROP TABLE IF EXISTS metric_aggregates;
DROP TABLE IF EXISTS tag_synonyms;
DROP TABLE IF EXISTS sync_state;
DROP TABLE IF EXISTS timeline_records;
