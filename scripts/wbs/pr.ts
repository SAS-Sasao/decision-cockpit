// 対象設計: docs/design/detail/wbs-loop.md §2.5(pr — 限定編集 PR の作成)
//
// git 実行は配列引数の spawn に固定(シェル文字列連結なし)・hooks 中和・refspec に + を付けない。
// staged 閉包検査(全行 'M'・glob 一致・verify 済み集合と一致)は commit より前に行う。
// 結果は out/pr.json({created, number, branch})— mark への成功信号。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AppliedItem = { item_key: string; from: string; to: string };
export type AppliedFile = { path: string; items: AppliedItem[] };
export type PrResult = { created: boolean; number?: string; branch?: string };

const FILE_PATH_RE = /^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/;

export function buildAddArgs(paths: string[]): string[] {
  return ["-c", "core.hooksPath=", "add", "--", ...paths];
}

export function buildDiffNameStatusArgs(): string[] {
  return ["diff", "--cached", "--name-status"];
}

export function buildCommitArgs(date: string): string[] {
  return ["-c", "core.hooksPath=", "commit", "-m", buildPrTitle(date)];
}

/** PAT は引数渡し(.git/config に残さない)。refspec は + なし・wbs/<date> のみ。 */
export function buildPushArgs(remoteUrl: string, date: string): string[] {
  return ["push", remoteUrl, `HEAD:refs/heads/wbs/${date}`];
}

export function parseNameStatusLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.length > 0);
}

/**
 * staged 閉包検査(§2.5): 全行 'M'(追加・削除・リネームなし)かつ path が WBS glob に一致し、
 * verify 済み集合(applied.json の path 集合)と完全一致すること。
 */
export function isStagedClosureValid(lines: string[], verifiedPaths: string[]): boolean {
  if (lines.length === 0) return false;
  const staged = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith("M")) return false;
    const path = line.slice(1).trim();
    if (!FILE_PATH_RE.test(path) || path.includes("..")) return false;
    staged.add(path);
  }
  const verified = new Set(verifiedPaths);
  if (staged.size !== verified.size) return false;
  for (const path of staged) {
    if (!verified.has(path)) return false;
  }
  return true;
}

export function buildPrTitle(date: string): string {
  return `wbs: state updates ${date}`;
}

/** PR 本文 = 変更一覧(item_key / file / from→to)+ 機械生成の注意書き(§0-7)。 */
export function buildPrBody(files: AppliedFile[]): string {
  const lines: string[] = ["| item | file | 変更 |", "|---|---|---|"];
  for (const file of files) {
    for (const item of file.items) {
      lines.push(`| ${item.item_key} | ${file.path} | ${item.from} → ${item.to} |`);
    }
  }
  lines.push("");
  lines.push("機械生成(wbs-writeback): ステータストークンの置換のみ・verify 済み。");
  lines.push("レビュー観点 = 変更行が表の一覧と一致していること(それ以外の差分があれば必ず reject)。");
  return lines.join("\n");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[wbs/pr] 環境変数 ${name} が未設定です`);
  }
  return value;
}

function runGit(cwd: string, args: string[]): { status: number; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

export async function runPr(): Promise<void> {
  const out = requiredEnv("WBS_OUT");
  const orgDir = requiredEnv("ORG_DIR");
  const date = requiredEnv("WBS_DATE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[wbs/pr] 不正な date: ${date}`);
  }

  const applied = JSON.parse(readFileSync(join(out, "applied.json"), "utf8")) as AppliedFile[];
  if (applied.length === 0) {
    // 送信0件(不在のみの run など)— PR は作らず mark へ引き継ぐ
    writeFileSync(join(out, "pr.json"), JSON.stringify({ created: false } satisfies PrResult));
    console.log("[wbs/pr] no changes; skipped");
    return;
  }

  const paths = applied.map((f) => f.path);
  const add = runGit(orgDir, buildAddArgs(paths));
  if (add.status !== 0) {
    throw new Error("[wbs/pr] add に失敗しました");
  }

  // staged 閉包検査は commit より前(organize R2 B-2 と同型)
  const nameStatus = runGit(orgDir, buildDiffNameStatusArgs());
  const lines = parseNameStatusLines(nameStatus.stdout);
  if (!isStagedClosureValid(lines, paths)) {
    throw new Error("[wbs/pr] staged 閉包違反を検出しました(commit 前に停止)");
  }

  const commit = runGit(orgDir, buildCommitArgs(date));
  if (commit.status !== 0) {
    throw new Error("[wbs/pr] commit に失敗しました");
  }

  const token = requiredEnv("ORGREPO_PAT");
  const remoteUrl = `https://x-access-token:${token}@github.com/SAS-Sasao/cc-sier-organization.git`;
  const push = runGit(orgDir, buildPushArgs(remoteUrl, date));
  if (push.status !== 0) {
    throw new Error("[wbs/pr] push に失敗しました");
  }

  const prCreate = spawnSync(
    "gh",
    ["pr", "create", "--title", buildPrTitle(date), "--body", buildPrBody(applied), "--head", `wbs/${date}`],
    { cwd: orgDir, encoding: "utf8", env: { ...process.env, GH_TOKEN: token } }
  );
  if (prCreate.status !== 0) {
    throw new Error("[wbs/pr] gh pr create に失敗しました");
  }

  const result: PrResult = { created: true, branch: `wbs/${date}` };
  writeFileSync(join(out, "pr.json"), JSON.stringify(result));
  console.log(`[wbs/pr] created branch=wbs/${date} files=${paths.length}`);
}

if (require.main === module) {
  runPr().catch((err) => {
    console.error("[wbs/pr] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
