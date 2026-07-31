import { describe, expect, it } from "vitest";

import { sanitizeAdminProxyRequestHeaders } from "./admin-proxy-headers";

describe("sanitizeAdminProxyRequestHeaders", () => {
  it("removes every client-controlled forwarding identity before the trusted rewrite", () => {
    const sanitized = sanitizeAdminProxyRequestHeaders(
      new Headers({
        Forwarded: "for=198.51.100.90",
        Origin: "https://five.example",
        "X-Forwarded-For": "198.51.100.91",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Port": "444",
        "X-Forwarded-Proto": "http",
        "X-Real-IP": "198.51.100.92",
      }),
    );

    expect(Object.fromEntries(sanitized)).toEqual({ origin: "https://five.example" });
  });
});
