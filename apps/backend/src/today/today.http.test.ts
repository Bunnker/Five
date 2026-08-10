import "reflect-metadata";

import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATABASE_POOL } from "../database/postgres-pool";
import type { TodayContentResult } from "./today-content.service";
import { TODAY_CONTENT_READER, TodayController, type TodayContentReader } from "./today.controller";
import { TodayModule } from "./today.module";

@Module({
  imports: [TodayModule],
})
class TodayHttpTestModule {}

@Global()
@Module({
  exports: [DATABASE_POOL],
  providers: [
    {
      provide: DATABASE_POOL,
      useValue: {
        connect: () => Promise.reject(new Error("production database unavailable")),
      },
    },
  ],
})
class UnavailableDatabaseTestModule {}

@Module({
  imports: [UnavailableDatabaseTestModule, TodayModule],
})
class DatabaseBackedTodayHttpTestModule {}

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
  let demoApp: NestFastifyApplication;
  let missingRuntimeModeApp: NestFastifyApplication;
  let productionApp: NestFastifyApplication;
  let readyApp: NestFastifyApplication;

  beforeAll(async () => {
    const originalDemoContent = process.env.FIVE_DEMO_CONTENT;
    const originalNodeEnvironment = process.env.NODE_ENV;
    delete process.env.FIVE_DEMO_CONTENT;
    app = await NestFactory.create<NestFastifyApplication>(
      TodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
    process.env.NODE_ENV = "development";
    process.env.FIVE_DEMO_CONTENT = "1";
    demoApp = await NestFactory.create<NestFastifyApplication>(
      TodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await demoApp.init();
    process.env.NODE_ENV = "production";
    productionApp = await NestFactory.create<NestFastifyApplication>(
      TodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await productionApp.init();
    delete process.env.NODE_ENV;
    missingRuntimeModeApp = await NestFactory.create<NestFastifyApplication>(
      DatabaseBackedTodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await missingRuntimeModeApp.init();
    if (originalDemoContent === undefined) {
      delete process.env.FIVE_DEMO_CONTENT;
    } else {
      process.env.FIVE_DEMO_CONTENT = originalDemoContent;
    }
    if (originalNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnvironment;
    }
    readyApp = await NestFactory.create<NestFastifyApplication>(
      ReadyTodayHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await readyApp.init();
  });

  afterAll(async () => {
    await Promise.all([
      app.close(),
      demoApp.close(),
      missingRuntimeModeApp.close(),
      productionApp.close(),
      readyApp.close(),
    ]);
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

  it("registers the look route and fails closed without a published-content adapter", async () => {
    const response = await app.inject({
      headers: {
        "x-request-id": "edge-request-look-default",
      },
      method: "GET",
      url: "/api/v1/daily/2026-07-15/looks/look-main-01?expectedContentVersion=fd-20260715-r3",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("edge-request-look-default");
    expect(response.json()).toMatchObject({
      error: {
        code: "LOOK_NOT_FOUND",
        requestId: "edge-request-look-default",
        retryable: false,
      },
    });
  });

  it("serves one complete local demo through the public today and look routes", async () => {
    const todayResponse = await demoApp.inject({
      headers: {
        "x-request-id": "local-demo-today",
      },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(todayResponse.statusCode).toBe(200);
    const today = todayResponse.json();
    expect(today.content.fortuneDate).toBe(today.publicContentContext.servedFortuneDate);
    expect(today.content.tiers).toHaveLength(5);
    expect(today.content.outfitFormulas).toHaveLength(3);
    expect(today.content.looks.length).toBeGreaterThanOrEqual(2);
    const coverImageUrls = today.content.looks.map(
      (candidate: { coverImage: { url: string } }) => candidate.coverImage.url,
    );
    expect(new Set(coverImageUrls).size).toBe(coverImageUrls.length);

    const look = today.content.looks[0];
    const contentVersion = today.content.versions.contentVersion;
    const lookResponse = await demoApp.inject({
      headers: {
        "x-request-id": "local-demo-look",
      },
      method: "GET",
      url: `/api/v1/daily/${today.content.fortuneDate}/looks/${look.lookId}?expectedContentVersion=${contentVersion}`,
    });

    expect(lookResponse.statusCode).toBe(200);
    expect(lookResponse.json()).toMatchObject({
      contentVersion,
      fortuneDate: today.content.fortuneDate,
      look: {
        lookId: look.lookId,
      },
    });
  });

  it("keeps the demo adapter disabled in production even when the flag is present", async () => {
    const response = await productionApp.inject({
      headers: {
        "x-request-id": "production-demo-disabled",
      },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: "CONTENT_NOT_READY",
        requestId: "production-demo-disabled",
      },
    });
  });

  it("does not let a missing runtime mode turn a production database failure into demo content", async () => {
    const response = await missingRuntimeModeApp.inject({
      headers: {
        "x-request-id": "missing-runtime-mode-demo-disabled",
      },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      error: {
        code: "CONTENT_NOT_READY",
        requestId: "missing-runtime-mode-demo-disabled",
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
