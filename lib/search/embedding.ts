import "server-only";

// 対象設計: docs/design/detail/search-foundation.md §2.2(EmbeddingClient IF・dispatch fail-closed)
//          docs/design/basic/search-foundation.md §1-1(モデル固定・切替構造・有効モデル識別子)
//
// EMBEDDING_MODEL / EMBEDDING_DIM / EMBEDDING_API_KEY の env 参照、モデル名リテラル、
// 送信先 URL の参照はこのファイルに限定する(受け入れ条件5 の ⊆ 判定)。
// embed-index.ts / lib/data/knowledge.ts は currentEmbeddingModel() / createEmbeddingClient()
// 経由でのみこのモジュールを利用する。

import { createHash } from "node:crypto";

export type EmbeddingClient = { embed(texts: string[]): Promise<number[][]> };

const MAX_BATCH_SIZE = 100;

/**
 * EMBEDDING_SOURCE === "fixture" の厳密等値(SYNC_SOURCE 前例と同型)。
 * VERCEL_ENV === "production" で fixture 指定は throw(production 拒否)。
 * createEmbeddingClient() / currentEmbeddingModel() の両方がこの単一述語を共用する
 * (選択と識別子プレフィクスの書き分けによる乖離を防ぐ — §2.2)。
 */
export function isFixtureMode(): boolean {
  const fixture = process.env.EMBEDDING_SOURCE === "fixture";
  if (fixture && process.env.VERCEL_ENV === "production") {
    throw new Error(
      "[lib/search/embedding] EMBEDDING_SOURCE=fixture is not allowed when VERCEL_ENV=production"
    );
  }
  return fixture;
}

/** EMBEDDING_MODEL は fixture / 実API のどちらでも必須(未設定・空文字は throw — 対称 fail-closed)。 */
function requireModelName(): string {
  const model = process.env.EMBEDDING_MODEL;
  if (!model) {
    throw new Error("[lib/search/embedding] EMBEDDING_MODEL is required and must not be empty");
  }
  return model;
}

function requireDim(): number {
  const raw = process.env.EMBEDDING_DIM;
  const dim = raw ? Number(raw) : NaN;
  if (!Number.isFinite(dim) || dim <= 0) {
    throw new Error("[lib/search/embedding] EMBEDDING_DIM is required and must be a positive number");
  }
  return dim;
}

/**
 * 有効モデル識別子(基本設計 §1-1)。embed-index.ts の記録・比較と knowledge.ts の検索ガードの
 * 両方がこの関数経由でのみ取得する(env 直参照は禁止)。
 */
export function currentEmbeddingModel(): string {
  const model = requireModelName();
  return isFixtureMode() ? `fixture:${model}` : model;
}

/** L2 正規化(純関数)。ゼロベクトルはそのまま返す。 */
export function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

// ---------------------------------------------------------------------------
// FixtureEmbedder — 決定的(sha256 種)・実ネットワークなし・正規化済み
// ---------------------------------------------------------------------------

function fixtureRawVector(text: string, dim: number): number[] {
  const values: number[] = [];
  let round = 0;
  let digest = createHash("sha256").update(text, "utf8").digest();
  let offset = 0;
  while (values.length < dim) {
    if (offset >= digest.length) {
      round += 1;
      digest = createHash("sha256").update(`${text}::${round}`, "utf8").digest();
      offset = 0;
    }
    const byte = digest[offset]!;
    offset += 1;
    values.push((byte / 255) * 2 - 1); // [-1, 1]
  }
  return values;
}

class FixtureEmbedder implements EmbeddingClient {
  async embed(texts: string[]): Promise<number[][]> {
    const dim = requireDim();
    return texts.map((text) => l2normalize(fixtureRawVector(text, dim)));
  }
}

// ---------------------------------------------------------------------------
// ApiEmbedder — fail-closed dispatch(text-embedding- → OpenAI / gemini- → Google)
// ---------------------------------------------------------------------------

function chunkTexts(texts: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < texts.length; i += size) out.push(texts.slice(i, i + size));
  return out;
}

async function embedOpenAI(
  batch: string[],
  model: string,
  dim: number,
  apiKey: string
): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: batch, dimensions: dim }),
  });
  if (!res.ok) {
    throw new Error(`[lib/search/embedding] OpenAI embeddings request failed: ${res.status}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

async function embedGoogle(
  batch: string[],
  model: string,
  dim: number,
  apiKey: string
): Promise<number[][]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dim,
        })),
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`[lib/search/embedding] Google embeddings request failed: ${res.status}`);
  }
  const json = (await res.json()) as { embeddings: { values: number[] }[] };
  return json.embeddings.map((e) => l2normalize(e.values));
}

class ApiEmbedder implements EmbeddingClient {
  async embed(texts: string[]): Promise<number[][]> {
    const model = requireModelName();
    const dim = requireDim();

    let dispatch: (batch: string[], apiKey: string) => Promise<number[][]>;
    if (model.startsWith("text-embedding-")) {
      dispatch = (batch, apiKey) => embedOpenAI(batch, model, dim, apiKey);
    } else if (model.startsWith("gemini-")) {
      dispatch = (batch, apiKey) => embedGoogle(batch, model, dim, apiKey);
    } else {
      // fail-closed: 未知の名前(修飾表記含む)・想定外の値は既定フォールバックせず throw する
      throw new Error(`[lib/search/embedding] unknown EMBEDDING_MODEL provider: ${model}`);
    }

    const apiKey = process.env.EMBEDDING_API_KEY;
    if (!apiKey) {
      throw new Error("[lib/search/embedding] EMBEDDING_API_KEY is required for API embedding");
    }

    const results: number[][] = [];
    for (const batch of chunkTexts(texts, MAX_BATCH_SIZE)) {
      results.push(...(await dispatch(batch, apiKey)));
    }
    return results;
  }
}

/** isFixtureMode() を factory と currentEmbeddingModel() が共用する(選択 ↔ 識別子のペアリング一致)。 */
export function createEmbeddingClient(): EmbeddingClient {
  return isFixtureMode() ? new FixtureEmbedder() : new ApiEmbedder();
}
