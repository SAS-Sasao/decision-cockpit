// Next.js 16: middleware.ts 相当(ファイル名は proxy.ts に改名)。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
//
// 除外はパス境界付き(`/api/authx` や `/loginx` は保護対象のまま)。
// `/login` は明示除外し、SDK 内部の loginUrl 素通し実装に依存しない。
//
// M4-FIX(docs/design/detail/capture-spar.md §0「M4-FIX 追補」— SDK 欠陥への対処):
// @neondatabase/auth 0.4.2-beta の middleware は get-session 照会へ元リクエストの
// method をそのまま転送し、保護パスへの POST を常に未認証(307)扱いにしてしまう。
// セッション判定は cookie ヘッダのみに依存するため、GET/HEAD 以外は url + headers を
// 保持した GET 複製の NextRequest を作って SDK middleware に渡す(意味論同値)。
import type { NextFetchEvent, NextProxy } from "next/server";
import { NextRequest } from "next/server";
import { auth } from "./lib/auth/server";

const rawMiddleware = auth.middleware({ loginUrl: "/login" });
// SDK の型定義は event 引数を持たないが、Next.js のランタイムは常に第2引数(event)を
// 渡してくる。将来 SDK 側が event を受け取るようになった場合に備え、素通しできる形に
// 広げてから呼び出す(現状 SDK 側は未使用の引数として無視する)。
const middleware = rawMiddleware as (
  request: NextRequest,
  event?: NextFetchEvent
) => ReturnType<typeof rawMiddleware>;

const proxy: NextProxy = (request, event) => {
  if (request.method === "GET" || request.method === "HEAD") {
    return middleware(request, event);
  }

  const getRequest = new NextRequest(request.url, {
    headers: request.headers,
  });

  return middleware(getRequest, event);
};

export default proxy;

export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|api/sync(?:/|$)|login(?:/|$)|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
