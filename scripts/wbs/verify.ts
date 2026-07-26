// 対象設計: docs/design/detail/wbs-loop.md §2.5 / 基本設計 §3-3(verify — CI 内の独立判定)
//
// 一次基準 = 行単位バイト diff(before = git show HEAD:<path> — 配列引数 spawn・path は単一引数連結・
// オブジェクト DB 読みのため FS/symlink を辿らない)。skip 行を含む「変更行以外の全行」のバイト不変を要求。
// 二次 = parse 前後比較 (a)(b)(c)。(e) = パス glob + '..' 拒否。破れ = exit 1(PR を作らない)。

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

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type AppliedItem = { item_key: string; from: string; to: string };
export type AppliedFile = { path: string; items: AppliedItem[] };

const FILE_PATH_RE = /^\.companies\/[^/]+\/docs\/secretary\/[^/]+-wbs\.md$/;
const TOKEN: Record<string, string> = { todo: "[ ]", doing: "[~]", done: "[x]" };

/** EOL を保持したまま行分割する(バイト単位比較のため)。 */
export function splitLinesKeepEol(content: string): string[] {
  return content.length === 0 ? [] : content.split(/(?<=\n)/);
}

/**
 * 一次基準: before/after の行配列を突き合わせ、
 * (i) 行数が同一 (ii) 変更行はちょうど items.length 行 (iii) 各変更行は同長かつ
 * トークン3バイト(from→to)の1箇所置換のみ (iv) それ以外の全行はバイト同一 — を検査する。
 */
export function verifyLineDiff(
  before: string,
  after: string,
  items: AppliedItem[]
): { ok: boolean; reason?: string } {
  const beforeLines = splitLinesKeepEol(before);
  const afterLines = splitLinesKeepEol(after);
  if (beforeLines.length !== afterLines.length) {
    return { ok: false, reason: "line count changed" };
  }
  const remaining = new Map<string, AppliedItem>();
  for (const item of items) remaining.set(item.item_key, item);

  let changedLines = 0;
  for (let i = 0; i < beforeLines.length; i += 1) {
    const b = beforeLines[i]!;
    const a = afterLines[i]!;
    if (b === a) continue;
    changedLines += 1;
    if (b.length !== a.length) {
      return { ok: false, reason: `line ${i + 1}: length changed` };
    }
    // 差分バイト位置を特定 — ちょうど連続3バイトのトークン置換のみ許す
    let start = -1;
    for (let p = 0; p < b.length; p += 1) {
      if (b[p] !== a[p]) {
        start = p;
        break;
      }
    }
    let end = -1;
    for (let p = b.length - 1; p >= 0; p -= 1) {
      if (b[p] !== a[p]) {
        end = p;
        break;
      }
    }
    if (start === -1 || end - start + 1 > 3) {
      return { ok: false, reason: `line ${i + 1}: non-token diff` };
    }
    // トークン境界に正規化(3バイトトークン内の部分差分を許容しつつ、置換対が正しいか検査)
    const matched = Array.from(remaining.values()).find((item) => {
      const fromTok = TOKEN[item.from];
      const toTok = TOKEN[item.to];
      if (!fromTok || !toTok) return false;
      const idx = b.indexOf(fromTok, Math.max(0, start - 2));
      if (idx === -1 || idx > start) return false;
      return (
        b.slice(idx, idx + 3) === fromTok &&
        a.slice(idx, idx + 3) === toTok &&
        b.slice(0, idx) === a.slice(0, idx) &&
        b.slice(idx + 3) === a.slice(idx + 3)
      );
    });
    if (!matched) {
      return { ok: false, reason: `line ${i + 1}: diff is not a declared token swap` };
    }
    remaining.delete(matched.item_key);
  }

  if (changedLines !== items.length || remaining.size !== 0) {
    return { ok: false, reason: `changed lines=${changedLines}, expected=${items.length}` };
  }
  return { ok: true };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[wbs/verify] 環境変数 ${name} が未設定です`);
  }
  return value;
}

export async function runVerify(): Promise<void> {
  const out = requiredEnv("WBS_OUT");
  const orgDir = requiredEnv("ORG_DIR");

  const { parseBoard } = await import("../../lib/ingestion/parsers/board");

  const applied = JSON.parse(readFileSync(join(out, "applied.json"), "utf8")) as AppliedFile[];

  for (const file of applied) {
    // (e) パス検査(glob + '..' 拒否)
    if (!FILE_PATH_RE.test(file.path) || file.path.includes("..")) {
      throw new Error(`[wbs/verify] 対象外パスを検出しました`);
    }

    // before = SSoT の HEAD(git のオブジェクト DB 読み — apply の保存物を before に使わない)
    const show = spawnSync("git", ["show", `HEAD:${file.path}`], { cwd: orgDir, encoding: "utf8" });
    if (show.status !== 0) {
      throw new Error(`[wbs/verify] git show に失敗しました: ${file.path}`);
    }
    const before = show.stdout;
    const after = readFileSync(join(orgDir, file.path), "utf8");

    // 一次: 行単位バイト diff
    const lineCheck = verifyLineDiff(before, after, file.items);
    if (!lineCheck.ok) {
      throw new Error(`[wbs/verify] 行単位バイト diff 違反: ${file.path} (${lineCheck.reason})`);
    }

    // 二次: parse 前後比較 (a) item 数同一 (b) 対象のみ state 変化 (c) 他フィールド完全一致
    const parsedBefore = parseBoard({ path: file.path, content: before });
    const parsedAfter = parseBoard({ path: file.path, content: after });
    if (parsedBefore.items.length !== parsedAfter.items.length) {
      throw new Error(`[wbs/verify] item 数が変化しました: ${file.path}`);
    }
    const targets = new Map(file.items.map((i) => [i.item_key, i]));
    for (let i = 0; i < parsedBefore.items.length; i += 1) {
      const b = parsedBefore.items[i]!;
      const a = parsedAfter.items[i]!;
      const target = targets.get(b.itemKey);
      const expectedState = target ? target.to : b.state;
      if (a.itemKey !== b.itemKey || a.state !== expectedState) {
        throw new Error(`[wbs/verify] 対象外 item の変化を検出しました: ${file.path}`);
      }
      const fieldsB = JSON.stringify({ ...b, state: undefined });
      const fieldsA = JSON.stringify({ ...a, state: undefined });
      if (fieldsB !== fieldsA) {
        throw new Error(`[wbs/verify] item フィールドの変化を検出しました: ${file.path}`);
      }
    }
  }

  console.log(`[wbs/verify] files=${applied.length} ok`);
}

if (require.main === module) {
  runVerify().catch((err) => {
    console.error("[wbs/verify] failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
