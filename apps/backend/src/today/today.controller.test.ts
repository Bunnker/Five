import type { components } from "@five/api-contract";
import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { TodayContentResult } from "./today-content.service";
import { TodayController, type TodayContentReader, type TodayHttpReply } from "./today.controller";

type TodayResponse = components["schemas"]["TodayResponse"];

class RecordingReply implements TodayHttpReply {
  readonly headers = new Map<string, string>();
  statusCode = 200;

  header(name: string, value: string | number): this {
    this.headers.set(name, String(value));
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
}

function readyResult(): Extract<TodayContentResult, { kind: "ready" }> {
  const body = {
    content: {
      versions: {
        contentVersion: "fd-20260724-r1",
      },
    },
    requestContext: {
      responseGeneratedAt: "2026-07-24T10:00:00+08:00",
    },
  } as unknown as TodayResponse;

  return {
    body,
    cacheControl: "public, max-age=0, s-maxage=60, must-revalidate",
    contentVersion: "fd-20260724-r1",
    etag: '"sha256-representation"',
    kind: "ready",
    representationDate: "Fri, 24 Jul 2026 02:00:00 GMT",
    sharedMaxAgeSeconds: 60,
  };
}

function controllerWith(result: TodayContentResult): TodayController {
  const reader: TodayContentReader = {
    read: () => Promise.resolve(result),
  };
  return new TodayController(reader);
}

describe("TodayController", () => {
  it("returns the frozen response body and all 200 response headers", async () => {
    const result = readyResult();
    const reply = new RecordingReply();

    await expect(controllerWith(result).getToday(undefined, undefined, reply)).resolves.toBe(
      result.body,
    );
    expect(reply.statusCode).toBe(200);
    expect(Object.fromEntries(reply.headers)).toMatchObject({
      "Cache-Control": "public, max-age=0, s-maxage=60, must-revalidate",
      Date: "Fri, 24 Jul 2026 02:00:00 GMT",
      ETag: '"sha256-representation"',
      "X-Content-Version": "fd-20260724-r1",
    });
    expect(reply.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 304 only when the complete representation ETag still matches", async () => {
    const result = readyResult();
    const reply = new RecordingReply();

    await expect(
      controllerWith(result).getToday(
        `"another-representation", W/${result.etag}`,
        undefined,
        reply,
      ),
    ).resolves.toBeUndefined();
    expect(reply.statusCode).toBe(304);
    expect(reply.headers.get("ETag")).toBe(result.etag);
    expect(reply.headers.has("X-Content-Version")).toBe(false);
  });

  it("returns an uncached CONTENT_NOT_READY error when there is no safe content", async () => {
    const reply = new RecordingReply();
    const controller = controllerWith({
      kind: "not_ready",
      requestContext: {
        civilDate: "2026-07-24",
        crossedDayBoundary: false,
        dayBoundary: "23:00",
        fortuneDate: "2026-07-24",
        responseGeneratedAt: "2026-07-24T10:00:00+08:00",
        shichen: "巳",
        timezone: "Asia/Shanghai",
      },
      retryAfterSeconds: 30,
    });

    const body = await controller.getToday(undefined, "edge request 123", reply);

    expect(reply.statusCode).toBe(503);
    expect(reply.headers.get("Cache-Control")).toBe("no-store");
    expect(reply.headers.get("Retry-After")).toBe("30");
    expect(body).toMatchObject({
      error: {
        code: "CONTENT_NOT_READY",
        details: {},
        message: "今日内容正在校验中，请稍后重试。",
        retryable: true,
      },
    });
    expect(
      typeof body === "object" && body !== null && "error" in body ? body.error.requestId : null,
    ).toBe(reply.headers.get("X-Request-Id"));
  });

  it("maps a reader failure to the same uncached product error", async () => {
    const logger = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const reply = new RecordingReply();
    const controller = new TodayController({
      read: () => Promise.reject(new Error("database unavailable")),
    });

    try {
      const body = await controller.getToday(undefined, "edge request 456", reply);

      expect(reply.statusCode).toBe(503);
      expect(reply.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toMatchObject({
        error: {
          code: "CONTENT_NOT_READY",
          requestId: "edge request 456",
        },
      });
      expect(logger).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Today content read failed",
          requestId: "edge request 456",
        }),
      );
    } finally {
      logger.mockRestore();
    }
  });
});
