import type { NextConfig } from "next";

const apiOrigin = (
  process.env.FIVE_API_ORIGIN ?? `http://127.0.0.1:${process.env.HTTP_PORT ?? "3100"}`
).replace(/\/+$/u, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        destination: `${apiOrigin}/api/:path*`,
        source: "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
