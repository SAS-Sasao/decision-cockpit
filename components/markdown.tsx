// 対象設計: docs/design/basic/md-render.md §1-2(components/markdown.tsx)
//
// Server Component。lib/ui/markdown.ts の parseMarkdown の結果を JSX に描画する。
// innerHTML 系 API は使わない(文字列は React の自動エスケープを必ず通る)。
// リンク href は isSafeHref の allowlist(http/https のみ)を通った場合のみ <a> 化する。
import type { Block, Inline } from "../lib/ui/markdown";
import { isSafeHref, parseMarkdown } from "../lib/ui/markdown";

function headingTag(level: number): "h3" | "h4" | "h5" | "h6" {
  if (level <= 1) return "h3";
  if (level === 2) return "h4";
  if (level === 3) return "h5";
  return "h6";
}

function headingSize(level: number): number {
  if (level <= 1) return 16;
  if (level === 2) return 15;
  return 14;
}

function renderInline(inline: Inline[]) {
  return inline.map((tok, i) => {
    if (tok.kind === "link") {
      if (isSafeHref(tok.href)) {
        return (
          <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            {tok.text}
          </a>
        );
      }
      return <span key={i}>{tok.text}</span>;
    }
    if (tok.kind === "strong") return <strong key={i}>{tok.text}</strong>;
    if (tok.kind === "code") {
      return (
        <code
          key={i}
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--panel-row)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          {tok.text}
        </code>
      );
    }
    // text
    return <span key={i}>{tok.text}</span>;
  });
}

function renderBlock(block: Block, key: number) {
  switch (block.kind) {
    case "heading": {
      const Tag = headingTag(block.level);
      return (
        <Tag key={key} style={{ fontSize: headingSize(block.level), fontWeight: 600, margin: "14px 0 6px" }}>
          {renderInline(block.inline)}
        </Tag>
      );
    }
    case "para":
      return (
        <p key={key} style={{ lineHeight: 1.7, margin: "0 0 10px" }}>
          {renderInline(block.inline)}
        </p>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={key} style={{ paddingLeft: 20, margin: "0 0 10px", lineHeight: 1.7 }}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ListTag>
      );
    }
    case "quote":
      return (
        <blockquote
          key={key}
          style={{
            borderLeft: "3px solid var(--line)",
            color: "var(--text-sub)",
            margin: "0 0 10px",
            padding: "2px 0 2px 12px",
          }}
        >
          {renderInline(block.inline)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={key}
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--panel-row)",
            padding: 10,
            borderRadius: 6,
            overflowX: "auto",
            margin: "0 0 10px",
          }}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "hr":
      return <hr key={key} style={{ border: "none", borderTop: "1px solid var(--line)", margin: "12px 0" }} />;
    case "table":
      return (
        <div key={key} style={{ overflowX: "auto", marginBottom: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    style={{
                      fontWeight: 600,
                      background: "var(--panel-row)",
                      border: "1px solid var(--line)",
                      padding: "6px 10px",
                      textAlign: "left",
                    }}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{ border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" }}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

/** Markdown 本文をレンダリングする。null・空文字は空描画。 */
export function Markdown({ text }: { text: string | null }) {
  if (!text) return null;
  const blocks = parseMarkdown(text);
  return <div>{blocks.map((block, i) => renderBlock(block, i))}</div>;
}
