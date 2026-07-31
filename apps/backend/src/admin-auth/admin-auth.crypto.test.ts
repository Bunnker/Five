import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AesGcmTotpSecretCipher,
  HmacSecretDigester,
  NodeScryptPasswordHasher,
  SystemAdminAuthRandom,
  generateTotpCode,
  matchTotpCounter,
} from "./admin-auth.crypto";

describe("admin authentication cryptography", () => {
  it("hashes only passwords between 16 and 128 Unicode code points", async () => {
    const hasher = new NodeScryptPasswordHasher({ cost: 1_024, blockSize: 8, parallelization: 1 });
    const password = "密码abcdefghijklmn";
    const encoded = await hasher.hash(password);

    await expect(hasher.verify(password, encoded)).resolves.toBe(true);
    await expect(hasher.verify(`${password}!`, encoded)).resolves.toBe(false);
    await expect(hasher.hash("短密码short")).rejects.toMatchObject({ code: "invalid_password" });
    await expect(hasher.hash("密".repeat(129))).rejects.toMatchObject({ code: "invalid_password" });
    await expect(hasher.verify(password, "not-a-scrypt-hash")).resolves.toBe(false);
  });

  it("matches RFC 6238 SHA-1 vectors and accepts only the configured adjacent counters", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    expect(generateTotpCode(secret, 1, 8)).toBe("94287082");

    const currentCounter = 1_000;
    const previous = generateTotpCode(secret, currentCounter - 1);
    const next = generateTotpCode(secret, currentCounter + 1);
    expect(matchTotpCounter(secret, previous, currentCounter, 1)).toBe(currentCounter - 1);
    expect(matchTotpCounter(secret, next, currentCounter, 1)).toBe(currentCounter + 1);
    expect(
      matchTotpCounter(secret, generateTotpCode(secret, currentCounter - 2), currentCounter, 1),
    ).toBeNull();
    expect(matchTotpCounter(secret, "12345", currentCounter, 1)).toBeNull();
  });

  it("encrypts TOTP secrets with versioned AES-256-GCM keys and account-bound AAD", () => {
    const cipher = new AesGcmTotpSecretCipher({
      activeVersion: 7,
      keys: new Map([[7, randomBytes(32)]]),
    });
    const encrypted = cipher.encrypt(Buffer.from("totp-secret"), "operator-1", 3);

    expect(encrypted.keyVersion).toBe(7);
    expect(encrypted.aad).toBe("five:admin-totp:v1:operator-1:credential-revision:3");
    expect(cipher.decrypt(encrypted, "operator-1", 3)).toEqual(Buffer.from("totp-secret"));
    expect(() => cipher.decrypt(encrypted, "operator-2", 3)).toThrow(
      "TOTP ciphertext AAD mismatch",
    );
    expect(() => cipher.decrypt(encrypted, "operator-1", 4)).toThrow(
      "TOTP ciphertext AAD mismatch",
    );
    expect(() => cipher.decrypt({ ...encrypted, keyVersion: 8 }, "operator-1", 3)).toThrow(
      "TOTP encryption key version 8 is unavailable",
    );
    expect(() =>
      cipher.decrypt({ ...encrypted, authenticationTag: Buffer.alloc(16) }, "operator-1", 3),
    ).toThrow();
  });

  it("uses domain-separated keyed digests and 256-bit random opaque values", () => {
    const digester = new HmacSecretDigester(randomBytes(32));
    expect(digester.digest("session", "same-value")).not.toEqual(
      digester.digest("recovery-code", "same-value"),
    );

    const random = new SystemAdminAuthRandom();
    const token = random.opaqueToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    const codes = random.recoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => Buffer.from(code.slice(3), "base64url").length === 32)).toBe(true);
  });
});
