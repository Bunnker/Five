import type { components } from "@five/api-contract";

type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export function analyticsErrorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  retryable: boolean,
): ErrorEnvelope {
  return {
    error: {
      code,
      details: {},
      message,
      requestId,
      retryable,
    },
  };
}
