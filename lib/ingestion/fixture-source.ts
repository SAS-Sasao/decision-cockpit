import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.1(SourceAdapter・Fixture 実装)
//
// テスト・受け入れ検証用の SourceAdapter 実装。ルートは env FIXTURES_DIR(既定 'fixtures')
// 配下の `<repo>/`。実ネットワーク・実 GitHub アクセスを一切行わない。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { SourceNotFoundError, type SourceAdapter } from "./source";

function walk(dir: string, base: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // ルートが存在しない場合は空扱い
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(sep).join("/"));
    }
  }
}

export class FixtureSource implements SourceAdapter {
  readonly repo: "cc-sier-organization" | "ai-war-room";
  private readonly root: string;

  constructor(repo: "cc-sier-organization" | "ai-war-room") {
    this.repo = repo;
    const fixturesDir = process.env.FIXTURES_DIR || "fixtures";
    this.root = resolve(fixturesDir, repo);
  }

  /** 全ファイルの (path, sha256(content)) を辞書順連結した文字列の sha256(決定的)。 */
  async head(): Promise<string> {
    const paths = await this.listPaths();
    const hash = createHash("sha256");
    for (const path of paths) {
      const content = readFileSync(join(this.root, path), "utf8");
      const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
      hash.update(path, "utf8");
      hash.update("\0", "utf8");
      hash.update(contentHash, "utf8");
      hash.update("\n", "utf8");
    }
    return hash.digest("hex");
  }

  /** FixtureSource は増分検知をしない(常に全量走査)。 */
  async changedPaths(_base: string | null): Promise<string[] | "full"> {
    return "full";
  }

  async listPaths(): Promise<string[]> {
    const out: string[] = [];
    walk(this.root, this.root, out);
    out.sort();
    return out;
  }

  async fetch(path: string): Promise<string> {
    const full = join(this.root, path);
    try {
      return readFileSync(full, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") {
        throw new SourceNotFoundError(`fixture not found: ${this.repo}/${path}`);
      }
      throw err;
    }
  }
}
