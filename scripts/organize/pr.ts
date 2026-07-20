// 対象設計: docs/design/detail/organize-loop.md §2.3(pr)
//
// tsx 実行用の CLI(job publish)。repo ごとに organize/<date>-<slot> ブランチへ
// 「追加のみ」の commit を作り、force を使わずに push・PR 作成する。
// date/slot は state/run.json から読む(第2の真実源を作らない — R4 arch G-1)。
// git 実行は配列引数の spawn に固定し、-A・--all・"." は使わない。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ManifestEntry = {
  repo: string;
  path: string;
  file: string;
  capture_ids: string[];
};

export type RunMeta = { date: string; slot: string; allowed_orgs: string[] };

export const REPO_DIRS: Record<string, string> = {
  "ai-war-room": "../warroom",
  "cc-sier-organization": "../orgrepo",
};

const PAT_ENV_BY_REPO: Record<string, string> = {
  "ai-war-room": "WARROOM_PAT",
  "cc-sier-organization": "ORGREPO_PAT",
};

/** slot は `^[a-z0-9-]+$` のみ許容(不一致は呼び出し側で exit 1)。 */
export function isValidSlot(slot: string): boolean {
  return /^[a-z0-9-]+$/.test(slot);
}

/** `-c core.hooksPath= add -- <paths...>`(`-A`/`--all`/`.` を使わない・追加のみ)。 */
export function buildAddArgs(paths: string[]): string[] {
  return ["-c", "core.hooksPath=", "add", "--", ...paths];
}

export function buildDiffNameStatusArgs(): string[] {
  return ["diff", "--cached", "--name-status"];
}

export function buildCommitArgs(date: string, slot: string): string[] {
  return ["-c", "core.hooksPath=", "commit", "-m", buildPrTitle(date, slot)];
}

/** PAT を引数として渡す(`.git/config` に残さない)。remote は作らない。 */
export function buildRemoteUrl(repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/SAS-Sasao/${repo}.git`;
}

/** force フラグなし・main を参照しない・organize/<date>-<slot> ブランチへ push する。 */
export function buildPushArgs(remoteUrl: string, date: string, slot: string): string[] {
  return ["push", remoteUrl, `HEAD:refs/heads/organize/${date}-${slot}`];
}

export function parseNameStatusLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.length > 0);
}

/** `--name-status` の全行が `A`(追加)始まりであること(空出力は空振りとして扱い false)。 */
export function isAllAdded(lines: string[]): boolean {
  if (lines.length === 0) return false;
  return lines.every((line) => line.startsWith("A"));
}

export function buildPrTitle(date: string, slot: string): string {
  return `organize: ${date} ${slot}`;
}

export function buildPrBody(paths: string[]): string {
  return [`件数: ${paths.length}`, "", ...paths].join("\n");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[organize/pr] 環境変数 ${name} が未設定です`);
  }
  return value;
}

function runGit(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export async function runPr(): Promise<void> {
  const out = requiredEnv("ORGANIZE_OUT");
  const state = requiredEnv("ORGANIZE_STATE");

  const run = JSON.parse(readFileSync(join(state, "run.json"), "utf8")) as RunMeta;
  if (!isValidSlot(run.slot)) {
    throw new Error(`[organize/pr] 不正な slot: ${run.slot}`);
  }

  const manifest = JSON.parse(readFileSync(join(out, "files.json"), "utf8")) as ManifestEntry[];
  const byRepo = new Map<string, ManifestEntry[]>();
  for (const entry of manifest) {
    const list = byRepo.get(entry.repo) ?? [];
    list.push(entry);
    byRepo.set(entry.repo, list);
  }

  const successRepos: string[] = [];
  for (const [repo, entries] of byRepo) {
    const cwd = REPO_DIRS[repo];
    const patEnvName = PAT_ENV_BY_REPO[repo];
    if (!cwd || !patEnvName) {
      throw new Error(`[organize/pr] 未知の repo: ${repo}`);
    }
    const paths = entries.map((entry) => entry.path);

    const add = runGit(cwd, buildAddArgs(paths));
    if (add.status !== 0) {
      throw new Error(`[organize/pr] add に失敗しました: ${repo}`);
    }

    const nameStatus = runGit(cwd, buildDiffNameStatusArgs());
    const lines = parseNameStatusLines(nameStatus.stdout);
    if (!isAllAdded(lines)) {
      throw new Error(`[organize/pr] 追加以外の変更を検出しました(commit 前に停止): ${repo}`);
    }

    const commit = runGit(cwd, buildCommitArgs(run.date, run.slot));
    if (commit.status !== 0) {
      throw new Error(`[organize/pr] commit に失敗しました: ${repo}`);
    }

    const token = requiredEnv(patEnvName);
    const remoteUrl = buildRemoteUrl(repo, token);
    const push = runGit(cwd, buildPushArgs(remoteUrl, run.date, run.slot));
    if (push.status !== 0) {
      throw new Error(`[organize/pr] push に失敗しました: ${repo}`);
    }

    const prCreate = spawnSync(
      "gh",
      [
        "pr",
        "create",
        "--title",
        buildPrTitle(run.date, run.slot),
        "--body",
        buildPrBody(paths),
        "--head",
        `organize/${run.date}-${run.slot}`,
      ],
      { cwd, encoding: "utf8", env: { ...process.env, GH_TOKEN: token } }
    );
    if (prCreate.status !== 0) {
      throw new Error(`[organize/pr] gh pr create に失敗しました: ${repo}`);
    }

    successRepos.push(repo);
  }

  writeFileSync(join(out, "pr-repos.json"), JSON.stringify(successRepos));
  console.log(`[organize/pr] repos=${successRepos.length}`);
}

if (require.main === module) {
  runPr().catch((err) => {
    console.error("[organize/pr] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
