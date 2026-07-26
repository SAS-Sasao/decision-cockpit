// 対象設計: docs/design/detail/wbs-loop.md §2.2(board-rewrite — 状態トークンの逆写像)
//
// locateAdoptedRows(parseBoard と同一 walker)で対象行を特定し、ステータスセルの
// トークン3バイトだけを同長スプライスで置換する。他のバイトには一切触れない
// (CRLF・パディング・skip 行は構造的に保存 — トークン3種は全て3バイト)。
import { locateAdoptedRows } from "./board";

const TOKEN: Record<"todo" | "doing" | "done", string> = {
  todo: "[ ]",
  doing: "[~]",
  done: "[x]",
};

/**
 * changed=false の2条件(§2.2): (i) 採用行に itemKey が無い (ii) 現トークンが既に desired。
 * 採用行は parseBoard と同一の先勝ち1行(重複 ID の2行目・skip 行は触らない)。
 */
export function rewriteBoardState(
  content: string,
  itemKey: string,
  desired: "todo" | "doing" | "done"
): { content: string; changed: boolean } {
  const row = locateAdoptedRows(content).find((r) => r.itemKey === itemKey);
  if (!row) return { content, changed: false };
  if (row.state === desired) return { content, changed: false };
  const next =
    content.slice(0, row.tokenStart) + TOKEN[desired] + content.slice(row.tokenStart + 3);
  return { content: next, changed: true };
}
