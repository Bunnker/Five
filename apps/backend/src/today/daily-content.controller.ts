import type { components } from "@five/api-contract";
import { Controller, Get, Headers, Inject, Logger, Param, Query, Res } from "@nestjs/common";

import { resolveHttpRequestId } from "../http/request-id";
import type { DailyContentResult, ReadDailyContentInput } from "./daily-content.service";
import { isFortuneDate, isOpaquePublicValue } from "./public-route-params";

type DailyContentResponse = components["schemas"]["DailyContentResponse"];
type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export const DAILY_CONTENT_READER = Symbol("DAILY_CONTENT_READER");

export interface DailyContentReader {
  read(input: ReadDailyContentInput): Promise<DailyContentResult>;
}

export interface DailyContentHttpReply {
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
  return {
    error: {
      code,
      details,
      message,
      requestId,
      retryable,
    },
  };
}

@Controller("api/v1")
export class DailyContentController {
  private readonly logger = new Logger(DailyContentController.name);

  constructor(
    @Inject(DAILY_CONTENT_READER)
    private readonly dailyContentReader: DailyContentReader,
  ) {}

  @Get("daily/:fortuneDate")
  async getDailyContent(
    @Param("fortuneDate") fortuneDate: string,
    @Query("expectedContentVersion") expectedContentVersion: unknown,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: DailyContentHttpReply,
  ): Promise<DailyContentResponse | ErrorEnvelope> {
    const requestId = resolveHttpRequestId(incomingRequestId);
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", requestId);

    if (!isFortuneDate(fortuneDate)) {
      reply.status(400);
      return errorEnvelope(
        "INVALID_FORTUNE_DATE",
        "命理日格式无效，请检查后重试。",
        requestId,
        false,
        { fortuneDate },
      );
    }

    if (expectedContentVersion !== undefined && !isOpaquePublicValue(expectedContentVersion)) {
      reply.status(400);
      return errorEnvelope("INVALID_ARGUMENT", "预期内容版本无效。", requestId, false, {
        field: "expectedContentVersion",
      });
    }

    let result: DailyContentResult;
    try {
      result = await this.dailyContentReader.read({
        expectedContentVersion: expectedContentVersion ?? null,
        fortuneDate,
      });
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: "Daily content read failed",
        requestId,
      });
      result = { kind: "missing" };
    }

    if (result.kind === "expired") {
      reply.status(410);
      return errorEnvelope(
        "HISTORICAL_CONTENT_EXPIRED",
        "该日期内容已不在公开保留期内。",
        requestId,
        false,
        { fortuneDate },
      );
    }

    if (result.kind === "missing") {
      reply.status(404);
      return errorEnvelope(
        "CONTENT_NOT_FOUND",
        "该日期暂时没有可公开查看的内容。",
        requestId,
        false,
        { fortuneDate },
      );
    }

    reply.header("Cache-Control", result.cacheControl);
    reply.header("ETag", result.etag);
    reply.header("X-Content-Version", result.contentVersion);
    reply.status(200);
    return result.body;
  }
}
