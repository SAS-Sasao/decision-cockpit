// 対象設計: docs/design/detail/ingestion-foundation.md §2.3(タグ初期語彙投入)/ §3(tests/ingestion/tag-vocab.test.ts)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTagVocab, mergeTagVocab } from "../../lib/ingestion/tag-vocab";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MASTERS_DIR = join(
  REPO_ROOT,
  "fixtures",
  "cc-sier-organization",
  ".companies",
  "demo-org",
  "masters"
);

function loadMasters(): { path: string; content: string }[] {
  return ["departments.md", "roles.md", "workflows.md"].map((name) => ({
    path: `masters/${name}`,
    content: readFileSync(join(MASTERS_DIR, name), "utf8"),
  }));
}

describe("buildTagVocab", () => {
  it("見出し・箇条書き項目を slug 化して {synonym, canonical} を返す(synonym=canonical)", () => {
    const vocab = buildTagVocab(loadMasters());
    expect(vocab.length).toBeGreaterThan(0);
    for (const entry of vocab) {
      expect(entry.synonym).toBe(entry.canonical);
      expect(entry.synonym).toBe(entry.synonym.toLowerCase());
    }
  });

  it("departments.md の部署名が語彙に含まれる", () => {
    const vocab = buildTagVocab(loadMasters());
    const synonyms = vocab.map((v) => v.synonym);
    expect(synonyms).toContain("小売ドメイン室");
    expect(synonyms).toContain("技術リサーチ室");
  });

  it("roles.md の箇条書きロール名が語彙に含まれる", () => {
    const vocab = buildTagVocab(loadMasters());
    const synonyms = vocab.map((v) => v.synonym);
    expect(synonyms).toContain("retail-domain-researcher");
    expect(synonyms).toContain("tech-researcher");
  });

  it("重複する見出し/項目は1つにまとめられる", () => {
    const vocab = buildTagVocab([
      { path: "a.md", content: "# 重複見出し\n- 重複見出し\n" },
    ]);
    const synonyms = vocab.map((v) => v.synonym);
    const count = synonyms.filter((s) => s === "重複見出し").length;
    expect(count).toBe(1);
  });

  it("同一入力から同一出力(決定性)", () => {
    const masters = loadMasters();
    const a = buildTagVocab(masters);
    const b = buildTagVocab(masters);
    expect(a).toEqual(b);
  });
});

describe("mergeTagVocab — DB upsert と同じ置換セマンティクスの in-place マージ", () => {
  it("同 synonym は canonical を置換する", () => {
    const vocab = [{ synonym: "営業部", canonical: "営業部" }];
    mergeTagVocab(vocab, [{ synonym: "営業部", canonical: "セールス" }]);
    expect(vocab).toEqual([{ synonym: "営業部", canonical: "セールス" }]);
  });

  it("新規 synonym は末尾に追加する", () => {
    const vocab = [{ synonym: "営業部", canonical: "営業部" }];
    mergeTagVocab(vocab, [{ synonym: "開発部", canonical: "開発部" }]);
    expect(vocab).toEqual([
      { synonym: "営業部", canonical: "営業部" },
      { synonym: "開発部", canonical: "開発部" },
    ]);
  });

  it("空 entries では vocab を変更しない", () => {
    const vocab = [{ synonym: "営業部", canonical: "営業部" }];
    mergeTagVocab(vocab, []);
    expect(vocab).toEqual([{ synonym: "営業部", canonical: "営業部" }]);
  });
});
