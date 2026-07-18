// 対象設計: docs/design/detail/today-view.md §2.1(parseBoard)/ §3(tests/board-parser.test.ts)
//
// 実 DB・実ネットワークなし。純関数 parseBoard の契約(列同定・状態写像・スキップ規定・
// section 追跡・サニタイズ・決定性)を fixture 相当のインライン markdown で検証する。
import { describe, expect, it } from "vitest";
import { parseBoard } from "../lib/ingestion/parsers/board";
import type { SourceFile } from "../lib/ingestion/parsers/types";

function file(content: string, path = ".companies/demo-org/docs/secretary/demo-wbs.md"): SourceFile {
  return { path, content };
}

describe("parseBoard — 状態3値変換", () => {
  it("[ ]→todo, [~]→doing, [x]→done に完全一致でのみ変換する", () => {
    const content = [
      "## セクションA",
      "",
      "| WBS | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | タスク1 | [ ] |",
      "| W-2 | タスク2 | [~] |",
      "| W-3 | タスク3 | [x] |",
      "",
    ].join("\n");
    const { items, skippedRows } = parseBoard(file(content));
    expect(skippedRows).toBe(0);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.state)).toEqual(["todo", "doing", "done"]);
  });
});

describe("parseBoard — ヘッダ名ベースの列同定(並び替え耐性・完全一致・先勝ち)", () => {
  it("列順が入れ替わっていても正しく対応する", () => {
    const content = [
      "| ステータス | WBS | 担当 | タスク |",
      "|---|---|---|---|",
      "| [ ] | W-9 | 田中 | 並び替えタスク |",
      "",
    ].join("\n");
    const { items, skippedRows } = parseBoard(file(content));
    expect(skippedRows).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      itemKey: "W-9",
      title: "並び替えタスク",
      assignee: "田中",
      state: "todo",
    });
  });

  it("同名ヘッダが複数あれば先勝ち", () => {
    const content = [
      "| WBS | ステータス | WBS | タスク |",
      "|---|---|---|---|",
      "| W-1 | [ ] | W-DUP | 先勝ちタスク |",
      "",
    ].join("\n");
    const { items } = parseBoard(file(content));
    expect(items).toHaveLength(1);
    expect(items[0]!.itemKey).toBe("W-1");
  });

  it("ヘッダ名は完全一致のみ(部分一致は不一致扱い)", () => {
    const content = [
      "| WBS番号 | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | タスク1 | [ ] |",
      "",
    ].join("\n");
    const { items, skippedRows } = parseBoard(file(content));
    // WBS 列が同定できないため対象外テーブル(非計上)
    expect(items).toHaveLength(0);
    expect(skippedRows).toBe(0);
  });
});

describe("parseBoard — 対象外テーブル非計上", () => {
  it("WBS/ステータスを含まない表(マイルストーン表等)は items/skippedRows どちらにも計上されない", () => {
    const content = [
      "| マイルストーン | 日付 |",
      "|---|---|",
      "| M1 | 2026-08-01 |",
      "| M2 |  |",
      "",
    ].join("\n");
    const { items, skippedRows } = parseBoard(file(content));
    expect(items).toHaveLength(0);
    expect(skippedRows).toBe(0);
  });
});

describe("parseBoard — スキップ4種(状態外・空ID・重複ID2件目・必須セル欠落)+ skippedRows 計上", () => {
  it("各カテゴリ1行ずつスキップされ、有効行のみ items に残る", () => {
    const content = [
      "| WBS | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | 有効タスク | [ ] |",
      "| W-2 | 状態外タスク | [?] |",
      "|  | ID空タスク | [ ] |",
      "| W-1 | 重複タスク | [~] |",
      "| W-3 |  | [x] |",
      "",
    ].join("\n");
    const { items, skippedRows } = parseBoard(file(content));
    expect(skippedRows).toBe(4);
    expect(items).toHaveLength(1);
    expect(items[0]!.itemKey).toBe("W-1");
    expect(items[0]!.title).toBe("有効タスク");
  });

  it("重複IDは行順で2件目以降がスキップされ、seen 集合には有効行の ID のみ登録される", () => {
    const content = [
      "| WBS | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | 1件目 | [ ] |",
      "| W-1 | 2件目(重複) | [~] |",
      "| W-1 | 3件目(重複) | [x] |",
      "",
    ].join("\n");
    const { items, skippedRows } = parseBoard(file(content));
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("1件目");
    expect(skippedRows).toBe(2);
  });

  it("ヘッダ行・区切り行は行としてカウントされない(全行有効なら skippedRows=0)", () => {
    const content = [
      "| WBS | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | タスク1 | [ ] |",
      "",
    ].join("\n");
    const { skippedRows } = parseBoard(file(content));
    expect(skippedRows).toBe(0);
  });
});

describe("parseBoard — section 追跡", () => {
  it("直近の ##/### 見出しを section として付与し、フェンス内の見出し様行は無視する", () => {
    const content = [
      "## 大セクション",
      "",
      "```",
      "### フェンス内見出し(無視される)",
      "```",
      "",
      "### 小セクション",
      "",
      "| WBS | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | タスク1 | [ ] |",
      "",
    ].join("\n");
    const { items } = parseBoard(file(content));
    expect(items[0]!.section).toBe("小セクション");
  });

  it("見出しが無ければ section は null", () => {
    const content = ["| WBS | タスク | ステータス |", "|---|---|---|", "| W-1 | タスク1 | [ ] |", ""].join(
      "\n"
    );
    const { items } = parseBoard(file(content));
    expect(items[0]!.section).toBeNull();
  });
});

describe("parseBoard — sanitizeAbsPaths", () => {
  it("title/assignee/period/deliverable/section/issueRef の絶対パスがファイル名のみに切り詰められる", () => {
    const content = [
      "## /home/user/secret-section",
      "",
      "| WBS | タスク | 担当 | 期間 | 成果物 | Issue | ステータス |",
      "|---|---|---|---|---|---|---|",
      "| W-1 | /home/user/task.md | /Users/alice/name | /home/x/period.txt | /home/y/deliver.pdf | /home/z/issue.md | [ ] |",
      "",
    ].join("\n");
    const { items } = parseBoard(file(content));
    const item = items[0]!;
    expect(item.title).toBe("task.md");
    expect(item.assignee).toBe("name");
    expect(item.period).toBe("period.txt");
    expect(item.deliverable).toBe("deliver.pdf");
    expect(item.issueRef).toBe("issue.md");
    expect(item.section).toBe("secret-section");
  });
});

describe("parseBoard — 決定性", () => {
  it("同一入力を2回パースしても同じ結果になる", () => {
    const content = [
      "| WBS | タスク | ステータス |",
      "|---|---|---|",
      "| W-1 | タスク1 | [ ] |",
      "| W-2 | タスク2 | [~] |",
      "",
    ].join("\n");
    const f = file(content);
    const first = parseBoard(f);
    const second = parseBoard(f);
    expect(first).toEqual(second);
  });
});
