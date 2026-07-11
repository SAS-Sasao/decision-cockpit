// 対象設計: docs/design/detail/auth-foundation.md §3(tests/check-no-secrets.test.ts)
// scripts/check-no-secrets.sh(§2.3)の契約テスト。
// OS の一時ディレクトリ(リポジトリ外)に git init した匿名 fixture 上で実行し、
// (a) クリーン → exit 0 / (b) 実値形式 → exit 1 / (c) .env.example 相当 → exit 1 /
// (d) gitignore 済み → exit 0 を確認する。
// 偽の秘密値はテスト内で文字列連結して生成し、リテラルは残さない。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(REPO_ROOT, "scripts", "check-no-secrets.sh");

function fakeSecretValue(): string {
  // npg_ 接頭辞 + 英数字(実値形式のダミー)。リテラルとして残さないよう連結で生成する。
  return ["npg", "_", "abc123XYZ789"].join("");
}

function runScript(cwd: string): { status: number | null; stderr: string } {
  try {
    execFileSync("bash", [SCRIPT], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number | null; stderr?: string };
    return {
      status: typeof err.status === "number" ? err.status : null,
      stderr: err.stderr ?? "",
    };
  }
}

describe("scripts/check-no-secrets.sh", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "cns-fixture-"));
    execFileSync("git", ["init", "-q"], { cwd: repoDir });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("(a) クリーンな fixture -> exit 0", () => {
    writeFileSync(join(repoDir, "README.md"), "hello\n");

    const result = runScript(repoDir);

    expect(result.status).toBe(0);
  });

  it("(b) 実値形式の秘密が含まれる -> exit 1", () => {
    writeFileSync(join(repoDir, "notes.txt"), `token=${fakeSecretValue()}\n`);

    const result = runScript(repoDir);

    expect(result.status).toBe(1);
  });

  it("(c) .env.example 相当のファイルに仕込んでも検知される -> exit 1", () => {
    writeFileSync(join(repoDir, ".env.example"), `SOME_TOKEN=${fakeSecretValue()}\n`);

    const result = runScript(repoDir);

    expect(result.status).toBe(1);
  });

  it("(d) gitignore 済みファイルは非検知 -> exit 0", () => {
    writeFileSync(join(repoDir, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(repoDir, "ignored.txt"), `token=${fakeSecretValue()}\n`);

    const result = runScript(repoDir);

    expect(result.status).toBe(0);
  });
});
