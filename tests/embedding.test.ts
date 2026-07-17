// 対象設計: docs/design/detail/search-foundation.md §2.2 / §3(tests/embedding.test.ts)
//
// FixtureEmbedder / l2normalize / dispatch fail-closed / 有効モデル識別子 / production 拒否を
// 実ネットワークなし(EMBEDDING_SOURCE=fixture・または throw 経路のみ)で検証する。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEmbeddingClient,
  currentEmbeddingModel,
  isFixtureMode,
  l2normalize,
} from "../lib/search/embedding";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.EMBEDDING_SOURCE;
  delete process.env.VERCEL_ENV;
  delete process.env.EMBEDDING_API_KEY;
  process.env.EMBEDDING_MODEL = "text-embedding-3-small";
  process.env.EMBEDDING_DIM = "8"; // テスト高速化のための小次元(契約上は任意の正数でよい)
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

describe("FixtureEmbedder — 決定性・次元・単位ノルム", () => {
  it("同一入力2回 → 同一ベクトル(決定的)", async () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    const client = createEmbeddingClient();
    const [a] = await client.embed(["同じテキスト"]);
    const [b] = await client.embed(["同じテキスト"]);
    expect(a).toEqual(b);
  });

  it("次元 = EMBEDDING_DIM・単位ノルム(|v|-1 < 1e-6)", async () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    const client = createEmbeddingClient();
    const [v] = await client.embed(["何かのテキスト"]);
    expect(v).toHaveLength(8);
    expect(Math.abs(norm(v) - 1)).toBeLessThan(1e-6);
  });

  it("異なる入力は異なるベクトルを返す", async () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    const client = createEmbeddingClient();
    const [a, b] = await client.embed(["テキストA", "テキストB"]);
    expect(a).not.toEqual(b);
  });
});

describe("l2normalize — 数理", () => {
  it("非正規化入力 → ノルム1", () => {
    const v = l2normalize([3, 4, 0]);
    expect(Math.abs(norm(v) - 1)).toBeLessThan(1e-10);
  });

  it("冪等(既に正規化済みの入力に適用しても不変)", () => {
    const once = l2normalize([3, 4, 0]);
    const twice = l2normalize(once);
    expect(twice[0]).toBeCloseTo(once[0]!, 10);
    expect(twice[1]).toBeCloseTo(once[1]!, 10);
    expect(twice[2]).toBeCloseTo(once[2]!, 10);
  });

  it("ゼロベクトルは不変を返す(ゼロ除算しない)", () => {
    expect(l2normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("ApiEmbedder dispatch — fail-closed(不明名・未設定・空文字 → throw)", () => {
  it("不明なモデル名 → throw(既定フォールバックしない)", async () => {
    process.env.EMBEDDING_MODEL = "models/some-other-provider";
    const client = createEmbeddingClient();
    await expect(client.embed(["x"])).rejects.toThrow();
  });

  it("EMBEDDING_MODEL 未設定 → throw", async () => {
    delete process.env.EMBEDDING_MODEL;
    const client = createEmbeddingClient();
    await expect(client.embed(["x"])).rejects.toThrow();
  });

  it("EMBEDDING_MODEL 空文字 → throw", async () => {
    process.env.EMBEDDING_MODEL = "";
    const client = createEmbeddingClient();
    await expect(client.embed(["x"])).rejects.toThrow();
  });
});

describe("有効モデル識別子 — currentEmbeddingModel()", () => {
  it("fixture モード → `fixture:${model}` プレフィクス", () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    expect(currentEmbeddingModel()).toBe("fixture:text-embedding-3-small");
  });

  it("通常モード → ベア名(プレフィクスなし)", () => {
    expect(currentEmbeddingModel()).toBe("text-embedding-3-small");
  });

  it("EMBEDDING_MODEL 未設定・空文字はどちらのモードでも throw(対称 fail-closed)", () => {
    delete process.env.EMBEDDING_MODEL;
    expect(() => currentEmbeddingModel()).toThrow();

    process.env.EMBEDDING_SOURCE = "fixture";
    process.env.EMBEDDING_MODEL = "";
    expect(() => currentEmbeddingModel()).toThrow();
  });
});

describe("createEmbeddingClient — 選択 ↔ 識別子プレフィクスのペアリング一致", () => {
  it("fixture モード: EMBEDDING_API_KEY 未設定でも embed が成功する(= FixtureEmbedder が選ばれている)し、識別子は fixture: プレフィクス", async () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    delete process.env.EMBEDDING_API_KEY;
    const client = createEmbeddingClient();
    await expect(client.embed(["x"])).resolves.toBeDefined();
    expect(currentEmbeddingModel().startsWith("fixture:")).toBe(true);
  });

  it("通常モード: EMBEDDING_API_KEY 未設定だと embed が throw する(= ApiEmbedder が選ばれている)し、識別子はベア名", async () => {
    delete process.env.EMBEDDING_SOURCE;
    delete process.env.EMBEDDING_API_KEY;
    const client = createEmbeddingClient();
    await expect(client.embed(["x"])).rejects.toThrow();
    expect(currentEmbeddingModel().startsWith("fixture:")).toBe(false);
  });
});

describe("production 拒否 — EMBEDDING_SOURCE=fixture + VERCEL_ENV=production", () => {
  it("isFixtureMode() が throw する", () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    process.env.VERCEL_ENV = "production";
    expect(() => isFixtureMode()).toThrow();
  });

  it("currentEmbeddingModel() 経由でも throw する(isFixtureMode 共用)", () => {
    process.env.EMBEDDING_SOURCE = "fixture";
    process.env.VERCEL_ENV = "production";
    expect(() => currentEmbeddingModel()).toThrow();
  });

  it("production でも EMBEDDING_SOURCE が fixture でなければ throw しない", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => isFixtureMode()).not.toThrow();
    expect(isFixtureMode()).toBe(false);
  });
});
