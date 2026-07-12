import type { ReactNode } from "react";
// Neon Auth SDK 付属 UI(AuthView 等)のスタイル。app/login で使用するためグローバル import する。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
import "@neondatabase/auth/ui/css";
// デザイントークン + ダークテーマ既定スタイル。
// 対象設計: docs/design/detail/ui-shell.md §2.4(app/globals.css)/ §2.5(app/layout.tsx 最小化)
import "./globals.css";

export const metadata = {
  title: "Decision Cockpit",
  description: "個人用の統合意思決定コックピット",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: NeonAuthUIProvider のテーマ処理がクライアントで
  // <html> に className("light" 等)を付与するため、初回ハイドレーション時の
  // 属性差分警告を抑止する(この要素の属性のみ・子には波及しない)
  return (
    <html lang="ja" suppressHydrationWarning>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
