import "reflect-metadata";

import type { components } from "@five/api-contract";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import {
  DAILY_CONTENT_READER,
  DailyContentController,
  type DailyContentReader,
} from "./daily-content.controller";
import {
  DAILY_CONTENT_RESOLUTION_READER,
  type DailyContentResolutionReader,
} from "./daily-content-resolution.reader";
import { DailyContentService } from "./daily-content.service";
import { TodayCachePolicy } from "./today-cache-policy";
import { TodayModule } from "./today.module";

type DailyContent = components["schemas"]["DailyContent"];
type DailyContentResponse = components["schemas"]["DailyContentResponse"];

const readyContent = {
  effectiveTo: "2026-07-15T23:00:00+08:00",
  fortuneDate: "2026-07-15",
  versions: {
    contentVersion: "fd-20260715-r4",
  },
} as unknown as DailyContent;

const readyBody = {
  content: readyContent,
  requestedFortuneDate: "2026-07-15",
  resolution: {
    expectedContentVersion: "fd-20260715-r3",
    reason: "replaced",
    servedContentVersion: "fd-20260715-r4",
    versionChanged: true,
  },
} as unknown as DailyContentResponse;

const resolveDailyContent = vi.fn<DailyContentResolutionReader["resolve"]>();

@Module({
  controllers: [DailyContentController],
  providers: [
    PublicContentContextResolver,
    TodayCachePolicy,
    {
      provide: RequestContextResolver,
      useValue: {
        resolve: () => ({
          civilDate: "2026-07-28",
          crossedDayBoundary: false,
          dayBoundary: "23:00",
          fortuneDate: "2026-07-28",
          responseGeneratedAt: "2026-07-28T10:00:00+08:00",
          shichen: "巳",
          timezone: "Asia/Shanghai",
        }),
      },
    },
    {
      provide: DAILY_CONTENT_RESOLUTION_READER,
      useValue: { resolve: resolveDailyContent } satisfies DailyContentResolutionReader,
    },
    {
      inject: [
        RequestContextResolver,
        PublicContentContextResolver,
        DAILY_CONTENT_RESOLUTION_READER,
        TodayCachePolicy,
      ],
      provide: DailyContentService,
      useFactory: (
        requestContextResolver: RequestContextResolver,
        publicContentContextResolver: PublicContentContextResolver,
        dailyContentResolutionReader: DailyContentResolutionReader,
        cachePolicy: TodayCachePolicy,
      ) =>
        new DailyContentService(
          requestContextResolver,
          publicContentContextResolver,
          dailyContentResolutionReader,
          cachePolicy,
        ),
    },
    {
      inject: [DailyContentService],
      provide: DAILY_CONTENT_READER,
      useFactory: (service: DailyContentService): DailyContentReader => service,
    },
  ],
})
class DailyContentHttpTestModule {}

@Module({
  imports: [TodayModule],
})
class RegisteredDailyContentHttpTestModule {}

describe("GET /api/v1/daily/:fortuneDate", () => {
  let app: NestFastifyApplication;
  let registeredApp: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      DailyContentHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();

    registeredApp = await NestFactory.create<NestFastifyApplication>(
      RegisteredDailyContentHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await registeredApp.init();
  });

  afterAll(async () => {
    await Promise.all([app.close(), registeredApp.close()]);
  });

  it("registers the public route through the real application module and fails closed by default", async () => {
    const response = await registeredApp.inject({
      headers: {
        "x-request-id": "registered-daily-route",
      },
      method: "GET",
      url: "/api/v1/daily/2026-07-15",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      error: {
        code: "CONTENT_NOT_FOUND",
        requestId: "registered-daily-route",
        retryable: false,
      },
    });
  });

  it("serves the current safe version when an old shared version was replaced", async () => {
    resolveDailyContent.mockResolvedValueOnce({
      content: readyContent,
      kind: "ready",
      reason: "replaced",
    });

    const response = await app.inject({
      headers: {
        "x-request-id": "shared-link-request-123",
      },
      method: "GET",
      url: "/api/v1/daily/2026-07-15?expectedContentVersion=fd-20260715-r3",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate",
    );
    expect(response.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/u);
    expect(response.headers["x-content-version"]).toBe("fd-20260715-r4");
    expect(response.headers["x-request-id"]).toBe("shared-link-request-123");
    expect(response.json()).toEqual(readyBody);
    expect(resolveDailyContent).toHaveBeenLastCalledWith({
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
    });
  });

  it("accepts a valid date without an expected content version", async () => {
    resolveDailyContent.mockResolvedValueOnce({
      content: readyContent,
      kind: "ready",
      reason: "current",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/daily/2026-07-15",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resolution: {
        expectedContentVersion: null,
        reason: "current",
        servedContentVersion: "fd-20260715-r4",
        versionChanged: false,
      },
    });
  });

  it.each(["rolled_back", "withdrawn"] as const)(
    "preserves the public %s reason while serving only the current safe payload",
    async (reason) => {
      resolveDailyContent.mockResolvedValueOnce({
        content: readyContent,
        kind: "ready",
        reason,
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/daily/2026-07-15?expectedContentVersion=fd-20260715-r3",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        content: {
          versions: {
            contentVersion: "fd-20260715-r4",
          },
        },
        resolution: {
          expectedContentVersion: "fd-20260715-r3",
          reason,
          servedContentVersion: "fd-20260715-r4",
          versionChanged: true,
        },
      });
    },
  );

  it("fails closed when the resolution reason contradicts the served version", async () => {
    resolveDailyContent.mockResolvedValueOnce({
      content: readyContent,
      kind: "ready",
      reason: "current",
    });

    const response = await app.inject({
      headers: {
        "x-request-id": "contradictory-resolution",
      },
      method: "GET",
      url: "/api/v1/daily/2026-07-15?expectedContentVersion=fd-20260715-r3",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      error: {
        code: "CONTENT_NOT_FOUND",
        requestId: "contradictory-resolution",
      },
    });
  });

  it("keeps current content inside every dynamic cache boundary", async () => {
    const currentContent = {
      ...readyContent,
      effectiveTo: "2026-07-28T23:00:00+08:00",
      fortuneDate: "2026-07-28",
      versions: {
        contentVersion: "fd-20260728-r1",
      },
    } as DailyContent;
    resolveDailyContent.mockResolvedValueOnce({
      content: currentContent,
      kind: "ready",
      reason: "current",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/daily/2026-07-28",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=60, must-revalidate",
    );
  });

  it("rejects an invalid fortune date before reading public content", async () => {
    const callCount = resolveDailyContent.mock.calls.length;
    const response = await app.inject({
      headers: {
        "x-request-id": "invalid-date-request",
      },
      method: "GET",
      url: "/api/v1/daily/2026-02-30",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("invalid-date-request");
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_FORTUNE_DATE",
        requestId: "invalid-date-request",
        retryable: false,
      },
    });
    expect(resolveDailyContent).toHaveBeenCalledTimes(callCount);
  });

  it.each([
    {
      code: "CONTENT_NOT_FOUND",
      kind: "missing",
      fortuneDate: "2026-07-01",
      statusCode: 404,
    },
    {
      code: "HISTORICAL_CONTENT_EXPIRED",
      kind: "expired",
      fortuneDate: "2026-04-01",
      statusCode: 410,
    },
  ] as const)(
    "returns a safe $statusCode response when the target is $kind",
    async ({ code, fortuneDate, kind, statusCode }) => {
      if (kind === "missing") {
        resolveDailyContent.mockResolvedValueOnce({ kind: "missing" });
      }

      const response = await app.inject({
        headers: {
          "x-request-id": `daily-${kind}-request`,
        },
        method: "GET",
        url: `/api/v1/daily/${fortuneDate}?expectedContentVersion=old-private-version`,
      });

      expect(response.statusCode).toBe(statusCode);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({
        error: {
          code,
          details: {
            fortuneDate,
          },
          message: expect.any(String),
          requestId: `daily-${kind}-request`,
          retryable: false,
        },
      });
      expect(response.body).not.toContain("old-private-version");
      expect(response.body).not.toMatch(/draft|withdrawn|草稿|下线/iu);
    },
  );
});
