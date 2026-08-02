// 対象設計: docs/design/basic/codex-spar.md §5 条件5(受理3検証・入力検証・env allowlist・
// 結論保存の除外・history 分離 — 純関数のみ。SDK・ネットワークはテストに持ち込まない)
import { describe, expect, it } from "vitest";
import {
  latestSparConclusion,
  sparHistory,
  type TurnLike,
} from "../app/(shell)/capture/spar-panel-lib";
import {
  ALLOWED_ORIGIN,
  QUESTION_MAX_CHARS,
  buildChildEnv,
  checkAdmission,
  checkPreflight,
  validateQuestion,
} from "../scripts/codex/serve-lib";

const OK_HEADERS = {
  origin: "http://localhost:3000",
  host: "127.0.0.1:8788",
  contentType: "application/json",
};

describe("checkAdmission(受理3検証)", () => {
  it("正規リクエスト(Origin/Host/CT 全一致)を受理する", () => {
    expect(checkAdmission(OK_HEADERS)).toEqual({ ok: true });
  });

  it("Content-Type に charset が付いていても受理する", () => {
    expect(checkAdmission({ ...OK_HEADERS, contentType: "application/json; charset=utf-8" })).toEqual({ ok: true });
  });

  it("Host = localhost:8788 も受理する", () => {
    expect(checkAdmission({ ...OK_HEADERS, host: "localhost:8788" })).toEqual({ ok: true });
  });

  it("Origin 欠落は 403 forbidden(素の curl を構造的に拒否)", () => {
    expect(checkAdmission({ ...OK_HEADERS, origin: undefined })).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("Origin 不一致(攻撃者オリジン)は 403 forbidden", () => {
    expect(checkAdmission({ ...OK_HEADERS, origin: "https://evil.example" })).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("Origin = http://127.0.0.1:3000 も完全一致でないため 403(localhost:3000 で開く前提)", () => {
    expect(checkAdmission({ ...OK_HEADERS, origin: "http://127.0.0.1:3000" })).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("Origin = null(sandboxed iframe 等)は不一致として 403", () => {
    expect(checkAdmission({ ...OK_HEADERS, origin: "null" })).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("Host 不一致(DNS rebinding: 攻撃者ドメイン)は 403 forbidden", () => {
    expect(checkAdmission({ ...OK_HEADERS, host: "evil.example:8788" })).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("Host 欠落は 403 forbidden", () => {
    expect(checkAdmission({ ...OK_HEADERS, host: undefined })).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("Content-Type = text/plain(cross-site simple request)は 415 unsupported_media", () => {
    expect(checkAdmission({ ...OK_HEADERS, contentType: "text/plain" })).toEqual({ ok: false, status: 415, error: "unsupported_media" });
  });

  it("Content-Type 欠落は 415 unsupported_media", () => {
    expect(checkAdmission({ ...OK_HEADERS, contentType: undefined })).toEqual({ ok: false, status: 415, error: "unsupported_media" });
  });
});

describe("checkPreflight(OPTIONS — Origin/Host のみ)", () => {
  it("正規オリジン + 正規 Host を通す", () => {
    expect(checkPreflight({ origin: ALLOWED_ORIGIN, host: "127.0.0.1:8788" })).toBe(true);
  });

  it("攻撃者オリジンは拒否する", () => {
    expect(checkPreflight({ origin: "https://evil.example", host: "127.0.0.1:8788" })).toBe(false);
  });

  it("Host 不一致(rebinding)は拒否する", () => {
    expect(checkPreflight({ origin: ALLOWED_ORIGIN, host: "evil.example:8788" })).toBe(false);
  });
});

describe("validateQuestion(入力検証)", () => {
  it("正常な質問文を trim して返す", () => {
    expect(validateQuestion({ question: "  設計をレビューして  " })).toBe("設計をレビューして");
  });

  it("上限 4000 文字ちょうどは受理する", () => {
    expect(validateQuestion({ question: "a".repeat(QUESTION_MAX_CHARS) })).toBe("a".repeat(QUESTION_MAX_CHARS));
  });

  it("4001 文字は拒否する(null)", () => {
    expect(validateQuestion({ question: "a".repeat(QUESTION_MAX_CHARS + 1) })).toBeNull();
  });

  it("空白のみ・非文字列・欠落・非オブジェクトはすべて拒否する", () => {
    expect(validateQuestion({ question: "   " })).toBeNull();
    expect(validateQuestion({ question: 42 })).toBeNull();
    expect(validateQuestion({})).toBeNull();
    expect(validateQuestion(null)).toBeNull();
    expect(validateQuestion("plain string")).toBeNull();
  });
});

describe("buildChildEnv(子プロセス env の allowlist 最小化)", () => {
  const hostEnv = {
    PATH: "/usr/bin",
    HOME: "/home/user",
    DATABASE_URL: "postgres://secret",
    GITHUB_TOKEN: "ghp_secret",
    SPAR_API_KEY: "sk-secret",
    CODEX_API_KEY: "codex-key",
    UNDEFINED_KEY: undefined,
  };

  it("allowlist 外の秘密(DATABASE_URL / GITHUB_TOKEN / SPAR_API_KEY)を子 env に渡さない", () => {
    const child = buildChildEnv(hostEnv);
    expect(child).not.toHaveProperty("DATABASE_URL");
    expect(child).not.toHaveProperty("GITHUB_TOKEN");
    expect(child).not.toHaveProperty("SPAR_API_KEY");
  });

  it("PATH / HOME / Codex 認証変数は保持する", () => {
    const child = buildChildEnv(hostEnv);
    expect(child.PATH).toBe("/usr/bin");
    expect(child.HOME).toBe("/home/user");
    expect(child.CODEX_API_KEY).toBe("codex-key");
  });

  it("未定義のキーは出力に含めない(全量が allowlist の定義済み値のみ)", () => {
    const child = buildChildEnv(hostEnv);
    expect(Object.keys(child).sort()).toEqual(["CODEX_API_KEY", "HOME", "PATH"].sort());
  });
});

const t = (role: TurnLike["role"], mode: TurnLike["mode"], content: string): TurnLike => ({ role, mode, content });

describe("latestSparConclusion(結論保存の除外)", () => {
  it("最新の SPAR 応答を返す(codex 応答がより新しくてもスキップ)", () => {
    const turns = [
      t("user", "spar", "q1"),
      t("assistant", "spar", "spar 応答"),
      t("user", "codex", "q2"),
      t("assistant", "codex", "codex 応答"),
    ];
    expect(latestSparConclusion(turns)?.content).toBe("spar 応答");
  });

  it("codex 応答しか無い会話では null(保存ボタン非表示)", () => {
    const turns = [t("user", "codex", "q"), t("assistant", "codex", "codex 応答")];
    expect(latestSparConclusion(turns)).toBeNull();
  });

  it("空の会話では null", () => {
    expect(latestSparConclusion([])).toBeNull();
  });
});

describe("sparHistory(history 分離)", () => {
  it("codex ターン(質問・応答とも)を SPAR 送信 history から除外する", () => {
    const turns = [
      t("user", "spar", "q1"),
      t("assistant", "spar", "a1"),
      t("user", "codex", "codex 質問"),
      t("assistant", "codex", "codex 応答"),
      t("user", "spar", "q2"),
    ];
    expect(sparHistory(turns)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
  });

  it("SPAR ターンのみの会話は role/content の形でそのまま写像する", () => {
    const turns = [t("user", "spar", "q"), t("assistant", "spar", "a")];
    expect(sparHistory(turns)).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });
});
