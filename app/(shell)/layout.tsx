import type { ReactNode } from "react";
import { requireUser } from "../../lib/auth/user";
import { isAdmin } from "../../lib/auth/roles";
import { getLastSync, getUnprocessedInboxCount } from "../../lib/data/overview";
import { signOutAction } from "../logout/actions";
import { NavLink } from "../../components/nav-link";
import { SparOverlay } from "./spar-overlay";

// 共通シェル(サイドバー + トップバー)。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/layout.tsx)
//          docs/design/basic/ui-shell.md §1-2(サイドバー230px・トップバー56px・二層防御)
//          docs/design/detail/ui-polish.md §2.3(同期ステータスに ckblink ドット追加のみ)
//
// requireUser() はナビ用ユーザー情報取得を兼ねる(soft navigation で再実行されないため
// 認可の層としては数えない — 各ページ側でも requireUser() を呼ぶ)。
export const dynamic = "force-dynamic";

type NavItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "概観" },
  { href: "/today", label: "今日" },
  { href: "/knowledge", label: "ナレッジ検索" },
  { href: "/retro", label: "振り返り" },
  { href: "/capture", label: "キャプチャ" },
  { href: "/admin/users", label: "管理", adminOnly: true },
];

/** ISO 文字列 → "YYYY-MM-DD HH:mm"(UTC)。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [admin, unprocessedInbox, lastSync] = await Promise.all([
    isAdmin(user.id),
    getUnprocessedInboxCount(user.id),
    getLastSync(),
  ]);

  const visibleNav = NAV.filter((item) => !item.adminOnly || admin);
  const displayName = user.name ?? user.email ?? "(unknown)";
  const roleLabel = admin ? "admin" : "member";

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 230,
          minWidth: 230,
          flexShrink: 0,
          background: "var(--panel)",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              padding: "16px 20px",
              fontWeight: 700,
              fontSize: 15,
              borderBottom: "1px solid var(--line)",
            }}
          >
            Decision Cockpit
          </div>
          <nav style={{ padding: "12px 0", display: "flex", flexDirection: "column", gap: 2 }}>
            {visibleNav.map((item) => (
              <NavLink key={item.href} href={item.href}>
                <span>{item.label}</span>
                {item.href === "/capture" && unprocessedInbox > 0 ? (
                  <span
                    style={{
                      fontSize: 11,
                      background: "var(--accent-spar)",
                      color: "var(--bg)",
                      borderRadius: 999,
                      padding: "1px 7px",
                      minWidth: 18,
                      textAlign: "center",
                    }}
                  >
                    {unprocessedInbox}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--line)", fontSize: 13 }}>
          <div style={{ color: "var(--text)" }}>{displayName}</div>
          <div style={{ color: "var(--text-sub)", marginBottom: 8 }}>{roleLabel}</div>
          <form action={signOutAction}>
            <button
              type="submit"
              style={{
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--text-sub)",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            height: 56,
            minHeight: 56,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--good)",
                animation: "ckblink 2.4s infinite",
              }}
            />
            <div style={{ display: "flex", gap: 20, fontSize: 12, color: "var(--text-sub)" }}>
              {lastSync.map((s) => (
                <span key={s.repo}>
                  {s.repo}: {s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : "未同期"}
                </span>
              ))}
            </div>
          </div>
          <SparOverlay canCiReview={admin} />
        </header>

        <main style={{ flex: 1, padding: 24, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
