import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";

describe("POST /api/v1/analytics-events registration", () => {
  let app: NestFastifyApplication;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL ??= "postgresql://five:five@127.0.0.1:1/five";
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("registers a strict public event route through the real application module", async () => {
    const response = await app.inject({
      headers: { "x-request-id": "analytics-route-registration" },
      method: "POST",
      payload: {
        anonymousId: "browser-018f3a7d6c214ed4",
        channelId: "organic",
        contentVersion: "fd-20260810-r2",
        eventId: "event-018f3a7d6c214ed4",
        eventName: "view_today_summary",
        fortuneDate: "2026-08-10",
        posterInstanceId: null,
        referralId: null,
        sourceContentVersion: null,
        unexpectedPrivateField: "must-not-be-accepted",
      },
      url: "/api/v1/analytics-events",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("analytics-route-registration");
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "analytics-route-registration" },
    });
  });
});
