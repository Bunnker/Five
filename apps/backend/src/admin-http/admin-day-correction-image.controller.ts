import type { components } from "@five/api-contract";
import { createHash } from "node:crypto";
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";

import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import type { DayCorrectionImageJobService } from "../day-correction/day-correction-image-job.service";
import type { DayCorrectionImageJobView } from "../day-correction/day-correction-image-job.store";
import type {
  DayCorrectionImageWorkflow,
  PrepareCorrectionImageResult,
} from "../day-correction/day-correction-image.workflow";
import type { DayCorrectionWorkflow } from "../day-correction/day-correction.workflow";
import {
  formatDayCorrectionEtag,
  isDailyImageSlot,
  isIdempotencyKey,
  isOpaqueAdminId,
  parseDayCorrectionEtag,
} from "./admin-content.validation";
import { mapDayCorrectionWorkingCopy } from "./admin-day-correction.controller";
import { adminErrorEnvelope, type AdminHttpReply } from "./admin-http";
import {
  DAILY_IMAGE_ASSET_SERVICE,
  DAY_CORRECTION_IMAGE_JOB_SERVICE,
  DAY_CORRECTION_IMAGE_WORKFLOW,
  DAY_CORRECTION_WORKFLOW,
} from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

type DayCorrectionImageLibraryPage = components["schemas"]["DayCorrectionImageLibraryPage"];
type DayCorrectionImageSelectionResult = components["schemas"]["DayCorrectionImageSelectionResult"];
type DayCorrectionImageStatus = components["schemas"]["DayCorrectionImageStatus"];
type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

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

function requestId(request: AdminProtectionRequest): string {
  return request.adminRequestId ?? "admin-request-unavailable";
}

function failure(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
  status: number,
  code: ErrorCode,
  message: string,
): ErrorEnvelope {
  reply.status(status);
  return adminErrorEnvelope(code, message, requestId(request));
}

function singleHeader(request: AdminProtectionRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function revisionPrecondition(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
):
  | {
      readonly kind: "valid";
      readonly revision: { readonly correctionRevision: number; readonly draftRevision: number };
    }
  | { readonly error: ErrorEnvelope; readonly kind: "invalid" } {
  const ifMatch = singleHeader(request, "if-match");
  if (ifMatch === undefined) {
    return {
      error: failure(
        request,
        reply,
        428,
        "PRECONDITION_REQUIRED",
        "缺少订正工作副本修订号，请刷新后重试。",
      ),
      kind: "invalid",
    };
  }
  const revision = parseDayCorrectionEtag(ifMatch);
  return revision === null
    ? {
        error: failure(
          request,
          reply,
          400,
          "INVALID_ARGUMENT",
          "订正工作副本修订号格式无效，请刷新后重试。",
        ),
        kind: "invalid",
      }
    : { kind: "valid", revision };
}

function validReasonBody(value: unknown): value is { readonly reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 1 &&
    typeof candidate.reason === "string" &&
    candidate.reason.trim().length > 0 &&
    Array.from(candidate.reason).length <= 500
  );
}

function validSelectBody(
  value: unknown,
): value is { readonly assetId: string; readonly reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).sort().join(",") === "assetId,reason" &&
    typeof candidate.assetId === "string" &&
    isOpaqueAdminId(candidate.assetId) &&
    typeof candidate.reason === "string" &&
    candidate.reason.trim().length > 0 &&
    Array.from(candidate.reason).length <= 500
  );
}

function validReuseBody(value: unknown): value is {
  readonly assetId: string;
  readonly reason: string;
  readonly sourceContentVersion: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).sort().join(",") === "assetId,reason,sourceContentVersion" &&
    isOpaqueAdminId(candidate.assetId) &&
    isOpaqueAdminId(candidate.sourceContentVersion) &&
    typeof candidate.reason === "string" &&
    candidate.reason.trim().length > 0 &&
    Array.from(candidate.reason).length <= 500
  );
}

function multipartErrorCode(error: unknown): string | null {
  const code =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown }).code
      : null;
  return typeof code === "string" ? code : null;
}

function ownedUploadMetadata(input: {
  readonly altText: string | null;
  readonly correctionId: string;
  readonly imageSlot: components["schemas"]["DailyImageSlot"];
  readonly requestId: string;
}): components["schemas"]["ImageAssetUploadMetadata"] {
  const trace = createHash("sha256")
    .update(`${input.correctionId}:${input.imageSlot}:${input.requestId}`)
    .digest("hex")
    .slice(0, 24);
  return {
    aiLabelStatus: "not_applicable",
    altText: input.altText ?? `${input.imageSlot} 手动上传模特穿搭`,
    declaredModel: null,
    generatedAt: null,
    generationMethod: "owned_upload",
    promptVersion: null,
    reproductionReference: null,
    rightsRecordIds: [`rights-pending-${trace}`],
    sourceMaterialReferences: [`owned-upload-pending-${trace}`],
    sourceType: "licensed",
  };
}

function revisionMismatch(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
  currentRevision: { readonly correctionRevision: number; readonly draftRevision: number },
): ErrorEnvelope {
  reply.header("ETag", formatDayCorrectionEtag(currentRevision));
  return failure(
    request,
    reply,
    412,
    "REVISION_MISMATCH",
    "这一天的图片或内容已经变化，请刷新后重试。",
  );
}

@Controller("admin/api/v1/day-corrections")
export class AdminDayCorrectionImageController {
  constructor(
    @Inject(DAY_CORRECTION_IMAGE_WORKFLOW)
    private readonly workflow: DayCorrectionImageWorkflow,
    @Inject(DAY_CORRECTION_IMAGE_JOB_SERVICE)
    private readonly jobs: DayCorrectionImageJobService,
    @Inject(DAILY_IMAGE_ASSET_SERVICE)
    private readonly images: DailyImageAssetService,
    @Inject(DAY_CORRECTION_WORKFLOW)
    private readonly corrections: DayCorrectionWorkflow,
  ) {}

  @Get(":correctionId/images/:imageSlot")
  async getStatus(
    @Param("correctionId") correctionId: string,
    @Param("imageSlot") imageSlot: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionImageStatus | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    if (!isOpaqueAdminId(correctionId) || !isDailyImageSlot(imageSlot)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "订正编号或图片槽位无效。");
    }
    const view = await this.jobs.getCurrent(correctionId, imageSlot);
    if (view === null) {
      return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正图片工作副本不存在。");
    }
    reply.header("ETag", formatDayCorrectionEtag(view.revision));
    return this.status(view);
  }

  @Post(":correctionId/images/:imageSlot/regenerate")
  @HttpCode(202)
  async regenerate(
    @Param("correctionId") correctionId: string,
    @Param("imageSlot") imageSlot: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionImageStatus | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    if (!isOpaqueAdminId(correctionId) || !isDailyImageSlot(imageSlot) || !validReasonBody(body)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "重生成图片参数无效。");
    }
    const precondition = revisionPrecondition(request, reply);
    if (precondition.kind === "invalid") return precondition.error;
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (!isIdempotencyKey(idempotencyKey)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "幂等键格式无效。");
    }
    const result = await this.workflow.requestRegeneration({
      actorId: request.adminPrincipal.accountId,
      correctionId,
      expectedRevision: precondition.revision,
      idempotencyKey,
      imageSlot,
      reason: body.reason,
      requestId: requestId(request),
    });
    if (result.kind === "requested" || result.kind === "existing") {
      const live =
        result.kind === "existing" ? await this.jobs.getCurrent(correctionId, imageSlot) : null;
      const view = live === null ? result.view : { ...result.view, revision: live.revision };
      reply.header("ETag", formatDayCorrectionEtag(view.revision));
      return this.status(view);
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, result.currentRevision);
    }
    if (result.kind === "not_found") {
      return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正工作副本不存在。");
    }
    if (result.kind === "idempotency_conflict") {
      return failure(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一项图片操作。");
    }
    if (result.kind === "invalid_state") {
      return failure(
        request,
        reply,
        409,
        "INVALID_STATE_TRANSITION",
        "订正已经开始生效，不能继续生成图片。",
      );
    }
    return failure(request, reply, 400, "INVALID_ARGUMENT", "重生成图片参数无效。");
  }

  @Post(":correctionId/images/:imageSlot/select")
  @HttpCode(200)
  async select(
    @Param("correctionId") correctionId: string,
    @Param("imageSlot") imageSlot: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionImageSelectionResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    if (!isOpaqueAdminId(correctionId) || !isDailyImageSlot(imageSlot) || !validSelectBody(body)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "选择图片参数无效。");
    }
    const precondition = revisionPrecondition(request, reply);
    if (precondition.kind === "invalid") return precondition.error;
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (!isIdempotencyKey(idempotencyKey)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "幂等键格式无效。");
    }
    const result = await this.workflow.selectDraftCandidate({
      actorId: request.adminPrincipal.accountId,
      assetId: body.assetId,
      correctionId,
      expectedRevision: precondition.revision,
      idempotencyKey,
      imageSlot,
      reason: body.reason,
      requestId: requestId(request),
    });
    return this.selectionResponse(result, correctionId, imageSlot, request, reply);
  }

  @Get(":correctionId/images/:imageSlot/library")
  async library(
    @Param("correctionId") correctionId: string,
    @Param("imageSlot") imageSlot: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionImageLibraryPage | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    if (!isOpaqueAdminId(correctionId) || !isDailyImageSlot(imageSlot)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "订正编号或图片槽位无效。");
    }
    const result = await this.workflow.listReusable({ correctionId, imageSlot });
    if (result.kind === "ready") {
      return {
        copyEnabled: true,
        items: result.items.map((item) => ({ ...item, colorCodes: [...item.colorCodes] })),
      };
    }
    if (result.kind === "not_found") {
      return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正工作副本不存在。");
    }
    if (result.kind === "invalid_state") {
      return failure(
        request,
        reply,
        409,
        "INVALID_STATE_TRANSITION",
        "订正已经开始生效，不能继续选择素材。",
      );
    }
    return failure(request, reply, 400, "INVALID_ARGUMENT", "搭配库查询参数无效。");
  }

  @Post(":correctionId/images/:imageSlot/library/select")
  @HttpCode(200)
  async selectReusable(
    @Param("correctionId") correctionId: string,
    @Param("imageSlot") imageSlot: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionImageSelectionResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    if (!isOpaqueAdminId(correctionId) || !isDailyImageSlot(imageSlot) || !validReuseBody(body)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "搭配库图片选择参数无效。");
    }
    const precondition = revisionPrecondition(request, reply);
    if (precondition.kind === "invalid") return precondition.error;
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (!isIdempotencyKey(idempotencyKey)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "幂等键格式无效。");
    }
    return this.selectionResponse(
      await this.workflow.selectReusable({
        actorId: request.adminPrincipal.accountId,
        assetId: body.assetId,
        correctionId,
        expectedRevision: precondition.revision,
        idempotencyKey,
        imageSlot,
        reason: body.reason,
        requestId: requestId(request),
        sourceContentVersion: body.sourceContentVersion,
      }),
      correctionId,
      imageSlot,
      request,
      reply,
    );
  }

  @Post(":correctionId/images/:imageSlot/upload")
  @HttpCode(201)
  async upload(
    @Param("correctionId") correctionId: string,
    @Param("imageSlot") imageSlot: string,
    @Req() request: AdminMultipartRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionImageSelectionResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效。");
    }
    if (!isOpaqueAdminId(correctionId) || !isDailyImageSlot(imageSlot)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "订正编号或图片槽位无效。");
    }
    const precondition = revisionPrecondition(request, reply);
    if (precondition.kind === "invalid") return precondition.error;
    const idempotencyKey = singleHeader(request, "idempotency-key");
    if (!isIdempotencyKey(idempotencyKey)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "幂等键格式无效。");
    }

    let bytes: Buffer | null = null;
    let mediaType: string | null = null;
    let altText: string | null = null;
    let reason: string | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file" && part.fieldname === "file" && bytes === null) {
          bytes = await part.toBuffer();
          mediaType = part.mimetype;
        } else if (
          part.type === "field" &&
          part.fieldname === "altText" &&
          altText === null &&
          part.valueTruncated !== true &&
          typeof part.value === "string"
        ) {
          altText = part.value;
        } else if (
          part.type === "field" &&
          part.fieldname === "reason" &&
          reason === null &&
          part.valueTruncated !== true &&
          typeof part.value === "string"
        ) {
          reason = part.value;
        } else {
          return failure(request, reply, 400, "IMAGE_FILE_INVALID", "multipart 结构无效。");
        }
      }
    } catch (error) {
      if (multipartErrorCode(error) === "FST_REQ_FILE_TOO_LARGE") {
        return failure(request, reply, 413, "IMAGE_FILE_TOO_LARGE", "图片超过 8MiB 限制。");
      }
      return failure(request, reply, 400, "IMAGE_FILE_INVALID", "图片或 multipart 结构无效。");
    }
    if (
      bytes === null ||
      mediaType === null ||
      reason === null ||
      reason.trim().length === 0 ||
      Array.from(reason).length > 500 ||
      (altText !== null && (altText.trim().length === 0 || Array.from(altText).length > 300))
    ) {
      return failure(request, reply, 400, "IMAGE_FILE_INVALID", "图片或订正原因缺失。");
    }
    return this.selectionResponse(
      await this.workflow.uploadAndSelect({
        actorId: request.adminPrincipal.accountId,
        bytes,
        correctionId,
        declaredMediaType: mediaType,
        expectedRevision: precondition.revision,
        idempotencyKey,
        imageSlot,
        metadata: ownedUploadMetadata({
          altText,
          correctionId,
          imageSlot,
          requestId: requestId(request),
        }),
        reason,
        requestId: requestId(request),
      }),
      correctionId,
      imageSlot,
      request,
      reply,
    );
  }

  private async status(view: DayCorrectionImageJobView): Promise<DayCorrectionImageStatus> {
    const completedAssetId = view.job?.completedAssetId;
    let candidate: DayCorrectionImageStatus["candidate"] = null;
    if (completedAssetId !== null && completedAssetId !== undefined && view.job !== null) {
      const assets = await this.images.listDraftAssets(view.job.draftId);
      const item = assets?.items.find(
        (entry) =>
          entry.asset.assetId === completedAssetId && entry.imageSlot === view.job?.imageSlot,
      );
      if (assets !== null && assets !== undefined && item !== undefined) {
        candidate = {
          asset: item.asset,
          draftId: assets.draftId,
          draftRevision: assets.draftRevision,
          fortuneDate: assets.fortuneDate,
          imageSlot: item.imageSlot,
          previewUrl: item.previewUrl,
          reviewLocked: item.reviewLocked,
          selectedForSlot: item.selectedForSlot,
        };
      }
    }
    return {
      candidate,
      correctionRevision: view.revision.correctionRevision,
      draftRevision: view.revision.draftRevision,
      job: view.job,
    };
  }

  private async selectionResponse(
    result: PrepareCorrectionImageResult,
    correctionId: string,
    imageSlot: components["schemas"]["DailyImageSlot"],
    request: AdminProtectionRequest,
    reply: AdminHttpReply,
  ): Promise<DayCorrectionImageSelectionResult | ErrorEnvelope> {
    if (result.kind === "replaced" || result.kind === "existing") {
      const live = await this.corrections.getWorkingCopy(correctionId);
      if (live.kind !== "ready") {
        return failure(
          request,
          reply,
          409,
          "INVALID_STATE_TRANSITION",
          "图片已处理，但工作副本状态已变化，请刷新页面。",
        );
      }
      const revision = {
        correctionRevision: live.correction.correctionRevision,
        draftRevision: live.draft.draftRevision,
      };
      const assets = await this.images.listDraftAssets(live.draft.draftId);
      const selected = assets?.items.find(
        (item) => item.imageSlot === imageSlot && item.selectedForSlot,
      );
      if (assets !== null && assets !== undefined && selected === undefined) {
        return failure(
          request,
          reply,
          409,
          "INVALID_STATE_TRANSITION",
          "图片选择已变化，请刷新后查看当前槽位。",
        );
      }
      reply.header("ETag", formatDayCorrectionEtag(revision));
      return {
        assetId: selected?.asset.assetId ?? result.assetId,
        correctionRevision: revision.correctionRevision,
        draftRevision: revision.draftRevision,
        previewUrl: selected?.previewUrl ?? result.previewUrl,
        workingCopy: mapDayCorrectionWorkingCopy(live),
      };
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, result.currentRevision);
    }
    if (result.kind === "candidate_ready") {
      reply.header("ETag", formatDayCorrectionEtag(result.currentRevision));
      return failure(
        request,
        reply,
        409,
        "INVALID_STATE_TRANSITION",
        "候选图片已保存，但页面内容已经变化；刷新后可以再次选择，不会丢失候选。",
      );
    }
    if (result.kind === "not_found") {
      return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正工作副本或图片候选不存在。");
    }
    if (result.kind === "idempotency_conflict") {
      return failure(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于另一项图片操作。");
    }
    if (result.kind === "invalid_state") {
      return failure(
        request,
        reply,
        409,
        "INVALID_STATE_TRANSITION",
        "订正已经开始生效，不能继续选择图片。",
      );
    }
    if (result.kind === "invalid_asset_reference" || result.kind === "ineligible") {
      return failure(request, reply, 422, "IMAGE_SET_INVALID", "图片不属于当前草稿和槽位。");
    }
    if (result.kind === "file_error") {
      if (result.code === "too_large") {
        return failure(request, reply, 413, "IMAGE_FILE_TOO_LARGE", "图片超过 8MiB 限制。");
      }
      if (result.code === "unsupported_media_type" || result.code === "media_type_mismatch") {
        return failure(request, reply, 415, "IMAGE_MEDIA_TYPE_UNSUPPORTED", "图片格式不受支持。");
      }
      return failure(request, reply, 400, "IMAGE_FILE_INVALID", "图片文件无效。");
    }
    return failure(request, reply, 400, "INVALID_ARGUMENT", "选择图片参数无效。");
  }
}
