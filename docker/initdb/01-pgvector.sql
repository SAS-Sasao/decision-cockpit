-- ローカル開発 DB の初期化(docker compose 初回起動時に一度だけ実行される)。
-- Neon と同等の状態に揃えるため pgvector 拡張を有効化する。
CREATE EXTENSION IF NOT EXISTS vector;
