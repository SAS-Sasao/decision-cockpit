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

## 1. スキーマの再適用(0001 → 0008 を順に)

```bash
cd /home/toyoki05/decision-cockpit
for f in db/migrations/0001_*.up.sql db/migrations/0002_*.up.sql db/migrations/0003_*.up.sql \
         db/migrations/0004_*.up.sql db/migrations/0005_*.up.sql db/migrations/0006_*.up.sql \
         db/migrations/0007_*.up.sql db/migrations/0008_*.up.sql; do
  printf '%s: ' "$f"
  docker compose exec -T db psql -U cockpit -d cockpit -v ON_ERROR_STOP=1 -q -f - < "$f" && echo ok
done
```

## 2. SSoT からの再同期(timeline_records / board_items)

```bash
docker compose exec -T app npx tsx scripts/sync-local.ts --force
```

- SSoT(GitHub)が原本なので、**同期対象データはすべて復元できる**。
- 完了後の目安: `timeline_records` 約 8,000 行(ok)・`board_items` 59 行・error 9 行。

## 3. タグの修復(**必須** — 手順2 だけでは tags が空になる)

**既知の問題**: `lib/ingestion/run-sync.ts` はタグ語彙を**同期開始時に1回だけ**読み込む
(`const vocab = await getAllTagSynonyms()`)。DB が空の状態では語彙が0件なので、
**その run で取り込んだ全行の `tags` が空**になる(語彙を作る masters ファイルは同じ run の後半で取り込まれるため間に合わない)。

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
- `metric_aggregates` は現状 UI から参照されていないため実害なし。

## 本番(Neon)への示唆

- 手順3 の「コールドスタートでタグが空になる」問題は **Vercel 本番の初回同期でも同じように起きる**。
  初回だけ **同期を2回**走らせる(または手順3 の対処 B を実行する)こと。
- 本番のマイグレーションは 0003〜0008 が未適用。展開時に順に適用する(人間承認)。
