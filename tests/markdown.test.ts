// 対象設計: docs/design/basic/md-render.md §4-1(受け入れ条件)・§5(禁止事項)
//
// lib/ui/markdown.ts(純関数)と components/markdown.tsx(要素木)を検証する。
// DB/ネットワーク非接続。jsdom 不要 — components/markdown.tsx は関数として直接呼び、
// 返却された React 要素木を walk して検査する。
import { describe, expect, it } from "vitest";
import { isSafeHref, parseMarkdown, stripMarkdown } from "../lib/ui/markdown";
import { Markdown } from "../components/markdown";

// ---------------------------------------------------------------------------
// React 要素木の walk ユーティリティ(関数型要素=サブコンポーネントは呼び出して再帰)
// ---------------------------------------------------------------------------
type ElementLike = { type: unknown; props: Record<string, unknown> };

function isElementLike(node: unknown): node is ElementLike {
  return (
    !!node &&
    typeof node === "object" &&
    "type" in (node as Record<string, unknown>) &&
    "props" in (node as Record<string, unknown>)
  );
}

function walk(node: unknown, visit: (el: ElementLike) => void): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node === "string" || typeof node === "number") return;
  if (isElementLike(node)) {
    if (typeof node.type === "function") {
      const rendered = (node.type as (props: Record<string, unknown>) => unknown)(node.props);
      visit(node);
      walk(rendered, visit);
      return;
    }
    visit(node);
    walk(node.props?.children, visit);
    return;
  }
}

describe("parseMarkdown", () => {
  it("見出しレベル(# 〜 ######)", () => {
    const blocks = parseMarkdown("# H1\n## H2\n###### H6");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, inline: [{ kind: "text", text: "H1" }] },
      { kind: "heading", level: 2, inline: [{ kind: "text", text: "H2" }] },
      { kind: "heading", level: 6, inline: [{ kind: "text", text: "H6" }] },
    ]);
  });

  it("箇条書き(順序なし)", () => {
    const blocks = parseMarkdown("- a\n- b\n- c");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          [{ kind: "text", text: "a" }],
          [{ kind: "text", text: "b" }],
          [{ kind: "text", text: "c" }],
        ],
      },
    ]);
  });

  it("箇条書き(番号付き)", () => {
    const blocks = parseMarkdown("1. a\n2. b");
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: true,
        items: [
          [{ kind: "text", text: "a" }],
          [{ kind: "text", text: "b" }],
        ],
      },
    ]);
  });

  it("引用", () => {
    const blocks = parseMarkdown("> hello world");
    expect(blocks).toEqual([{ kind: "quote", inline: [{ kind: "text", text: "hello world" }] }]);
  });

  it("水平線", () => {
    const blocks = parseMarkdown("before\n---\nafter");
    expect(blocks).toEqual([
      { kind: "para", inline: [{ kind: "text", text: "before" }] },
      { kind: "hr" },
      { kind: "para", inline: [{ kind: "text", text: "after" }] },
    ]);
  });

  it("フェンスコード(内部の # は見出しにならない)", () => {
    const blocks = parseMarkdown("```\n# not a heading\nplain\n```");
    expect(blocks).toEqual([{ kind: "code", text: "# not a heading\nplain" }]);
  });

  it("強調・インラインコードの Inline トークン生成", () => {
    const blocks = parseMarkdown("**bold** and `code` text");
    expect(blocks).toEqual([
      {
        kind: "para",
        inline: [
          { kind: "strong", text: "bold" },
          { kind: "text", text: " and " },
          { kind: "code", text: "code" },
          { kind: "text", text: " text" },
        ],
      },
    ]);
  });

  it("fail-soft: 対応外記法(テーブル行)は段落トークンになる", () => {
    const blocks = parseMarkdown("| a | b |");
    expect(blocks).toEqual([{ kind: "para", inline: [{ kind: "text", text: "| a | b |" }] }]);
  });

  it("リンク(https → link トークン・URL 生値保持)", () => {
    const blocks = parseMarkdown("[decision log](https://example.com/x?y=1)");
    expect(blocks).toEqual([
      {
        kind: "para",
        inline: [{ kind: "link", text: "decision log", href: "https://example.com/x?y=1" }],
      },
    ]);
  });

  it("HTML タグ入力 → text トークンのまま(raw HTML 型が出ない)", () => {
    const blocks = parseMarkdown("<div>hello</div>");
    expect(blocks).toEqual([{ kind: "para", inline: [{ kind: "text", text: "<div>hello</div>" }] }]);
  });
});

describe("isSafeHref", () => {
  it("http:// / https:// を許可", () => {
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("https://example.com")).toBe(true);
  });

  it("javascript: を拒否", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
  });

  it("data: を拒否", () => {
    expect(isSafeHref("data:text/html,hi")).toBe(false);
  });

  it("大文字混在(JavaScript:)を拒否", () => {
    expect(isSafeHref("JavaScript:alert(1)")).toBe(false);
  });

  it("空白前置を拒否", () => {
    expect(isSafeHref(" javascript:alert(1)")).toBe(false);
  });

  it("// 相対を拒否", () => {
    expect(isSafeHref("//evil.example.com")).toBe(false);
  });
});

describe("Markdown 要素木検査", () => {
  it("javascript: リンクは type \"a\" の要素にならない", () => {
    const el = Markdown({ text: "[x](javascript:alert(1))" });
    let hasAnchor = false;
    walk(el, (node) => {
      if (node.type === "a") hasAnchor = true;
    });
    expect(hasAnchor).toBe(false);
  });

  it("https リンクは a + rel=noopener noreferrer + target=_blank を持つ", () => {
    const el = Markdown({ text: "[x](https://example.com)" });
    let found = false;
    walk(el, (node) => {
      if (
        node.type === "a" &&
        node.props.rel === "noopener noreferrer" &&
        node.props.target === "_blank"
      ) {
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("null は空描画(要素木が空)", () => {
    const el = Markdown({ text: null });
    let count = 0;
    walk(el, () => {
      count += 1;
    });
    expect(count).toBe(0);
  });

  it("空文字は空描画(要素木が空)", () => {
    const el = Markdown({ text: "" });
    let count = 0;
    walk(el, () => {
      count += 1;
    });
    expect(count).toBe(0);
  });
});

describe("stripMarkdown", () => {
  it("見出し記号を除去", () => {
    expect(stripMarkdown("# Heading")).toBe("Heading");
  });

  it("箇条書きマーカー(- / *)を除去", () => {
    expect(stripMarkdown("- item")).toBe("item");
    expect(stripMarkdown("* item")).toBe("item");
  });

  it("番号付きリスト(1. 形式)を除去", () => {
    expect(stripMarkdown("1. item")).toBe("item");
  });

  it("引用記号を除去", () => {
    expect(stripMarkdown("> quoted")).toBe("quoted");
  });

  it("フェンス行を除去", () => {
    expect(stripMarkdown("```\ncode\n```")).toBe("\ncode\n");
  });

  it("強調・インラインコード・リンクを除去", () => {
    expect(stripMarkdown("**bold** and `code` and [link](https://example.com)")).toBe(
      "bold and code and link"
    );
  });

  it("切断入力(閉じない **)で throw しない", () => {
    expect(() => stripMarkdown("**bold text without close")).not.toThrow();
  });

  it("切断入力(途中で切れたリンク)で throw しない", () => {
    expect(() => stripMarkdown("[text](https://example.com/very-lo")).not.toThrow();
  });

  it("空文字・null で安全", () => {
    expect(stripMarkdown("")).toBe("");
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown(undefined)).toBe("");
  });
});
