"use client";

// SDK 標準の認証ビュー(/auth/sign-up・/auth/forgot-password 等)。
// AuthView(sign-in)内のリンクは basePath 既定値 "/auth" 配下の各ビューを指すため、
// /login(サインイン専用)に加えて本 catch-all ページで残りのビューを受ける。
// authClient の生成方法・同一オリジン相対フェッチの理由は app/login/page.tsx のコメント参照。
import { createAuthClient } from "@neondatabase/auth/next";
import { AuthView, NeonAuthUIProvider } from "@neondatabase/auth/react";
import { useParams } from "next/navigation";

const authClient = createAuthClient();

export default function AuthViewPage() {
  const { pathname } = useParams<{ pathname: string }>();
  return (
    <NeonAuthUIProvider authClient={authClient} redirectTo="/">
      <section
        style={{
          maxWidth: 420,
          margin: "48px auto",
          padding: "0 16px",
        }}
      >
        <AuthView pathname={pathname} redirectTo="/" />
      </section>
    </NeonAuthUIProvider>
  );
}
