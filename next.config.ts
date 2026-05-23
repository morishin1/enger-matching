import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 請求書/勤怠ファイルのアップロード用にサーバーアクションのボディ上限を拡大（既定1MB）
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
