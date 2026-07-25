// 対象設計: docs/design/detail/ingestion-foundation.md §2.3(タグ初期語彙投入)
//          docs/design/basic/ingestion-foundation.md §1 やる-5(masters 由来語彙)
//
// 純関数: masters の MD(departments/roles/workflows)テキストから見出し・箇条書き項目を
// 抽出し、決定的に slug 化して {synonym, canonical} を返す。DB / ネットワーク依存なし。
// M1 はシンプル化のため synonym と canonical を同一値にする(将来の類義語統合は M2/M5)。

import type { TagVocabEntry } from "./normalize";

export type { TagVocabEntry };

const HEADING_RE = /^#{1,6}\s+(.+)$/;
const BULLET_RE = /^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/;

/** 見出し/箇条書きの生テキストを決定的に正規化する(空白1個区切り・小文字化)。 */
function slugify(raw: string): string {
  return raw
    .trim()
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * masters ファイル群(departments.md / roles.md / workflows.md 等)から
 * 見出し・箇条書き項目を抽出し、重複を除いた {synonym, canonical} 配列を返す。
 * 入力順・行順に対して決定的(同一入力→同一出力)。
 */
/**
 * DB の upsertTagSynonyms と同じ置換セマンティクスで vocab 配列を in-place 更新する
 * (同 synonym は canonical を置換・新規は末尾追加)。戻り値なし・決定的。
 * run-sync がラン内スナップショットへ masters 由来語彙を即時反映するために使う
 * (コールドスタートでも同一ラン内の後続ファイルにタグが付く — tag-cold-start 設計 §3)。
 */
export function mergeTagVocab(vocab: TagVocabEntry[], entries: TagVocabEntry[]): void {
  for (const entry of entries) {
    const existing = vocab.find((v) => v.synonym === entry.synonym);
    if (existing) {
      existing.canonical = entry.canonical;
    } else {
      vocab.push({ synonym: entry.synonym, canonical: entry.canonical });
    }
  }
}

export function buildTagVocab(
  files: { path: string; content: string }[]
): TagVocabEntry[] {
  const seen = new Set<string>();
  const vocab: TagVocabEntry[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const headingMatch = trimmed.match(HEADING_RE);
      const bulletMatch = !headingMatch ? trimmed.match(BULLET_RE) : null;
      const raw = headingMatch?.[1] ?? bulletMatch?.[1];
      if (!raw) continue;

      const slug = slugify(raw);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      vocab.push({ synonym: slug, canonical: slug });
    }
  }

  return vocab;
}
