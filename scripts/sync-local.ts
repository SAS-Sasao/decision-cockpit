// 対象設計: docs/design/detail/ingestion-foundation.md §2.4(scripts/sync-local.ts)
//
// tsx 実行用の CLI。SourceAdapter 経由(直接 GitHub を叩かない)。
// 使い方:
//   SYNC_SOURCE=fixture DATABASE_URL=... npx tsx scripts/sync-local.ts [--force]
//
// 既定 SYNC_MAX_FILES=0(無制限。初回フル同期をローカルから完走させるため)。
//
// 実装ノート: `import "server-only"` は Next.js の React Server Components 向け
// マーカーパッケージで、'react-server' という export condition が有効な環境
// (= Next.js のビルド/実行時)でのみ no-op になる。tsx(素の Node 実行)には
// その condition が無いため、素で require すると throw する。このスクリプトは
// CLI から直接 tsx 実行される唯一のエントリポイントのため、対象モジュールを
// import する前に require キャッシュへ空モジュールを差し込んで無害化する
// (Next.js 経由の実行には一切影響しない・このファイル内に閉じた副作用)。
export {}; // このファイルをモジュールスコープにする(グローバルスコープの他スクリプトとの関数名衝突を避ける)

function stubServerOnlyForCli(): void {
  try {
    const resolved = require.resolve("server-only");
    const cache = require.cache as Record<string, { exports: unknown } | undefined>;
    if (!cache[resolved]) {
      cache[resolved] = { exports: {} } as NodeJS.Module;
    }
  } catch {
    // 解決できない環境(常には発生しない)では何もしない
  }
}
stubServerOnlyForCli();

function parseArgs(argv: string[]): { force: boolean } {
  return { force: argv.includes("--force") };
}

function resolveMaxFiles(): number {
  const raw = process.env.SYNC_MAX_FILES;
  if (raw === undefined || raw === "") return 0; // sync-local の既定は無制限
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[scripts/sync-local] 環境変数 DATABASE_URL が未設定です。");
    process.exitCode = 1;
    return;
  }

  // server-only スタブ適用後に動的 import する(静的 import だと先に評価され得るため)。
  const [{ FixtureSource }, { GithubSource }, { runSync }] = await Promise.all([
    import("../lib/ingestion/fixture-source"),
    import("../lib/ingestion/github-source"),
    import("../lib/ingestion/run-sync"),
  ]);

  function buildAdapters() {
    if (process.env.SYNC_SOURCE === "fixture") {
      return [new FixtureSource("cc-sier-organization"), new FixtureSource("ai-war-room")];
    }
    return [new GithubSource("cc-sier-organization"), new GithubSource("ai-war-room")];
  }

  const { force } = parseArgs(process.argv.slice(2));
  const maxFiles = resolveMaxFiles();

  const summary = await runSync(buildAdapters(), { maxFiles, force });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[scripts/sync-local] sync failed:", err);
  process.exitCode = 1;
});
