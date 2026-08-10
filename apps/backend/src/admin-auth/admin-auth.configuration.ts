import { HmacSecretDigester } from "./admin-auth.crypto";

function decodeKey(value: unknown, label: string): Buffer {
  if (typeof value !== "string") {
    throw new Error(`${label} is missing or is not a Base64 string`);
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes`);
  }
  return key;
}

export function adminSecurityCryptoFromEnvironment(environment: NodeJS.ProcessEnv): {
  readonly digester: HmacSecretDigester;
} {
  const hmacKey = decodeKey(environment.FIVE_ADMIN_HMAC_KEY_BASE64, "FIVE_ADMIN_HMAC_KEY_BASE64");
  return {
    digester: new HmacSecretDigester(hmacKey),
  };
}
