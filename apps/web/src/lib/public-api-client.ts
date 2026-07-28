import { randomUUID } from "node:crypto";

const DEFAULT_HTTP_PORT = "3100";

export const DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS = 5_000;

export function getPublicApiOrigin(): string {
  return (
    process.env.FIVE_API_ORIGIN ?? `http://127.0.0.1:${process.env.HTTP_PORT ?? DEFAULT_HTTP_PORT}`
  );
}

export function resolvePublicRequestId(requestId: string | null | undefined): string {
  const candidate = requestId?.trim();
  if (
    candidate !== undefined &&
    candidate.length >= 8 &&
    candidate.length <= 128 &&
    !/[\r\n]/u.test(candidate)
  ) {
    return candidate;
  }

  return randomUUID();
}
