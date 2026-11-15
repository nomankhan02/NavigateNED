import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function resolveBuildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  }
}

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  devIndicators: {
    appIsrStatus: false,
    buildActivity: false,
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: resolveBuildId(),
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/wasm/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
