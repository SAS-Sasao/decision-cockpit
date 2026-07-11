"use client";

// サインイン画面。
// 対象設計: docs/design/detail/auth-foundation.md §2.1(SDK 付属 AuthView(sign-in)。成功後 `/` へ)
//
// UI コンポーネント(AuthView / NeonAuthUIProvider)は `@neondatabase/auth/react` から import する
// (§0 で確定済み)。認証ハンドラは `app/api/auth/[...path]/route.ts` に `auth.handler()` としてマウント済み。
//
// authClient は `@neondatabase/auth/next` の `createAuthClient()`(引数なし)で生成する。
// 型定義(node_modules/@neondatabase/auth/dist/next/index.mjs)で確認済みの通り、この関数は内部で
//   createAuthClient(undefined, { adapter: BetterAuthReactAdapter() })
// を呼ぶだけの薄いラッパーで、baseURL を渡さないため better-auth クライアントは
// 同一オリジンの既定パス(basePath 既定値 = "/api/auth")へ相対フェッチする。
// これは本ページと同じ Next.js アプリ内の `app/api/auth/[...path]/route.ts` の
// マウント先と一致する。NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET はサーバ側
// (lib/auth/server.ts)でのみ使用され、クライアントには一切露出しない。
import { createAuthClient } from "@neondatabase/auth/next";
import { AuthView, NeonAuthUIProvider } from "@neondatabase/auth/react";

const authClient = createAuthClient();

export default function LoginPage() {
  return (
    <NeonAuthUIProvider authClient={authClient} redirectTo="/">
      <section
        style={{
          maxWidth: 420,
          margin: "48px auto",
          padding: "0 16px",
        }}
      >
        <AuthView pathname="sign-in" redirectTo="/" />
      </section>
    </NeonAuthUIProvider>
  );
}
