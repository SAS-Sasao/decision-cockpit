// 対象設計: docs/design/detail/auth-foundation.md §3(tests/capture-contract.test.ts・任意)
// db/migrations/0001_auth_foundation.up.sql の静的文字列検査(DB 不要)。
// capture 契約(.claude/rules/capture.md)の kind 4語彙 CHECK / partial index / seed の
// ON CONFLICT が DDL に含まれることを確認する。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const upSql = readFileSync(
  join(REPO_ROOT, "db", "migrations", "0001_auth_foundation.up.sql"),
  "utf8"
);

describe("0001_auth_foundation.up.sql の契約", () => {
  it("kind の4語彙(status/issue/next_move/spar_conclusion)を CHECK 制約で強制する", () => {
    expect(upSql).toContain(
      "CHECK (kind IN ('status','issue','next_move','spar_conclusion'))"
    );
  });

  it("processed_at IS NULL 走査用の partial index を持つ", () => {
    expect(upSql).toContain("WHERE processed_at IS NULL");
  });

  it("roles の seed が ON CONFLICT で冪等になっている", () => {
    expect(upSql).toContain("ON CONFLICT (name) DO NOTHING");
  });
});
