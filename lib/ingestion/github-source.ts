import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.1(SourceAdapter・GitHub 実装)
//
// GitHub への唯一の経路(GET のみ)。fetch() は既定で GET を発行するため、この
// ファイルでは HTTP 動詞を明示指定しない(受け入れ条件8-b の判定アンカー)。
// 疎通確認はしない(実装と型のみ。実 GitHub アクセスはテスト・受け入れに持ち込まない)。
//
// GitHub API ホスト文字列(api.github.com / raw.githubusercontent.com)は
// このファイル以外に書かない(受け入れ条件8-a)。

import { SourceNotFoundError, type SourceAdapter } from "./source";

const OWNER = "SAS-Sasao";
const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";

function githubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "[lib/ingestion/github-source] 環境変数 GITHUB_TOKEN が未設定です。"
    );
  }
  return token;
}

function apiHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${githubToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

type CompareResponse = {
  files?: { filename: string; status: string }[];
};

type TreeResponse = {
  tree?: { path: string; type: string }[];
};

export class GithubSource implements SourceAdapter {
  readonly repo: "cc-sier-organization" | "ai-war-room";
  private pinnedHead: string | null = null;
  private cachedDefaultBranch: string | null = null;

  constructor(repo: "cc-sier-organization" | "ai-war-room") {
    this.repo = repo;
  }

  private repoPath(): string {
    return `${OWNER}/${this.repo}`;
  }

  private async defaultBranch(): Promise<string> {
    if (this.cachedDefaultBranch) return this.cachedDefaultBranch;
    const res = await fetch(`${API_BASE}/repos/${this.repoPath()}`, {
      headers: apiHeaders(),
    });
    if (!res.ok) {
      throw new Error(`[github-source] repo lookup failed: ${res.status}`);
    }
    const data = (await res.json()) as { default_branch?: string };
    this.cachedDefaultBranch = data.default_branch ?? "main";
    return this.cachedDefaultBranch;
  }

  /** HEAD の commit sha。run 内で一度取得した値をメモ化し、以降の呼び出しに固定(pin)する。 */
  async head(): Promise<string> {
    if (this.pinnedHead) return this.pinnedHead;
    const branch = await this.defaultBranch();
    const res = await fetch(
      `${API_BASE}/repos/${this.repoPath()}/commits/${branch}`,
      { headers: apiHeaders() }
    );
    if (!res.ok) {
      throw new Error(`[github-source] head() failed: ${res.status}`);
    }
    const data = (await res.json()) as { sha?: string };
    if (!data.sha) {
      throw new Error("[github-source] head() response missing sha");
    }
    this.pinnedHead = data.sha;
    return this.pinnedHead;
  }

  private async ensureHead(): Promise<string> {
    return this.pinnedHead ?? this.head();
  }

  /** base=null は全量走査。それ以外は compare API で差分パスを求める(削除は除外)。 */
  async changedPaths(base: string | null): Promise<string[] | "full"> {
    if (!base) return "full";
    const head = await this.ensureHead();
    const res = await fetch(
      `${API_BASE}/repos/${this.repoPath()}/compare/${base}...${head}`,
      { headers: apiHeaders() }
    );
    if (res.status === 404 || res.status === 409) {
      // 履歴切断・比較不能 → 全量走査にフォールバック
      return "full";
    }
    if (!res.ok) {
      throw new Error(`[github-source] changedPaths() failed: ${res.status}`);
    }
    const data = (await res.json()) as CompareResponse;
    const files = data.files ?? [];
    // status: removed(削除)は存在するパスのみ返す契約のため除外する
    return files.filter((f) => f.status !== "removed").map((f) => f.filename);
  }

  /** git trees API で HEAD 時点の全ファイルパスを列挙する(全量走査の候補パス)。 */
  async listPaths(): Promise<string[]> {
    const head = await this.ensureHead();
    const res = await fetch(
      `${API_BASE}/repos/${this.repoPath()}/git/trees/${head}?recursive=1`,
      { headers: apiHeaders() }
    );
    if (!res.ok) {
      throw new Error(`[github-source] listPaths() failed: ${res.status}`);
    }
    const data = (await res.json()) as TreeResponse;
    const tree = data.tree ?? [];
    return tree.filter((t) => t.type === "blob").map((t) => t.path);
  }

  /** HEAD の sha に固定してファイル本文を取得する。存在しなければ SourceNotFoundError。 */
  async fetch(path: string): Promise<string> {
    const head = await this.ensureHead();
    const res = await fetch(`${RAW_BASE}/${this.repoPath()}/${head}/${path}`, {
      headers: { Authorization: `Bearer ${githubToken()}` },
    });
    if (res.status === 404) {
      throw new SourceNotFoundError(
        `github raw content not found: ${this.repoPath()}/${path}`
      );
    }
    if (!res.ok) {
      throw new Error(`[github-source] fetch() failed: ${res.status} ${path}`);
    }
    return res.text();
  }
}
