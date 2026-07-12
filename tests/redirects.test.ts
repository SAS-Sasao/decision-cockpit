// 対象設計: docs/design/detail/ui-shell.md §2.5(next.config.mjs)/ §3(tests/redirects.test.ts)
// next.config.mjs を import して redirects() の契約(source/destination/permanent)を検証する。
// 実ネットワーク・実サーバ起動なし(設定オブジェクトの直接検証)。
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.mjs";

describe("next.config redirects — 旧 URL の後方互換", () => {
  it("/search → /knowledge・/review → /retro の2エントリを permanent(308)で返す", async () => {
    const redirects = await nextConfig.redirects!();

    expect(redirects).toHaveLength(2);

    const search = redirects.find((r) => r.source === "/search");
    expect(search).toEqual({ source: "/search", destination: "/knowledge", permanent: true });

    const review = redirects.find((r) => r.source === "/review");
    expect(review).toEqual({ source: "/review", destination: "/retro", permanent: true });
  });
});
