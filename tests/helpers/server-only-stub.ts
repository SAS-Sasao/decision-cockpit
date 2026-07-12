// 'server-only' の vitest 用スタブ。
// 対象設計: docs/design/detail/ingestion-foundation.md §3(server-only の vitest 対応)
// 本物の 'server-only' パッケージはブラウザ環境向け条件付き export で throw するため、
// vitest(node environment)でそのまま import すると失敗する場合がある。
// vitest.config.ts の resolve.alias でこのファイルに差し替える(何もしない空モジュール)。
export {};
