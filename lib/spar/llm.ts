import "server-only";

// 対象設計: docs/design/detail/capture-spar.md §2.3(lib/spar/llm.ts)
//
// SPAR_PROVIDER / SPAR_MODEL / SPAR_API_KEY の env 参照はこのファイルに限定する
// (受け入れ条件4 の ⊆ 判定 — process.env.SPAR は lib/spar/llm.ts 限定)。
// 3つとも既定値を置かない(未設定/空/未知 provider は SparConfigError — fail-closed)。
// 送信先 URL(https://api.openai.com/v1/chat/completions)の参照もこのファイル限定
// (lib/search/embedding.ts の api.openai.com と合わせて2箇所限定 — rev.2)。

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 30_000;

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_CTX_TOPK = 3;
const DEFAULT_MAX_INPUT_CHARS = 2000;
const DEFAULT_MAX_TOKENS = 1024;

export type SparConfig = { provider: "openai"; model: string; apiKey: string };
export type SparGuards = {
  maxTurns: number;
  ctxTopK: number;
  maxInputChars: number;
  maxTokens: number;
};

/** env 欠落・未知 provider(dispatch 契約違反)。 */
export class SparConfigError extends Error {}

/** プロバイダ非 2xx / ネットワーク例外。応答本文・鍵・プロンプトは message に含めない。 */
export class SparUpstreamError extends Error {
  status: number;

  constructor(status: number) {
    super(`[lib/spar/llm] upstream chat request failed (status ${status})`);
    this.status = status;
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function envIntGuard(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

/**
 * SPAR_PROVIDER / SPAR_MODEL / SPAR_API_KEY のいずれかが未設定・空、または
 * provider が "openai" 以外の場合は SparConfigError を投げる(既定フォールバックなし)。
 */
export function getSparConfig(): SparConfig {
  const provider = process.env.SPAR_PROVIDER;
  const model = process.env.SPAR_MODEL;
  const apiKey = process.env.SPAR_API_KEY;

  if (!provider || !model || !apiKey) {
    throw new SparConfigError(
      "[lib/spar/llm] SPAR_PROVIDER / SPAR_MODEL / SPAR_API_KEY must all be set (no defaults)"
    );
  }
  if (provider !== "openai") {
    throw new SparConfigError(`[lib/spar/llm] unknown SPAR_PROVIDER (only "openai" is supported)`);
  }

  return { provider, model, apiKey };
}

/**
 * コストガード4種。env 任意・未設定/空/非数値はコード既定値に落ちる(§0 問い#6)。
 * クランプ: maxTurns 1..20 / ctxTopK 1..20(実効上限は searchKnowledge の MAX_LIMIT に従属)/
 * maxInputChars 1..8000 / maxTokens 1..4096。
 */
export function getSparGuards(): SparGuards {
  return {
    maxTurns: envIntGuard("SPAR_MAX_TURNS", DEFAULT_MAX_TURNS, 1, 20),
    ctxTopK: envIntGuard("SPAR_CTX_TOPK", DEFAULT_CTX_TOPK, 1, 20),
    maxInputChars: envIntGuard("SPAR_MAX_INPUT_CHARS", DEFAULT_MAX_INPUT_CHARS, 1, 8000),
    maxTokens: envIntGuard("SPAR_MAX_TOKENS", DEFAULT_MAX_TOKENS, 1, 4096),
  };
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
};

/**
 * OpenAI Chat Completions 呼び出し(provider は現状 "openai" のみ実装)。
 * タイムアウト30秒(AbortSignal)。非2xx → SparUpstreamError(status)。
 * ネットワーク例外・タイムアウトは status 0。応答本文・鍵・プロンプトはエラーに含めない。
 */
export async function callChat(
  config: SparConfig,
  guards: SparGuards,
  messages: ChatMessage[]
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages, max_tokens: guards.maxTokens }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SparUpstreamError(0);
  }

  if (!res.ok) {
    throw new SparUpstreamError(res.status);
  }

  const json = (await res.json()) as ChatCompletionResponse;
  return json.choices?.[0]?.message?.content ?? "";
}
