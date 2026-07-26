import { randomUUID } from "node:crypto";

import type { components } from "@five/api-contract";
import { Controller, Get, Headers, Inject, Logger, Res } from "@nestjs/common";

import type { TodayContentResult } from "./today-content.service";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
type TodayResponse = components["schemas"]["TodayResponse"];

export const TODAY_CONTENT_READER = Symbol("TODAY_CONTENT_READER");

export interface TodayContentReader {
  read(): Promise<TodayContentResult>;
}

export interface TodayHttpReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  const normalize = (value: string) => value.replace(/^W\//i, "");
  const normalizedEtag = normalize(etag);

  return (
    ifNoneMatch
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || normalize(candidate) === normalizedEtag) ?? false
  );
}

function resolveRequestId(incomingRequestId: string | undefined): string {
  return incomingRequestId !== undefined &&
    incomingRequestId.length >= 8 &&
    incomingRequestId.length <= 128 &&
    !/[\r\n]/.test(incomingRequestId)
    ? incomingRequestId
    : randomUUID();
}

@Controller("api/v1")
export class TodayController {
  private readonly logger = new Logger(TodayController.name);

  constructor(
    @Inject(TODAY_CONTENT_READER)
    private readonly todayContentReader: TodayContentReader,
  ) {}

  private contentNotReady(
    reply: TodayHttpReply,
    requestId: string,
    retryAfterSeconds: number,
  ): ErrorEnvelope {
    reply.header("Cache-Control", "no-store");
    reply.header("Retry-After", retryAfterSeconds);
    reply.status(503);

    return {
      error: {
        code: "CONTENT_NOT_READY",
        details: {},
        message: "今日内容正在校验中，请稍后重试。",
        requestId,
        retryable: true,
      },
    };
  }

  @Get("today")
  async getToday(
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: TodayHttpReply,
  ): Promise<ErrorEnvelope | TodayResponse | undefined> {
    const requestId = resolveRequestId(incomingRequestId);
    reply.header("X-Request-Id", requestId);
    let result: TodayContentResult;

    try {
      result = await this.todayContentReader.read();
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: "Today content read failed",
        requestId,
      });
      return this.contentNotReady(reply, requestId, 30);
    }

    if (result.kind === "not_ready") {
      return this.contentNotReady(reply, requestId, result.retryAfterSeconds);
    }

    reply.header("Cache-Control", result.cacheControl);
    reply.header("Date", result.representationDate);
    reply.header("ETag", result.etag);

    if (etagMatches(ifNoneMatch, result.etag)) {
      reply.status(304);
      return undefined;
    }

    reply.header("X-Content-Version", result.contentVersion);
    reply.status(200);
    return result.body;
  }
}
