import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdminAuthService,
  EmergencyControlService,
  SessionPrincipal,
} from "../admin-auth/admin-auth.service";
import { AdminSecurityController } from "./admin-security.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { ADMIN_AUTH_SERVICE, EMERGENCY_CONTROL_SERVICE } from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";

const principal: SessionPrincipal = {
  absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
  accountId: "admin-1",
  credentialRevision: 4,
  csrfToken: "c".repeat(43),
  idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
  issuedAt: new Date("2026-07-31T20:00:00.000Z"),
  sessionTokenDigest: Buffer.alloc(32, 2),
  username: "operator",
};

const authService = {
  authenticateSession: vi.fn(),
  listSecurityEvents: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;
const emergencyService = {
  apply: vi.fn(),
  getState: vi.fn(),
} as unknown as EmergencyControlService;

@Module({
  controllers: [AdminSecurityController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: EMERGENCY_CONTROL_SERVICE, useValue: emergencyService },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminSecurityHttpTestModule {}

describe("admin security HTTP", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminSecurityHttpTestModule,
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
    vi.mocked(authService.recordCsrfRejected).mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns sanitized security events in reverse chronological order", async () => {
    vi.mocked(authService.listSecurityEvents).mockResolvedValue({
      items: [
        {
          accountId: "admin-1",
          eventId: "security-event-2",
          eventType: "login_password_succeeded",
          metadata: {},
          occurredAt: new Date("2026-07-31T20:00:00.000Z"),
          outcome: "success",
          reason: null,
          requestId: "security-request-2",
          sourceFingerprint: "a".repeat(64),
          userAgentSummary: "browser=chrome;platform=macos",
        },
        {
          accountId: "admin-1",
          eventId: "security-event-1",
          eventType: "csrf_rejected",
          metadata: { reasonCategory: "origin_untrusted" },
          occurredAt: new Date("2026-07-31T19:00:00.000Z"),
          outcome: "denied",
          reason: null,
          requestId: "security-request-1",
          sourceFingerprint: "b".repeat(64),
          userAgentSummary: "browser=other;platform=other",
        },
      ],
      kind: "page",
      nextCursor: null,
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/security-events?limit=2",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          action: "login_password",
          clientSummary: "browser=chrome;platform=macos",
          eventId: "security-event-2",
          occurredAt: "2026-07-31T20:00:00.000Z",
          outcome: "succeeded",
          reason: null,
          requestId: "security-request-2",
          sourceFingerprint: "a".repeat(64),
        },
        {
          action: "csrf_rejected",
          clientSummary: "browser=other;platform=other",
          eventId: "security-event-1",
          occurredAt: "2026-07-31T19:00:00.000Z",
          outcome: "rejected",
          reason: null,
          requestId: "security-request-1",
          sourceFingerprint: "b".repeat(64),
        },
      ],
      nextCursor: null,
    });
    expect(response.body).not.toMatch(/origin_untrusted|accountId|metadata/iu);
    expect(authService.listSecurityEvents).toHaveBeenCalledWith("admin-1", {
      cursor: null,
      limit: 2,
    });
  });

  it.each([
    ["public_access_stopped", "emergency_stop", "发现图片权利材料错误"],
    ["public_access_resumed", "emergency_resume", "已替换问题图片并完成复核"],
  ])("keeps the reason for %s visible as %s", async (eventType, action, reason) => {
    vi.mocked(authService.listSecurityEvents).mockResolvedValue({
      items: [
        {
          accountId: "admin-1",
          eventId: `security-event-${action}`,
          eventType,
          metadata: {},
          occurredAt: new Date("2026-07-31T20:00:00.000Z"),
          outcome: "success",
          reason,
          requestId: `security-request-${action}`,
          sourceFingerprint: "c".repeat(64),
          userAgentSummary: "browser=chrome;platform=macos",
        },
      ],
      kind: "page",
      nextCursor: null,
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/security-events?limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ action, reason });
  });

  it("rejects a forged security-event cursor with the stable 400 envelope", async () => {
    vi.mocked(authService.listSecurityEvents).mockResolvedValue({ kind: "invalid_cursor" });

    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        "x-request-id": "security-invalid-cursor",
      },
      method: "GET",
      url: "/admin/api/v1/security-events?cursor=forged&limit=20",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "security-invalid-cursor" },
    });
    expect(authService.listSecurityEvents).toHaveBeenCalledWith("admin-1", {
      cursor: "forged",
      limit: 20,
    });
  });

  it("rejects repeated security-event cursors before they reach the signed cursor parser", async () => {
    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        "x-request-id": "security-repeated-cursor",
      },
      method: "GET",
      url: "/admin/api/v1/security-events?cursor=first&cursor=second",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "security-repeated-cursor" },
    });
    expect(authService.listSecurityEvents).not.toHaveBeenCalled();
  });

  it("returns the emergency state with its strong revision ETag", async () => {
    vi.mocked(emergencyService.getState).mockResolvedValue({
      auditEventId: "security-event-stop-1",
      changedAt: new Date("2026-07-31T20:00:00.000Z"),
      publiclyEnabled: false,
      reason: "发现图片权利材料错误",
      requestId: "emergency-stop-request",
      revision: 7,
    });

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/emergency-control",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"emergency-control:7"');
    expect(response.json()).toEqual({
      auditEventId: "security-event-stop-1",
      changedAt: "2026-07-31T20:00:00.000Z",
      publicAccessEnabled: false,
      reason: "发现图片权利材料错误",
      revision: 7,
    });
  });

  it("stops public access with an authenticated session, exact confirmation, revision and idempotency", async () => {
    vi.mocked(emergencyService.apply).mockResolvedValue({
      kind: "applied",
      state: {
        auditEventId: "security-event-stop-2",
        changedAt: new Date("2026-07-31T20:01:00.000Z"),
        publiclyEnabled: false,
        reason: "发现图片权利材料错误",
        requestId: "emergency-stop-request-2",
        revision: 8,
      },
    });

    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        "idempotency-key": "emergency-stop-0001",
        "if-match": '"emergency-control:7"',
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "c".repeat(43),
        "x-request-id": "emergency-stop-request-2",
      },
      method: "POST",
      payload: {
        confirmationPhrase: "停止全部公开内容",
        reason: "发现图片权利材料错误",
      },
      url: "/admin/api/v1/emergency-control/stop",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"emergency-control:8"');
    expect(response.json()).toMatchObject({
      auditEventId: "security-event-stop-2",
      publicAccessEnabled: false,
      revision: 8,
    });
    expect(emergencyService.apply).toHaveBeenCalledWith({
      action: "stop",
      confirmationPhrase: "停止全部公开内容",
      context: expect.objectContaining({ requestId: "emergency-stop-request-2" }),
      expectedRevision: 7,
      idempotencyKey: "emergency-stop-0001",
      principal,
      reason: "发现图片权利材料错误",
    });
  });

  it("requires If-Match before attempting an emergency update", async () => {
    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        "idempotency-key": "emergency-stop-0002",
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "c".repeat(43),
        "x-request-id": "emergency-missing-revision",
      },
      method: "POST",
      payload: {
        confirmationPhrase: "停止全部公开内容",
        reason: "发现图片权利材料错误",
      },
      url: "/admin/api/v1/emergency-control/stop",
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({
      error: { code: "PRECONDITION_REQUIRED", requestId: "emergency-missing-revision" },
    });
    expect(emergencyService.apply).not.toHaveBeenCalled();
  });

  it("rejects malformed emergency confirmation before the domain operation", async () => {
    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        "idempotency-key": "emergency-stop-0003",
        "if-match": '"emergency-control:8"',
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "c".repeat(43),
      },
      method: "POST",
      payload: {
        confirmationPhrase: "停止公开内容",
        reason: "发现图片权利材料错误",
      },
      url: "/admin/api/v1/emergency-control/stop",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(emergencyService.apply).not.toHaveBeenCalled();
  });

  it.each([
    [
      "revision_conflict",
      {
        current: {
          auditEventId: "security-event-current",
          changedAt: new Date("2026-07-31T20:02:00.000Z"),
          publiclyEnabled: false,
          reason: "其他维护操作",
          requestId: "other-request",
          revision: 9,
        },
        kind: "revision_conflict" as const,
      },
      412,
      "REVISION_MISMATCH",
      '"emergency-control:9"',
    ],
    [
      "idempotency_conflict",
      { kind: "idempotency_conflict" as const },
      409,
      "IDEMPOTENCY_KEY_REUSED",
      undefined,
    ],
    [
      "invalid_state",
      { kind: "invalid_state" as const },
      409,
      "EMERGENCY_CONTROL_CONFLICT",
      undefined,
    ],
  ])(
    "maps %s to the frozen HTTP error",
    async (_caseName, result, expectedStatus, expectedCode, expectedEtag) => {
      vi.mocked(emergencyService.apply).mockResolvedValue(result);
      const response = await app.inject({
        headers: {
          cookie: `five_admin_session=${"s".repeat(43)}`,
          "idempotency-key": "emergency-stop-0004",
          "if-match": '"emergency-control:8"',
          origin: "http://127.0.0.1:3000",
          "x-csrf-token": "c".repeat(43),
        },
        method: "POST",
        payload: {
          confirmationPhrase: "停止全部公开内容",
          reason: "发现图片权利材料错误",
        },
        url: "/admin/api/v1/emergency-control/stop",
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json()).toMatchObject({ error: { code: expectedCode } });
      expect(response.headers.etag).toBe(expectedEtag);
    },
  );
});
