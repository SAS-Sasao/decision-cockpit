// 対象設計: docs/design/detail/ui-polish.md §0 問い1 / §2.3(app/(shell)/template.tsx)
// ナビゲーション毎に再マウントされる Next の仕組みを利用し、children を ckfade でフェードインする。
import type { ReactNode } from "react";

export default function ShellTemplate({ children }: { children: ReactNode }) {
  return <div className="ckfade">{children}</div>;
}
