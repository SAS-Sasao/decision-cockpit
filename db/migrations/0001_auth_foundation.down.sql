-- 0001_auth_foundation.down.sql
-- 対象設計: docs/design/detail/auth-foundation.md §1.3(設計明示 + design-review + 人間承認済みの down 定義)。
-- 本番(Neon main)への適用は人間承認必須。
DROP TABLE IF EXISTS capture_inbox;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS roles;
DROP EXTENSION IF EXISTS vector;   -- M0 時点では vector 列が存在しないため安全に削除可能
