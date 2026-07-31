import type { NextConfig } from "next";

const apiOrigin = (
  process.env.FIVE_API_ORIGIN ?? `http://127.0.0.1:${process.env.HTTP_PORT ?? "3100"}`
).replace(/\/+$/u, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
        source: "/admin/:path*",
      },
    ];
  },
  async rewrites() {
    return [
      {
        destination: `${apiOrigin}/admin/api/:path*`,
        source: "/admin/api/:path*",
      },
      {
        destination: `${apiOrigin}/api/:path*`,
        source: "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
