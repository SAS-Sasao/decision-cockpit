// 対象設計: docs/design/detail/capture-spar.md §2.3(lib/spar/llm.ts)/ §3(tests/spar-llm.test.ts)
// fetch をモックし、process.env は beforeEach/afterEach で自己管理する(実ネットワークなし)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SparConfigError, SparUpstreamError, callChat, getSparConfig, getSparGuards } from "../lib/spar/llm";

const ORIGINAL_ENV = { ...process.env };

const SPAR_ENV_KEYS = [
  "SPAR_PROVIDER",
  "SPAR_MODEL",
  "SPAR_API_KEY",
  "SPAR_MAX_TURNS",
  "SPAR_CTX_TOPK",
  "SPAR_MAX_INPUT_CHARS",
  "SPAR_MAX_TOKENS",
] as const;

function clearSparEnv(): void {
  for (const key of SPAR_ENV_KEYS) delete process.env[key];
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearSparEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function setFullConfig(): void {
  process.env.SPAR_PROVIDER = "openai";
  process.env.SPAR_MODEL = "gpt-4o-mini";
  process.env.SPAR_API_KEY = "sk-test-dummy-key";
}

describe("getSparConfig", () => {
  it("SPAR_PROVIDER 欠落 → SparConfigError", () => {
    setFullConfig();
    delete process.env.SPAR_PROVIDER;
    expect(() => getSparConfig()).toThrow(SparConfigError);
  });

  it("SPAR_MODEL 欠落 → SparConfigError", () => {
    setFullConfig();
    delete process.env.SPAR_MODEL;
    expect(() => getSparConfig()).toThrow(SparConfigError);
  });

  it("SPAR_API_KEY 欠落 → SparConfigError", () => {
    setFullConfig();
    delete process.env.SPAR_API_KEY;
    expect(() => getSparConfig()).toThrow(SparConfigError);
  });

  it("3env いずれかが空文字 → SparConfigError", () => {
    setFullConfig();
    process.env.SPAR_PROVIDER = "";
    expect(() => getSparConfig()).toThrow(SparConfigError);

    setFullConfig();
    process.env.SPAR_MODEL = "";
    expect(() => getSparConfig()).toThrow(SparConfigError);

    setFullConfig();
    process.env.SPAR_API_KEY = "";
    expect(() => getSparConfig()).toThrow(SparConfigError);
  });

  it("未知 provider → SparConfigError", () => {
    setFullConfig();
    process.env.SPAR_PROVIDER = "anthropic";
    expect(() => getSparConfig()).toThrow(SparConfigError);
  });

  it("3env 揃い(provider=openai) → 成立", () => {
    setFullConfig();
    expect(getSparConfig()).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test-dummy-key",
    });
  });
});

describe("getSparGuards", () => {
  it("既定値 8/3/2000/1024", () => {
    expect(getSparGuards()).toEqual({
      maxTurns: 8,
      ctxTopK: 3,
      maxInputChars: 2000,
      maxTokens: 1024,
    });
  });

  it("クランプ: TURNS 1..20 / TOPK 1..20 / INPUT 1..8000 / TOKENS 1..4096", () => {
    process.env.SPAR_MAX_TURNS = "0";
    process.env.SPAR_CTX_TOPK = "0";
    process.env.SPAR_MAX_INPUT_CHARS = "0";
    process.env.SPAR_MAX_TOKENS = "0";
    expect(getSparGuards()).toEqual({
      maxTurns: 1,
      ctxTopK: 1,
      maxInputChars: 1,
      maxTokens: 1,
    });

    process.env.SPAR_MAX_TURNS = "999";
    process.env.SPAR_CTX_TOPK = "999";
    process.env.SPAR_MAX_INPUT_CHARS = "999999";
    process.env.SPAR_MAX_TOKENS = "999999";
    expect(getSparGuards()).toEqual({
      maxTurns: 20,
      ctxTopK: 20,
      maxInputChars: 8000,
      maxTokens: 4096,
    });
  });
});

describe("callChat", () => {
  const config = { provider: "openai" as const, model: "gpt-4o-mini", apiKey: "sk-test-secret-key-value" };
  const guards = { maxTurns: 8, ctxTopK: 3, maxInputChars: 2000, maxTokens: 1024 };
  const messages = [{ role: "user" as const, content: "PROMPT_MARKER_TEXT" }];

  it("正常系: content を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "壁打ちの応答です" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callChat(config, guards, messages);
    expect(result).toBe("壁打ちの応答です");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-test-secret-key-value");
  });

  it("非2xx → SparUpstreamError(status 保持・message に応答本文・鍵・プロンプトを含まない)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "RESPONSE_BODY_MARKER sk-test-secret-key-value" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callChat(config, guards, messages)).rejects.toMatchObject({ status: 500 });

    let caught: unknown;
    try {
      await callChat(config, guards, messages);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SparUpstreamError);
    const message = (caught as SparUpstreamError).message;
    expect(message).not.toContain("RESPONSE_BODY_MARKER");
    expect(message).not.toContain("sk-test-secret-key-value");
    expect(message).not.toContain("PROMPT_MARKER_TEXT");
  });

  it("fetch reject(ネットワーク例外) → status 0", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await callChat(config, guards, messages);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SparUpstreamError);
    expect((caught as SparUpstreamError).status).toBe(0);
  });
});
