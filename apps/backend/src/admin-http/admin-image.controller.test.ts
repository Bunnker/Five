import "reflect-metadata";

import { Module } from "@nestjs/common";
import type { components } from "@five/api-contract";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService, SessionPrincipal } from "../admin-auth/admin-auth.service";
import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { AdminImageController } from "./admin-image.controller";
import { ADMIN_AUTH_SERVICE, DAILY_IMAGE_ASSET_SERVICE } from "./admin-http.providers";
import { installAdminImageMultipart } from "./admin-image-multipart";
import { installAdminRequestProtection } from "./admin-request-protection";

const principal: SessionPrincipal = {
  absoluteExpiresAt: new Date("2026-08-02T20:00:00.000Z"),
  accountId: "admin-1",
  credentialRevision: 4,
  csrfToken: "c".repeat(43),
  idleExpiresAt: new Date("2026-08-02T08:30:00.000Z"),
  issuedAt: new Date("2026-08-02T08:00:00.000Z"),
  sessionTokenDigest: Buffer.alloc(32, 2),
  username: "operator",
};

const authService = {
  authenticateSession: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;
const imageService = {
  getDailyImageSet: vi.fn(),
  listDraftAssets: vi.fn(),
  readAssetBinary: vi.fn(),
  reviewDraftAsset: vi.fn(),
  selectDraftAssetForSlot: vi.fn(),
  uploadDraftAsset: vi.fn(),
  withdrawVersionAsset: vi.fn(),
} as unknown as DailyImageAssetService;

const metadata: components["schemas"]["ImageAssetUploadMetadata"] = {
  aiLabelStatus: "not_applicable",
  altText: "黑色通勤搭配",
  declaredModel: null,
  generatedAt: null,
  generationMethod: "licensed_upload",
  promptVersion: null,
  reproductionReference: null,
  rightsRecordIds: ["rights-1"],
  sourceMaterialReferences: ["license:record-1"],
  sourceType: "licensed",
};
const asset: components["schemas"]["AdminImageAsset"] = {
  ...metadata,
  assetId: "asset-1",
  fileUrl: null,
  height: 1,
  manualReview: null,
  mediaType: "image/png",
  reviewStatus: "pending",
  rightsStatus: "pending",
  sha256: "a".repeat(64),
  width: 1,
};
const uploadResult: components["schemas"]["DraftImageAssetResult"] = {
  asset,
  draftId: "draft-1",
  draftRevision: 2,
  fortuneDate: "2026-08-03",
  imageSlot: "required_primary",
  previewUrl: "/admin/api/v1/image-assets/asset-1/preview",
  reviewLocked: false,
  selectedForSlot: true,
};
const passedReview: components["schemas"]["ImageAssetReviewRequest"] = {
  aiLabelCompliance: "passed",
  aiLabelStatus: "not_applicable",
  colorAndCopyConsistency: "passed",
  decision: "approved",
  garmentAndPersonIntegrity: "passed",
  mobileAndWechatPreview: "passed",
  notes: "人工检查通过。",
  rightsAndIdentityRisk: "passed",
  rightsStatus: "cleared",
  scenarioAndImitability: "passed",
};

const protectedHeaders = {
  cookie: `five_admin_session=${"s".repeat(43)}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": "c".repeat(43),
};

function multipart(order: "file-first" | "metadata-first") {
  const boundary = "five-image-boundary-0001";
  const file = [
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="file"; filename="look.png"\r\n',
    "Content-Type: image/png\r\n\r\n",
    "PNG-BYTES",
    "\r\n",
  ].join("");
  const metadataPart = [
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="metadata"\r\n',
    "\r\n",
    JSON.stringify(metadata),
    "\r\n",
  ].join("");
  const slotPart = [
    `--${boundary}\r\n`,
    'Content-Disposition: form-data; name="imageSlot"\r\n',
    "\r\n",
    "required_primary",
    "\r\n",
  ].join("");
  return {
    boundary,
    payload: Buffer.from(
      `${
        order === "file-first" ? file + slotPart + metadataPart : metadataPart + slotPart + file
      }--${boundary}--\r\n`,
    ),
  };
}

function multipartParts(
  parts: readonly {
    readonly bytes: Buffer;
    readonly contentType?: string;
    readonly fieldname: string;
    readonly filename?: string;
  }[],
  boundary = "five-image-boundary-custom",
) {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${part.fieldname}"${
          part.filename === undefined ? "" : `; filename="${part.filename}"`
        }\r\n`,
      ),
    );
    if (part.contentType !== undefined) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }
    chunks.push(Buffer.from("\r\n"), part.bytes, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, payload: Buffer.concat(chunks) };
}

function imageUploadHeaders(boundary: string, requestId: string) {
  return {
    ...protectedHeaders,
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "idempotency-key": `upload-${requestId}`,
    "if-match": '"draft:1"',
    "x-request-id": requestId,
  };
}

@Module({
  controllers: [AdminImageController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: DAILY_IMAGE_ASSET_SERVICE, useValue: imageService },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminImageHttpTestModule {}

describe("admin image HTTP boundary", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminImageHttpTestModule,
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
  });

  afterAll(async () => app.close());

  it.each(["file-first", "metadata-first"] as const)(
    "accepts exactly one file and metadata part in %s order",
    async (order) => {
      vi.mocked(imageService.uploadDraftAsset).mockResolvedValue({
        kind: "uploaded",
        result: uploadResult,
      });
      const body = multipart(order);
      const response = await app.inject({
        headers: {
          ...protectedHeaders,
          "content-type": `multipart/form-data; boundary=${body.boundary}`,
          "idempotency-key": "upload-image-http-0001",
          "if-match": '"draft:1"',
          "x-request-id": `request-${order}`,
        },
        method: "POST",
        payload: body.payload,
        url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
      });

      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers.etag).toBe('"draft:2"');
      expect(response.json()).toEqual(uploadResult);
      expect(imageService.uploadDraftAsset).toHaveBeenCalledWith({
        actorId: "admin-1",
        bytes: Buffer.from("PNG-BYTES"),
        declaredMediaType: "image/png",
        draftId: "draft-1",
        expectedDraftRevision: 1,
        idempotencyKey: "upload-image-http-0001",
        imageSlot: "required_primary",
        metadata,
        requestId: `request-${order}`,
      });
    },
  );

  it("rejects a new multipart upload when imageSlot is missing", async () => {
    const body = multipartParts([
      { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
      {
        bytes: Buffer.from("PNG"),
        contentType: "image/png",
        fieldname: "file",
        filename: "look.png",
      },
    ]);
    const response = await app.inject({
      headers: imageUploadHeaders(body.boundary, "request-missing-image-slot"),
      method: "POST",
      payload: body.payload,
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "IMAGE_FILE_INVALID" } });
    expect(imageService.uploadDraftAsset).not.toHaveBeenCalled();
  });

  it("selects one existing candidate for a named slot with the draft ETag", async () => {
    vi.mocked(imageService.selectDraftAssetForSlot).mockResolvedValue({
      kind: "selected",
      result: uploadResult,
    });
    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "content-type": "application/json",
        "idempotency-key": "select-image-http-0001",
        "if-match": '"draft:1"',
        "x-request-id": "request-select-image",
      },
      method: "POST",
      payload: { imageSlot: "required_primary", reason: "切换为人工确认的候选。" },
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets/asset-1/selection",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers.etag).toBe('"draft:2"');
    expect(imageService.selectDraftAssetForSlot).toHaveBeenCalledWith({
      actorId: "admin-1",
      assetId: "asset-1",
      draftId: "draft-1",
      expectedDraftRevision: 1,
      idempotencyKey: "select-image-http-0001",
      imageSlot: "required_primary",
      reason: "切换为人工确认的候选。",
      requestId: "request-select-image",
    });
  });

  it("rejects an unauthenticated multipart write before parsing its invalid body", async () => {
    vi.mocked(authService.authenticateSession).mockResolvedValue(null);
    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        cookie: `five_admin_session=${"x".repeat(43)}`,
        "content-type": "multipart/form-data; boundary=broken",
        "x-request-id": "request-auth-before-multipart",
      },
      method: "POST",
      payload: Buffer.from("not multipart"),
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(imageService.uploadDraftAsset).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a duplicate metadata field",
      parts: [
        { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
        { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
        {
          bytes: Buffer.from("PNG"),
          contentType: "image/png",
          fieldname: "file",
          filename: "look.png",
        },
      ],
    },
    {
      name: "an extra part",
      parts: [
        { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
        {
          bytes: Buffer.from("PNG"),
          contentType: "image/png",
          fieldname: "file",
          filename: "look.png",
        },
        { bytes: Buffer.from("unexpected"), fieldname: "extra" },
      ],
    },
    {
      name: "two file parts",
      parts: [
        { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
        {
          bytes: Buffer.from("PNG-1"),
          contentType: "image/png",
          fieldname: "file",
          filename: "one.png",
        },
        {
          bytes: Buffer.from("PNG-2"),
          contentType: "image/png",
          fieldname: "file",
          filename: "two.png",
        },
      ],
    },
  ])("rejects $name instead of parsing past multipart limits", async ({ name, parts }) => {
    const body = multipartParts(parts, `five-${name.replaceAll(" ", "-")}`);
    const response = await app.inject({
      headers: imageUploadHeaders(body.boundary, `request-invalid-parts-${name.length}`),
      method: "POST",
      payload: body.payload,
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "IMAGE_FILE_INVALID" } });
    expect(imageService.uploadDraftAsset).not.toHaveBeenCalled();
  });

  it("rejects a metadata field larger than 64KiB", async () => {
    const oversized = JSON.stringify({ ...metadata, altText: "a".repeat(70 * 1024) });
    const body = multipartParts([
      { bytes: Buffer.from(oversized), fieldname: "metadata" },
      {
        bytes: Buffer.from("PNG"),
        contentType: "image/png",
        fieldname: "file",
        filename: "look.png",
      },
    ]);
    const response = await app.inject({
      headers: imageUploadHeaders(body.boundary, "request-oversized-metadata"),
      method: "POST",
      payload: body.payload,
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "IMAGE_FILE_INVALID" } });
    expect(imageService.uploadDraftAsset).not.toHaveBeenCalled();
  });

  it("accepts a multipart image above 1MiB while remaining below the 8MiB contract limit", async () => {
    vi.mocked(imageService.uploadDraftAsset).mockResolvedValue({
      kind: "uploaded",
      result: uploadResult,
    });
    const largeBytes = Buffer.alloc(1_100_000, 0x61);
    const body = multipartParts([
      { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
      { bytes: Buffer.from("required_primary"), fieldname: "imageSlot" },
      { bytes: largeBytes, contentType: "image/png", fieldname: "file", filename: "large.png" },
    ]);
    const response = await app.inject({
      headers: imageUploadHeaders(body.boundary, "request-large-valid-image"),
      method: "POST",
      payload: body.payload,
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(imageService.uploadDraftAsset).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: largeBytes }),
    );
  });

  it("maps the multipart 8MiB file limit without invoking the image service", async () => {
    const body = multipartParts([
      { bytes: Buffer.from(JSON.stringify(metadata)), fieldname: "metadata" },
      {
        bytes: Buffer.alloc(8 * 1024 * 1024 + 1, 0x61),
        contentType: "image/png",
        fieldname: "file",
        filename: "too-large.png",
      },
    ]);
    const response = await app.inject({
      headers: imageUploadHeaders(body.boundary, "request-file-over-eight-mib"),
      method: "POST",
      payload: body.payload,
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets",
    });

    expect(response.statusCode, response.body).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: "IMAGE_FILE_TOO_LARGE" } });
    expect(imageService.uploadDraftAsset).not.toHaveBeenCalled();
  });

  it("returns a stable conflict when a copied candidate review is locked", async () => {
    vi.mocked(imageService.reviewDraftAsset).mockResolvedValue({ kind: "review_locked" });
    const response = await app.inject({
      headers: {
        ...protectedHeaders,
        "content-type": "application/json",
        "idempotency-key": "review-locked-image-http-0001",
        "if-match": '"draft:1"',
        "x-request-id": "request-review-locked-image",
      },
      method: "POST",
      payload: passedReview,
      url: "/admin/api/v1/daily-content-drafts/draft-1/image-assets/asset-1/review",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: "复制素材的审核记录已冻结；如需修改，请上传新图片。",
      },
    });
  });

  it("streams a private preview with the real media type and defensive headers", async () => {
    vi.mocked(imageService.readAssetBinary).mockResolvedValue({
      bytes: Buffer.from("private-image"),
      mediaType: "image/png",
    });

    const response = await app.inject({
      headers: {
        cookie: protectedHeaders.cookie,
        "x-request-id": "request-private-preview",
      },
      method: "GET",
      url: "/admin/api/v1/image-assets/asset-1/preview",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    });
    expect(response.rawPayload).toEqual(Buffer.from("private-image"));
  });

  it("sends preview 401 and 404 envelopes without leaving a manual reply open", async () => {
    vi.mocked(authService.authenticateSession).mockResolvedValueOnce(null);
    const unauthenticated = await app.inject({
      headers: {
        cookie: protectedHeaders.cookie,
        "x-request-id": "request-preview-unauthenticated",
      },
      method: "GET",
      url: "/admin/api/v1/image-assets/asset-1/preview",
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });

    vi.mocked(imageService.readAssetBinary).mockResolvedValue(null);
    const missing = await app.inject({
      headers: { cookie: protectedHeaders.cookie, "x-request-id": "request-preview-missing" },
      method: "GET",
      url: "/admin/api/v1/image-assets/asset-missing/preview",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
  });

  it("maps active-version drift precisely and rejects a whitespace withdrawal reason", async () => {
    vi.mocked(imageService.withdrawVersionAsset).mockResolvedValue({
      kind: "active_version_mismatch",
    });
    const headers = {
      ...protectedHeaders,
      "content-type": "application/json",
      "idempotency-key": "withdraw-image-http-0001",
      "if-match": '"lifecycle:3"',
      "x-request-id": "request-withdraw-active-drift",
    };
    const drift = await app.inject({
      headers,
      method: "POST",
      payload: { expectedActiveContentVersion: "content-other", reason: "版权材料撤销。" },
      url: "/admin/api/v1/daily-content-versions/content-1/image-assets/asset-1/withdraw",
    });
    expect(drift.statusCode).toBe(409);
    expect(drift.json()).toMatchObject({ error: { code: "ACTIVE_CONTENT_VERSION_CHANGED" } });

    vi.mocked(imageService.withdrawVersionAsset).mockResolvedValue({
      kind: "active_version_asset_reference",
    });
    const shared = await app.inject({
      headers: { ...headers, "idempotency-key": "withdraw-image-http-shared-0001" },
      method: "POST",
      payload: { expectedActiveContentVersion: "content-active", reason: "授权已撤销。" },
      url: "/admin/api/v1/daily-content-versions/content-1/image-assets/asset-1/withdraw",
    });
    expect(shared.statusCode).toBe(409);
    expect(shared.json()).toMatchObject({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: "同一素材仍由当前生效版本引用，请在当前生效版本下线。",
      },
    });

    vi.mocked(imageService.withdrawVersionAsset).mockClear();
    const blank = await app.inject({
      headers: { ...headers, "idempotency-key": "withdraw-image-http-0002" },
      method: "POST",
      payload: { expectedActiveContentVersion: "content-other", reason: "   " },
      url: "/admin/api/v1/daily-content-versions/content-1/image-assets/asset-1/withdraw",
    });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(imageService.withdrawVersionAsset).not.toHaveBeenCalled();
  });
});
