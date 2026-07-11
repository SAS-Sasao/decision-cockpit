// Neon Auth API ハンドラ。auth.handler() の再エクスポートのみ(ロジックを書かない)。
// 対象設計: docs/design/detail/auth-foundation.md §2.1
import { auth } from "../../../../lib/auth/server";

export const { GET, POST } = auth.handler();
