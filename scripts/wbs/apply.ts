// 対象設計: docs/design/detail/wbs-loop.md §2.5(apply — トークン置換と不在検査)
//
// 送信集合に rewriteBoardState を適用し(書き込みは ORG_DIR 配下のみ — startsWith assert)、
// 監査集合の不在検査(checkout 実物に file/採用行が無い)結果を out/absent.json に書く。
// symlink は lstat で検知し書かない(changed=false 扱い — 設計 §4-R)。ログは件数・パスのみ。

// scripts からの lib import は server-only 連鎖(board → normalize)を踏むため、
// scripts/sync-local.ts 前例の require キャッシュスタブを最初に適用する(§0-9)。
function stubServerOnlyForCli(): void {
  try {
    const resolved = require.resolve("server-only");
    const cache = require.cache as Record<string, { exports: unknown } | undefined>;
    if (!cache[resolved]) {
      cache[resolved] = { exports: {} } as NodeJS.Module;
    }
  } catch {
    // noop
  }
}
stubServerOnlyForCli();

import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type SendRow = { source: string; file_path: string; item_key: string; desired_state: string };
export type AuditRow = { source: string; file_path: string; item_key: string };
export type AppliedItem = { item_key: string; from: string; to: string };
export type AppliedFile = { path: string; items: AppliedItem[] };

const FILE_PATH_RE = /^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[wbs/apply] 環境変数 ${name} が未設定です`);
  }
  return value;
}

/** ORG_DIR 封じ込め: resolve 後のパスが ORG_DIR 配下であることを assert する(設計 §2.5)。 */
export function containedPath(orgDir: string, filePath: string): string {
  const root = resolve(orgDir);
  const full = resolve(orgDir, filePath);
  if (!full.startsWith(root + sep)) {
    throw new Error(`[wbs/apply] ORG_DIR 外への書き込みを拒否しました`);
  }
  return full;
}

export async function runApply(): Promise<void> {
  const out = requiredEnv("WBS_OUT");
  const orgDir = requiredEnv("ORG_DIR");

  const { locateAdoptedRows } = await import("../../lib/ingestion/parsers/board");
  const { rewriteBoardState } = await import("../../lib/ingestion/parsers/board-rewrite");

  const payload = JSON.parse(readFileSync(join(out, "overrides.json"), "utf8")) as {
    send: SendRow[];
    audit: AuditRow[];
  };

  // --- 送信集合: ファイル単位に rewrite を適用 ---
  const appliedByPath = new Map<string, AppliedItem[]>();
  let skipped = 0;
  for (const row of payload.send) {
    if (!FILE_PATH_RE.test(row.file_path) || row.file_path.includes("..")) {
      skipped += 1;
      continue; // DB CHECK 済みだが多層防御(glob 外は書かない)
    }
    const full = containedPath(orgDir, row.file_path);
    if (!existsSync(full) || lstatSync(full).isSymbolicLink()) {
      skipped += 1; // 不在 or symlink は書かない(changed=false 扱い — 不在は監査側で supersede)
      continue;
    }
    const content = readFileSync(full, "utf8");
    const before = locateAdoptedRows(content).find((r) => r.itemKey === row.item_key);
    const result = rewriteBoardState(content, row.item_key, row.desired_state as "todo" | "doing" | "done");
    if (!result.changed || !before) {
      skipped += 1;
      continue;
    }
    writeFileSync(full, result.content);
    const list = appliedByPath.get(row.file_path) ?? [];
    list.push({ item_key: row.item_key, from: before.state, to: row.desired_state });
    appliedByPath.set(row.file_path, list);
  }

  // --- 監査集合: 不在検査(file 不在 or 採用行に item_key 不在)---
  const absent: AuditRow[] = [];
  const adoptedCache = new Map<string, Set<string>>();
  for (const row of payload.audit) {
    if (!FILE_PATH_RE.test(row.file_path) || row.file_path.includes("..")) {
      absent.push(row);
      continue;
    }
    const full = containedPath(orgDir, row.file_path);
    if (!existsSync(full) || lstatSync(full).isSymbolicLink()) {
      absent.push(row);
      continue;
    }
    let keys = adoptedCache.get(row.file_path);
    if (!keys) {
      const content = readFileSync(full, "utf8");
      keys = new Set(locateAdoptedRows(content).map((r) => r.itemKey));
      adoptedCache.set(row.file_path, keys);
    }
    if (!keys.has(row.item_key)) {
      absent.push(row);
    }
  }

  const applied: AppliedFile[] = Array.from(appliedByPath.entries()).map(([path, items]) => ({
    path,
    items,
  }));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "applied.json"), JSON.stringify(applied));
  writeFileSync(join(out, "absent.json"), JSON.stringify(absent));
  console.log(
    `[wbs/apply] files=${applied.length} items=${applied.reduce((n, f) => n + f.items.length, 0)} skipped=${skipped} absent=${absent.length}`
  );
}

if (require.main === module) {
  runApply().catch((err) => {
    console.error("[wbs/apply] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
