import type { components } from "@five/api-contract";

export type FeedbackErrorCode = components["schemas"]["ErrorCode"];
export type FeedbackErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export const FEEDBACK_REPORT_PATH = "/api/v1/feedback-reports";

export function feedbackErrorEnvelope(
  code: FeedbackErrorCode,
  message: string,
  requestId: string,
  retryable: boolean,
): FeedbackErrorEnvelope {
  return { error: { code, details: {}, message, requestId, retryable } };
}
