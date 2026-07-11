"use server";

// 対象設計: docs/design/detail/auth-foundation.md §2.1
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth/server";

export async function signOutAction() {
  await auth.signOut();
  redirect("/login");
}
