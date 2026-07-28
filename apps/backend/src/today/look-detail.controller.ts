import type { components } from "@five/api-contract";
import { Controller, Get, Headers, Inject, Param, Query, Res } from "@nestjs/common";

import { resolveHttpRequestId } from "../http/request-id";
import type { LookDetailResult, ReadLookDetailInput } from "./look-detail.service";

type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
type LookDetailResponse = components["schemas"]["LookDetailResponse"];

export const LOOK_DETAIL_READER = Symbol("LOOK_DETAIL_READER");

export interface LookDetailReader {
  read(input: ReadLookDetailInput): Promise<LookDetailResult>;
}

export interface LookDetailHttpReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

function isFortuneDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isOpaqueValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  );
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
export class LookDetailController {
  constructor(
    @Inject(LOOK_DETAIL_READER)
    private readonly lookDetailReader: LookDetailReader,
  ) {}

  @Get("daily/:fortuneDate/looks/:lookId")
  async getLookDetail(
    @Param("fortuneDate") fortuneDate: string,
    @Param("lookId") lookId: string,
    @Query("expectedContentVersion") expectedContentVersion: unknown,
    @Headers("x-request-id") incomingRequestId: string | undefined,
    @Res({ passthrough: true }) reply: LookDetailHttpReply,
  ): Promise<ErrorEnvelope | LookDetailResponse> {
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

    if (!isOpaqueValue(lookId) || !isOpaqueValue(expectedContentVersion)) {
      reply.status(400);
      return errorEnvelope("INVALID_ARGUMENT", "搭配标识或预期内容版本无效。", requestId, false, {
        field: !isOpaqueValue(lookId) ? "lookId" : "expectedContentVersion",
      });
    }

    const result = await this.lookDetailReader.read({
      expectedContentVersion,
      fortuneDate,
      lookId,
    });

    if (result.kind === "version_changed") {
      reply.header("X-Content-Version", result.currentContentVersion);
      reply.status(409);
      return errorEnvelope(
        "CONTENT_VERSION_CHANGED",
        "页面内容版本已经变化，请刷新后重试。",
        requestId,
        true,
        {
          currentContentVersion: result.currentContentVersion,
          expectedContentVersion: result.expectedContentVersion,
        },
      );
    }

    if (result.kind === "missing") {
      reply.status(404);
      return errorEnvelope("LOOK_NOT_FOUND", "当前内容版本中没有这套搭配。", requestId, false, {
        fortuneDate,
        lookId,
      });
    }

    reply.header("X-Content-Version", result.contentVersion);
    reply.status(200);
    return result.body;
  }
}
