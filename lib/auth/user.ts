// 認証ユーザーの取得ヘルパー。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
import { redirect } from "next/navigation";
import { auth } from "./server";

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
};

/**
 * セッションを取得し AuthUser に正規化する。
 * `auth.getSession()` の error が非 null の場合は console.error して null を返す
 * (fail-closed = 未認証扱い)。
 */
export async function getUser(): Promise<AuthUser | null> {
  const { data, error } = await auth.getSession();

  if (error) {
    console.error("[lib/auth/user] getSession failed:", error);
    return null;
  }

  const user = data?.user;
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
  };
}

/**
 * 認証必須のページ/アクション向け。未認証なら /login へ redirect(next/navigation)。
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
