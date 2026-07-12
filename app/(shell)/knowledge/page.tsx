// 「ナレッジ検索」画面(雛形): pgvector 近傍検索 + メタフィルタ。結果は出典付き。
// 対象設計: docs/design/detail/ui-shell.md §2.5(app/(shell)/knowledge/page.tsx — 旧 /search の移設)
//
// 実装は M2(pgvector 検索)。
import { requireUser } from "../../../lib/auth/user";

export default async function KnowledgePage() {
  await requireUser();

  return (
    <section>
      <h1>ナレッジ検索</h1>
      <p>pgvector + メタフィルタ(source / date / tags)による出典付き検索(雛形)。</p>
      <p style={{ color: "var(--text-sub)" }}>※ M2 で実装予定。</p>
    </section>
  );
}
