import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService, SessionPrincipal } from "../admin-auth/admin-auth.service";
import type { AdminOperationsService } from "../admin-operations/admin-operations.service";
import { AdminOperationsController } from "./admin-operations.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { ADMIN_AUTH_SERVICE, ADMIN_OPERATIONS_SERVICE } from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";

const principal: SessionPrincipal = {
  absoluteExpiresAt: new Date("2026-08-06T20:00:00.000Z"),
  accountId: "admin-1",
  credentialRevision: 4,
  csrfToken: "c".repeat(43),
  idleExpiresAt: new Date("2026-08-06T08:30:00.000Z"),
  issuedAt: new Date("2026-08-06T08:00:00.000Z"),
  sessionTokenDigest: Buffer.alloc(32, 2),
  username: "operator",
};

const authService = {
  authenticateSession: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;

const operationsService = {
  calendar: vi.fn(),
  dayDetail: vi.fn(),
  issues: vi.fn(),
  overview: vi.fn(),
} as unknown as AdminOperationsService;

const requestContext = {
  civilDate: "2026-08-06",
  crossedDayBoundary: false,
  dayBoundary: "23:00" as const,
  fortuneDate: "2026-08-06",
  responseGeneratedAt: "2026-08-06T10:00:00+08:00",
  shichen: "巳" as const,
  timezone: "Asia/Shanghai" as const,
};
const publicContentContext = {
  advancedFromCivilDate: false,
  servedFortuneDate: "2026-08-06",
  switchBoundary: "18:00" as const,
};
const nextPreviewRequestContext = {
  ...requestContext,
  civilDate: "2026-08-07",
  fortuneDate: "2026-08-07",
  responseGeneratedAt: "2026-08-07T12:00:00+08:00",
  shichen: "午" as const,
};
const nextPreviewPublicContentContext = {
  advancedFromCivilDate: false,
  servedFortuneDate: "2026-08-07",
  switchBoundary: "18:00" as const,
};

const requiredImages = { deliverySafeCount: 2, modelReadyCount: 2, requiredCount: 2 as const };
const currentSummary = {
  dayElement: "metal" as const,
  dayElementLabel: "金" as const,
  effectiveFrom: "2026-08-05T18:00:00+08:00",
  effectiveTo: "2026-08-06T18:00:00+08:00",
  fortuneDate: "2026-08-06",
  issueCodes: [],
  lifecycleRevision: 4,
  operationalStatus: "published_healthy" as const,
  optionalImageStatus: "not_requested" as const,
  prepareBy: "2026-08-05T13:00:00+08:00",
  previewAvailable: true,
  primaryColors: [{ colorCode: "ivory", name: "乳白" }],
  relation: "current" as const,
  requiredImages,
  scheduleSlotRevision: 0,
  updatedAt: "2026-08-06T09:50:00+08:00",
};
const nextSummary = {
  ...currentSummary,
  effectiveFrom: "2026-08-06T18:00:00+08:00",
  effectiveTo: "2026-08-07T18:00:00+08:00",
  fortuneDate: "2026-08-07",
  operationalStatus: "scheduled_ready" as const,
  prepareBy: "2026-08-06T13:00:00+08:00",
  relation: "next" as const,
  scheduleSlotRevision: 2,
};

@Module({
  controllers: [AdminOperationsController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: ADMIN_OPERATIONS_SERVICE, useValue: operationsService },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminOperationsHttpTestModule {}

describe("admin operations HTTP", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminOperationsHttpTestModule,
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
    vi.mocked(authService.authenticateSession).mockResolvedValue(principal);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the single server-derived today and tomorrow overview", async () => {
    vi.mocked(operationsService.overview).mockResolvedValue({
      current: currentSummary,
      currentPreview: null,
      currentPreviewPublicContentContext: publicContentContext,
      currentPreviewRequestContext: requestContext,
      health: "healthy",
      issueCount: 0,
      next: nextSummary,
      nextPreview: null,
      nextPreviewPublicContentContext,
      nextPreviewRequestContext,
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      publicContentContext,
      requestContext,
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/operations/overview",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      current: { fortuneDate: "2026-08-06", requiredImages: { modelReadyCount: 2 } },
      next: { fortuneDate: "2026-08-07", operationalStatus: "scheduled_ready" },
      nextPreviewPublicContentContext: { servedFortuneDate: "2026-08-07" },
      requestContext: { fortuneDate: "2026-08-06" },
    });
  });

  it("returns the server-built calendar window and rejects malformed months", async () => {
    vi.mocked(operationsService.calendar).mockResolvedValue({
      items: Array.from({ length: 42 }, (_, index) => ({
        ...currentSummary,
        fortuneDate: `2026-08-${String(Math.min(index + 1, 31)).padStart(2, "0")}`,
      })),
      month: "2026-08",
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      publicContentContext,
      requestContext,
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/operations/calendar?month=2026-08",
    });
    const invalid = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/operations/calendar?month=2026-13",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(42);
    expect(operationsService.calendar).toHaveBeenCalledWith("2026-08");
    expect(invalid.statusCode).toBe(400);
  });

  it("returns actionable issues without engineering payloads", async () => {
    vi.mocked(operationsService.issues).mockResolvedValue({
      items: [
        {
          actionHref: "/admin/calendar/2026-08-07",
          actionLabel: "立即处理下一期",
          code: "NEXT_DAY_OVERDUE",
          firstDetectedAt: "2026-08-06T18:00:00+08:00",
          fortuneDate: "2026-08-07",
          impact: "明天切换存在风险。",
          mitigation: "今天内容不受影响。",
          severity: "warning",
          title: "下一期内容尚未准备好",
          updatedAt: "2026-08-06T18:00:00+08:00",
        },
      ],
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      publicContentContext,
      requestContext,
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/operations/issues",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().nextOperationalBoundaryAt).toBe("2026-08-06T18:00:00+08:00");
    expect(response.json().items[0]).not.toHaveProperty("stack");
    expect(JSON.stringify(response.json())).not.toContain("workerLog");
  });

  it("returns a day detail without exposing an internal id as visible copy", async () => {
    vi.mocked(operationsService.dayDetail).mockResolvedValue({
      concurrency: {
        activeContentVersion: null,
        lifecycleRevision: 0,
        scheduleSlotRevision: 0,
      },
      editableSelectionKeys: ["share.copy"],
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      preview: null,
      previewPublicContentContext: nextPreviewPublicContentContext,
      previewRequestContext: nextPreviewRequestContext,
      previewSource: "none",
      publicContentContext,
      readonlySelectionKeys: ["calendar.summary"],
      requestContext,
      summary: { ...nextSummary, previewAvailable: false },
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/operations/days/2026-08-07",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      preview: null,
      previewPublicContentContext: { servedFortuneDate: "2026-08-07" },
      previewSource: "none",
      summary: { fortuneDate: "2026-08-07" },
    });
  });
});
