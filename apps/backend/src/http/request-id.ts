import { randomUUID } from "node:crypto";

export function resolveHttpRequestId(incomingRequestId: string | undefined): string {
  return incomingRequestId !== undefined &&
    incomingRequestId.length >= 8 &&
    incomingRequestId.length <= 128 &&
    !/[\r\n]/u.test(incomingRequestId)
    ? incomingRequestId
    : randomUUID();
}
