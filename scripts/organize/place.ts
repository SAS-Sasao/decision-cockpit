// 対象設計: docs/design/detail/organize-loop.md §2.3(place)
//
// tsx 実行用の CLI(job publish)。verify を通過したマニフェスト(out/files.json)の
// (repo, path, file) を、fresh checkout 済みの書き戻し先リポジトリへ「追加のみ」で
// コピーする。宛先が既存なら exit 1(上書き・削除・移動はしない)。
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ManifestEntry = {
  repo: string;
  path: string;
  file: string;
  capture_ids: string[];
};

// job publish の checkout パス(§2.5 step6/7: path: warroom / path: orgrepo)。
// working-directory: cockpit からの相対パス。
export const REPO_DIRS: Record<string, string> = {
  "ai-war-room": "../warroom",
  "cc-sier-organization": "../orgrepo",
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[organize/place] 環境変数 ${name} が未設定です`);
  }
  return value;
}

export function resolveDestDir(repo: string): string | null {
  return REPO_DIRS[repo] ?? null;
}

export async function runPlace(): Promise<void> {
  const out = requiredEnv("ORGANIZE_OUT");
  const manifest = JSON.parse(readFileSync(join(out, "files.json"), "utf8")) as ManifestEntry[];

  let placed = 0;
  for (const entry of manifest) {
    const destDir = resolveDestDir(entry.repo);
    if (!destDir) {
      throw new Error(`[organize/place] 未知の repo: ${entry.repo}`);
    }
    const destPath = join(destDir, entry.path);
    if (existsSync(destPath)) {
      throw new Error(`[organize/place] 宛先が既存のため停止します(追加のみ): ${entry.repo}:${entry.path}`);
    }
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(join(out, entry.file), destPath);
    placed += 1;
  }

  console.log(`[organize/place] placed=${placed}`);
}

if (require.main === module) {
  runPlace().catch((err) => {
    console.error("[organize/place] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
