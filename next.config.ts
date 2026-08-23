import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      allowedOrigins: ["*.e2b.app"],
    },
  },
};

export default nextConfig;
