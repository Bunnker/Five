import type { components } from "@five/api-contract";
import {
  isImageAssetReviewRequest,
  isImageAssetUploadMetadata,
  isWithdrawImageAssetRequest,
} from "@five/api-contract/runtime";
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";

import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import {
  isDailyImageSlot,
  isIdempotencyKey,
  isOpaqueAdminId,
  isSelectDraftImageAssetRequest,
  parseStrongRevisionEtag,
} from "./admin-content.validation";
import { adminErrorEnvelope, type AdminHttpReply } from "./admin-http";
import { DAILY_IMAGE_ASSET_SERVICE } from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

type AdminDailyImageSet = components["schemas"]["AdminDailyImageSet"];
type DraftImageAssetList = components["schemas"]["DraftImageAssetList"];
type DraftImageAssetResult = components["schemas"]["DraftImageAssetResult"];
type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
type ImageAssetWithdrawalResult = components["schemas"]["ImageAssetWithdrawalResult"];

interface MultipartFilePart {
  readonly fieldname: string;
  readonly mimetype: string;
  readonly type: "file";
  toBuffer(): Promise<Buffer>;
}

interface MultipartFieldPart {
  readonly fieldname: string;
  readonly mimetype?: string;
  readonly type: "field";
  readonly value: unknown;
  readonly valueTruncated?: boolean;
}

interface AdminMultipartRequest extends AdminProtectionRequest {
  parts(): AsyncIterable<MultipartFieldPart | MultipartFilePart>;
}

interface BinaryReply extends AdminHttpReply {
  send(payload: Buffer | ErrorEnvelope): unknown;
  type(contentType: string): BinaryReply;
}

function requestId(request: AdminProtectionRequest): string {
  return request.adminRequestId ?? "admin-request-unavailable";
}

function fail(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
  status: number,
  code: ErrorCode,
  message: string,
): ErrorEnvelope {
  reply.status(status);
  return adminErrorEnvelope(code, message, requestId(request));
}

function revisionMismatch(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
  resource: "draft" | "lifecycle",
  currentRevision: number,
): ErrorEnvelope {
  reply.header("ETag", `"${resource}:${currentRevision}"`);
  return fail(request, reply, 412, "REVISION_MISMATCH", "资源修订号已变化，请刷新后重试。");
}

function singleHeader(request: AdminProtectionRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function multipartErrorCode(error: unknown): string | null {
  const code =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown }).code
      : null;
  return typeof code === "string" ? code : null;
}

@Controller("admin/api/v1")
export class AdminImageController {
  constructor(
    @Inject(DAILY_IMAGE_ASSET_SERVICE)
    private readonly images: DailyImageAssetService,
  ) {}

  @Get("daily-content-drafts/:draftId/image-assets")
  async listDraftAssets(
    @Param("draftId") draftId: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DraftImageAssetList | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return fail(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    const result = isOpaqueAdminId(draftId) ? await this.images.listDraftAssets(draftId) : null;
    if (result === null) {
      return fail(request, reply, 404, "RESOURCE_NOT_FOUND", "草稿不存在。");
    }
    reply.header("ETag", `"draft:${result.draftRevision}"`);
    return result;
  }

  @Post("daily-content-drafts/:draftId/image-assets")
  async uploadDraftAsset(
    @Param("draftId") draftId: string,
    @Req() request: AdminMultipartRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DraftImageAssetResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return fail(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    const ifMatch = singleHeader(request, "if-match");
    if (ifMatch === undefined) {
      return fail(request, reply, 428, "PRECONDITION_REQUIRED", "缺少当前草稿修订号。");
    }
    const revision = parseStrongRevisionEtag(ifMatch, "draft");
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (revision === null || !isOpaqueAdminId(draftId) || !isIdempotencyKey(idempotencyKey)) {
      return fail(request, reply, 400, "INVALID_ARGUMENT", "图片上传参数无效。");
    }

    let bytes: Buffer | null = null;
    let mediaType: string | null = null;
    let metadata: unknown = null;
    let imageSlot: unknown = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file" && part.fieldname === "file" && bytes === null) {
          bytes = await part.toBuffer();
          mediaType = part.mimetype;
        } else if (
          part.type === "field" &&
          part.fieldname === "metadata" &&
          metadata === null &&
          part.valueTruncated !== true &&
          (part.mimetype === undefined ||
            part.mimetype === "text/plain" ||
            part.mimetype.startsWith("application/json"))
        ) {
          metadata =
            typeof part.value === "string" ? (JSON.parse(part.value) as unknown) : part.value;
        } else if (
          part.type === "field" &&
          part.fieldname === "imageSlot" &&
          imageSlot === null &&
          part.valueTruncated !== true &&
          typeof part.value === "string"
        ) {
          imageSlot = part.value;
        } else {
          return fail(request, reply, 400, "IMAGE_FILE_INVALID", "multipart 结构无效。");
        }
      }
    } catch (error) {
      const code = multipartErrorCode(error);
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return fail(request, reply, 413, "IMAGE_FILE_TOO_LARGE", "图片超过 8MiB 限制。");
      }
      return fail(request, reply, 400, "IMAGE_FILE_INVALID", "图片或 multipart 结构无效。");
    }
    if (
      bytes === null ||
      mediaType === null ||
      !isImageAssetUploadMetadata(metadata) ||
      !isDailyImageSlot(imageSlot)
    ) {
      return fail(request, reply, 400, "IMAGE_FILE_INVALID", "图片文件、槽位或元数据缺失。");
    }
    const result = await this.images.uploadDraftAsset({
      actorId: request.adminPrincipal.accountId,
      bytes,
      declaredMediaType: mediaType,
      draftId,
      expectedDraftRevision: revision,
      idempotencyKey,
      imageSlot,
      metadata,
      requestId: requestId(request),
    });
    if (result.kind === "uploaded" || result.kind === "existing") {
      reply.header("ETag", `"draft:${result.result.draftRevision}"`);
      return result.result;
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "draft", result.currentRevision);
    }
    if (result.kind === "idempotency_conflict") {
      return fail(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一请求。");
    }
    if (result.kind === "not_found") {
      return fail(request, reply, 404, "RESOURCE_NOT_FOUND", "草稿不存在。");
    }
    if (result.kind === "invalid_state") {
      return fail(request, reply, 409, "INVALID_STATE_TRANSITION", "草稿已冻结。");
    }
    if (result.kind === "file_error") {
      if (result.code === "too_large") {
        return fail(request, reply, 413, "IMAGE_FILE_TOO_LARGE", "图片超过 8MiB 限制。");
      }
      if (result.code === "unsupported_media_type" || result.code === "media_type_mismatch") {
        return fail(request, reply, 415, "IMAGE_MEDIA_TYPE_UNSUPPORTED", "图片格式不受支持。");
      }
      return fail(request, reply, 400, "IMAGE_FILE_INVALID", "图片文件损坏或无效。");
    }
    return fail(request, reply, 422, "IMAGE_REVIEW_INCOMPLETE", "图片来源或权利元数据不完整。");
  }

  @Post("daily-content-drafts/:draftId/image-assets/:assetId/selection")
  @HttpCode(200)
  async selectDraftAssetForSlot(
    @Param("draftId") draftId: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DraftImageAssetResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return fail(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    const ifMatch = singleHeader(request, "if-match");
    if (ifMatch === undefined) {
      return fail(request, reply, 428, "PRECONDITION_REQUIRED", "缺少当前草稿修订号。");
    }
    const revision = parseStrongRevisionEtag(ifMatch, "draft");
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (
      revision === null ||
      !isOpaqueAdminId(draftId) ||
      !isOpaqueAdminId(assetId) ||
      !isIdempotencyKey(idempotencyKey) ||
      !isSelectDraftImageAssetRequest(body)
    ) {
      return fail(request, reply, 400, "INVALID_ARGUMENT", "图片槽位选择参数无效。");
    }
    const result = await this.images.selectDraftAssetForSlot({
      actorId: request.adminPrincipal.accountId,
      assetId,
      draftId,
      expectedDraftRevision: revision,
      idempotencyKey,
      imageSlot: body.imageSlot,
      reason: body.reason,
      requestId: requestId(request),
    });
    if (result.kind === "selected" || result.kind === "existing") {
      reply.header("ETag", `"draft:${result.result.draftRevision}"`);
      return result.result;
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "draft", result.currentRevision);
    }
    if (result.kind === "idempotency_conflict") {
      return fail(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一请求。");
    }
    if (result.kind === "not_found") {
      return fail(request, reply, 404, "RESOURCE_NOT_FOUND", "图片候选或目标槽位不存在。");
    }
    if (result.kind === "invalid_state") {
      return fail(request, reply, 409, "INVALID_STATE_TRANSITION", "草稿已冻结。");
    }
    return fail(request, reply, 400, "INVALID_ARGUMENT", "图片槽位选择参数无效。");
  }

  @Post("daily-content-drafts/:draftId/image-assets/:assetId/review")
  @HttpCode(200)
  async reviewDraftAsset(
    @Param("draftId") draftId: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DraftImageAssetResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return fail(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    const ifMatch = singleHeader(request, "if-match");
    if (ifMatch === undefined) {
      return fail(request, reply, 428, "PRECONDITION_REQUIRED", "缺少当前草稿修订号。");
    }
    const revision = parseStrongRevisionEtag(ifMatch, "draft");
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (
      revision === null ||
      !isOpaqueAdminId(draftId) ||
      !isOpaqueAdminId(assetId) ||
      !isIdempotencyKey(idempotencyKey) ||
      !isImageAssetReviewRequest(body)
    ) {
      return fail(request, reply, 400, "INVALID_ARGUMENT", "图片审核参数无效。");
    }
    const result = await this.images.reviewDraftAsset({
      actorId: request.adminPrincipal.accountId,
      assetId,
      draftId,
      expectedDraftRevision: revision,
      idempotencyKey,
      requestId: requestId(request),
      review: body,
    });
    if (result.kind === "reviewed" || result.kind === "existing") {
      reply.header("ETag", `"draft:${result.result.draftRevision}"`);
      return result.result;
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "draft", result.currentRevision);
    }
    if (result.kind === "idempotency_conflict") {
      return fail(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一请求。");
    }
    if (result.kind === "not_found") {
      return fail(request, reply, 404, "RESOURCE_NOT_FOUND", "图片候选不存在。");
    }
    if (result.kind === "invalid_state") {
      return fail(request, reply, 409, "INVALID_STATE_TRANSITION", "草稿已冻结。");
    }
    if (result.kind === "review_locked") {
      return fail(
        request,
        reply,
        409,
        "INVALID_STATE_TRANSITION",
        "复制素材的审核记录已冻结；如需修改，请上传新图片。",
      );
    }
    return fail(request, reply, 422, "IMAGE_REVIEW_INCOMPLETE", "人工检查条件未满足。");
  }

  @Get("image-assets/:assetId/preview")
  async previewAsset(
    @Param("assetId") assetId: string,
    @Req() request: AdminProtectionRequest,
    @Res() reply: BinaryReply,
  ): Promise<void> {
    if (request.adminPrincipal === undefined) {
      reply.status(401);
      reply.send(
        adminErrorEnvelope("UNAUTHENTICATED", "后台会话不存在或已失效。", requestId(request)),
      );
      return;
    }
    const binary = isOpaqueAdminId(assetId) ? await this.images.readAssetBinary(assetId) : null;
    if (binary === null) {
      reply.status(404);
      reply.send(adminErrorEnvelope("RESOURCE_NOT_FOUND", "图片不存在。", requestId(request)));
      return;
    }
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(binary.mediaType).send(binary.bytes);
  }

  @Get("daily-content-versions/:contentVersion/daily-image-set")
  async getDailyImageSet(
    @Param("contentVersion") contentVersion: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminDailyImageSet | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return fail(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    const imageSet = isOpaqueAdminId(contentVersion)
      ? await this.images.getDailyImageSet(contentVersion)
      : null;
    if (imageSet === null) {
      return fail(request, reply, 404, "RESOURCE_NOT_FOUND", "每日图片组不存在。");
    }
    reply.header("ETag", `"lifecycle:${imageSet.lifecycleRevision}"`);
    return imageSet;
  }

  @Post("daily-content-versions/:contentVersion/image-assets/:assetId/withdraw")
  @HttpCode(200)
  async withdrawAsset(
    @Param("contentVersion") contentVersion: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<ImageAssetWithdrawalResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return fail(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    const ifMatch = singleHeader(request, "if-match");
    if (ifMatch === undefined) {
      return fail(request, reply, 428, "PRECONDITION_REQUIRED", "缺少生命周期修订号。");
    }
    const revision = parseStrongRevisionEtag(ifMatch, "lifecycle");
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (
      revision === null ||
      !isOpaqueAdminId(contentVersion) ||
      !isOpaqueAdminId(assetId) ||
      !isIdempotencyKey(idempotencyKey) ||
      !isWithdrawImageAssetRequest(body) ||
      body.reason.trim().length === 0
    ) {
      return fail(request, reply, 400, "INVALID_ARGUMENT", "单图下线参数无效。");
    }
    const result = await this.images.withdrawVersionAsset({
      actorId: request.adminPrincipal.accountId,
      assetId,
      contentVersion,
      expectedActiveContentVersion: body.expectedActiveContentVersion,
      expectedLifecycleRevision: revision,
      idempotencyKey,
      reason: body.reason,
      requestId: requestId(request),
    });
    if (result.kind === "withdrawn" || result.kind === "existing") {
      reply.header("ETag", `"lifecycle:${result.result.lifecycleRevision}"`);
      return result.result;
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "lifecycle", result.currentRevision);
    }
    if (result.kind === "withdrawal_blocked") {
      return fail(request, reply, 422, "IMAGE_WITHDRAWAL_BLOCKED", "必备图没有安全降级素材。");
    }
    if (result.kind === "not_found") {
      return fail(request, reply, 404, "RESOURCE_NOT_FOUND", "内容版本或图片不存在。");
    }
    if (result.kind === "idempotency_conflict") {
      return fail(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一请求。");
    }
    if (result.kind === "active_version_mismatch") {
      return fail(
        request,
        reply,
        409,
        "ACTIVE_CONTENT_VERSION_CHANGED",
        "当前生效内容版本已变化，请刷新后重试。",
      );
    }
    if (result.kind === "active_version_asset_reference") {
      return fail(
        request,
        reply,
        409,
        "INVALID_STATE_TRANSITION",
        "同一素材仍由当前生效版本引用，请在当前生效版本下线。",
      );
    }
    if (result.kind === "invalid_argument") {
      return fail(request, reply, 400, "INVALID_ARGUMENT", "单图下线参数无效。");
    }
    return fail(request, reply, 409, "INVALID_STATE_TRANSITION", "当前版本不允许下线该图片。");
  }
}
