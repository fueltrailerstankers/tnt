import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Test runs in parallel use separate build dirs (NEXT_DIST_DIR); production uses the default.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  async headers() {
    return [
      // Role-link URLs carry a bearer token: never leak it in Referer, never cache the page.
      { source: "/e/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
