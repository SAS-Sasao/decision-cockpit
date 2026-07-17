// 対象設計: docs/design/detail/search-foundation.md §2.6(scripts/embed-local.ts)
//
// tsx 実行用の CLI(sync-local.ts と同型・インライン env 渡し・dotenv 依存なし)。
// 使い方:
//   EMBEDDING_SOURCE=fixture DATABASE_URL=... npx tsx scripts/embed-local.ts
//   (本番バックフィルは DATABASE_URL を差し替えて実行 — 実行は人間承認)
export {}; // このファイルをモジュールスコープにする(sync-local.ts とのグローバル関数名衝突を避ける)

// 実装ノート: `import "server-only"` は Next.js の React Server Components 向け
// マーカーパッケージで、'react-server' という export condition が有効な環境
// (= Next.js のビルド/実行時)でのみ no-op になる。tsx(素の Node 実行)には
// その condition が無いため、素で require すると throw する。このスクリプトは
// CLI から直接 tsx 実行される唯一のエントリポイントのため、対象モジュールを
// import する前に require キャッシュへ空モジュールを差し込んで無害化する
// (Next.js 経由の実行には一切影響しない・このファイル内に閉じた副作用)。
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

const MAX_ITERATIONS = 50;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[scripts/embed-local] 環境変数 DATABASE_URL が未設定です。");
    process.exitCode = 1;
    return;
  }

  // server-only スタブ適用後に動的 import する(静的 import だと先に評価され得るため)。
  const { runEmbedIndex } = await import("../lib/search/embed-index");

  let previousRemaining: number | null = null;
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const summary = await runEmbedIndex();
    console.log(JSON.stringify({ iteration, ...summary }, null, 2));

    if (summary.remaining === 0) {
      break;
    }
    if (previousRemaining !== null && summary.remaining >= previousRemaining) {
      // 進捗なし(恒常失敗の無限ループ防止) — ここで停止する
      break;
    }
    previousRemaining = summary.remaining;
  }
}

main().catch((err) => {
  console.error("[scripts/embed-local] embed failed:", err);
  process.exitCode = 1;
});
