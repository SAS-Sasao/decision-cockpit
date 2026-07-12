/** @type {import('next').NextConfig} */
const nextConfig = {
  // 対象設計: docs/design/detail/ui-shell.md §2.5(next.config.mjs)
  // 旧 URL の後方互換: /search → /knowledge・/review → /retro(permanent = 308)。
  async redirects() {
    return [
      { source: "/search", destination: "/knowledge", permanent: true },
      { source: "/review", destination: "/retro", permanent: true },
    ];
  },
};

export default nextConfig;
