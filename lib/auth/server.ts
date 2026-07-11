// Neon Auth サーバ側シングルトン。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
//
// env(NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET)が未設定の場合は
// モジュール初期化時に throw する(fail-fast)。実値は .env / Vercel のみに置く。
import { createNeonAuth } from "@neondatabase/auth/next/server";

type RequiredEnvName = "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET";

function requireEnv(name: RequiredEnvName): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[lib/auth/server] 環境変数 ${name} が未設定です。.env(.env.example を参照)に設定してください。`
    );
  }
  return value;
}

const baseUrl = requireEnv("NEON_AUTH_BASE_URL");
const cookieSecret = requireEnv("NEON_AUTH_COOKIE_SECRET");

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret },
});
