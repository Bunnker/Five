import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";

export type AdminAuthDigestDomain =
  | "account-rate-limit"
  | "csrf-token"
  | "csrf-verifier"
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
const MIN_PASSWORD_CODE_POINTS = 8;
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
      throw new AdminAuthInputError("Password must contain between 8 and 128 Unicode code points");
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

export class SystemAdminAuthRandom {
  opaqueToken(): string {
    return randomBytes(32).toString("base64url");
  }

  identifier(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}
