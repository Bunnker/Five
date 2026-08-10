import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsEventController } from "./analytics-event.controller";
import { AnalyticsEventService } from "./analytics-event.service";

const service = { record: vi.fn() } as unknown as AnalyticsEventService;

@Module({
  controllers: [AnalyticsEventController],
  providers: [{ provide: AnalyticsEventService, useValue: service }],
})
class AnalyticsEventHttpTestModule {}

const request = {
  anonymousId: "browser-018f3a7d6c214ed4",
  channelId: "organic",
  contentVersion: "fd-20260810-r2",
  eventId: "event-018f3a7d6c214ed4",
  eventName: "view_today_summary",
  fortuneDate: "2026-08-10",
  posterInstanceId: null,
  referralId: null,
  sourceContentVersion: null,
};

describe("POST /api/v1/analytics-events", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AnalyticsEventHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  beforeEach(() => vi.resetAllMocks());
  afterAll(async () => app.close());

  it.each(["accepted", "duplicate"] as const)(
    "returns the %s idempotency outcome",
    async (kind) => {
      vi.mocked(service.record).mockResolvedValue({ kind });
      const response = await app.inject({
        method: "POST",
        payload: request,
        url: "/api/v1/analytics-events",
      });
      expect(response.statusCode).toBe(202);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ eventId: request.eventId, status: kind });
    },
  );

  it("returns 409 when one event id is reused for different content", async () => {
    vi.mocked(service.record).mockResolvedValue({ kind: "idempotency_conflict" });
    const response = await app.inject({
      method: "POST",
      payload: request,
      url: "/api/v1/analytics-events",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  it.each([
    ["a page view with a referral", { ...request, referralId: "referral:aaaaaaaaaaaaaaaa" }],
    [
      "a share initiation without a referral",
      { ...request, eventName: "share_summary_initiated", referralId: null },
    ],
    [
      "a link landing without its source version",
      {
        ...request,
        eventName: "share_link_landing_view",
        referralId: "referral:aaaaaaaaaaaaaaaa",
        sourceContentVersion: null,
      },
    ],
    [
      "a poster share without its poster instance",
      {
        ...request,
        eventName: "share_poster_initiated",
        referralId: "poster-job-00000001",
      },
    ],
    [
      "a declared save success without a poster instance",
      { ...request, eventName: "poster_save_succeeded" },
    ],
  ])("rejects %s", async (_case, payload) => {
    const response = await app.inject({
      method: "POST",
      payload,
      url: "/api/v1/analytics-events",
    });

    expect(response.statusCode).toBe(400);
    expect(service.record).not.toHaveBeenCalled();
  });

  it("returns the documented 429 response when the anonymous event budget is exhausted", async () => {
    vi.mocked(service.record).mockResolvedValue({ kind: "rate_limited" });
    const response = await app.inject({
      method: "POST",
      payload: request,
      url: "/api/v1/analytics-events",
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.json()).toMatchObject({ error: { code: "RATE_LIMITED", retryable: true } });
  });

  it("fails locally without exposing persistence details", async () => {
    vi.mocked(service.record).mockRejectedValue(new Error("secret database endpoint"));
    const response = await app.inject({
      method: "POST",
      payload: request,
      url: "/api/v1/analytics-events",
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.json()).toMatchObject({
      error: { code: "ANALYTICS_UNAVAILABLE", retryable: true },
    });
    expect(response.body).not.toContain("secret database endpoint");
  });
});
