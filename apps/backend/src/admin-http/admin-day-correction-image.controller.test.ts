import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService, SessionPrincipal } from "../admin-auth/admin-auth.service";
import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import type { DayCorrectionImageJobService } from "../day-correction/day-correction-image-job.service";
import type { DayCorrectionImageWorkflow } from "../day-correction/day-correction-image.workflow";
import type { DayCorrectionWorkflow } from "../day-correction/day-correction.workflow";
import { AdminDayCorrectionImageController } from "./admin-day-correction-image.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import {
  ADMIN_AUTH_SERVICE,
  DAILY_IMAGE_ASSET_SERVICE,
  DAY_CORRECTION_IMAGE_JOB_SERVICE,
  DAY_CORRECTION_IMAGE_WORKFLOW,
  DAY_CORRECTION_WORKFLOW,
} from "./admin-http.providers";
import { installAdminImageMultipart } from "./admin-image-multipart";
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
  listReusable: vi.fn(),
  requestRegeneration: vi.fn(),
  selectDraftCandidate: vi.fn(),
  selectReusable: vi.fn(),
  uploadAndSelect: vi.fn(),
} as unknown as DayCorrectionImageWorkflow;
const corrections = { getWorkingCopy: vi.fn() } as unknown as DayCorrectionWorkflow;
const jobs = { getCurrent: vi.fn() } as unknown as DayCorrectionImageJobService;
const images = { listDraftAssets: vi.fn() } as unknown as DailyImageAssetService;

const protectedHeaders = {
  cookie: `five_admin_session=${"s".repeat(43)}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": "c".repeat(43),
};

function correctionUploadMultipart() {
  const boundary = "five-correction-image-boundary";
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="altText"\r\n\r\n白色通勤模特穿搭\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="reason"\r\n\r\n手动上传更合适的模特图。\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="look.png"\r\nContent-Type: image/png\r\n\r\nPNG-FIXTURE\r\n`,
    `--${boundary}--\r\n`,
  ];
  return { boundary, payload: Buffer.from(parts.join("")) };
}

const job = {
  actorId: "admin-1",
  attempts: 0,
  attemptLimit: 3,
  availableAt: "2026-08-07T08:00:00.000Z",
  completedAssetId: null,
  correctionId: "correction-images",
  draftId: "draft-images",
  fortuneDate: "2026-08-08",
  generationRevision: 1,
  imageSlot: "required_primary" as const,
  jobId: "correction-image-job-1",
  lastError: null,
  promptVersion: "five-outfit-model-v1",
  reason: "这张模特图不合适，重新生成。",
  requestId: "correction-image-regenerate-http",
  requestedAt: "2026-08-07T08:00:00.000Z",
  status: "queued" as const,
};

@Module({
  controllers: [AdminDayCorrectionImageController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: DAY_CORRECTION_IMAGE_WORKFLOW, useValue: workflow },
    { provide: DAY_CORRECTION_IMAGE_JOB_SERVICE, useValue: jobs },
    { provide: DAY_CORRECTION_WORKFLOW, useValue: corrections },
    { provide: DAILY_IMAGE_ASSET_SERVICE, useValue: images },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminDayCorrectionImageHttpTestModule {}

describe("admin day correction image HTTP", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminDayCorrectionImageHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await installAdminImageMultipart(app.getHttpAdapter().getInstance());
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
    vi.mocked(corrections.getWorkingCopy).mockResolvedValue({
      correction: {
        appliedAction: null,
        applyDraftRevision: null,
        applyIdempotencyKeyHash: null,
        applyRequestHash: null,
        applyMode: null,
        applyStartedRevision: null,
        baselineActiveContentVersion: "content-live",
        baselineLifecycleRevision: 4,
        correctionId: "correction-images",
        correctionRevision: 1,
        createdAt: "2026-08-07T08:00:00.000Z",
        draftId: "draft-images",
        fortuneDate: "2026-08-08",
        scheduledEffectiveFrom: null,
        sourceContentVersion: "content-live",
        status: "open",
        submittedContentVersion: null,
        submittedLifecycleRevision: null,
        terminalFailure: null,
        updatedAt: "2026-08-07T08:01:00.000Z",
      },
      draft: {
        createdAt: "2026-08-07T08:00:00.000Z",
        draftId: "draft-images",
        draftRevision: 9,
        fortuneDate: "2026-08-08",
        modules: {
          calendar_algorithm: null,
          copy_and_formula: null,
          poster_consistency: null,
          visual_and_rights: null,
        },
        state: "draft",
        updatedAt: "2026-08-07T08:01:00.000Z",
      },
      kind: "ready",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("queues a correction-only candidate with the opaque composite ETag", async () => {
    vi.mocked(workflow.requestRegeneration).mockResolvedValue({
      kind: "requested",
      view: {
        job,
        revision: { correctionRevision: 1, draftRevision: 7 },
      },
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-image-regenerate-0001",
        "if-match": '"dc:MTo3"',
        "x-request-id": "correction-image-regenerate-http",
      },
      method: "POST",
      payload: { reason: "这张模特图不合适，重新生成。" },
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/regenerate",
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.etag).toBe('"dc:MTo3"');
    expect(response.json()).toMatchObject({
      candidate: null,
      correctionRevision: 1,
      draftRevision: 7,
      job: { jobId: job.jobId, status: "queued" },
    });
    expect(workflow.requestRegeneration).toHaveBeenCalledWith({
      actorId: principal.accountId,
      correctionId: "correction-images",
      expectedRevision: { correctionRevision: 1, draftRevision: 7 },
      idempotencyKey: "correction-image-regenerate-0001",
      imageSlot: "required_primary",
      reason: "这张模特图不合适，重新生成。",
      requestId: "correction-image-regenerate-http",
    });
  });

  it("recovers an idempotent regeneration before revision rejection but returns the live ETag", async () => {
    vi.mocked(workflow.requestRegeneration).mockResolvedValue({
      kind: "existing",
      view: {
        job: { ...job, completedAssetId: "asset-generated", status: "completed" },
        revision: { correctionRevision: 1, draftRevision: 7 },
      },
    });
    vi.mocked(jobs.getCurrent).mockResolvedValue({
      job: { ...job, completedAssetId: "asset-generated", status: "completed" },
      revision: { correctionRevision: 1, draftRevision: 8 },
    });
    vi.mocked(images.listDraftAssets).mockResolvedValue({
      draftId: "draft-images",
      draftRevision: 8,
      fortuneDate: "2026-08-08",
      items: [],
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-image-regenerate-0001",
        "if-match": '"dc:MTo3"',
        "x-request-id": "correction-image-replay-http",
      },
      method: "POST",
      payload: { reason: "这张模特图不合适，重新生成。" },
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/regenerate",
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.etag).toBe('"dc:MTo4"');
    expect(response.json()).toMatchObject({ draftRevision: 8, job: { status: "completed" } });
  });

  it("selects a same-slot candidate without applying or publishing the correction", async () => {
    vi.mocked(workflow.selectDraftCandidate).mockResolvedValue({
      assetId: "asset-generated",
      correctionRevision: 1,
      draftRevision: 9,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-generated/preview",
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-image-select-0001",
        "if-match": '"dc:MTo3"',
        "x-request-id": "correction-image-select-http",
      },
      method: "POST",
      payload: { assetId: "asset-generated", reason: "采用这张候选图。" },
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/select",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:MTo5"');
    expect(response.json()).toMatchObject({
      assetId: "asset-generated",
      correctionRevision: 1,
      draftRevision: 9,
      previewUrl: "/admin/api/v1/image-assets/asset-generated/preview",
      workingCopy: { correctionId: "correction-images", draftId: "draft-images" },
    });
    expect(workflow.selectDraftCandidate).toHaveBeenCalledOnce();
    expect("apply" in workflow).toBe(false);
  });

  it("returns the authoritative current selection when an older idempotent action is replayed", async () => {
    vi.mocked(workflow.selectDraftCandidate).mockResolvedValue({
      assetId: "asset-old-replay",
      correctionRevision: 1,
      draftRevision: 7,
      kind: "existing",
      previewUrl: "/admin/api/v1/image-assets/asset-old-replay/preview",
    });
    vi.mocked(images.listDraftAssets).mockResolvedValue({
      draftId: "draft-images",
      draftRevision: 9,
      fortuneDate: "2026-08-08",
      items: [
        {
          asset: { assetId: "asset-current" },
          imageSlot: "required_primary",
          previewUrl: "/admin/api/v1/image-assets/asset-current/preview",
          selectedForSlot: true,
        },
      ],
    } as never);

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-image-select-old-replay",
        "if-match": '"dc:MTo3"',
        "x-request-id": "correction-image-select-old-replay-http",
      },
      method: "POST",
      payload: { assetId: "asset-old-replay", reason: "重放原选择请求。" },
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/select",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:MTo5"');
    expect(response.json()).toMatchObject({
      assetId: "asset-current",
      draftRevision: 9,
      previewUrl: "/admin/api/v1/image-assets/asset-current/preview",
    });
  });

  it("exposes the safe reusable image action", async () => {
    vi.mocked(workflow.listReusable).mockResolvedValue({
      items: [
        {
          assetId: "asset-library",
          colorCodes: ["silver", "white"],
          imageSlot: "required_primary",
          previewUrl: "/admin/api/v1/image-assets/asset-library/preview",
          sourceContentVersion: "content-library",
          sourceFortuneDate: "2026-08-01",
        },
      ],
      kind: "ready",
    });

    const response = await app.inject({
      headers: {
        cookie: protectedHeaders.cookie,
        "x-request-id": "correction-image-library-http",
      },
      method: "GET",
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/library",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      copyEnabled: true,
      items: [expect.objectContaining({ assetId: "asset-library" })],
    });
  });

  it("copies a safe library asset and returns the authoritative working copy", async () => {
    vi.mocked(workflow.selectReusable).mockResolvedValue({
      assetId: "asset-library",
      correctionRevision: 1,
      draftRevision: 9,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-library/preview",
    });

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-image-library-select",
        "if-match": '"dc:MTo3"',
        "x-request-id": "correction-image-library-select-http",
      },
      method: "POST",
      payload: {
        assetId: "asset-library",
        reason: "复用已检查搭配。",
        sourceContentVersion: "content-library",
      },
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/library/select",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"dc:MTo5"');
    expect(response.json()).toMatchObject({
      assetId: "asset-library",
      previewUrl: "/admin/api/v1/image-assets/asset-library/preview",
      workingCopy: { correctionId: "correction-images", draftRevision: 9 },
    });
    expect(workflow.selectReusable).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-library",
        sourceContentVersion: "content-library",
      }),
    );
  });

  it("uploads and replaces a correction image in one high-level request", async () => {
    vi.mocked(workflow.uploadAndSelect).mockResolvedValue({
      assetId: "asset-uploaded",
      correctionRevision: 1,
      draftRevision: 9,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-uploaded/preview",
    });
    const body = correctionUploadMultipart();

    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "content-type": `multipart/form-data; boundary=${body.boundary}`,
        "idempotency-key": "correction-image-upload-http",
        "if-match": '"dc:MTo3"',
        "x-request-id": "correction-image-upload-http",
      },
      method: "POST",
      payload: body.payload,
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/upload",
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBe('"dc:MTo5"');
    expect(response.json()).toMatchObject({
      assetId: "asset-uploaded",
      workingCopy: { correctionId: "correction-images", draftRevision: 9 },
    });
    expect(workflow.uploadAndSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: Buffer.from("PNG-FIXTURE"),
        correctionId: "correction-images",
        imageSlot: "required_primary",
        metadata: expect.objectContaining({
          aiLabelStatus: "not_applicable",
          altText: "白色通勤模特穿搭",
          generationMethod: "owned_upload",
          sourceType: "licensed",
        }),
        reason: "手动上传更合适的模特图。",
      }),
    );
    expect(workflow.selectDraftCandidate).not.toHaveBeenCalled();
  });

  it("rejects draft-only ETags at the correction image boundary", async () => {
    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "idempotency-key": "correction-image-regenerate-0002",
        "if-match": '"draft:7"',
        "x-request-id": "correction-image-invalid-etag",
      },
      method: "POST",
      payload: { reason: "重生成。" },
      url: "/admin/api/v1/day-corrections/correction-images/images/required_primary/regenerate",
    });

    expect(response.statusCode).toBe(400);
    expect(workflow.requestRegeneration).not.toHaveBeenCalled();
  });
});
