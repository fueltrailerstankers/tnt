import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Test runs in parallel use separate build dirs (NEXT_DIST_DIR); production uses the default.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // forbidden() from requirePerm renders app/forbidden.tsx with HTTP 403 (M7).
  experimental: { authInterrupts: true },
  async headers() {
    return [
      // Role-link URLs carry a bearer token: never leak it in Referer, never cache the page.
      { source: "/e/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      // Invite and sign-in links carry a one-time token hash.
      { source: "/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
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
