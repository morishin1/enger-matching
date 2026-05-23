import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 請求書/勤怠ファイルのアップロード用にサーバーアクションのボディ上限を拡大（既定1MB→一般的な10MB）
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
