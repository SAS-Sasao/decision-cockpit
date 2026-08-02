// 対象設計: docs/design/basic/codex-spar.md §1 やる-1 / §3(serve-lib — 受理3検証・入力検証・env allowlist)
//
// ここは純関数のみ(SDK・http・fs を import しない — vitest の対象)。
// 受理3検証は sec R1 の中核: CORS はレスポンス読取の制御であり送達を止めないため、
// サーバ側で Origin / Content-Type / Host を検証し、不通過のリクエストは処理しない(403/415)。
// 3検証は互いのバックストップ(CT 例外バグ→Origin が遮断 / DNS rebinding→Host が遮断)。

export const ALLOWED_ORIGIN = "http://localhost:3000";
export const ALLOWED_HOSTS = ["127.0.0.1:8788", "localhost:8788"] as const;
export const QUESTION_MAX_CHARS = 4000;

export type Admission =
  | { ok: true }
  | { ok: false; status: 403 | 415; error: "forbidden" | "unsupported_media" };

export type AdmissionHeaders = {
  origin: string | undefined;
  host: string | undefined;
  contentType: string | undefined;
};

/**
 * 実 POST の受理3検証(§1 やる-1):
 * (i) Origin = ALLOWED_ORIGIN の完全一致必須(欠落・不一致 = 403 — 素の curl も構造的に 403)
 * (ii) Content-Type = application/json 必須(text/plain 等の simple request = 415)
 * (iii) Host = ALLOWED_HOSTS の完全一致必須(DNS rebinding 遮断)
 */
export function checkAdmission(h: AdmissionHeaders): Admission {
  if (h.host === undefined || !(ALLOWED_HOSTS as readonly string[]).includes(h.host)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (h.origin !== ALLOWED_ORIGIN) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  const media = (h.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (media !== "application/json") {
    return { ok: false, status: 415, error: "unsupported_media" };
  }
  return { ok: true };
}

/**
 * OPTIONS(プリフライト)は Origin/Host 検証のみ(プリフライトに Content-Type は無い)。
 * 実 POST 側の3検証をここに合わせて緩めない(§1 やる-1 — 緩和 = 設計逸脱)。
 */
export function checkPreflight(h: { origin: string | undefined; host: string | undefined }): boolean {
  return (
    h.host !== undefined &&
    (ALLOWED_HOSTS as readonly string[]).includes(h.host) &&
    h.origin === ALLOWED_ORIGIN
  );
}

/** CORS 応答ヘッダ(固定オリジンのみ)。 */
export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-methods": "POST",
    "access-control-allow-headers": "content-type",
  };
}

/** 入力検証: question は trim 後 1..4000 文字。不正は null(= 400 bad_request)。 */
export function validateQuestion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const q = (body as { question?: unknown }).question;
  if (typeof q !== "string") return null;
  const trimmed = q.trim();
  if (trimmed.length < 1 || trimmed.length > QUESTION_MAX_CHARS) return null;
  return trimmed;
}

// 子プロセス(Codex)へ渡す env の allowlist(§1 やる-1 — ホストシェル env の丸ごと継承をしない)。
// SDK の env オプションは「指定時は process.env を継承しない」ため、この戻り値が子 env の全量になる。
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "CODEX_HOME",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
] as const;

export function buildChildEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
