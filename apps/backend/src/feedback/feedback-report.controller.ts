import type { components } from "@five/api-contract";
import { Body, Controller, Headers, Logger, Post, Res } from "@nestjs/common";

import { resolveHttpRequestId } from "../http/request-id";
import { isFortuneDate, isOpaquePublicValue } from "../today/public-route-params";
import { feedbackErrorEnvelope } from "./feedback-http";
import type { CreateFeedbackRequest } from "./feedback-report.repository";
import { FeedbackReportService } from "./feedback-report.service";

type CreateFeedbackResponse = components["schemas"]["CreateFeedbackResponse"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

const CREATE_FEEDBACK_KEYS = [
  "category",
  "channelId",
  "contact",
  "contentVersion",
  "fortuneDate",
  "message",
] as const;
const FEEDBACK_UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

export interface FeedbackReportHttpReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

function textLength(value: string): number {
  return Array.from(value).length;
}

function containsUnsafeControl(value: string, allowLineWhitespace: boolean): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (allowLineWhitespace && (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d)) {
      return false;
    }
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function isMessage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    textLength(value) <= 2_000 &&
    !containsUnsafeControl(value, true)
  );
}

function isContact(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.trim().length >= 1 &&
      textLength(value) <= 200 &&
      !containsUnsafeControl(value, false))
  );
}

function isCreateFeedbackRequest(value: unknown): value is CreateFeedbackRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === CREATE_FEEDBACK_KEYS.length &&
    keys.every((key, index) => key === CREATE_FEEDBACK_KEYS[index]) &&
    (record.category === "content_error" || record.category === "product_feedback") &&
    isMessage(record.message) &&
    typeof record.fortuneDate === "string" &&
    isFortuneDate(record.fortuneDate) &&
    isOpaquePublicValue(record.contentVersion) &&
    isOpaquePublicValue(record.channelId) &&
    textLength(record.channelId) <= 64 &&
    isContact(record.contact)
  );
}

@Controller("api/v1/feedback-reports")
export class FeedbackReportController {
  private readonly logger = new Logger(FeedbackReportController.name);

  constructor(private readonly service: FeedbackReportService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: FeedbackReportHttpReply,
  ): Promise<CreateFeedbackResponse | ErrorEnvelope> {
    const requestId = resolveHttpRequestId(incomingRequestId);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", requestId);

    if (!isCreateFeedbackRequest(body)) {
      reply.status(400);
      return feedbackErrorEnvelope(
        "INVALID_ARGUMENT",
        "反馈信息格式无效，请检查后重试。",
        requestId,
        false,
      );
    }

    let result: Awaited<ReturnType<FeedbackReportService["submit"]>>;
    try {
      result = await this.service.submit(body, requestId);
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: "Feedback report persistence failed",
        requestId,
      });
      reply.header("Retry-After", FEEDBACK_UNAVAILABLE_RETRY_AFTER_SECONDS);
      reply.status(503);
      return feedbackErrorEnvelope(
        "FEEDBACK_UNAVAILABLE",
        "反馈暂时无法接收，请稍后再试。",
        requestId,
        true,
      );
    }
    if (result.kind === "rate_limited") {
      reply.header("Retry-After", result.retryAfterSeconds);
      reply.status(429);
      return feedbackErrorEnvelope("RATE_LIMITED", "提交过于频繁，请稍后再试。", requestId, true);
    }

    reply.status(202);
    return { feedbackId: result.feedbackId, status: "received" };
  }
}
