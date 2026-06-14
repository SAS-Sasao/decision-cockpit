/** @type {import('next').NextConfig} */
const nextConfig = {
  // 最小スキャフォールド: ビルドは静的レンダリングで完結し、DB/外部接続を必要としない。
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
