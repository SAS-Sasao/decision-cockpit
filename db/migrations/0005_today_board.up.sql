-- 対象設計: docs/design/detail/today-view.md §1(design-review PASS 後に適用)
CREATE TABLE IF NOT EXISTS board_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  file_path    text NOT NULL,
  item_key     text NOT NULL,               -- WBS ID(冪等キーの一部)
  commit       text NOT NULL,               -- 世代識別子(基本設計 §1-2)
  title        text NOT NULL,
  assignee     text,
  period       text,
  deliverable  text,
  iter         text,
  pri          text,
  task_type    text,
  issue_ref    text,
  state        text NOT NULL CHECK (state IN ('todo','doing','done')),
  org          text,
  section      text,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, file_path, item_key)
);
CREATE INDEX IF NOT EXISTS board_items_state_idx ON board_items (state);
CREATE INDEX IF NOT EXISTS board_items_org_idx ON board_items (org);
CREATE INDEX IF NOT EXISTS board_items_file_synced_idx ON board_items (file_path, synced_at);
