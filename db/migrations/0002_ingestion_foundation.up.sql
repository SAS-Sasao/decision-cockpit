-- 0002_ingestion_foundation.up.sql
-- 対象設計: docs/design/detail/ingestion-foundation.md §1(design-review 全レンズ PASS)

CREATE TABLE IF NOT EXISTS timeline_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  file_path    text NOT NULL,
  item_key     text NOT NULL DEFAULT '',   -- 複数レコードファイル内の識別子(単一レコードは '')
  commit       text NOT NULL,              -- 最終処理コミット(鮮度・stale 判別)
  type         text NOT NULL CHECK (type IN ('task','quality','score','session','conversation','decision','daily_log')),
  occurred_at  timestamptz,                -- status='ok' ではパーサ契約上必須。error は NULL 可
  org          text,
  topic        text,
  tags         text[] NOT NULL DEFAULT '{}',
  title        text,
  body         text,
  raw_ref      text NOT NULL,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
  reward_score double precision,
  signals      jsonb,                      -- 4シグナル bool×4(task-log のみ・他は NULL)
  completeness double precision,           -- judge 3軸(0-1 正規化済み)
  accuracy     double precision,
  clarity      double precision,
  quality_gate_result text,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, file_path, item_key)
);

-- メタフィルタ用(db.md: 近傍検索は M2、通常インデックスを先行)
CREATE INDEX IF NOT EXISTS timeline_records_occurred_at_idx ON timeline_records (occurred_at);
CREATE INDEX IF NOT EXISTS timeline_records_type_idx        ON timeline_records (type);
CREATE INDEX IF NOT EXISTS timeline_records_org_idx         ON timeline_records (org);
CREATE INDEX IF NOT EXISTS timeline_records_tags_idx        ON timeline_records USING gin (tags);

CREATE TABLE IF NOT EXISTS sync_state (
  repo           text PRIMARY KEY,
  last_commit    text,
  last_synced_at timestamptz,
  last_summary   jsonb,                    -- { ok, error, skipped, deleted, fetch_failed, hasMore, sourceKind }
  progress       jsonb                     -- 進行カーソル: { head, done: [path...] } / 完了時 NULL(done は denylist 通過後の相対パスのみ)
);

CREATE TABLE IF NOT EXISTS tag_synonyms (
  synonym   text PRIMARY KEY,
  canonical text NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_aggregates (
  period text NOT NULL,
  metric text NOT NULL,
  org    text NOT NULL DEFAULT '',
  value  double precision,
  PRIMARY KEY (period, metric, org)
);
