# ローカル DB 復旧手順(runbook)

> 2026-07-20 の全データ消失事故で**実際に使って復旧できた手順**をそのまま残したもの。
> ボリューム破棄は `.claude/rules/db.md` と `.claude/hooks/guard-bash.sh` で禁止・遮断しているが、
> それでも DB が空になった場合は**この手順を最後まで完了させること**(途中で止めない)。

## 0. 症状と確認

アプリに `relation "user_roles" does not exist` / `relation "capture_inbox" does not exist` 等が出る。

```bash
docker compose exec -T db psql -U cockpit -d cockpit -tA -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

`0` ならテーブルが全滅している。原因の確認(ボリュームが作り直されたか):

```bash
docker volume inspect decision-cockpit_cockpit-db-data --format '{{.CreatedAt}}'
docker compose logs db | grep -i "creating subdirectories"   # 出れば initdb がゼロから走った証拠
```

## 1. スキーマの再適用(0001 → 0011 を順に)

```bash
cd /home/toyoki05/decision-cockpit
for f in db/migrations/0001_*.up.sql db/migrations/0002_*.up.sql db/migrations/0003_*.up.sql \
         db/migrations/0004_*.up.sql db/migrations/0005_*.up.sql db/migrations/0006_*.up.sql \
         db/migrations/0007_*.up.sql db/migrations/0008_*.up.sql db/migrations/0009_*.up.sql \
         db/migrations/0010_*.up.sql db/migrations/0011_*.up.sql; do
  printf '%s: ' "$f"
  docker compose exec -T db psql -U cockpit -d cockpit -v ON_ERROR_STOP=1 -q -f - < "$f" && echo ok
done
```

> **0010(review_requests)・0011(カード参照列)も replay 可能**。0011 は列が
> `ADD COLUMN IF NOT EXISTS`、制約が `pg_constraint` 存在検査つきの `DO` ブロックなので、
> **同じ up.sql を2回流しても `ON_ERROR_STOP=1` で停止しない**(card-review 詳細 §1)。

## 2. SSoT からの再同期(timeline_records / board_items)

```bash
docker compose exec -T app npx tsx scripts/sync-local.ts --force
```

- SSoT(GitHub)が原本なので、**同期対象データはすべて復元できる**。
- 完了後の目安: `timeline_records` 約 8,000 行(ok)・`board_items` 59 行・error 9 行。

## 3. タグの修復(**2026-07-25 の恒久修正以降は原則不要**)

**恒久修正済み(tag-cold-start / TCS-1)**: run-sync は masters を優先処理し、masters 由来語彙を
ラン内の vocab スナップショットへ即時マージするため、**完全コールドスタート(sync_state も空)なら
手順2 の1回の同期でタグが付く**。以下が必要になるのは次の場合のみ:
- **部分復元状態**(sync_state が残存し tag_synonyms のみ空)— masters が changedPaths に現れず語彙が再構築されない。
- 恒久修正**前**に取り込んでタグ空になった既存行の回復。

**旧・既知の問題(記録)**: 修正前の run-sync はタグ語彙を同期開始時の1回しか読まず、DB が空の状態では
**その run で取り込んだ全行の `tags` が空**になっていた(2026-07-20 の復旧で実際に発生)。

**対処 A(簡単・推奨)**: もう一度同期を走らせる。ただし `--force` は全行の `synced_at` を進めるため、
**再埋め込み(~$0.4)が発生する**。手順4 とセットで実施すること。

```bash
docker compose exec -T app npx tsx scripts/sync-local.ts --force
```

**対処 B(埋め込みを温存したい場合)**: `tags` 列だけを更新する一時スクリプトを使う。
リポジトリ本体の `applyTags` を再利用し、`synced_at` に触れないので**再埋め込みが不要**。
(2026-07-20 はこちらを使い、564行にタグを復元した。スクリプトは実行後に削除する。)

```ts
// tag-repair.tmp.ts(リポジトリ直下に一時作成し、実行後に削除する。末尾の export {} を忘れない)
function stubServerOnlyForCli(): void {
  try {
    const resolved = require.resolve("server-only");
    const cache = require.cache as Record<string, { exports: unknown } | undefined>;
    if (!cache[resolved]) cache[resolved] = { exports: {} } as NodeJS.Module;
  } catch { /* noop */ }
}
stubServerOnlyForCli();

async function main(): Promise<void> {
  const { applyTags } = await import("./lib/ingestion/normalize");
  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const vocab = (await pool.query("SELECT synonym, canonical FROM tag_synonyms")).rows;
  const rows = (await pool.query("SELECT id, title, body FROM timeline_records WHERE status = 'ok'")).rows;
  let updated = 0;
  for (const row of rows) {
    const tags = applyTags(`${row.title ?? ""} ${row.body ?? ""}`, vocab);
    if (tags.length === 0) continue;
    await pool.query("UPDATE timeline_records SET tags = $1 WHERE id = $2", [tags, row.id]);
    updated += 1;
  }
  console.log(`tagged rows: ${updated}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
export {};
```

```bash
docker compose exec -T app npx tsx tag-repair.tmp.ts && rm -f tag-repair.tmp.ts
```

確認:
```bash
docker compose exec -T db psql -U cockpit -d cockpit -tA -c \
  "SELECT count(*) FILTER (WHERE array_length(tags,1)>0) || ' / ' || count(*) FROM timeline_records WHERE status='ok';"
```

## 4. 埋め込みのバックフィル(検索の復旧・**要課金 ~$0.4**)

**人間に費用を伝えて承認を得てから**実行する。

```bash
docker compose exec -T app npx tsx scripts/embed-local.ts
docker compose exec -T db psql -U cockpit -d cockpit -tA -c \
  "SELECT count(*) FILTER (WHERE embedding IS NOT NULL) || ' / ' || count(*) FILTER (WHERE status='ok') FROM timeline_records;"
```

## 5. admin ロールの再付与(user_roles)

ローカル DB の `user_roles` は消えるが、**Neon Auth のユーザー自体は Neon 側に残っている**ので ID を照合して再投入する。

```bash
# Neon 本番から user id を読む(読み取りのみ)
PW=$(grep -E '^DATABASE_URL=' .env | sed -E 's|^DATABASE_URL=postgres(ql)?://[^:]+:([^@]+)@([^/]+)/.*|\2|')
HOST=$(grep -E '^DATABASE_URL=' .env | sed -E 's|^DATABASE_URL=postgres(ql)?://[^:]+:[^@]+@([^/]+)/.*|\2|')
docker compose exec -T db psql "postgresql://neondb_owner:$PW@$HOST/neondb?sslmode=require" -tA \
  -c 'SELECT id, email FROM neon_auth."user" ORDER BY "createdAt";'
```

```bash
# 取得した id をローカルの user_roles に投入(admin)
docker compose exec -T db psql -U cockpit -d cockpit -v ON_ERROR_STOP=1 -tA -c "
INSERT INTO user_roles (user_id, role_id)
SELECT v.uid, r.id FROM (VALUES ('<user-id-1>'), ('<user-id-2>')) AS v(uid)
CROSS JOIN roles r WHERE r.name = 'admin' ON CONFLICT DO NOTHING;"
```

## 6. 仕上げ

```bash
docker compose restart app
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login   # 200 を確認
```

## 復元できないもの(必ず人間に報告する)

- **`capture_inbox`**(UI で入力したメモ・課題・次の一手・壁打ち結論)— **SSoT に存在しないため復元不能**。
  消失した旨と、可能なら消失時点の件数を必ず伝えること。
- **`board_overrides`**(/today での WBS カード移動の未送信・未解決の意図 — wbs-loop)— SSoT に無く**復元不能**。
  消失時は「PR 反映待ちだった移動が失われた」旨を報告(SSoT へ反映済みの分は次の同期で正しく表示される)。
- **`review_requests`**(CI レビューの依頼文・結果・カード参照 — review-loop / card-review)—
  SSoT に無く**復元不能**。GitHub Actions の run ログは retention 期間内なら残るが、依頼と結果の
  対応づけ・カードへの紐づけは DB にしか無い。消失時は「CI レビュー履歴が失われた」旨を報告する。
- `metric_aggregates` は現状 UI から参照されていないため実害なし。

## 本番(Neon)への示唆

- 「コールドスタートでタグが空になる」問題は **2026-07-25 に恒久修正済み(TCS-1)**。本番の初回同期は
  **1回でタグが付く**(「2回走らせる」回避策は不要になった)。部分復元状態だけが手順3 の残る適用場面。
- **本番のマイグレーションは 0001〜0010 まで適用済み**(2026-08-03 時点)。0011 は card-review(CR-1)で適用する — **Neon ブランチ検証 → 本番適用 → main マージ**の順(マージ = Vercel 自動デプロイのため)。
