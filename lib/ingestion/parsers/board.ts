// 対象設計: docs/design/detail/today-view.md §2.1(parseBoard)
//          docs/design/basic/today-view.md §1-1 / §1-3(WBS パーサ + 取り込み経路)
//
// 入力: cc-sier-organization `.companies/<org>/docs/secretary/<name>-wbs.md` の WBS 表。
// 列同定はヘッダ名ベース(trim 後・完全一致・同名先勝ち)。対象テーブル = ヘッダに
// 「WBS」「タスク」「ステータス」を全て含むもののみ(欠けるテーブル・地の文・他表は対象外
// = skippedRows 非計上)。状態写像は `[ ]`/`[~]`/`[x]` の完全一致のみ。
// 決定的(同一入力 → 同一出力)。パース例外は投げない(fail-soft)。

import { sanitizeAbsPaths } from "../normalize";
import type { SourceFile } from "./types";

export type BoardItem = {
  itemKey: string; // WBS ID(trim 済み・非空)
  title: string;
  assignee: string | null;
  period: string | null;
  deliverable: string | null;
  iter: string | null;
  pri: string | null;
  taskType: string | null;
  issueRef: string | null;
  state: "todo" | "doing" | "done";
  section: string | null; // 直近の ##/### 見出しテキスト
};

// ---------------------------------------------------------------------------
// 見出し / フェンス
// ---------------------------------------------------------------------------

// section 追跡の対象は ##/### のみ(# = 文書タイトル・#### 以深は対象外)。
const SECTION_HEADING_RE = /^(#{2,3})[ \t]+(.+)$/;
const FENCE_RE = /^\s*```/;

// ---------------------------------------------------------------------------
// テーブル行判定(lib/ui/markdown.ts の判定規則を board 用に踏襲・独立実装)
// ---------------------------------------------------------------------------

const SEP_CONTENT_RE = /^[\s|:-]+$/;

function isTableRowCandidate(line: string): boolean {
  return line.trim() !== "" && line.includes("|") && !FENCE_RE.test(line) && !SECTION_HEADING_RE.test(line);
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  if (t === "") return false;
  if (!t.includes("|")) return false;
  if (!SEP_CONTENT_RE.test(t)) return false;
  if (!t.includes("-")) return false;
  return true;
}

function isTableStart(lines: string[], i: number): boolean {
  return i + 1 < lines.length && isTableRowCandidate(lines[i]!) && isSeparatorRow(lines[i + 1]!);
}

/** 行頭・行末の `|` を除去し `|` で分割・trim する(`\|` エスケープ非対応)。 */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** cells[idx] が存在しなければ空文字を返す(列数不足を「セル空」と同一視するための共通化)。 */
function getCell(cells: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return idx < cells.length ? cells[idx]! : "";
}

// ---------------------------------------------------------------------------
// ヘッダ名 → 列インデックス(trim 後・完全一致・同名先勝ち)
// ---------------------------------------------------------------------------

type ColKey =
  | "itemKey"
  | "title"
  | "assignee"
  | "period"
  | "deliverable"
  | "iter"
  | "pri"
  | "taskType"
  | "issueRef"
  | "state";

const HEADER_NAME_TO_KEY: Record<string, ColKey> = {
  WBS: "itemKey",
  タスク: "title",
  担当: "assignee",
  期間: "period",
  成果物: "deliverable",
  Iter: "iter",
  Pri: "pri",
  Type: "taskType",
  Issue: "issueRef",
  ステータス: "state",
};

type ColumnMap = Partial<Record<ColKey, number>>;

function buildColumnMap(headerCells: string[]): ColumnMap {
  const map: ColumnMap = {};
  headerCells.forEach((rawCell, idx) => {
    const key = HEADER_NAME_TO_KEY[rawCell];
    if (key && map[key] === undefined) {
      map[key] = idx;
    }
  });
  return map;
}

/** 対象テーブル = ヘッダに WBS・タスク・ステータスを全て含むもの(必須列 §2.1)。 */
function isTargetTable(map: ColumnMap): boolean {
  return map.itemKey !== undefined && map.title !== undefined && map.state !== undefined;
}

// ---------------------------------------------------------------------------
// 状態写像(完全一致のみ)
// ---------------------------------------------------------------------------

function mapState(raw: string): "todo" | "doing" | "done" | null {
  if (raw === "[ ]") return "todo";
  if (raw === "[~]") return "doing";
  if (raw === "[x]") return "done";
  return null;
}

/** 自由テキストセル(空なら null・非空なら sanitizeAbsPaths 適用)。 */
function textCell(cells: string[], idx: number | undefined): string | null {
  const raw = getCell(cells, idx);
  return raw === "" ? null : sanitizeAbsPaths(raw);
}

// ---------------------------------------------------------------------------
// 1行処理(スキップ規定 — 最初に該当したカテゴリを計上。順序は §2.1 の列挙順)
// ---------------------------------------------------------------------------

function processRow(
  cells: string[],
  map: ColumnMap,
  section: string | null,
  seen: Set<string>
): { item: BoardItem } | { skipped: true } {
  const stateRaw = getCell(cells, map.state);
  const state = mapState(stateRaw);
  if (state === null) return { skipped: true }; // 状態3値外(列数不足で欠落した場合も含む)

  const itemKey = getCell(cells, map.itemKey);
  if (itemKey === "") return { skipped: true }; // WBS ID 空

  if (seen.has(itemKey)) return { skipped: true }; // 重複 WBS ID(2件目以降)

  const titleRaw = getCell(cells, map.title);
  if (titleRaw === "") return { skipped: true }; // 必須セル欠落(タスク)

  seen.add(itemKey);

  return {
    item: {
      itemKey,
      title: sanitizeAbsPaths(titleRaw),
      assignee: textCell(cells, map.assignee),
      period: textCell(cells, map.period),
      deliverable: textCell(cells, map.deliverable),
      iter: textCell(cells, map.iter),
      pri: textCell(cells, map.pri),
      taskType: textCell(cells, map.taskType),
      issueRef: textCell(cells, map.issueRef),
      state,
      section,
    },
  };
}

// ---------------------------------------------------------------------------
// parseBoard 本体
// ---------------------------------------------------------------------------

export function parseBoard(file: SourceFile): { items: BoardItem[]; skippedRows: number } {
  const lines = file.content.split(/\r?\n/);
  const items: BoardItem[] = [];
  let skippedRows = 0;
  // 重複判定の seen 集合は「有効行として採用した ID」のみを登録する(ファイル全体で共有)。
  const seen = new Set<string>();
  let section: string | null = null;
  let inFence = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }

    const heading = line.match(SECTION_HEADING_RE);
    if (heading) {
      section = sanitizeAbsPaths(heading[2]!.trim());
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const headerCells = splitCells(line);
      const map = buildColumnMap(headerCells);
      i += 2; // ヘッダ行 + 区切り行を消費(非カウント)

      const dataLines: string[] = [];
      while (i < lines.length && isTableRowCandidate(lines[i]!)) {
        dataLines.push(lines[i]!);
        i += 1;
      }

      if (isTargetTable(map)) {
        for (const rowLine of dataLines) {
          const cells = splitCells(rowLine);
          const result = processRow(cells, map, section, seen);
          if ("skipped" in result) {
            skippedRows += 1;
          } else {
            items.push(result.item);
          }
        }
      }
      // 対象外テーブル(WBS/タスク/ステータスのいずれか欠落)は素通し(非カウント)。
      continue;
    }

    i += 1;
  }

  return { items, skippedRows };
}
