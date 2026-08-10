import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService, SessionPrincipal } from "../admin-auth/admin-auth.service";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { AnalyticsEventService } from "../product-analytics/analytics-event.service";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { AdminAnalyticsController } from "./admin-analytics.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { ADMIN_AUTH_SERVICE } from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";

const principal: SessionPrincipal = {
  absoluteExpiresAt: new Date("2026-08-09T20:00:00.000Z"),
  accountId: "admin-1",
  credentialRevision: 4,
  csrfToken: "c".repeat(43),
  idleExpiresAt: new Date("2026-08-09T08:30:00.000Z"),
  issuedAt: new Date("2026-08-09T08:00:00.000Z"),
  sessionTokenDigest: Buffer.alloc(32, 2),
  username: "operator",
};
const authService = {
  authenticateSession: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;
let currentInstant = new Date("2026-08-09T09:59:59.000Z");
const requestContextResolver = new RequestContextResolver({ now: () => new Date(currentInstant) });
const analytics = { overview: vi.fn(), report: vi.fn() } as unknown as AnalyticsEventService;

@Module({
  controllers: [AdminAnalyticsController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: AnalyticsEventService, useValue: analytics },
    PublicContentContextResolver,
    { provide: RequestContextResolver, useValue: requestContextResolver },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminAnalyticsHttpTestModule {}

const overview = {
  anonymousBrowsers: 4,
  channelId: null,
  collectionStatus: "active" as const,
  contentVersion: null,
  fromFortuneDate: "2026-08-01",
  generatedAt: "2026-08-09T12:00:00.000Z",
  outfitDetailRate: { denominator: 4, numerator: 2, ratio: 0.5 },
  outfitDetailVisitors: 2,
  outfitHubVisitors: 3,
  pageViews: 7,
  posterSaveFailed: 1,
  posterSaveRequests: 3,
  posterSaveSucceeded: 2,
  referredBrowsers: 1,
  shareInitiationRate: { denominator: 4, numerator: 2, ratio: 0.5 },
  shareInitiations: 3,
  sharingBrowsers: 2,
  toFortuneDate: "2026-08-09",
};

const report = {
  channelBreakdown: [
    { anonymousBrowsers: 4, channelId: "organic" as const, pageViews: 7, ratio: 1 },
  ],
  collectionStatus: "active" as const,
  daily: Array.from({ length: 7 }, (_, index) => ({
    anonymousBrowsers: index === 6 ? 4 : 0,
    fortuneDate: `2026-08-0${index + 3}`,
    outfitDetailVisitors: 0,
    outfitHubVisitors: 0,
    pageViews: index === 6 ? 7 : 0,
    posterSaveSucceeded: 0,
    referredBrowsers: 0,
    shareInitiations: 0,
    sharingBrowsers: 0,
  })),
  days: 7 as const,
  fromFortuneDate: "2026-08-03",
  generatedAt: "2026-08-09T09:59:59.000Z",
  summary: { ...overview, fromFortuneDate: "2026-08-03" },
  toFortuneDate: "2026-08-09",
};

describe("GET /admin/api/v1/analytics/overview", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminAnalyticsHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    installAdminRequestProtection(
      app.getHttpAdapter().getInstance(),
      authService,
      new Set(["http://127.0.0.1:3000"]),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    currentInstant = new Date("2026-08-09T09:59:59.000Z");
    vi.mocked(authService.authenticateSession).mockResolvedValue(principal);
    vi.mocked(analytics.overview).mockResolvedValue(overview);
    vi.mocked(analytics.report).mockResolvedValue(report);
  });
  afterAll(async () => app.close());

  it("returns a protected no-store overview with optional filters", async () => {
    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/overview?from=2026-08-01&to=2026-08-09&channelId=organic&contentVersion=fd-20260809-r1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(analytics.overview).toHaveBeenCalledWith({
      channelId: "organic",
      contentVersion: "fd-20260809-r1",
      fromFortuneDate: "2026-08-01",
      toFortuneDate: "2026-08-09",
    });
  });

  it.each([
    "/admin/api/v1/analytics/overview?from=2026-02-30&to=2026-03-01",
    "/admin/api/v1/analytics/overview?from=2026-08-10&to=2026-08-09",
    "/admin/api/v1/analytics/overview?from=2026-08-01&to=2026-09-01",
  ])("rejects an invalid or greater-than-31-day range: %s", async (url) => {
    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url,
    });
    expect(response.statusCode).toBe(400);
    expect(analytics.overview).not.toHaveBeenCalled();
  });

  it("is covered by the existing admin session boundary", async () => {
    vi.mocked(authService.authenticateSession).mockResolvedValue(null);
    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"x".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/overview?from=2026-08-01&to=2026-08-09",
    });
    expect(response.statusCode).toBe(401);
    expect(analytics.overview).not.toHaveBeenCalled();
  });

  it("fails closed without exposing database details", async () => {
    vi.mocked(analytics.overview).mockRejectedValue(new Error("private database address"));
    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/overview?from=2026-08-01&to=2026-08-09",
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.body).not.toContain("private database address");
  });
});

describe("GET /admin/api/v1/analytics/report", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminAnalyticsHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    installAdminRequestProtection(
      app.getHttpAdapter().getInstance(),
      authService,
      new Set(["http://127.0.0.1:3000"]),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    currentInstant = new Date("2026-08-09T09:59:59.000Z");
    vi.mocked(authService.authenticateSession).mockResolvedValue(principal);
    vi.mocked(analytics.report).mockResolvedValue(report);
  });
  afterAll(async () => app.close());

  it("uses the server served fortune date and switches the report window at 18:00", async () => {
    const before = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/report?days=7",
    });
    expect(before.statusCode).toBe(200);
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(analytics.report).toHaveBeenLastCalledWith({
      days: 7,
      fromFortuneDate: "2026-08-03",
      toFortuneDate: "2026-08-09",
    });

    currentInstant = new Date("2026-08-09T10:00:00.000Z");
    await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/report?days=7",
    });
    expect(analytics.report).toHaveBeenLastCalledWith({
      days: 7,
      fromFortuneDate: "2026-08-04",
      toFortuneDate: "2026-08-10",
    });

    currentInstant = new Date("2026-08-09T15:00:00.000Z");
    await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/report?days=30",
    });
    expect(analytics.report).toHaveBeenLastCalledWith({
      days: 30,
      fromFortuneDate: "2026-07-12",
      toFortuneDate: "2026-08-10",
    });

    currentInstant = new Date("2026-08-09T16:00:00.000Z");
    await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/report?days=7",
    });
    expect(analytics.report).toHaveBeenLastCalledWith({
      days: 7,
      fromFortuneDate: "2026-08-04",
      toFortuneDate: "2026-08-10",
    });
  });

  it.each(["6", "8", "31", "seven", "7&days=30"])("rejects unsupported days=%s", async (days) => {
    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: `/admin/api/v1/analytics/report?days=${days}`,
    });
    expect(response.statusCode).toBe(400);
    expect(analytics.report).not.toHaveBeenCalled();
  });

  it("is protected by the existing admin session boundary", async () => {
    vi.mocked(authService.authenticateSession).mockResolvedValue(null);
    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"x".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/analytics/report?days=30",
    });
    expect(response.statusCode).toBe(401);
    expect(analytics.report).not.toHaveBeenCalled();
  });
});
