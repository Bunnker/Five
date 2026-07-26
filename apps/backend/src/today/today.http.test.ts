import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TodayContentResult } from "./today-content.service";
import { TODAY_CONTENT_READER, TodayController, type TodayContentReader } from "./today.controller";
import { TodayModule } from "./today.module";

@Module({
  imports: [TodayModule],
})
class TodayHttpTestModule {}

const readyResult = {
  body: {
    content: {
      versions: {
        contentVersion: "fd-20260724-r1",
      },
    },
    requestContext: {
      responseGeneratedAt: "2026-07-24T10:00:00+08:00",
    },
  },
  cacheControl: "public, max-age=0, s-maxage=60, must-revalidate",
  contentVersion: "fd-20260724-r1",
  etag: '"sha256-representation"',
  kind: "ready",
  representationDate: "Fri, 24 Jul 2026 02:00:00 GMT",
  sharedMaxAgeSeconds: 60,
} as unknown as Extract<TodayContentResult, { kind: "ready" }>;

@Module({
  controllers: [TodayController],
  providers: [
    {
      provide: TODAY_CONTENT_READER,
      useValue: {
        read: () => Promise.resolve(readyResult),
      } satisfies TodayContentReader,
    },
  ],
})
class ReadyTodayHttpTestModule {}

describe("GET /api/v1/today", () => {
  let app: NestFastifyApplication;
  let readyApp: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      TodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
    readyApp = await NestFactory.create<NestFastifyApplication>(
      ReadyTodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await readyApp.init();
  });

  afterAll(async () => {
    await Promise.all([app.close(), readyApp.close()]);
  });

  it("fails closed through the real HTTP route until a published-content adapter exists", async () => {
    const response = await app.inject({
      headers: {
        "x-request-id": "edge-request-123",
      },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["x-request-id"]).toBe("edge-request-123");
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: {
        code: "CONTENT_NOT_READY",
        details: {},
        message: "今日内容正在校验中，请稍后重试。",
        requestId: "edge-request-123",
        retryable: true,
      },
    });
  });

  it("preserves the representation time and success headers through Fastify", async () => {
    const response = await readyApp.inject({
      headers: {
        "x-request-id": "edge-request-200",
      },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.date).toBe("Fri, 24 Jul 2026 02:00:00 GMT");
    expect(response.headers.etag).toBe(readyResult.etag);
    expect(response.headers["x-content-version"]).toBe(readyResult.contentVersion);
    expect(response.headers["x-request-id"]).toBe("edge-request-200");
    expect(response.json()).toEqual(readyResult.body);
  });

  it("supports weak If-None-Match comparison and returns no 304 body", async () => {
    const response = await readyApp.inject({
      headers: {
        "if-none-match": `W/${readyResult.etag}`,
        "x-request-id": "edge-request-304",
      },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(response.statusCode).toBe(304);
    expect(response.body).toBe("");
    expect(response.headers.date).toBe("Fri, 24 Jul 2026 02:00:00 GMT");
    expect(response.headers.etag).toBe(readyResult.etag);
    expect(response.headers["x-request-id"]).toBe("edge-request-304");
  });
});
