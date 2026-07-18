// 対象設計: docs/design/detail/org-docs-ingestion.md §2.1(chunkMarkdown)/ §3(tests/chunk.test.ts)
//
// chunkMarkdown() は純関数(DB/ネットワーク非依存)なのでインライン markdown のみで検証する。
import { describe, expect, it } from "vitest";
import { chunkMarkdown, CHUNK_MAX_CHARS } from "../lib/ingestion/chunk";

describe("chunkMarkdown — 見出し分割(h2/h3 階層パス)", () => {
  it("h2 単独 → h2>h3 の階層 → h2 単独、の順で headingPath が変化する", () => {
    const md = [
      "# タイトル",
      "## 見出しA",
      "本文A",
      "",
      "### 見出しB",
      "本文B",
      "",
      "### 見出しC",
      "本文C",
      "",
      "## 見出しD",
      "本文D",
    ].join("\n");

    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.headingPath)).toEqual([
      ["見出しA"],
      ["見出しA", "見出しB"],
      ["見出しA", "見出しC"],
      ["見出しD"],
    ]);
    expect(chunks.map((c) => c.text)).toEqual(["本文A", "本文B", "本文C", "本文D"]);
  });

  it("h3 が h2 なしで単独出現した場合は h3 のみのパスになる", () => {
    const md = ["# タイトル", "### 単独h3", "本文"].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["単独h3"]);
  });

  it("h4 は分割点にならない(見出しパスに現れず、ブロックに内包される)", () => {
    const md = ["# タイトル", "## 見出しA", "本文A1", "", "#### 内部見出し", "本文A2"].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["見出しA"]);
    expect(chunks[0]!.text).toContain("#### 内部見出し");
    expect(chunks[0]!.text).toContain("本文A1");
    expect(chunks[0]!.text).toContain("本文A2");
  });
});

describe("chunkMarkdown — 前文(headingPath 空)", () => {
  it("H1 直後〜最初の見出しの前文は headingPath 空のチャンクになる", () => {
    const md = ["# タイトル", "前文の本文。", "", "## 見出しA", "本文A"].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks[0]!.headingPath).toEqual([]);
    expect(chunks[0]!.text).toBe("前文の本文。");
    expect(chunks[1]!.headingPath).toEqual(["見出しA"]);
  });

  it("前文が無ければ(H1 直後が見出し)前文チャンクは生成されない", () => {
    const md = ["# タイトル", "## 見出しA", "本文A"].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["見出しA"]);
  });
});

describe("chunkMarkdown — 500字超ブロックの貪欲段落再結合", () => {
  it("2段落(各 ≤500字・連結後 >500字)は必ず2チャンクに分割される", () => {
    const p1 = "a".repeat(300);
    const p2 = "b".repeat(300);
    const md = ["# タイトル", "## 見出しA", p1, "", p2].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toBe(p1);
    expect(chunks[1]!.text).toBe(p2);
    expect(chunks[0]!.headingPath).toEqual(["見出しA"]);
    expect(chunks[1]!.headingPath).toEqual(["見出しA"]);
  });

  it("3段落は貪欲結合の境界どおりに一部だけまとまる(全部は結合されない)", () => {
    const p1 = "a".repeat(300);
    const p2 = "b".repeat(300);
    const p3 = "c".repeat(10);
    // p1 単独で 500 超にはならないが p1+p2 は 602 で超過 → p1 は単独チャンク。
    // p2+p3 は 312 で 500 以内 → 結合される。
    const md = ["# タイトル", "## 見出しA", p1, "", p2, "", p3].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toBe(p1);
    expect(chunks[1]!.text).toBe(`${p2}\n\n${p3}`);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });
});

describe("chunkMarkdown — 単一段落500字超の機械分割", () => {
  it("500字を超える単一段落は500字ごとに機械分割される", () => {
    const long = "z".repeat(1200);
    const md = ["# タイトル", "## 見出しA", long].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.text).toBe(long.slice(0, 500));
    expect(chunks[1]!.text).toBe(long.slice(500, 1000));
    expect(chunks[2]!.text).toBe(long.slice(1000, 1200));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });
});

describe("chunkMarkdown — 決定性(同一入力 → 同一 Chunk 列)", () => {
  it("同一 markdown を2回チャンク化すると同じ結果になる", () => {
    const md = ["# タイトル", "## A", "本文A", "", "## B", "b".repeat(600)].join("\n");
    const first = chunkMarkdown(md);
    const second = chunkMarkdown(md);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("chunkMarkdown — フェンス内見出しで分割しない", () => {
  it("```内の ## 行は分割点にならず本文として保持される", () => {
    const md = [
      "# タイトル",
      "## 見出しA",
      "本文A",
      "```md",
      "## フェイク見出し",
      "```",
      "続きの本文",
    ].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["見出しA"]);
    expect(chunks[0]!.text).toContain("## フェイク見出し");
    expect(chunks[0]!.text).toContain("続きの本文");
  });
});

describe("chunkMarkdown — 空文書・frontmatter のみ", () => {
  it("空文書は空配列を返す", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("frontmatter のみ(本文なし)は空配列を返す", () => {
    const md = ["---", "date: 2026-07-01", "---", ""].join("\n");
    expect(chunkMarkdown(md)).toEqual([]);
  });
});

describe("chunkMarkdown — 全チャンク ≤ 500字", () => {
  it("様々なブロック長でも全チャンクが500字以内になる", () => {
    const md = [
      "# タイトル",
      "前文",
      "",
      "## A",
      "a".repeat(500),
      "",
      "## B",
      "b".repeat(700),
      "",
      "## C",
      "c".repeat(50),
      "",
      "d".repeat(50),
    ].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });
});
