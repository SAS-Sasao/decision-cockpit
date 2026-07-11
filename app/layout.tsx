import type { ReactNode } from "react";
import Link from "next/link";
// Neon Auth SDK 付属 UI(AuthView 等)のスタイル。app/login で使用するためグローバル import する。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
import "@neondatabase/auth/ui/css";

export const metadata = {
  title: "Decision Cockpit",
  description: "個人用の統合意思決定コックピット",
};

const tabs = [
  { href: "/", label: "今日" },
  { href: "/search", label: "ナレッジ検索" },
  { href: "/review", label: "振り返り" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: NeonAuthUIProvider のテーマ処理がクライアントで
  // <html> に className("light" 等)を付与するため、初回ハイドレーション時の
  // 属性差分警告を抑止する(この要素の属性のみ・子には波及しない)
  return (
    <html lang="ja" suppressHydrationWarning>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <nav
          style={{
            display: "flex",
            gap: 16,
            padding: 16,
            borderBottom: "1px solid #ddd",
          }}
        >
          {tabs.map((t) => (
            <Link key={t.href} href={t.href}>
              {t.label}
            </Link>
          ))}
        </nav>
        <main style={{ padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
