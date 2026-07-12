"use client";

// シェル専用の小物: サイドバーのナビ項目(アクティブ強調)。
// 対象設計: docs/design/detail/ui-shell.md §2.5(components/nav-link.tsx)
//
// アクティブ判定: usePathname() で完全一致("/" はルートのみ)or 前方一致(それ以外)。
// アクティブ時は `--accent` の左ボーダー + 背景強調 + 文字色を明るくする。
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  children: ReactNode;
};

/** "/" は完全一致のみ。それ以外は完全一致 or "href/" 前方一致でアクティブとする。 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 20px",
        borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
        color: active ? "var(--text)" : "var(--text-sub)",
        fontWeight: active ? 600 : 400,
        textDecoration: "none",
        fontSize: 14,
      }}
    >
      {children}
    </Link>
  );
}
