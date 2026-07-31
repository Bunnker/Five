import { AesGcmTotpSecretCipher, HmacSecretDigester } from "./admin-auth.crypto";

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
  readonly secretCipher: AesGcmTotpSecretCipher;
} {
  const activeVersion = Number(environment.FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION);
  if (!Number.isSafeInteger(activeVersion) || activeVersion < 1) {
    throw new Error("FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION must be a positive integer");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(environment.FIVE_ADMIN_TOTP_KEYS_JSON ?? "");
  } catch {
    throw new Error("FIVE_ADMIN_TOTP_KEYS_JSON must be a JSON object of versioned Base64 keys");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("FIVE_ADMIN_TOTP_KEYS_JSON must be a JSON object of versioned Base64 keys");
  }
  const keys = new Map<number, Buffer>();
  for (const [versionText, encoded] of Object.entries(parsed)) {
    const version = Number(versionText);
    if (!Number.isSafeInteger(version) || version < 1 || String(version) !== versionText) {
      throw new Error("FIVE_ADMIN_TOTP_KEYS_JSON contains an invalid key version");
    }
    keys.set(version, decodeKey(encoded, `TOTP encryption key version ${version}`));
  }
  if (!keys.has(activeVersion)) {
    throw new Error(
      "The active TOTP encryption key version is absent from FIVE_ADMIN_TOTP_KEYS_JSON",
    );
  }
  const hmacKey = decodeKey(environment.FIVE_ADMIN_HMAC_KEY_BASE64, "FIVE_ADMIN_HMAC_KEY_BASE64");
  if ([...keys.values()].some((encryptionKey) => encryptionKey.equals(hmacKey))) {
    throw new Error("The admin HMAC key must not be reused as a TOTP encryption key");
  }
  return {
    digester: new HmacSecretDigester(hmacKey),
    secretCipher: new AesGcmTotpSecretCipher({ activeVersion, keys }),
  };
}
