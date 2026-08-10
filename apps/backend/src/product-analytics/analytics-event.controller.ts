import type { components } from "@five/api-contract";
import { Body, Controller, Headers, HttpCode, Logger, Post, Res } from "@nestjs/common";

import { resolveHttpRequestId } from "../http/request-id";
import { isFortuneDate, isOpaquePublicValue } from "../today/public-route-params";
import { AnalyticsEventService } from "./analytics-event.service";
import { analyticsErrorEnvelope } from "./analytics-http";

type CreateAnalyticsEventRequest = components["schemas"]["CreateAnalyticsEventRequest"];
type CreateAnalyticsEventResponse = components["schemas"]["CreateAnalyticsEventResponse"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

const REQUEST_KEYS = [
  "anonymousId",
  "channelId",
  "contentVersion",
  "eventId",
  "eventName",
  "fortuneDate",
  "posterInstanceId",
  "referralId",
  "sourceContentVersion",
] as const;
const EVENT_NAMES = new Set<CreateAnalyticsEventRequest["eventName"]>([
  "open_outfit_hub",
  "poster_landing_view",
  "poster_save_failed",
  "poster_save_requested",
  "poster_save_succeeded",
  "share_link_landing_view",
  "share_poster_initiated",
  "share_summary_initiated",
  "view_daily_look",
  "view_look_detail",
  "view_today_summary",
]);
const ANALYTICS_ID_PATTERN = /^[-A-Za-z0-9_:.]{16,128}$/u;
const RETRY_AFTER_SECONDS = 30;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export interface AnalyticsHttpReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isBoundedOpaque(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    codePointLength(value) <= maximum &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  );
}

function isAnalyticsId(value: unknown): value is string {
  return typeof value === "string" && ANALYTICS_ID_PATTERN.test(value);
}

function isNullableAnalyticsId(value: unknown): value is string | null {
  return value === null || isAnalyticsId(value);
}

function isNullableOpaqueId(value: unknown): value is string | null {
  return value === null || (isOpaquePublicValue(value) && codePointLength(value) <= 128);
}

function eventFieldsAreConsistent(request: CreateAnalyticsEventRequest): boolean {
  const hasReferral = request.referralId !== null;
  const hasPoster = request.posterInstanceId !== null;
  const hasSourceVersion = request.sourceContentVersion !== null;

  switch (request.eventName) {
    case "open_outfit_hub":
    case "view_daily_look":
    case "view_look_detail":
    case "view_today_summary":
      return !hasReferral && !hasPoster && !hasSourceVersion;
    case "share_summary_initiated":
      return hasReferral && !hasPoster && !hasSourceVersion;
    case "share_link_landing_view":
      return hasReferral && !hasPoster && hasSourceVersion;
    case "share_poster_initiated":
      return hasReferral && hasPoster && !hasSourceVersion;
    case "poster_save_failed":
    case "poster_save_requested":
    case "poster_save_succeeded":
      return !hasReferral && hasPoster && !hasSourceVersion;
    case "poster_landing_view":
      return hasReferral && !hasPoster && hasSourceVersion;
  }
}

function isAnalyticsEventRequest(value: unknown): value is CreateAnalyticsEventRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === REQUEST_KEYS.length &&
    keys.every((key, index) => key === REQUEST_KEYS[index]) &&
    isAnalyticsId(record.eventId) &&
    typeof record.eventName === "string" &&
    EVENT_NAMES.has(record.eventName as CreateAnalyticsEventRequest["eventName"]) &&
    typeof record.fortuneDate === "string" &&
    isFortuneDate(record.fortuneDate) &&
    isBoundedOpaque(record.contentVersion, 128) &&
    isBoundedOpaque(record.channelId, 64) &&
    isAnalyticsId(record.anonymousId) &&
    isNullableAnalyticsId(record.referralId) &&
    isNullableOpaqueId(record.posterInstanceId) &&
    isNullableOpaqueId(record.sourceContentVersion) &&
    eventFieldsAreConsistent(record as unknown as CreateAnalyticsEventRequest)
  );
}

@Controller("api/v1/analytics-events")
export class AnalyticsEventController {
  private readonly logger = new Logger(AnalyticsEventController.name);

  constructor(private readonly service: AnalyticsEventService) {}

  @Post()
  @HttpCode(202)
  async create(
    @Body() body: unknown,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: AnalyticsHttpReply,
  ): Promise<CreateAnalyticsEventResponse | ErrorEnvelope> {
    const requestId = resolveHttpRequestId(incomingRequestId);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", requestId);

    if (!isAnalyticsEventRequest(body)) {
      reply.status(400);
      return analyticsErrorEnvelope("INVALID_ARGUMENT", "匿名使用事件格式无效。", requestId, false);
    }

    try {
      const result = await this.service.record(body);
      if (result.kind === "idempotency_conflict") {
        reply.status(409);
        return analyticsErrorEnvelope(
          "IDEMPOTENCY_KEY_REUSED",
          "事件标识已用于不同内容。",
          requestId,
          false,
        );
      }
      if (result.kind === "rate_limited") {
        reply.header("Retry-After", RATE_LIMIT_RETRY_AFTER_SECONDS);
        reply.status(429);
        return analyticsErrorEnvelope(
          "RATE_LIMITED",
          "匿名使用事件较多，请稍后再试；页面功能不受影响。",
          requestId,
          true,
        );
      }
      reply.status(202);
      return { eventId: body.eventId, status: result.kind };
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: "Analytics event persistence failed",
        requestId,
      });
      reply.header("Retry-After", RETRY_AFTER_SECONDS);
      reply.status(503);
      return analyticsErrorEnvelope(
        "ANALYTICS_UNAVAILABLE",
        "匿名使用统计暂时不可用，其他功能不受影响。",
        requestId,
        true,
      );
    }
  }
}
