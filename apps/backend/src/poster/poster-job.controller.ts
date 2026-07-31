import type { components } from "@five/api-contract";
import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";

import { resolveHttpRequestId } from "../http/request-id";
import { isFortuneDate, isOpaquePublicValue } from "../today/public-route-params";
import { PosterJobService } from "./poster-job.service";

type CreatePosterJobRequest = components["schemas"]["CreatePosterJobRequest"];
type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
type PosterJob = components["schemas"]["PosterJob"];

const POSTER_UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

export interface PosterJobHttpReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  retryable: boolean,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error: { code, details, message, requestId, retryable } };
}

function isCreatePosterJobRequest(value: unknown): value is CreatePosterJobRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === 3 &&
    keys[0] === "channelId" &&
    keys[1] === "expectedContentVersion" &&
    keys[2] === "fortuneDate" &&
    typeof record.fortuneDate === "string" &&
    isFortuneDate(record.fortuneDate) &&
    isOpaquePublicValue(record.expectedContentVersion) &&
    isOpaquePublicValue(record.channelId) &&
    record.channelId.length <= 64
  );
}

function isIdempotencyKey(value: unknown): value is string {
  return isOpaquePublicValue(value) && value.length >= 16;
}

@Controller("api/v1/poster-jobs")
export class PosterJobController {
  constructor(private readonly service: PosterJobService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: PosterJobHttpReply,
  ): Promise<PosterJob | ErrorEnvelope> {
    const requestId = resolveHttpRequestId(incomingRequestId);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", requestId);

    if (!isIdempotencyKey(idempotencyKey) || !isCreatePosterJobRequest(body)) {
      reply.status(400);
      return errorEnvelope(
        "INVALID_ARGUMENT",
        "海报请求参数无效，请检查后重试。",
        requestId,
        false,
      );
    }

    const result = await this.service.create(body, idempotencyKey);
    if (result.kind === "version_changed") {
      reply.status(409);
      return errorEnvelope(
        "CONTENT_VERSION_CHANGED",
        "页面内容版本已经变化，请刷新后重试。",
        requestId,
        true,
        {
          currentContentVersion: result.currentActiveContentVersion,
          expectedContentVersion: body.expectedContentVersion,
        },
      );
    }
    if (result.kind === "idempotency_conflict") {
      reply.status(409);
      return errorEnvelope(
        "IDEMPOTENCY_KEY_REUSED",
        "该幂等键已经用于另一份海报请求。",
        requestId,
        false,
      );
    }
    if (result.kind === "rate_limited") {
      reply.header("Retry-After", result.retryAfterSeconds);
      reply.status(429);
      return errorEnvelope("RATE_LIMITED", "海报生成队列暂时已满，请稍后重试。", requestId, true);
    }
    if (result.kind === "unavailable") {
      reply.header("Retry-After", POSTER_UNAVAILABLE_RETRY_AFTER_SECONDS);
      reply.status(503);
      return errorEnvelope(
        "POSTER_GENERATION_UNAVAILABLE",
        "海报暂时不可用，今日内容和分享链接不受影响。",
        requestId,
        true,
      );
    }

    reply.status(result.kind === "accepted" ? 202 : 200);
    return result.job;
  }

  @Get(":jobId")
  async get(
    @Param("jobId") jobId: string,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: PosterJobHttpReply,
  ): Promise<PosterJob | ErrorEnvelope> {
    const requestId = resolveHttpRequestId(incomingRequestId);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", requestId);

    let job: PosterJob | null;
    try {
      job = isOpaquePublicValue(jobId) ? await this.service.get(jobId) : null;
    } catch {
      reply.header("Retry-After", POSTER_UNAVAILABLE_RETRY_AFTER_SECONDS);
      reply.status(503);
      return errorEnvelope(
        "POSTER_GENERATION_UNAVAILABLE",
        "海报暂时不可用，今日内容和分享链接不受影响。",
        requestId,
        true,
      );
    }
    if (job === null) {
      reply.status(404);
      return errorEnvelope("RESOURCE_NOT_FOUND", "海报任务不存在。", requestId, false, {
        jobId,
      });
    }
    reply.status(200);
    return job;
  }
}
