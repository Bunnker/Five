import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("admin web boundary", () => {
  it("allows the two documented loopback hosts to load development assets", () => {
    expect(nextConfig.allowedDevOrigins).toEqual(["127.0.0.1", "localhost"]);
  });

  it("proxies the same-origin admin API before the public API rewrite", async () => {
    expect(await nextConfig.rewrites?.()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: expect.stringMatching(/\/admin\/api\/:path\*$/u),
          source: "/admin/api/:path*",
        }),
      ]),
    );
  });

  it("prevents admin pages from being cached, framed, or sending referrers", async () => {
    expect(await nextConfig.headers?.()).toEqual([
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
    ]);
  });
});
