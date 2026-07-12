import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // 対象設計: docs/design/detail/ingestion-foundation.md §3
      // 'server-only' はテスト環境で throw し得るため、空スタブに差し替える。
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only-stub.ts", import.meta.url)
      ),
    },
  },
});
