import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService, SessionPrincipal } from "../admin-auth/admin-auth.service";
import type { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import type { ContentProductionService } from "../content-production/content-production.service";
import type { ContentReleaseService } from "../content-release/content-release.service";
import { AdminContentController } from "./admin-content.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import {
  ADMIN_AUTH_SERVICE,
  CONTENT_LIFECYCLE_SERVICE,
  CONTENT_PRODUCTION_SERVICE,
  CONTENT_RELEASE_SERVICE,
} from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";

const principal: SessionPrincipal = {
  absoluteExpiresAt: new Date("2026-08-01T20:00:00.000Z"),
  accountId: "admin-1",
  credentialRevision: 4,
  csrfToken: "c".repeat(43),
  idleExpiresAt: new Date("2026-08-01T08:30:00.000Z"),
  issuedAt: new Date("2026-08-01T08:00:00.000Z"),
  sessionTokenDigest: Buffer.alloc(32, 2),
  username: "operator",
};

const authService = {
  authenticateSession: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;

const lifecycleService = {
  addMasterReviewEvidence: vi.fn(),
  createDraft: vi.fn(),
  decideReview: vi.fn(),
  getDraft: vi.fn(),
  getVersion: vi.fn(),
  listAuditEvents: vi.fn(),
  listDrafts: vi.fn(),
  listVersions: vi.fn(),
  submitDraft: vi.fn(),
  updateDraftModule: vi.fn(),
} as unknown as ContentLifecycleService;

const productionService = {
  ensureDay: vi.fn(),
  list: vi.fn(),
} as unknown as ContentProductionService;

const releaseService = {
  cancelSchedule: vi.fn(),
  publish: vi.fn(),
  rollback: vi.fn(),
  schedule: vi.fn(),
  withdraw: vi.fn(),
} as unknown as ContentReleaseService;

const draft = {
  createdAt: "2026-08-01T08:00:00.000Z",
  draftId: "draft-1",
  draftRevision: 1,
  fortuneDate: "2026-08-02",
  modules: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "draft" as const,
  updatedAt: "2026-08-01T08:00:00.000Z",
};

const adminVersion = {
  activeContentVersion: null,
  contentVersion: "content-opaque-1",
  fortuneDate: "2026-08-02",
  lifecycleRevision: 4,
  masterReviewEvidence: [],
  preflightChecks: [
    {
      code: "master_review_evidence" as const,
      message: "尚未登记大师核对依据。",
      status: "pending" as const,
    },
  ],
  snapshot: draft.modules,
  state: "in_review" as const,
};

const releaseAction = {
  activeContentVersion: "content-opaque-1",
  auditEventId: "audit-release-1",
  contentVersion: "content-opaque-1",
  fortuneDate: "2026-08-02",
  lifecycleRevision: 5,
  state: "published" as const,
  transitions: [
    {
      contentVersion: "content-opaque-1",
      fromState: "approved" as const,
      toState: "published" as const,
    },
  ],
};

const protectedWriteHeaders = {
  cookie: `five_admin_session=${"s".repeat(43)}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": "c".repeat(43),
};

@Module({
  controllers: [AdminContentController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: CONTENT_LIFECYCLE_SERVICE, useValue: lifecycleService },
    { provide: CONTENT_PRODUCTION_SERVICE, useValue: productionService },
    { provide: CONTENT_RELEASE_SERVICE, useValue: releaseService },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminContentHttpTestModule {}

describe("admin content HTTP", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminContentHttpTestModule,
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
    vi.mocked(productionService.list).mockResolvedValue({ items: [] });
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists resumable drafts from the server and filters by fortune date", async () => {
    vi.mocked(lifecycleService.listDrafts).mockResolvedValue({
      items: [
        {
          createdAt: "2026-08-01T08:00:00.000Z",
          draftId: "draft-1",
          draftRevision: 3,
          fortuneDate: "2026-08-02",
          state: "draft",
          updatedAt: "2026-08-01T08:10:00.000Z",
        },
      ],
    });

    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        "x-request-id": "content-draft-list",
      },
      method: "GET",
      url: "/admin/api/v1/daily-content-drafts?fortuneDate=2026-08-02",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          createdAt: "2026-08-01T08:00:00.000Z",
          draftId: "draft-1",
          draftRevision: 3,
          fortuneDate: "2026-08-02",
          state: "draft",
          updatedAt: "2026-08-01T08:10:00.000Z",
        },
      ],
    });
    expect(lifecycleService.listDrafts).toHaveBeenCalledWith("2026-08-02");
  });

  it("creates a draft as the authenticated account and returns its strong ETag", async () => {
    vi.mocked(lifecycleService.createDraft).mockResolvedValue({ draft, kind: "created" });

    const response = await app.inject({
      headers: { ...protectedWriteHeaders, "x-request-id": "content-draft-create" },
      method: "POST",
      payload: { copyFromContentVersion: null, fortuneDate: "2026-08-02" },
      url: "/admin/api/v1/daily-content-drafts",
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"draft:1"');
    expect(response.json()).toEqual(draft);
    expect(lifecycleService.createDraft).toHaveBeenCalledWith({
      actorId: "admin-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "content-draft-create",
    });
  });

  it("automatically prepares one day for review without an empty manual draft", async () => {
    vi.mocked(productionService.ensureDay).mockResolvedValue({
      kind: "accepted",
      production: {
        completedImageSlots: 0,
        draftId: "auto-draft-1",
        draftRevision: 1,
        fortuneDate: "2026-08-02",
        imageSlots: [
          {
            attemptLimit: 3,
            attempts: 0,
            canRetry: false,
            deliveryReady: false,
            imageSlot: "required_primary",
            lastError: null,
            nextAttemptAt: "2026-08-01T08:00:00.000Z",
            status: "pending",
          },
          {
            attemptLimit: 3,
            attempts: 0,
            canRetry: false,
            deliveryReady: false,
            imageSlot: "required_alternative",
            lastError: null,
            nextAttemptAt: "2026-08-01T08:00:00.000Z",
            status: "pending",
          },
          {
            attemptLimit: 0,
            attempts: 0,
            canRetry: false,
            deliveryReady: false,
            imageSlot: "optional",
            lastError: null,
            nextAttemptAt: null,
            status: "not_requested",
          },
        ],
        lastError: null,
        optionalImageStatus: "not_requested",
        pendingImageSlots: 2,
        requiredGenerationComplete: false,
        requiredImagesReady: false,
        status: "generating",
        updatedAt: "2026-08-01T08:00:00.000Z",
      },
    });
    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "generate-2026-08-02-once",
        "x-request-id": "content-production-create",
      },
      method: "POST",
      payload: { fortuneDate: "2026-08-02" },
      url: "/admin/api/v1/daily-content-productions",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      completedImageSlots: 0,
      draftId: "auto-draft-1",
      draftRevision: 1,
      fortuneDate: "2026-08-02",
      imageSlots: [
        {
          attemptLimit: 3,
          attempts: 0,
          canRetry: false,
          deliveryReady: false,
          imageSlot: "required_primary",
          lastError: null,
          nextAttemptAt: "2026-08-01T08:00:00.000Z",
          status: "pending",
        },
        {
          attemptLimit: 3,
          attempts: 0,
          canRetry: false,
          deliveryReady: false,
          imageSlot: "required_alternative",
          lastError: null,
          nextAttemptAt: "2026-08-01T08:00:00.000Z",
          status: "pending",
        },
        {
          attemptLimit: 0,
          attempts: 0,
          canRetry: false,
          deliveryReady: false,
          imageSlot: "optional",
          lastError: null,
          nextAttemptAt: null,
          status: "not_requested",
        },
      ],
      lastError: null,
      optionalImageStatus: "not_requested",
      pendingImageSlots: 2,
      requiredGenerationComplete: false,
      requiredImagesReady: false,
      status: "generating",
      updatedAt: "2026-08-01T08:00:00.000Z",
    });
    expect(productionService.ensureDay).toHaveBeenCalledWith({
      actorId: "admin-1",
      fortuneDate: "2026-08-02",
      idempotencyKey: "generate-2026-08-02-once",
      requestId: "content-production-create",
    });
  });

  it("returns 404 when the requested copy source does not exist", async () => {
    vi.mocked(lifecycleService.createDraft).mockResolvedValue({ kind: "source_not_found" });

    const response = await app.inject({
      headers: { ...protectedWriteHeaders, "x-request-id": "content-copy-missing" },
      method: "POST",
      payload: { copyFromContentVersion: "missing-version", fortuneDate: "2026-08-02" },
      url: "/admin/api/v1/daily-content-drafts",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND", requestId: "content-copy-missing" },
    });
  });

  it("does not copy an immutable version into another fortune date", async () => {
    vi.mocked(lifecycleService.createDraft).mockResolvedValue({ kind: "source_date_mismatch" });

    const response = await app.inject({
      headers: { ...protectedWriteHeaders, "x-request-id": "content-copy-date-mismatch" },
      method: "POST",
      payload: { copyFromContentVersion: "content-old", fortuneDate: "2026-08-02" },
      url: "/admin/api/v1/daily-content-drafts",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION", requestId: "content-copy-date-mismatch" },
    });
  });

  it("returns a draft with its current edit revision", async () => {
    vi.mocked(lifecycleService.getDraft).mockResolvedValue(draft);

    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie, "x-request-id": "content-draft-get" },
      method: "GET",
      url: "/admin/api/v1/daily-content-drafts/draft-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"draft:1"');
    expect(response.json()).toEqual(draft);
    expect(lifecycleService.getDraft).toHaveBeenCalledWith("draft-1");
  });

  it("updates one validated draft module under If-Match", async () => {
    const module = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample",
      templateId: "template-1",
    };
    vi.mocked(lifecycleService.updateDraftModule).mockResolvedValue({
      kind: "updated",
      result: { draftId: "draft-1", draftRevision: 2, module, moduleCode: "poster_consistency" },
    });

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "if-match": '"draft:1"',
        "x-request-id": "content-module-save",
      },
      method: "PATCH",
      payload: module,
      url: "/admin/api/v1/daily-content-drafts/draft-1/modules/poster_consistency",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"draft:2"');
    expect(response.json()).toEqual({
      draftId: "draft-1",
      draftRevision: 2,
      module,
      moduleCode: "poster_consistency",
    });
    expect(lifecycleService.updateDraftModule).toHaveBeenCalledWith({
      actorId: "admin-1",
      draftId: "draft-1",
      expectedDraftRevision: 1,
      module,
      moduleCode: "poster_consistency",
      requestId: "content-module-save",
    });
  });

  it("requires If-Match before changing a draft module", async () => {
    const response = await app.inject({
      headers: { ...protectedWriteHeaders, "x-request-id": "content-module-precondition" },
      method: "PATCH",
      payload: {
        posterTemplateVersion: "poster-v1",
        sampleAssetId: "asset-sample",
        templateId: "template-1",
      },
      url: "/admin/api/v1/daily-content-drafts/draft-1/modules/poster_consistency",
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({
      error: { code: "PRECONDITION_REQUIRED", requestId: "content-module-precondition" },
    });
    expect(lifecycleService.updateDraftModule).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not_found" } as const, 404, "RESOURCE_NOT_FOUND", undefined],
    [{ kind: "invalid_state" } as const, 409, "INVALID_STATE_TRANSITION", undefined],
    [
      { currentRevision: 7, kind: "revision_mismatch" } as const,
      412,
      "REVISION_MISMATCH",
      '"draft:7"',
    ],
  ])("maps draft module result %# to its public error", async (result, status, code, etag) => {
    vi.mocked(lifecycleService.updateDraftModule).mockResolvedValue(result);

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "if-match": '"draft:1"',
        "x-request-id": "content-module-error",
      },
      method: "PATCH",
      payload: {
        posterTemplateVersion: "poster-v1",
        sampleAssetId: "asset-sample",
        templateId: "template-1",
      },
      url: "/admin/api/v1/daily-content-drafts/draft-1/modules/poster_consistency",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code } });
    expect(response.headers.etag).toBe(etag);
  });

  it("submits a draft idempotently and returns the new lifecycle revision", async () => {
    vi.mocked(lifecycleService.submitDraft).mockResolvedValue({
      kind: "submitted",
      result: {
        contentVersion: "content-opaque-1",
        draftId: "draft-1",
        lifecycleRevision: 4,
        state: "approved",
      },
    });

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "submit-intent-0001",
        "if-match": '"draft:2"',
        "x-request-id": "content-draft-submit",
      },
      method: "POST",
      url: "/admin/api/v1/daily-content-drafts/draft-1/submit",
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"lifecycle:4"');
    expect(response.json()).toEqual({
      contentVersion: "content-opaque-1",
      draftId: "draft-1",
      lifecycleRevision: 4,
      state: "approved",
    });
    expect(lifecycleService.submitDraft).toHaveBeenCalledWith({
      actorId: "admin-1",
      draftId: "draft-1",
      expectedDraftRevision: 2,
      idempotencyKey: "submit-intent-0001",
      requestId: "content-draft-submit",
    });
  });

  it.each([
    [{ kind: "not_found" } as const, 404, "RESOURCE_NOT_FOUND", undefined],
    [{ kind: "invalid_state" } as const, 409, "INVALID_STATE_TRANSITION", undefined],
    [{ kind: "image_withdrawn" } as const, 422, "IMAGE_SET_INVALID", undefined],
    [{ kind: "invalid_asset_reference" } as const, 422, "IMAGE_SET_INVALID", undefined],
    [{ kind: "idempotency_conflict" } as const, 409, "IDEMPOTENCY_KEY_REUSED", undefined],
    [
      { currentRevision: 9, kind: "revision_mismatch" } as const,
      412,
      "REVISION_MISMATCH",
      '"draft:9"',
    ],
  ])("maps draft submission result %# to its public error", async (result, status, code, etag) => {
    vi.mocked(lifecycleService.submitDraft).mockResolvedValue(result);

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "submit-intent-0002",
        "if-match": '"draft:2"',
      },
      method: "POST",
      url: "/admin/api/v1/daily-content-drafts/draft-1/submit",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code } });
    expect(response.headers.etag).toBe(etag);
  });

  it("lists immutable versions for one fortune date", async () => {
    vi.mocked(lifecycleService.listVersions).mockResolvedValue({
      activeContentVersion: null,
      fortuneDate: "2026-08-02",
      items: [
        {
          contentVersion: "content-opaque-1",
          createdAt: "2026-08-01T08:20:00.000Z",
          effectiveFrom: null,
          effectiveTo: null,
          lifecycleRevision: 4,
          state: "in_review",
        },
      ],
    });

    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie },
      method: "GET",
      url: "/admin/api/v1/daily-content-versions?fortuneDate=2026-08-02",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      activeContentVersion: null,
      fortuneDate: "2026-08-02",
      items: [{ contentVersion: "content-opaque-1", lifecycleRevision: 4 }],
    });
    expect(lifecycleService.listVersions).toHaveBeenCalledWith("2026-08-02");
  });

  it("returns the immutable snapshot, checks, evidence, and lifecycle ETag", async () => {
    vi.mocked(lifecycleService.getVersion).mockResolvedValue(adminVersion);

    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie },
      method: "GET",
      url: "/admin/api/v1/daily-content-versions/content-opaque-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"lifecycle:4"');
    expect(response.json()).toEqual(adminVersion);
    expect(lifecycleService.getVersion).toHaveBeenCalledWith("content-opaque-1");
  });

  it("records external master evidence as the authenticated account", async () => {
    const evidence = {
      conclusion: "confirmed" as const,
      notes: "已逐项核对。",
      references: [{ kind: "document" as const, reference: "evidence://review-1" }],
      reviewedAt: "2026-08-01T15:30:00+08:00",
      reviewerDisplayName: "林老师",
    };
    const version = {
      ...adminVersion,
      lifecycleRevision: 5,
      masterReviewEvidence: [{ ...evidence, evidenceId: "evidence-1" }],
    };
    vi.mocked(lifecycleService.addMasterReviewEvidence).mockResolvedValue({
      kind: "added",
      version,
    });

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "evidence-intent-001",
        "if-match": '"lifecycle:4"',
        "x-request-id": "content-evidence-add",
      },
      method: "POST",
      payload: evidence,
      url: "/admin/api/v1/daily-content-versions/content-opaque-1/master-review-evidence",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"lifecycle:5"');
    expect(response.json()).toEqual(version);
    expect(lifecycleService.addMasterReviewEvidence).toHaveBeenCalledWith({
      actorId: "admin-1",
      contentVersion: "content-opaque-1",
      evidence,
      expectedLifecycleRevision: 4,
      idempotencyKey: "evidence-intent-001",
      requestId: "content-evidence-add",
    });
  });

  it.each([
    [{ kind: "not_found" } as const, 404, "RESOURCE_NOT_FOUND", undefined],
    [{ kind: "invalid_state" } as const, 409, "INVALID_STATE_TRANSITION", undefined],
    [{ kind: "idempotency_conflict" } as const, 409, "IDEMPOTENCY_KEY_REUSED", undefined],
    [
      { currentRevision: 8, kind: "revision_mismatch" } as const,
      412,
      "REVISION_MISMATCH",
      '"lifecycle:8"',
    ],
  ])("maps evidence result %# to its public error", async (result, status, code, etag) => {
    vi.mocked(lifecycleService.addMasterReviewEvidence).mockResolvedValue(result);

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "evidence-intent-002",
        "if-match": '"lifecycle:4"',
      },
      method: "POST",
      payload: {
        conclusion: "confirmed",
        notes: "已核对。",
        references: [{ kind: "note", reference: "线下记录" }],
        reviewedAt: "2026-08-01T15:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
      url: "/admin/api/v1/daily-content-versions/content-opaque-1/master-review-evidence",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code } });
    expect(response.headers.etag).toBe(etag);
  });

  it("records an approve-or-change decision without trusting a body actor", async () => {
    const action = {
      activeContentVersion: null,
      auditEventId: "audit-review-1",
      contentVersion: "content-opaque-1",
      fortuneDate: "2026-08-02",
      lifecycleRevision: 6,
      state: "changes_requested" as const,
      transitions: [
        {
          contentVersion: "content-opaque-1",
          fromState: "in_review" as const,
          toState: "changes_requested" as const,
        },
      ],
    };
    vi.mocked(lifecycleService.decideReview).mockResolvedValue({ action, kind: "applied" });

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "decision-intent-001",
        "if-match": '"lifecycle:5"',
        "x-request-id": "content-review-decision",
      },
      method: "POST",
      payload: { decision: "changes_requested", reason: "第 2 个颜色说明需要修正。" },
      url: "/admin/api/v1/daily-content-versions/content-opaque-1/review-decision",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"lifecycle:6"');
    expect(response.json()).toEqual(action);
    expect(lifecycleService.decideReview).toHaveBeenCalledWith({
      actorId: "admin-1",
      contentVersion: "content-opaque-1",
      decision: "changes_requested",
      expectedLifecycleRevision: 5,
      idempotencyKey: "decision-intent-001",
      reason: "第 2 个颜色说明需要修正。",
      requestId: "content-review-decision",
    });
  });

  it.each([
    [{ kind: "not_found" } as const, 404, "RESOURCE_NOT_FOUND", undefined],
    [{ kind: "invalid_state" } as const, 409, "INVALID_STATE_TRANSITION", undefined],
    [{ kind: "idempotency_conflict" } as const, 409, "IDEMPOTENCY_KEY_REUSED", undefined],
    [
      { currentRevision: 7, kind: "revision_mismatch" } as const,
      412,
      "REVISION_MISMATCH",
      '"lifecycle:7"',
    ],
    [
      { kind: "master_review_missing", preflightChecks: [] } as const,
      422,
      "MASTER_REVIEW_EVIDENCE_MISSING",
      undefined,
    ],
    [
      { kind: "required_review_missing", preflightChecks: [] } as const,
      422,
      "REQUIRED_REVIEW_MISSING",
      undefined,
    ],
  ])("maps review decision result %# to its public error", async (result, status, code, etag) => {
    vi.mocked(lifecycleService.decideReview).mockResolvedValue(result);

    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "decision-intent-002",
        "if-match": '"lifecycle:5"',
      },
      method: "POST",
      payload: { decision: "approved", reason: null },
      url: "/admin/api/v1/daily-content-versions/content-opaque-1/review-decision",
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code } });
    expect(response.headers.etag).toBe(etag);
  });

  it("lists sanitized lifecycle audit events with server cursors", async () => {
    vi.mocked(lifecycleService.listAuditEvents).mockResolvedValue({
      items: [
        {
          action: "content_review_approved",
          auditEventId: "audit-review-1",
          contentVersion: "content-opaque-1",
          fortuneDate: "2026-08-02",
          occurredAt: "2026-08-01T08:30:00.000Z",
          reason: "全部检查通过。",
          requestId: "content-review-decision",
        },
      ],
      kind: "page",
      nextCursor: "cursor-next",
    });

    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie },
      method: "GET",
      url: "/admin/api/v1/audit-events?fortuneDate=2026-08-02&contentVersion=content-opaque-1&cursor=cursor-current&limit=25",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          action: "content_review_approved",
          auditEventId: "audit-review-1",
          contentVersion: "content-opaque-1",
          fortuneDate: "2026-08-02",
          occurredAt: "2026-08-01T08:30:00.000Z",
          reason: "全部检查通过。",
          requestId: "content-review-decision",
        },
      ],
      nextCursor: "cursor-next",
    });
    expect(lifecycleService.listAuditEvents).toHaveBeenCalledWith({
      contentVersion: "content-opaque-1",
      cursor: "cursor-current",
      fortuneDate: "2026-08-02",
      limit: 25,
    });
  });

  it("schedules an approved version under lifecycle and active-version preconditions", async () => {
    vi.mocked(releaseService.schedule).mockResolvedValue({
      action: { ...releaseAction, activeContentVersion: null, state: "scheduled" },
      kind: "applied",
    });
    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "schedule-http-key-01",
        "if-match": '"lifecycle:4"',
        "x-request-id": "schedule-http-request",
      },
      method: "POST",
      payload: {
        effectiveFrom: "2026-08-01T23:00:00+08:00",
        expectedActiveContentVersion: null,
        reason: "按冻结生效时间上线。",
      },
      url: "/admin/api/v1/daily-content-versions/content-opaque-1/schedule",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"lifecycle:5"');
    expect(releaseService.schedule).toHaveBeenCalledWith({
      actorId: "admin-1",
      contentVersion: "content-opaque-1",
      effectiveFrom: "2026-08-01T23:00:00+08:00",
      expectedActiveContentVersion: null,
      expectedLifecycleRevision: 4,
      idempotencyKey: "schedule-http-key-01",
      reason: "按冻结生效时间上线。",
      requestId: "schedule-http-request",
    });
  });

  it("maps an invalid fixed schedule time to the frozen OpenAPI 422 response", async () => {
    vi.mocked(releaseService.schedule).mockResolvedValue({ kind: "schedule_time_invalid" });
    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "schedule-invalid-http-key-01",
        "if-match": '"lifecycle:4"',
        "x-request-id": "schedule-invalid-http-request",
      },
      method: "POST",
      payload: {
        effectiveFrom: "2026-08-01T22:59:00+08:00",
        expectedActiveContentVersion: null,
        reason: "验证冻结排期错误映射。",
      },
      url: "/admin/api/v1/daily-content-versions/content-opaque-1/schedule",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "SCHEDULE_TIME_INVALID",
        requestId: "schedule-invalid-http-request",
      },
    });
  });

  it.each([
    [
      "cancel-schedule",
      "cancelSchedule",
      { expectedActiveContentVersion: null, reason: "取消排期。" },
    ],
    ["publish", "publish", { expectedActiveContentVersion: null, reason: "立即发布。" }],
    [
      "withdraw",
      "withdraw",
      {
        expectedActiveContentVersion: "content-opaque-1",
        reason: "发现风险，立即下线。",
        replacementContentVersion: null,
      },
    ],
  ] as const)("routes %s through the release service", async (path, method, payload) => {
    vi.mocked(releaseService[method]).mockResolvedValue({ action: releaseAction, kind: "applied" });
    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": `release-${path}-key-01`,
        "if-match": '"lifecycle:4"',
        "x-request-id": `release-${path}-request`,
      },
      method: "POST",
      payload,
      url: `/admin/api/v1/daily-content-versions/content-opaque-1/${path}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"lifecycle:5"');
    expect(releaseService[method]).toHaveBeenCalledWith({
      actorId: "admin-1",
      contentVersion: "content-opaque-1",
      expectedLifecycleRevision: 4,
      idempotencyKey: `release-${path}-key-01`,
      requestId: `release-${path}-request`,
      ...payload,
    });
  });

  it("rolls back a day to an explicitly selected same-day version", async () => {
    vi.mocked(releaseService.rollback).mockResolvedValue({
      action: releaseAction,
      kind: "applied",
    });
    const response = await app.inject({
      headers: {
        ...protectedWriteHeaders,
        "idempotency-key": "rollback-http-key-01",
        "if-match": '"lifecycle:4"',
        "x-request-id": "rollback-http-request",
      },
      method: "POST",
      payload: {
        expectedActiveContentVersion: "content-current",
        reason: "恢复同日安全旧版本。",
        targetContentVersion: "content-opaque-1",
      },
      url: "/admin/api/v1/daily-content-days/2026-08-02/rollback",
    });

    expect(response.statusCode).toBe(200);
    expect(releaseService.rollback).toHaveBeenCalledWith({
      actorId: "admin-1",
      expectedActiveContentVersion: "content-current",
      expectedLifecycleRevision: 4,
      fortuneDate: "2026-08-02",
      idempotencyKey: "rollback-http-key-01",
      reason: "恢复同日安全旧版本。",
      requestId: "rollback-http-request",
      targetContentVersion: "content-opaque-1",
    });
  });

  it("maps release conflicts and preflight failures to stable product errors", async () => {
    vi.mocked(releaseService.publish)
      .mockResolvedValueOnce({
        currentActiveContentVersion: "content-newer",
        kind: "active_version_changed",
      })
      .mockResolvedValueOnce({
        kind: "preflight_failed",
        preflightChecks: [
          { code: "required_images", message: "图片当前不可交付。", status: "failed" },
        ],
      });
    const request = (idempotencyKey: string, id: string) =>
      app.inject({
        headers: {
          ...protectedWriteHeaders,
          "idempotency-key": idempotencyKey,
          "if-match": '"lifecycle:4"',
          "x-request-id": id,
        },
        method: "POST" as const,
        payload: { expectedActiveContentVersion: null, reason: "立即发布。" },
        url: "/admin/api/v1/daily-content-versions/content-opaque-1/publish",
      });

    const conflict = await request("publish-conflict-0001", "publish-conflict-request");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: {
        code: "ACTIVE_CONTENT_VERSION_CHANGED",
        details: { currentActiveContentVersion: "content-newer" },
      },
    });
    const preflight = await request("publish-preflight-0001", "publish-preflight-request");
    expect(preflight.statusCode).toBe(422);
    expect(preflight.json()).toMatchObject({
      error: {
        code: "PUBLISH_PRECHECK_FAILED",
        details: { preflightChecks: [{ code: "required_images", status: "failed" }] },
      },
    });
  });

  it("rejects an unauthenticated content request before it reaches the lifecycle service", async () => {
    const response = await app.inject({
      headers: { "x-request-id": "content-unauthenticated" },
      method: "GET",
      url: "/admin/api/v1/daily-content-drafts",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED", requestId: "content-unauthenticated" },
    });
    expect(lifecycleService.listDrafts).not.toHaveBeenCalled();
  });

  it.each([
    "/admin/api/v1/daily-content-drafts?fortuneDate=2026-08-02&fortuneDate=2026-08-03",
    "/admin/api/v1/daily-content-versions?fortuneDate=2026-08-02&fortuneDate=2026-08-03",
    "/admin/api/v1/audit-events?cursor=first&cursor=second",
    "/admin/api/v1/audit-events?contentVersion=one&contentVersion=two",
    "/admin/api/v1/audit-events?limit=10&limit=20",
  ])("rejects repeated query values: %s", async (url) => {
    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie },
      method: "GET",
      url,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: expect.any(String) } });
    expect(lifecycleService.listDrafts).not.toHaveBeenCalled();
    expect(lifecycleService.listVersions).not.toHaveBeenCalled();
    expect(lifecycleService.listAuditEvents).not.toHaveBeenCalled();
  });

  it("rejects an impossible fortune date with the stable date error", async () => {
    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie, "x-request-id": "content-invalid-date" },
      method: "GET",
      url: "/admin/api/v1/daily-content-versions?fortuneDate=2026-02-30",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_FORTUNE_DATE", requestId: "content-invalid-date" },
    });
  });

  it("rejects a forged body actor instead of overriding the authenticated account", async () => {
    const response = await app.inject({
      headers: protectedWriteHeaders,
      method: "POST",
      payload: {
        actorId: "attacker",
        copyFromContentVersion: null,
        fortuneDate: "2026-08-02",
      },
      url: "/admin/api/v1/daily-content-drafts",
    });

    expect(response.statusCode).toBe(400);
    expect(lifecycleService.createDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["/admin/api/v1/daily-content-drafts/draft-1/submit", undefined],
    [
      "/admin/api/v1/daily-content-versions/content-opaque-1/master-review-evidence",
      {
        conclusion: "confirmed",
        notes: "已核对。",
        references: [{ kind: "note", reference: "线下记录" }],
        reviewedAt: "2026-08-01T15:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
    ],
    [
      "/admin/api/v1/daily-content-versions/content-opaque-1/review-decision",
      { decision: "approved", reason: null },
    ],
  ])("requires If-Match on lifecycle write %s", async (url, payload) => {
    const response = await app.inject({
      headers: { ...protectedWriteHeaders, "idempotency-key": "precondition-key-01" },
      method: "POST",
      payload,
      url,
    });

    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ error: { code: "PRECONDITION_REQUIRED" } });
  });

  it("maps a forged audit cursor to stable 400", async () => {
    vi.mocked(lifecycleService.listAuditEvents).mockResolvedValue({ kind: "invalid_cursor" });

    const response = await app.inject({
      headers: { cookie: protectedWriteHeaders.cookie, "x-request-id": "content-audit-cursor" },
      method: "GET",
      url: "/admin/api/v1/audit-events?cursor=forged&limit=20",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "content-audit-cursor" },
    });
  });
});
