// 「キャプチャ + 壁打ち」画面(プレースホルダ)。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/capture/page.tsx)
//          docs/design/basic/ui-shell.md §1(やらない — 壁打ちスライドオーバーの実体は M4)
//
// 実装(capture_inbox への保存・壁打ち)は M4。
import { requireUser } from "../../../lib/auth/user";

export default async function CapturePage() {
  await requireUser();

  return (
    <section>
      <h1>キャプチャ + 壁打ち</h1>
      <p style={{ color: "var(--text-sub)" }}>※ 準備中(M4 で実装予定)。</p>
    </section>
  );
}
