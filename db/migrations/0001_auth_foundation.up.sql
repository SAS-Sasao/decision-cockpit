-- 0001_auth_foundation.up.sql
-- 対象設計: docs/design/detail/auth-foundation.md §1.2(design-review 全レンズ PASS)
-- pgvector: M0 では拡張の有効化のみ。vector(<EMBEDDING_DIM>) 列は M1+ で
-- 埋め込みモデル確定後に env の EMBEDDING_DIM を用いて作成する(本 DDL に vector 列はない)。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS roles (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id text NOT NULL,                      -- Neon Auth の user id(FK は張らない: 基本設計 §3.1)
  role_id int  NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       int NOT NULL REFERENCES roles(id),
  permission_id int NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS capture_inbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('status','issue','next_move','spar_conclusion')),
  topic        text,
  tags         text[] NOT NULL DEFAULT '{}',
  body         text NOT NULL,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,                   -- NULL = 未処理(capture 契約)
  curated_ref  text
);

-- M5 の「processed_at IS NULL のみ走査」向け partial index(基本設計 問い#6 の決着。
-- M5 は全ユーザー一括・created_at 順の消費を前提。per-user 消費に変更する場合は M5 設計で再検討)
CREATE INDEX IF NOT EXISTS capture_inbox_unprocessed_idx
  ON capture_inbox (created_at) WHERE processed_at IS NULL;
-- 個人別一覧(M4)向け
CREATE INDEX IF NOT EXISTS capture_inbox_user_created_idx
  ON capture_inbox (user_id, created_at DESC);

-- seed(基本設計 §1-2: up 内・冪等)
INSERT INTO roles (name, description) VALUES
  ('admin',  '管理者: ユーザー/ロール管理が可能'),
  ('member', '一般: 共有データ閲覧と自分のキャプチャ入力')
ON CONFLICT (name) DO NOTHING;
