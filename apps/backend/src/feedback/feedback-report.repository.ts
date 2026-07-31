import type { components } from "@five/api-contract";

export type CreateFeedbackRequest = components["schemas"]["CreateFeedbackRequest"];

export const FEEDBACK_REPORT_REPOSITORY = Symbol("FEEDBACK_REPORT_REPOSITORY");

export interface CreateFeedbackReportRecordInput extends CreateFeedbackRequest {
  feedbackId: string;
  requestId: string;
}

export type CreateFeedbackReportResult =
  { feedbackId: string; kind: "accepted" } | { kind: "rate_limited"; retryAfterSeconds: number };

export interface FeedbackReportRepository {
  create(input: CreateFeedbackReportRecordInput): Promise<CreateFeedbackReportResult>;
}
