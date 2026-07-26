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
// 共有 walker(parseBoard / locateAdoptedRows の唯一の走査 — wbs-loop 詳細 §2.2。
// 採用・スキップの判定は processRow に一本化し、二重実装しない)
// ---------------------------------------------------------------------------

type WalkedRow = {
  item: BoardItem;
  lineIndex: number; // lines(split(/\r?\n/))内の行番号
  rawLine: string; // \r?\n を含まない生の行
  stateCellIndex: number; // splitCells 基準のステータス列インデックス
};

function walkBoardTables(lines: string[]): { rows: WalkedRow[]; skippedRows: number } {
  const rows: WalkedRow[] = [];
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

      const dataRows: { rawLine: string; lineIndex: number }[] = [];
      while (i < lines.length && isTableRowCandidate(lines[i]!)) {
        dataRows.push({ rawLine: lines[i]!, lineIndex: i });
        i += 1;
      }

      if (isTargetTable(map)) {
        for (const { rawLine, lineIndex } of dataRows) {
          const cells = splitCells(rawLine);
          const result = processRow(cells, map, section, seen);
          if ("skipped" in result) {
            skippedRows += 1;
          } else {
            rows.push({ item: result.item, lineIndex, rawLine, stateCellIndex: map.state! });
          }
        }
      }
      // 対象外テーブル(WBS/タスク/ステータスのいずれか欠落)は素通し(非カウント)。
      continue;
    }

    i += 1;
  }

  return { rows, skippedRows };
}

// ---------------------------------------------------------------------------
// parseBoard 本体
// ---------------------------------------------------------------------------

export function parseBoard(file: SourceFile): { items: BoardItem[]; skippedRows: number } {
  const lines = file.content.split(/\r?\n/);
  const { rows, skippedRows } = walkBoardTables(lines);
  return { items: rows.map((r) => r.item), skippedRows };
}

// ---------------------------------------------------------------------------
// locateAdoptedRows(wbs-loop 詳細 §2.2 — 書き戻し用の絶対オフセット)
// ---------------------------------------------------------------------------

export type AdoptedRow = {
  itemKey: string;
  state: "todo" | "doing" | "done";
  /** content 内の絶対オフセット: ステータスセルの trim 済みトークン(3バイト)の先頭位置。 */
  tokenStart: number;
};

/**
 * splitCells と同値のセル同定で、生の行内のセル生バイト範囲を返す(trim 済みセルの再構成をしない)。
 * 規則(§2.2): 行頭空白をスキップ → 先頭 `|` なら1バイト消費 → `|` 実位置で区切る。
 * 行末が `|` なら最後の空セグメントはセルに数えない(splitCells の trailing strip と同値)。
 * 行末 `|` が無い場合、最終セルは行末まで。
 */
function cellSpansInLine(rawLine: string): { start: number; end: number }[] {
  const trimmedRight = rawLine.replace(/\s+$/, "");
  let idx = rawLine.length - rawLine.trimStart().length; // 行頭空白のスキップ
  if (rawLine[idx] === "|") idx += 1; // 先頭 `|` の消費(無い行もある — isTableRowCandidate は許容)
  const spans: { start: number; end: number }[] = [];
  let cellStart = idx;
  for (let p = idx; p <= rawLine.length; p += 1) {
    if (p === rawLine.length || rawLine[p] === "|") {
      spans.push({ start: cellStart, end: p });
      cellStart = p + 1;
    }
  }
  // 行末(右 trim 後)が `|` なら、最後の区切り以降の空白セグメントはセルではない。
  if (trimmedRight.endsWith("|")) {
    spans.pop();
  }
  return spans;
}

/**
 * parseBoard(content).items と同数・同順・同 itemKey/state の採用行に、
 * ステータストークン(3バイト)の絶対オフセットを付けて返す(wbs-loop 詳細 §2.2)。
 * 行開始オフセットは split(/\r?\n/) のセグメントと 1:1(CRLF はセグメント末尾の外側)。
 */
export function locateAdoptedRows(content: string): AdoptedRow[] {
  const lines = content.split(/\r?\n/);
  // 行開始オフセット表: lineStart[i+1] = lineStart[i] + lines[i].length + EOL 長(\r\n=2 / \n=1)。
  const lineStarts: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    lineStarts[i] = offset;
    offset += lines[i]!.length;
    if (content[offset] === "\r") offset += 2;
    else if (content[offset] === "\n") offset += 1;
  }

  const { rows } = walkBoardTables(lines);
  const adopted: AdoptedRow[] = [];
  for (const row of rows) {
    const spans = cellSpansInLine(row.rawLine);
    const span = spans[row.stateCellIndex];
    if (!span) continue; // processRow が state を採用した行では起きない(防御)
    const cellRaw = row.rawLine.slice(span.start, span.end);
    const leading = cellRaw.length - cellRaw.trimStart().length;
    adopted.push({
      itemKey: row.item.itemKey,
      state: row.item.state,
      tokenStart: lineStarts[row.lineIndex]! + span.start + leading,
    });
  }
  return adopted;
}
