// Next.js 16: middleware.ts 相当(ファイル名は proxy.ts に改名)。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
//
// 除外はパス境界付き(`/api/authx` や `/loginx` は保護対象のまま)。
// `/login` は明示除外し、SDK 内部の loginUrl 素通し実装に依存しない。
import { auth } from "./lib/auth/server";

export default auth.middleware({ loginUrl: "/login" });

export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|login(?:/|$)|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
