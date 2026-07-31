import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { adminSecurityCryptoFromEnvironment } from "./admin-auth.configuration";
import { summarizeAdminUserAgent } from "./admin-auth.service";

describe("admin authentication configuration and evidence minimization", () => {
  it.each([
    ["MicroMessenger/8.0.50 iPhone15,2 CPU iPhone OS 19_1", "browser=wechat;platform=ios"],
    [
      "Mozilla/5.0 Linux; Android 16 Chrome/140.0.7339.122 Pixel 9",
      "browser=chrome;platform=android",
    ],
    [
      "Mozilla/5.0 Macintosh; Intel Mac OS X 15_0 Version/18.0 Safari/605.1.15",
      "browser=safari;platform=macos",
    ],
    ["custom-client/very-specific-device-serial", "browser=other;platform=other"],
  ])("reduces a raw user agent to a coarse browser/platform allowlist", (raw, expected) => {
    expect(summarizeAdminUserAgent(raw)).toBe(expected);
    expect(summarizeAdminUserAgent(raw)).not.toContain("15,2");
    expect(summarizeAdminUserAgent(raw)).not.toContain("7339");
  });

  it("requires independent explicit HMAC and versioned encryption keys", () => {
    const hmacKey = randomBytes(32);
    const encryptionKey = randomBytes(32);
    const configured = adminSecurityCryptoFromEnvironment({
      FIVE_ADMIN_HMAC_KEY_BASE64: hmacKey.toString("base64"),
      FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION: "2",
      FIVE_ADMIN_TOTP_KEYS_JSON: JSON.stringify({
        1: randomBytes(32).toString("base64"),
        2: encryptionKey.toString("base64"),
      }),
    });
    expect(configured.digester.digest("csrf-token", "session")).not.toEqual(
      configured.digester.digest("csrf-verifier", "session"),
    );
    const encrypted = configured.secretCipher.encrypt(Buffer.from("secret"), "operator", 4);
    expect(configured.secretCipher.decrypt(encrypted, "operator", 4)).toEqual(
      Buffer.from("secret"),
    );

    expect(() =>
      adminSecurityCryptoFromEnvironment({
        FIVE_ADMIN_HMAC_KEY_BASE64: hmacKey.toString("base64"),
        FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION: "3",
        FIVE_ADMIN_TOTP_KEYS_JSON: JSON.stringify({ 2: encryptionKey.toString("base64") }),
      }),
    ).toThrow("active TOTP encryption key version is absent");

    expect(() =>
      adminSecurityCryptoFromEnvironment({
        FIVE_ADMIN_HMAC_KEY_BASE64: hmacKey.toString("base64"),
        FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION: "1",
        FIVE_ADMIN_TOTP_KEYS_JSON: JSON.stringify({ 1: hmacKey.toString("base64") }),
      }),
    ).toThrow("must not be reused");
  });
});
