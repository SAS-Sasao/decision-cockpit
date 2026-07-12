// 「ユーザー管理」画面(プレースホルダ)。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/admin/users/page.tsx)
//          docs/design/basic/ui-shell.md §1-2(/admin/users のアクセス制御 — 非 admin は notFound())
//
// ナビ表示制御(isAdmin)とは別に、ページ側でも isAdmin 判定し、非 admin は 404(存在も隠す)。
// 実装(ユーザー一覧・ロール割当)は M4 前後。
import { notFound } from "next/navigation";
import { requireUser } from "../../../../lib/auth/user";
import { isAdmin } from "../../../../lib/auth/roles";

export default async function AdminUsersPage() {
  const user = await requireUser();
  if (!(await isAdmin(user.id))) {
    notFound();
  }

  return (
    <section>
      <h1>ユーザー管理</h1>
      <p style={{ color: "var(--text-sub)" }}>※ 準備中(M4 前後で実装予定)。</p>
    </section>
  );
}
