import { createHmac } from "node:crypto";

export type AnalyticsHmacDomain = "anonymous-id" | "poster-instance-id" | "referral-id";

export interface AnalyticsHmacDigesterPort {
  readonly available: boolean;
  digest(domain: AnalyticsHmacDomain, value: string): string;
}

export class AnalyticsHmacDigester implements AnalyticsHmacDigesterPort {
  readonly available = true;

  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("analytics HMAC key must decode to exactly 32 bytes");
    }
    this.key = Buffer.from(key);
  }

  digest(domain: AnalyticsHmacDomain, value: string): string {
    return createHmac("sha256", this.key)
      .update(`five-analytics:${domain}\u0000`)
      .update(value)
      .digest("hex");
  }
}

class UnavailableAnalyticsHmacDigester implements AnalyticsHmacDigesterPort {
  readonly available = false;

  digest(): never {
    throw new Error("analytics HMAC is unavailable");
  }
}

export function analyticsHmacKeyFromEnvironment(environment: NodeJS.ProcessEnv): Buffer {
  const encoded = environment.FIVE_ANALYTICS_HMAC_KEY_BASE64;
  if (encoded === undefined || !/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) {
    throw new Error(
      "FIVE_ANALYTICS_HMAC_KEY_BASE64 must be one canonical base64-encoded 32-byte key",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error(
      "FIVE_ANALYTICS_HMAC_KEY_BASE64 must be one canonical base64-encoded 32-byte key",
    );
  }
  return key;
}

export function analyticsHmacDigesterFromEnvironment(
  environment: NodeJS.ProcessEnv,
): AnalyticsHmacDigesterPort {
  try {
    return new AnalyticsHmacDigester(analyticsHmacKeyFromEnvironment(environment));
  } catch {
    // Anonymous analytics is deliberately a side capability: invalid configuration must not
    // prevent public content, publishing, or recovery from starting.
    return new UnavailableAnalyticsHmacDigester();
  }
}
