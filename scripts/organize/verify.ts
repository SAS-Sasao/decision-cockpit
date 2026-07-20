// 対象設計: docs/design/detail/organize-loop.md §2.2(verify)
//
// job publish の CI 内 judge。純関数群 + CLI。信頼アンカーは state/ids.json(分割一致の
// 基準集合)と state/run.json(date/slot/org のアンカー)であり、job generate が書いた
// 生の取得結果(Claude 可書域にある入力データ)は基準に使わない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { stripFrontmatter } from "../../lib/ingestion/parsers/frontmatter";

export type ManifestEntry = {
  repo: string;
  path: string;
  file: string;
  capture_ids: string[];
};

export type RunMeta = { date: string; slot: string; allowed_orgs: string[] };

export const ALLOWED: Record<string, RegExp[]> = {
  "ai-war-room": [/^docs\/logs\/[a-z0-9-]+\.md$/, /^docs\/decisions\/[a-z0-9-]+\.md$/],
  "cc-sier-organization": [
    /^\.companies\/[a-z0-9-]+\/docs\/decisions\/[a-z0-9-]+\.md$/,
    /^\.companies\/[a-z0-9-]+\/docs\/todos\/[a-z0-9-]+\.md$/,
  ],
};

// normalize.ts の DENY_PATTERNS の複製(React Server Components 専用パッケージ境界の
// ため import できない — §0-D-4)。語幹形で広く取り、退行検知の二重化として置く
// (決定的命名により通常は発火しない)。
export const DENY_WORDS = [
  "profile",
  "personality",
  "minefield",
  "memory",
  "agents",
  "claude",
  ".active",
  ".interaction-log",
  "agent-memory",
];

function isNormalizedRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\\")) return false;
  if (path.split("/").some((seg) => seg === "..")) return false;
  return true;
}

/** 許可パス正規表現に一致し、basename が denylist 語を含まないこと(org セグメントは対象外)。 */
export function isAllowedDest(repo: string, path: string): boolean {
  if (!isNormalizedRelativePath(path)) return false;
  const patterns = ALLOWED[repo];
  if (!patterns) return false;
  if (!patterns.some((re) => re.test(path))) return false;
  const base = path.split("/").pop() ?? "";
  const lowerBase = base.toLowerCase();
  return !DENY_WORDS.some((word) => lowerBase.includes(word));
}

/** ソースファイル(job generate 出力)は out/md/ 配下限定。 */
export function isAllowedSource(file: string): boolean {
  if (!isNormalizedRelativePath(file)) return false;
  return /^out\/md\/[^/]+\.md$/.test(file);
}

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function extractFrontmatterFields(md: string): Record<string, unknown> | null {
  const match = md.match(FRONTMATTER_BLOCK_RE);
  if (!match) return null;
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export const KIND_VALUES = ["mixed", "status", "issue", "next_move", "spar_conclusion"];
const REQUIRED_FRONTMATTER_KEYS = ["date", "slot", "source", "capture_ids", "kind", "status", "tags"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function setEquals(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
}

/** 必須7キー・date/slot 一致・source 固定・kind 語彙・status 固定・capture_ids 集合一致・tags 型。 */
export function checkFrontmatter(md: string, entry: ManifestEntry, run: RunMeta): string[] {
  const violations: string[] = [];
  const fm = extractFrontmatterFields(md);
  if (!fm) {
    violations.push("frontmatter missing or invalid");
    return violations;
  }

  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!(key in fm)) violations.push(`frontmatter missing key: ${key}`);
  }
  if (fm.date !== run.date) violations.push("frontmatter date mismatch");
  if (fm.slot !== run.slot) violations.push("frontmatter slot mismatch");
  if (fm.source !== "decision-cockpit") violations.push("frontmatter source invalid");
  if (typeof fm.kind !== "string" || !KIND_VALUES.includes(fm.kind)) violations.push("frontmatter kind invalid");
  if (fm.status !== "curated") violations.push("frontmatter status invalid");

  const captureIds = Array.isArray(fm.capture_ids) ? fm.capture_ids : null;
  const validCaptureIds =
    captureIds !== null &&
    captureIds.length > 0 &&
    captureIds.every((id): id is string => typeof id === "string" && UUID_RE.test(id));
  if (!validCaptureIds) {
    violations.push("frontmatter capture_ids invalid");
  } else if (!setEquals(captureIds as string[], entry.capture_ids)) {
    violations.push("frontmatter capture_ids mismatch with manifest");
  }

  if (!Array.isArray(fm.tags) || !fm.tags.every((t) => typeof t === "string")) {
    violations.push("frontmatter tags invalid");
  }

  return violations;
}

const LOGS_PATH_RE = /^docs\/logs\//;

/** 同一 (repo, path) の重複 / logs が repo ごと2件以上。 */
export function checkUniquePaths(manifest: ManifestEntry[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const logsCountByRepo = new Map<string, number>();

  for (const entry of manifest) {
    const key = `${entry.repo}:${entry.path}`;
    if (seen.has(key)) {
      violations.push(`duplicate path: ${key}`);
    } else {
      seen.add(key);
    }
    if (LOGS_PATH_RE.test(entry.path)) {
      logsCountByRepo.set(entry.repo, (logsCountByRepo.get(entry.repo) ?? 0) + 1);
    }
  }
  for (const [repo, count] of logsCountByRepo) {
    if (count > 1) violations.push(`multiple logs files in ${repo}: ${count}`);
  }
  return violations;
}

const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_SLOT_RE = /^[a-z0-9-]+$/;

/** run.date が YYYY-MM-DD / run.slot が [a-z0-9-]+ / allowed_orgs が非空。 */
export function checkRunMeta(run: RunMeta): string[] {
  const violations: string[] = [];
  if (!RUN_DATE_RE.test(run.date)) violations.push("run.date format invalid");
  if (!RUN_SLOT_RE.test(run.slot)) violations.push("run.slot format invalid");
  if (!Array.isArray(run.allowed_orgs) || run.allowed_orgs.length === 0) {
    violations.push("run.allowed_orgs empty");
  }
  return violations;
}

const H1_RE = /^#\s+/;

/** parsers/frontmatter.ts の stripFrontmatter で剥離した結果の1行目が H1 であること。 */
export function checkH1(md: string): boolean {
  const stripped = stripFrontmatter(md);
  const firstLine = (stripped.split(/\r?\n/)[0] ?? "").trim();
  return H1_RE.test(firstLine);
}

/** state/ids.json(基準集合)と manifest の capture_ids の分割一致(欠落・捏造・重複)。 */
export function checkPartition(
  baseIds: string[],
  manifest: ManifestEntry[]
): { missing: string[]; unknown: string[]; dup: string[] } {
  const baseSet = new Set(baseIds);
  const seen = new Set<string>();
  const dup = new Set<string>();
  const unknown = new Set<string>();

  for (const entry of manifest) {
    for (const id of entry.capture_ids) {
      if (!baseSet.has(id)) {
        unknown.add(id);
        continue;
      }
      if (seen.has(id)) {
        dup.add(id);
      } else {
        seen.add(id);
      }
    }
  }
  const missing = baseIds.filter((id) => !seen.has(id));
  return { missing, unknown: [...unknown], dup: [...dup] };
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 決定的規約との完全一致: logs = date-slot.md / decisions = date-slot-dNN.md / todos = date-slot-tNN.md。 */
export function checkFilename(repo: string, path: string, run: RunMeta): boolean {
  const base = path.split("/").pop() ?? "";
  const d = escapeForRegExp(run.date);
  const s = escapeForRegExp(run.slot);
  if (path.includes("/logs/")) {
    return new RegExp(`^${d}-${s}\\.md$`).test(base);
  }
  if (path.includes("/decisions/")) {
    return new RegExp(`^${d}-${s}-d\\d{2}\\.md$`).test(base);
  }
  if (path.includes("/todos/")) {
    return new RegExp(`^${d}-${s}-t\\d{2}\\.md$`).test(base);
  }
  return false;
}

const ORG_SEGMENT_RE = /^\.companies\/([^/]+)\//;

/** cc-sier の <org> セグメントが run.allowed_orgs に含まれるか(org 概念のない repo は対象外 = true)。 */
export function checkOrg(path: string, run: RunMeta): boolean {
  const match = path.match(ORG_SEGMENT_RE);
  if (!match) return true;
  return run.allowed_orgs.includes(match[1]);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[organize/verify] 環境変数 ${name} が未設定です`);
  }
  return value;
}

/** CLI 本体。ids.json / run.json(state)を基準に out/files.json + out/md/ を全検査する。 */
export function runVerifyCli(): number {
  const out = requiredEnv("ORGANIZE_OUT");
  const state = requiredEnv("ORGANIZE_STATE");
  const violations: string[] = [];

  let baseIds: string[] = [];
  let run: RunMeta | null = null;
  let manifest: ManifestEntry[] = [];

  try {
    baseIds = JSON.parse(readFileSync(join(state, "ids.json"), "utf8"));
  } catch {
    violations.push("ids.json unreadable");
  }
  try {
    run = JSON.parse(readFileSync(join(state, "run.json"), "utf8"));
  } catch {
    violations.push("run.json unreadable");
  }
  try {
    manifest = JSON.parse(readFileSync(join(out, "files.json"), "utf8"));
  } catch {
    violations.push("files.json unreadable");
  }

  if (run) {
    violations.push(...checkRunMeta(run).map((v) => `run.json: ${v}`));
    violations.push(...checkUniquePaths(manifest).map((v) => `manifest: ${v}`));

    const partition = checkPartition(baseIds, manifest);
    for (const id of partition.missing) violations.push(`partition missing: ${id}`);
    for (const id of partition.unknown) violations.push(`partition unknown: ${id}`);
    for (const id of partition.dup) violations.push(`partition dup: ${id}`);

    for (const entry of manifest) {
      if (!isAllowedDest(entry.repo, entry.path)) {
        violations.push(`dest not allowed: ${entry.repo}:${entry.path}`);
        continue;
      }
      if (!checkFilename(entry.repo, entry.path, run)) {
        violations.push(`run.json 不一致(filename): ${entry.repo}:${entry.path}`);
      }
      if (!checkOrg(entry.path, run)) {
        violations.push(`allowed_orgs 外: ${entry.repo}:${entry.path}`);
      }
      if (!isAllowedSource(entry.file)) {
        violations.push(`source not allowed: ${entry.file}`);
        continue;
      }

      let md: string;
      try {
        md = readFileSync(join(out, entry.file), "utf8");
      } catch {
        violations.push(`source unreadable: ${entry.file}`);
        continue;
      }
      if (!checkH1(md)) {
        violations.push(`H1 なし: ${entry.path}`);
      }
      violations.push(...checkFrontmatter(md, entry, run).map((v) => `${entry.path}: ${v}`));
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.error(v);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = runVerifyCli();
}
