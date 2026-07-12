// 「今日」画面(雛形): 組織メトリクスと判断ログを時間軸/タグで横断するダッシュボード。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/today/page.tsx — 旧 app/page.tsx の骨格移設)
//
// 入力(capture): 作業メモ・課題・次の一手・壁打ち結論はここに追加していく。
// 実装は M3(SC-03)。
import { requireUser } from "../../../lib/auth/user";

export default async function TodayPage() {
  await requireUser();

  return (
    <section>
      <h1>今日</h1>
      <p>組織メトリクスと判断ログを横断する今日のダッシュボード(雛形)。</p>
      <p>入力(capture): 作業メモ / 課題 / 次の一手 / 壁打ち結論。</p>
      <p style={{ color: "var(--text-sub)" }}>※ M3 で実装予定。</p>
    </section>
  );
}
