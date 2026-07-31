import type { components } from "@five/api-contract";

export type AdminErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export interface AdminHttpReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

export function adminErrorEnvelope(
  code: components["schemas"]["ErrorCode"],
  message: string,
  requestId: string,
  retryable = false,
): AdminErrorEnvelope {
  return { error: { code, details: {}, message, requestId, retryable } };
}

export function hasExactlyKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}
