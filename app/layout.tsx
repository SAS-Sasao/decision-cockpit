import type { ReactNode } from "react";
import Link from "next/link";

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
  return (
    <html lang="ja">
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
