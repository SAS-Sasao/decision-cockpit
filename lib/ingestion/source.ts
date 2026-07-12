import "server-only";

// 対象設計: docs/design/detail/ingestion-foundation.md §2.1(SourceAdapter)
//          docs/design/basic/ingestion-foundation.md §2(アーキテクチャ上の位置づけ)
//
// GitHub への唯一の経路となる差し替え可能なアダプタ契約。実装は
// lib/ingestion/github-source.ts(実 GitHub)/ lib/ingestion/fixture-source.ts
// (テスト・受け入れ用のローカル fixture)の2種。run-sync.ts はこの IF のみに依存する。

export type SourceFile = { path: string; content: string };

export interface SourceAdapter {
  repo: "cc-sier-organization" | "ai-war-room";
  /** HEAD の commit sha(1回の run 内では最初に取得した値を以降も使う契約)。 */
  head(): Promise<string>;
  /** base からの変更パス一覧。base=null は「全量走査」を意味する 'full' を返す契約。 */
  changedPaths(base: string | null): Promise<string[] | "full">;
  /** 全量走査時の候補パス列挙。 */
  listPaths(): Promise<string[]>;
  /** ファイル本文(text)。存在しない場合は SourceNotFoundError を throw する契約。 */
  fetch(path: string): Promise<string>;
}

/**
 * fetch(path) 対象が存在しない(= 削除済みとみなす)ことを表す typed error。
 * 一時的な失敗(ネットワーク/レート制限等)と区別するため、他の throw とは
 * 別クラスにする(run-sync.ts が instanceof で分岐する)。
 */
export class SourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNotFoundError";
  }
}
