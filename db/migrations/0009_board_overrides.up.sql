-- 対象設計: docs/design/detail/wbs-loop.md §1(design-review PASS 後に適用)
-- /today の WBS カード移動のオーバーレイ(cockpit ローカルの差分 — SSoT 不変)。
CREATE TABLE IF NOT EXISTS board_overrides (
  source     text NOT NULL CHECK (source = 'cc-sier-organization'),
  file_path  text NOT NULL
    CHECK (file_path ~ '^\.companies/[^/]+/docs/secretary/[^/]+-wbs\.md$')
    CHECK (position('..' in file_path) = 0),
  item_key   text NOT NULL CHECK (item_key <> ''),
  desired_state text NOT NULL CHECK (desired_state IN ('todo','doing','done')),
  base_state    text NOT NULL CHECK (base_state    IN ('todo','doing','done')),
  CONSTRAINT board_overrides_not_noop CHECK (base_state <> desired_state),
  user_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  pr_ref     text,
  resolved_at timestamptz,
  resolution text CHECK (resolution IN ('applied','superseded')),
  PRIMARY KEY (source, file_path, item_key)
);
CREATE INDEX IF NOT EXISTS board_overrides_active_idx
  ON board_overrides (source, file_path) WHERE resolved_at IS NULL;
