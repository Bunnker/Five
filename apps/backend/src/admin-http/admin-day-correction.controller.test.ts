import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService, SessionPrincipal } from "../admin-auth/admin-auth.service";
import type { DayCorrectionWorkflow } from "../day-correction/day-correction.workflow";
import { AdminDayCorrectionController } from "./admin-day-correction.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { ADMIN_AUTH_SERVICE, DAY_CORRECTION_WORKFLOW } from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";

const principal: SessionPrincipal = {
  absoluteExpiresAt: new Date("2026-08-07T20:00:00.000Z"),
  accountId: "admin-1",
  credentialRevision: 4,
  csrfToken: "c".repeat(43),
  idleExpiresAt: new Date("2026-08-07T08:30:00.000Z"),
  issuedAt: new Date("2026-08-07T08:00:00.000Z"),
  sessionTokenDigest: Buffer.alloc(32, 2),
  username: "operator",
};

const authService = {
  authenticateSession: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;

const workflow = {
  apply: vi.fn(),
  getWorkingCopy: vi.fn(),
  openWorkingCopy: vi.fn(),
  patch: vi.fn(),
} as unknown as DayCorrectionWorkflow;

const draft = {
  createdAt: "2026-08-07T08:00:00.000Z",
  draftId: "draft-correction-1",
  draftRevision: 3,
  fortuneDate: "2026-08-08",
  modules: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "draft" as const,
  updatedAt: "2026-08-07T08:10:00.000Z",
};

const correction = {
  appliedAction: null,
  applyDraftRevision: null,
  applyIdempotencyKeyHash: null,
  applyRequestHash: null,
  applyMode: null,
  applyStartedRevision: null,
  baselineActiveContentVersion: "content-before",
  baselineLifecycleRevision: 5,
  correctionId: "correction-1",
  correctionRevision: 1,
  createdAt: "2026-08-07T08:00:00.000Z",
  draftId: draft.draftId,
  fortuneDate: draft.fortuneDate,
  scheduledEffectiveFrom: null,
  sourceContentVersion: "content-before",
  status: "open" as const,
  submittedContentVersion: null,
  submittedLifecycleRevision: null,
  updatedAt: "2026-08-07T08:00:00.000Z",
};

const protectedHeaders = {
  cookie: `five_admin_session=${"s".repeat(43)}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": "c".repeat(43),
};

@Module({
  controllers: [AdminDayCorrectionController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: DAY_CORRECTION_WORKFLOW, useValue: workflow },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminDayCorrectionHttpTestModule {}

describe("admin day correction HTTP", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminDayCorrectionHttpTestModule,
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

  it("opens a working copy under CSRF protection and returns the real draft ETag", async () => {
    vi.mocked(workflow.openWorkingCopy).mockResolvedValue({ correction, draft, kind: "ready" });

    const response = await app.inject({
      headers: { ...protectedHeaders, "x-request-id": "correction-open-http" },
      method: "POST",
      payload: { fortuneDate: draft.fortuneDate },
      url: "/admin/api/v1/day-corrections",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:MToz"');
    expect(response.json()).toMatchObject({
      correctionId: correction.correctionId,
      correctionRevision: 1,
      draftId: draft.draftId,
      draftRevision: 3,
      fortuneDate: draft.fortuneDate,
      modules: draft.modules,
      status: "open",
    });
    expect(workflow.openWorkingCopy).toHaveBeenCalledWith({
      actorId: principal.accountId,
      fortuneDate: draft.fortuneDate,
      requestId: "correction-open-http",
    });
  });

  it("reads an existing working copy with the same draft concurrency contract", async () => {
    vi.mocked(workflow.getWorkingCopy).mockResolvedValue({ correction, draft, kind: "ready" });

    const response = await app.inject({
      headers: {
        cookie: protectedHeaders.cookie,
        "x-request-id": "correction-get-http",
      },
      method: "GET",
      url: `/admin/api/v1/day-corrections/${correction.correctionId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:MToz"');
    expect(workflow.getWorkingCopy).toHaveBeenCalledWith(correction.correctionId);
  });

  it("passes one semantic patch command with the draft revision from If-Match", async () => {
    vi.mocked(workflow.patch).mockResolvedValue({
      correctionId: correction.correctionId,
      correctionRevision: 1,
      draftRevision: 4,
      fortuneDate: correction.fortuneDate,
      kind: "updated",
      moduleCode: "copy_and_formula",
    });
    const command = {
      formulaId: "formula-1",
      kind: "set_outfit_formula_title",
      title: "通勤搭配",
    };

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "if-match": '"dc:MToz"',
        "x-request-id": "correction-patch-http",
      },
      method: "PATCH",
      payload: command,
      url: `/admin/api/v1/day-corrections/${correction.correctionId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:MTo0"');
    expect(workflow.patch).toHaveBeenCalledWith({
      actorId: principal.accountId,
      command,
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 3 },
      requestId: "correction-patch-http",
    });
  });

  it("returns the latest draft ETag when a stale editor loses the revision race", async () => {
    vi.mocked(workflow.patch).mockResolvedValue({
      currentRevision: { correctionRevision: 1, draftRevision: 8 },
      kind: "revision_mismatch",
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "if-match": '"dc:MToz"',
        "x-request-id": "correction-stale-http",
      },
      method: "PATCH",
      payload: { disclaimer: "新的依据说明", kind: "set_basis_disclaimer" },
      url: `/admin/api/v1/day-corrections/${correction.correctionId}`,
    });

    expect(response.statusCode).toBe(412);
    expect(response.headers.etag).toBe('"dc:MTo4"');
    expect(response.json()).toMatchObject({ error: { code: "REVISION_MISMATCH" } });
  });

  it("requires both If-Match and the external idempotency key before applying", async () => {
    const response = await app.inject({
      headers: { ...protectedHeaders, "x-request-id": "correction-apply-precondition" },
      method: "POST",
      payload: { reason: "保存订正。" },
      url: `/admin/api/v1/day-corrections/${correction.correctionId}/apply`,
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ error: { code: "PRECONDITION_REQUIRED" } });
    expect(workflow.apply).not.toHaveBeenCalled();
  });

  it("rejects apply when If-Match is valid but the idempotency key is missing", async () => {
    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "if-match": '"dc:MToz"',
        "x-request-id": "correction-apply-key-missing",
      },
      method: "POST",
      payload: { reason: "保存订正。" },
      url: `/admin/api/v1/day-corrections/${correction.correctionId}/apply`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(workflow.apply).not.toHaveBeenCalled();
  });

  it("applies with authenticated actor, CSRF, draft ETag and one idempotency key", async () => {
    const action = {
      activeContentVersion: "content-after",
      auditEventId: "audit-after",
      contentVersion: "content-after",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 7,
      state: "scheduled" as const,
      transitions: [
        {
          contentVersion: "content-after",
          fromState: "approved" as const,
          toState: "scheduled" as const,
        },
      ],
    };
    vi.mocked(workflow.apply).mockResolvedValue({
      action,
      correctionId: correction.correctionId,
      correctionRevision: 4,
      draftRevision: 3,
      kind: "applied",
      mode: "scheduled",
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-apply-http-0001",
        "if-match": '"dc:MToz"',
        "x-request-id": "correction-apply-http",
      },
      method: "POST",
      payload: { reason: "保存未来日期订正。" },
      url: `/admin/api/v1/day-corrections/${correction.correctionId}/apply`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:NDoz"');
    expect(response.json()).toEqual({
      action,
      correctionId: correction.correctionId,
      correctionRevision: 4,
      draftRevision: 3,
      mode: "scheduled",
    });
    expect(workflow.apply).toHaveBeenCalledWith({
      actorId: principal.accountId,
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 3 },
      idempotencyKey: "correction-apply-http-0001",
      reason: "保存未来日期订正。",
      requestId: "correction-apply-http",
    });
  });

  it("returns the terminal composite correction ETag instead of a lifecycle ETag", async () => {
    vi.mocked(workflow.apply).mockResolvedValue({
      correctionRevision: 4,
      draftRevision: 3,
      kind: "release_failed",
      result: { currentRevision: 9, kind: "revision_mismatch" },
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-apply-http-conflict",
        "if-match": '"dc:MToz"',
        "x-request-id": "correction-apply-http-conflict",
      },
      method: "POST",
      payload: { reason: "模拟发布冲突。" },
      url: `/admin/api/v1/day-corrections/${correction.correctionId}/apply`,
    });

    expect(response.statusCode).toBe(412);
    expect(response.headers.etag).toBe('"dc:NDoz"');
    expect(response.headers.etag).not.toContain("lifecycle");
    expect(response.json()).toMatchObject({ error: { code: "REVISION_MISMATCH" } });
  });

  it("rejects an apply write without the session-bound CSRF token", async () => {
    const response = await app.inject({
      headers: {
        cookie: protectedHeaders.cookie,
        "idempotency-key": "correction-apply-http-0002",
        "if-match": '"dc:MToz"',
        origin: protectedHeaders.origin,
      },
      method: "POST",
      payload: { reason: "缺少 CSRF。" },
      url: `/admin/api/v1/day-corrections/${correction.correctionId}/apply`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "CSRF_VALIDATION_FAILED" } });
    expect(workflow.apply).not.toHaveBeenCalled();
  });
});
