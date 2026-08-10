import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  HmacSecretDigester,
  NodeScryptPasswordHasher,
  SystemAdminAuthRandom,
} from "./admin-auth.crypto";

describe("admin authentication cryptography", () => {
  it("hashes only passwords between 8 and 128 Unicode code points", async () => {
    const hasher = new NodeScryptPasswordHasher({ cost: 1_024, blockSize: 8, parallelization: 1 });
    const password = "Passw0rd";
    const encoded = await hasher.hash(password);

    await expect(hasher.verify(password, encoded)).resolves.toBe(true);
    await expect(hasher.verify(`${password}!`, encoded)).resolves.toBe(false);
    await expect(hasher.hash("1234567")).rejects.toMatchObject({ code: "invalid_password" });
    await expect(hasher.hash("密".repeat(129))).rejects.toMatchObject({ code: "invalid_password" });
    await expect(hasher.verify(password, "not-a-scrypt-hash")).resolves.toBe(false);
  });

  it("uses domain-separated keyed digests and 256-bit random opaque values", () => {
    const digester = new HmacSecretDigester(randomBytes(32));
    expect(digester.digest("session", "same-value")).not.toEqual(
      digester.digest("csrf-verifier", "same-value"),
    );

    const random = new SystemAdminAuthRandom();
    const token = random.opaqueToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(random.identifier("admin")).toMatch(/^admin_[0-9a-f-]{36}$/u);
  });
});
