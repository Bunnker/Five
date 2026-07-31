import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

export type AdminAuthDigestDomain =
  | "account-rate-limit"
  | "csrf-token"
  | "csrf-verifier"
  | "login-challenge"
  | "recovery-challenge"
  | "recovery-code"
  | "security-event-cursor"
  | "session"
  | "source-fingerprint";

export interface ScryptParameters {
  readonly blockSize: number;
  readonly cost: number;
  readonly parallelization: number;
}

const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  blockSize: 8,
  cost: 32_768,
  parallelization: 1,
};
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const MIN_PASSWORD_CODE_POINTS = 16;
const MAX_PASSWORD_CODE_POINTS = 128;

export class AdminAuthInputError extends Error {
  readonly code = "invalid_password";
}

function isValidPassword(password: string): boolean {
  const length = Array.from(password).length;
  return length >= MIN_PASSWORD_CODE_POINTS && length <= MAX_PASSWORD_CODE_POINTS;
}

function deriveScrypt(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  const minimumMemory = 128 * parameters.cost * parameters.blockSize + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_HASH_BYTES,
      {
        N: parameters.cost,
        maxmem: Math.max(64 * 1024 * 1024, minimumMemory),
        p: parameters.parallelization,
        r: parameters.blockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function checkedScryptParameters(parameters: ScryptParameters): ScryptParameters {
  if (
    !Number.isInteger(parameters.cost) ||
    parameters.cost < 1_024 ||
    parameters.cost > 1_048_576 ||
    (parameters.cost & (parameters.cost - 1)) !== 0 ||
    !Number.isInteger(parameters.blockSize) ||
    parameters.blockSize < 1 ||
    parameters.blockSize > 32 ||
    !Number.isInteger(parameters.parallelization) ||
    parameters.parallelization < 1 ||
    parameters.parallelization > 16
  ) {
    throw new Error("Invalid scrypt parameters");
  }
  return parameters;
}

interface ParsedPasswordHash {
  readonly derivedKey: Buffer;
  readonly parameters: ScryptParameters;
  readonly salt: Buffer;
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  const parts = encodedHash.split("$");
  if (parts.length !== 8 || parts[0] !== "scrypt" || parts[1] !== "v=1") {
    return null;
  }
  const cost = Number(parts[2]?.replace(/^n=/u, ""));
  const blockSize = Number(parts[3]?.replace(/^r=/u, ""));
  const parallelization = Number(parts[4]?.replace(/^p=/u, ""));
  try {
    const parameters = checkedScryptParameters({ blockSize, cost, parallelization });
    const salt = Buffer.from(parts[5] ?? "", "base64url");
    const derivedKey = Buffer.from(parts[6] ?? "", "base64url");
    if (
      parts[7] !== "end" ||
      salt.length !== PASSWORD_SALT_BYTES ||
      derivedKey.length !== PASSWORD_HASH_BYTES
    ) {
      return null;
    }
    return { derivedKey, parameters, salt };
  } catch {
    return null;
  }
}

export class NodeScryptPasswordHasher {
  private readonly parameters: ScryptParameters;

  constructor(parameters: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS) {
    this.parameters = checkedScryptParameters(parameters);
  }

  async hash(password: string): Promise<string> {
    if (!isValidPassword(password)) {
      throw new AdminAuthInputError("Password must contain between 16 and 128 Unicode code points");
    }
    const salt = randomBytes(PASSWORD_SALT_BYTES);
    const derivedKey = await deriveScrypt(password, salt, this.parameters);
    return [
      "scrypt",
      "v=1",
      `n=${this.parameters.cost}`,
      `r=${this.parameters.blockSize}`,
      `p=${this.parameters.parallelization}`,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
      "end",
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsed = parsePasswordHash(encodedHash);
    if (parsed === null) {
      return false;
    }
    const candidate = await deriveScrypt(password, parsed.salt, parsed.parameters);
    return timingSafeEqual(candidate, parsed.derivedKey);
  }
}

export interface EncryptedTotpSecret {
  readonly aad: string;
  readonly authenticationTag: Buffer;
  readonly ciphertext: Buffer;
  readonly initializationVector: Buffer;
  readonly keyVersion: number;
}

export interface TotpEncryptionKeyring {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

function totpAad(accountId: string, credentialRevision: number): string {
  if (!Number.isSafeInteger(credentialRevision) || credentialRevision < 1) {
    throw new Error("Credential revision must be a positive safe integer");
  }
  return `five:admin-totp:v1:${accountId}:credential-revision:${credentialRevision}`;
}

export class AesGcmTotpSecretCipher {
  constructor(private readonly keyring: TotpEncryptionKeyring) {
    const activeKey = keyring.keys.get(keyring.activeVersion);
    if (activeKey?.length !== 32) {
      throw new Error("The active TOTP encryption key must contain exactly 32 bytes");
    }
    for (const key of keyring.keys.values()) {
      if (key.length !== 32) {
        throw new Error("Every TOTP encryption key must contain exactly 32 bytes");
      }
    }
  }

  encrypt(secret: Buffer, accountId: string, credentialRevision: number): EncryptedTotpSecret {
    const initializationVector = randomBytes(12);
    const aad = totpAad(accountId, credentialRevision);
    const key = this.keyring.keys.get(this.keyring.activeVersion);
    if (key === undefined) {
      throw new Error("Active TOTP encryption key is unavailable");
    }
    const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return {
      aad,
      authenticationTag: cipher.getAuthTag(),
      ciphertext,
      initializationVector,
      keyVersion: this.keyring.activeVersion,
    };
  }

  decrypt(encrypted: EncryptedTotpSecret, accountId: string, credentialRevision: number): Buffer {
    const expectedAad = totpAad(accountId, credentialRevision);
    if (encrypted.aad !== expectedAad) {
      throw new Error("TOTP ciphertext AAD mismatch");
    }
    const key = this.keyring.keys.get(encrypted.keyVersion);
    if (key === undefined) {
      throw new Error(`TOTP encryption key version ${encrypted.keyVersion} is unavailable`);
    }
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.initializationVector);
    decipher.setAAD(Buffer.from(encrypted.aad, "utf8"));
    decipher.setAuthTag(encrypted.authenticationTag);
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  }
}

export class HmacSecretDigester {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("The admin authentication HMAC key must contain exactly 32 bytes");
    }
  }

  digest(domain: AdminAuthDigestDomain, value: string): Buffer {
    return createHmac("sha256", this.key)
      .update(`five:admin-auth:${domain}:v1\0`, "utf8")
      .update(value, "utf8")
      .digest();
  }
}

function counterBuffer(counter: number): Buffer {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("TOTP counter must be a non-negative safe integer");
  }
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(counter));
  return result;
}

export function generateTotpCode(secret: Buffer, counter: number, digits = 6): string {
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error("TOTP digits must be between 6 and 8");
  }
  const digest = createHmac("sha1", secret).update(counterBuffer(counter)).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function matchTotpCounter(
  secret: Buffer,
  code: string,
  currentCounter: number,
  allowedDriftSteps = 1,
): number | null {
  if (!/^\d{6}$/u.test(code)) {
    return null;
  }
  const offsets = [0];
  for (let distance = 1; distance <= allowedDriftSteps; distance += 1) {
    offsets.push(-distance, distance);
  }
  const candidate = Buffer.from(code, "ascii");
  for (const offset of offsets) {
    const counter = currentCounter + offset;
    if (counter < 0) {
      continue;
    }
    const expected = Buffer.from(generateTotpCode(secret, counter, 6), "ascii");
    if (timingSafeEqual(candidate, expected)) {
      return counter;
    }
  }
  return null;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return encoded;
}

export interface TotpSetup {
  readonly otpauthUri: string;
  readonly secret: Buffer;
  readonly secretBase32: string;
}

export class SystemAdminAuthRandom {
  opaqueToken(): string {
    return randomBytes(32).toString("base64url");
  }

  recoveryCodes(): readonly string[] {
    return Array.from({ length: 10 }, () => `RC-${randomBytes(32).toString("base64url")}`);
  }

  identifier(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  totpSetup(username: string): TotpSetup {
    const secret = randomBytes(20);
    const secretBase32 = encodeBase32(secret);
    const issuer = encodeURIComponent("Five");
    const label = encodeURIComponent(`Five:${username}`);
    return {
      otpauthUri: `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      secret,
      secretBase32,
    };
  }
}
