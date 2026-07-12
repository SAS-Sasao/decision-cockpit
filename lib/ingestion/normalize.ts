import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.2(共通前処理)
//          docs/design/basic/ingestion-foundation.md §2.1(denylist)/ §3.1(サニタイズ・org 突合)
//
// パーサ共通の前処理関数群(server-only)。ここに実装する関数はすべて純関数
// (ネットワーク・DB 依存なし)であること。'server-only' はモジュール規約(条件11)。

import type { NormalizedRecord, ParseMeta, RecordType, SourceFile } from "./parsers/types";

// ---------------------------------------------------------------------------
// org 抽出 / 突合
// ---------------------------------------------------------------------------

const ORG_PATH_RE = /\.companies\/([^/]+)\//;

/** パス `.companies/<org>/` セグメントを抽出する(なければ null)。 */
export function orgFromPath(path: string): string | null {
  const m = path.match(ORG_PATH_RE);
  return m ? m[1] : null;
}

/**
 * frontmatter 等コンテンツ側が申告する org(declaredOrg)と、パスから抽出した
 * meta.org(metaOrg)の突合。両方が非 null かつ不一致のときのみ true(= エラー)。
 * 片方が null(申告なし・org 概念なし)の場合は不一致とみなさない。
 */
export function orgMismatch(declaredOrg: string | null, metaOrg: string | null): boolean {
  return declaredOrg !== null && metaOrg !== null && declaredOrg !== metaOrg;
}

// ---------------------------------------------------------------------------
// denylist(機微パス)
// ---------------------------------------------------------------------------

const DENY_PATTERNS = [
  "profile",
  "personality",
  "minefield",
  ".interaction-log",
  ".active",
  "agent-memory",
];

/** パスが機微 denylist(6パターン)のいずれかを部分一致で含むか。 */
export function isDenied(path: string): boolean {
  return DENY_PATTERNS.some((pattern) => path.includes(pattern));
}

// ---------------------------------------------------------------------------
// 絶対パスのサニタイズ
// ---------------------------------------------------------------------------

// `/home/...` `/Users/...` `C:\...` 等の絶対パスをファイル名のみに切り詰める。
// 引用符・空白の手前までを1トークンとみなす(JSON 文字列値の中でも安全に使える)。
const ABS_PATH_RE = /(?:\/home\/|\/Users\/|[A-Za-z]:\\)[^\s"'`]*/g;

export function sanitizeAbsPaths(text: string): string {
  if (!text) return text;
  return text.replace(ABS_PATH_RE, (match) => {
    const segments = match.split(/[\\/]/).filter((s) => s.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : match;
  });
}

/**
 * JSON 由来の値(文字列・配列・オブジェクト)を再帰的に走査し、文字列リーフに
 * sanitizeAbsPaths を適用する(quality-gate の target/errors[]/warnings[]/checklists[] 用)。
 */
export function sanitizeDeep(value: unknown): unknown {
  if (typeof value === "string") return sanitizeAbsPaths(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeDeep(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// タグ付与(決定的な語彙包含マッチ)
// ---------------------------------------------------------------------------

export type TagVocabEntry = { synonym: string; canonical: string };

/**
 * タイトル+本文等のテキストに対し、tag_synonyms 語彙(synonym の包含マッチ)で
 * canonical タグを重複なく返す(LLM 不使用・決定的)。
 * vocab の synonym は小文字・空白1個区切りに正規化済みである前提
 * (tag-vocab.ts の buildTagVocab がその形で生成する)。
 */
export function applyTags(text: string, vocab: TagVocabEntry[]): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const tags: string[] = [];
  for (const { synonym, canonical } of vocab) {
    if (!synonym) continue;
    if (normalized.includes(synonym) && !tags.includes(canonical)) {
      tags.push(canonical);
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// 日付ユーティリティ(ファイル名 / frontmatter 由来の日時を決定的に解決する)
// ---------------------------------------------------------------------------

const FLEXIBLE_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function isValidCalendar(month: number, day: number, hour: number, minute: number, second: number): boolean {
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31 &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

/**
 * `YYYY-MM-DDTHH:mm[:ss][.sss][Z|±HH:mm]` / `YYYY-MM-DD HH:mm[:ss]` を解決する。
 * オフセット省略時は決定性のため UTC として解釈する(実装判断。§最終報告に記載)。
 */
export function parseFlexibleDate(raw: string): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(FLEXIBLE_DATETIME_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  if (!isValidCalendar(month, day, hour, minute, second)) return null;

  const offset = m[7];
  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!offset || offset === "Z") {
    return Number.isNaN(baseUtc) ? null : new Date(baseUtc);
  }
  const sign = offset[0] === "-" ? -1 : 1;
  const digits = offset.slice(1).replace(":", "");
  const offH = Number(digits.slice(0, 2));
  const offM = Number(digits.slice(2, 4));
  const ts = baseUtc - sign * (offH * 60 + offM) * 60000;
  return Number.isNaN(ts) ? null : new Date(ts);
}

const FILENAME_DATETIME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-.+)?$/;

/**
 * task-log ファイル名(拡張子除去済み)/ case-bank id `YYYYMMDD-HHMMSS-<slug>` から
 * 日時を決定的(UTC)に解決する。
 */
export function dateFromFilenameDatetime(base: string): Date | null {
  const m = base.match(FILENAME_DATETIME_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (!isValidCalendar(month, day, hour, minute, second)) return null;
  const ts = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isNaN(ts) ? null : new Date(ts);
}

const FILE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` を UTC 0時として解決する(quality-gate / decisions / logs のファイル名日付)。 */
export function dateFromFileDate(dateStr: string): Date | null {
  const m = dateStr.match(FILE_DATE_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidCalendar(month, day, 0, 0, 0)) return null;
  const ts = Date.UTC(year, month - 1, day, 0, 0, 0);
  return Number.isNaN(ts) ? null : new Date(ts);
}

// ---------------------------------------------------------------------------
// パス断片ユーティリティ
// ---------------------------------------------------------------------------

/** パス区切り(`/` `\`)の最終セグメント(ファイル名。拡張子は残す)。 */
export function basename(pathish: string): string {
  const segments = pathish.split(/[\\/]/).filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : pathish;
}

/** basename から最終拡張子を除いたもの(topic 用の「ファイル名 slug」)。 */
export function fileSlug(pathish: string): string {
  const base = basename(pathish);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// ---------------------------------------------------------------------------
// エラーレコード生成
// ---------------------------------------------------------------------------

export type ErrorRecordOptions = {
  itemKey?: string;
  rawRef?: string;
};

/**
 * status='error' の NormalizedRecord を生成する。
 * body は「サニタイズ→切り詰め(先頭2000字)」の順で元テキスト(file.content)全体から作る
 * (ok/error 両パスへのサニタイズ適用という不変条件を守る)。
 * reason はデバッグ用に title へ格納する(スキーマに専用列がないため)。
 */
export function errorRecord(
  file: SourceFile,
  meta: ParseMeta,
  reason: string,
  type: RecordType,
  opts: ErrorRecordOptions = {}
): NormalizedRecord {
  const body = sanitizeAbsPaths(file.content).slice(0, 2000);
  return {
    source: meta.source,
    file_path: file.path,
    item_key: opts.itemKey ?? "",
    commit: meta.commit,
    type,
    occurred_at: null,
    org: meta.org,
    topic: null,
    tags: [],
    title: reason,
    body,
    raw_ref: opts.rawRef ?? file.path,
    status: "error",
    reward_score: null,
    signals: null,
    completeness: null,
    accuracy: null,
    clarity: null,
    quality_gate_result: null,
  };
}
