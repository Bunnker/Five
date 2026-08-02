import type { components } from "@five/api-contract";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";

import type { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { isFortuneDate } from "../today/public-route-params";
import {
  isCreateDraftRequest,
  isDraftModuleUpdate,
  isIdempotencyKey,
  isMasterReviewEvidenceRequest,
  isModuleCode,
  isOpaqueAdminId,
  isReviewDecisionRequest,
  parseStrongRevisionEtag,
} from "./admin-content.validation";
import { adminErrorEnvelope, type AdminHttpReply } from "./admin-http";
import { CONTENT_LIFECYCLE_SERVICE } from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

type ContentDraftList = components["schemas"]["ContentDraftList"];
type ContentDraft = components["schemas"]["ContentDraft"];
type AdminContentVersion = components["schemas"]["AdminContentVersion"];
type AuditEventPage = components["schemas"]["AuditEventPage"];
type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
type LifecycleActionResult = components["schemas"]["LifecycleActionResult"];
type SubmitDraftResult = components["schemas"]["SubmitDraftResult"];
type UpdatedDraftModule = components["schemas"]["UpdatedDraftModule"];
interface ContentVersionList {
  readonly activeContentVersion: components["schemas"]["NullableContentVersion"];
  readonly fortuneDate: components["schemas"]["FortuneDate"];
  readonly items: components["schemas"]["ContentVersionSummary"][];
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
  details?: Record<string, unknown>,
): ErrorEnvelope {
  reply.status(status);
  const envelope = adminErrorEnvelope(code, message, requestId(request));
  return details === undefined
    ? envelope
    : { error: { ...envelope.error, details: { ...details } } };
}

function unauthenticated(request: AdminProtectionRequest, reply: AdminHttpReply): ErrorEnvelope {
  return failure(request, reply, 401, "UNAUTHENTICATED", "后台会话不存在或已失效，请重新登录。");
}

function idempotencyConflict(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
): ErrorEnvelope {
  return failure(
    request,
    reply,
    409,
    "IDEMPOTENCY_KEY_REUSED",
    "幂等键已用于另一项操作，请生成新幂等键。",
  );
}

function revisionMismatch(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
  resource: "draft" | "lifecycle",
  currentRevision: number,
): ErrorEnvelope {
  reply.header("ETag", `"${resource}:${currentRevision}"`);
  return failure(
    request,
    reply,
    412,
    "REVISION_MISMATCH",
    resource === "draft"
      ? "草稿已被其他操作更新，请刷新后重试。"
      : "内容生命周期已变化，请刷新后重试。",
  );
}

@Controller("admin/api/v1")
export class AdminContentController {
  constructor(
    @Inject(CONTENT_LIFECYCLE_SERVICE)
    private readonly lifecycleService: ContentLifecycleService,
  ) {}

  @Get("daily-content-drafts")
  async listDrafts(
    @Query("fortuneDate") fortuneDate: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<ContentDraftList | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    if (Array.isArray(fortuneDate) || (fortuneDate !== undefined && !isFortuneDate(fortuneDate))) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_FORTUNE_DATE",
        "命理日格式无效，请检查后重试。",
        requestId(request),
      );
    }
    return this.lifecycleService.listDrafts(fortuneDate ?? null);
  }

  @Post("daily-content-drafts")
  async createDraft(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<ContentDraft | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    if (!isCreateDraftRequest(body)) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "草稿信息格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.createDraft({
      actorId: request.adminPrincipal.accountId,
      copyFromContentVersion: body.copyFromContentVersion,
      fortuneDate: body.fortuneDate,
      requestId: requestId(request),
    });
    if (result.kind === "created") {
      reply.header("ETag", `"draft:${result.draft.draftRevision}"`);
      return result.draft;
    }
    if (result.kind === "source_not_found") {
      reply.status(404);
      return adminErrorEnvelope(
        "RESOURCE_NOT_FOUND",
        "要复制的内容版本不存在。",
        requestId(request),
      );
    }
    if (result.kind === "source_date_mismatch") {
      reply.status(409);
      return adminErrorEnvelope(
        "INVALID_STATE_TRANSITION",
        "只能复制同一命理日的内容版本。",
        requestId(request),
      );
    }
    reply.status(400);
    return adminErrorEnvelope(
      "INVALID_ARGUMENT",
      "草稿信息格式无效，请检查后重试。",
      requestId(request),
    );
  }

  @Get("daily-content-drafts/:draftId")
  async getDraft(
    @Param("draftId") draftId: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<ContentDraft | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const draft = isOpaqueAdminId(draftId) ? await this.lifecycleService.getDraft(draftId) : null;
    if (draft === null) {
      reply.status(404);
      return adminErrorEnvelope("RESOURCE_NOT_FOUND", "草稿不存在。", requestId(request));
    }
    reply.header("ETag", `"draft:${draft.draftRevision}"`);
    return draft;
  }

  @Patch("daily-content-drafts/:draftId/modules/:moduleCode")
  async updateDraftModule(
    @Param("draftId") draftId: string,
    @Param("moduleCode") moduleCode: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<UpdatedDraftModule | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const ifMatch = request.headers["if-match"];
    if (ifMatch === undefined) {
      reply.status(428);
      return adminErrorEnvelope(
        "PRECONDITION_REQUIRED",
        "缺少当前草稿修订号，请刷新后重试。",
        requestId(request),
      );
    }
    const revision = parseStrongRevisionEtag(ifMatch, "draft");
    if (
      revision === null ||
      !isOpaqueAdminId(draftId) ||
      !isModuleCode(moduleCode) ||
      !isDraftModuleUpdate(moduleCode, body)
    ) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "草稿模块或修订号格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.updateDraftModule({
      actorId: request.adminPrincipal.accountId,
      draftId,
      expectedDraftRevision: revision,
      module: body,
      moduleCode,
      requestId: requestId(request),
    });
    if (result.kind === "updated") {
      reply.header("ETag", `"draft:${result.result.draftRevision}"`);
      return result.result;
    }
    if (result.kind === "not_found") {
      reply.status(404);
      return adminErrorEnvelope("RESOURCE_NOT_FOUND", "草稿不存在。", requestId(request));
    }
    if (result.kind === "invalid_state") {
      reply.status(409);
      return adminErrorEnvelope(
        "INVALID_STATE_TRANSITION",
        "当前草稿状态不允许修改。",
        requestId(request),
      );
    }
    return revisionMismatch(request, reply, "draft", result.currentRevision);
  }

  @Post("daily-content-drafts/:draftId/submit")
  async submitDraft(
    @Param("draftId") draftId: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<SubmitDraftResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const ifMatch = request.headers["if-match"];
    if (ifMatch === undefined) {
      reply.status(428);
      return adminErrorEnvelope(
        "PRECONDITION_REQUIRED",
        "缺少当前草稿修订号，请刷新后重试。",
        requestId(request),
      );
    }
    const revision = parseStrongRevisionEtag(ifMatch, "draft");
    const idempotencyKey = request.headers["idempotency-key"];
    if (revision === null || !isOpaqueAdminId(draftId) || !isIdempotencyKey(idempotencyKey)) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "提交参数格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.submitDraft({
      actorId: request.adminPrincipal.accountId,
      draftId,
      expectedDraftRevision: revision,
      idempotencyKey,
      requestId: requestId(request),
    });
    if (result.kind === "submitted" || result.kind === "existing") {
      reply.header("ETag", `"lifecycle:${result.result.lifecycleRevision}"`);
      return result.result;
    }
    if (result.kind === "not_found") {
      reply.status(404);
      return adminErrorEnvelope("RESOURCE_NOT_FOUND", "草稿不存在。", requestId(request));
    }
    if (result.kind === "invalid_state") {
      reply.status(409);
      return adminErrorEnvelope(
        "INVALID_STATE_TRANSITION",
        "当前草稿状态不允许提交。",
        requestId(request),
      );
    }
    if (result.kind === "idempotency_conflict") {
      return idempotencyConflict(request, reply);
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "draft", result.currentRevision);
    }
    reply.status(400);
    return adminErrorEnvelope(
      "INVALID_ARGUMENT",
      "草稿无法提交，请刷新后重试。",
      requestId(request),
    );
  }

  @Get("daily-content-versions")
  async listVersions(
    @Query("fortuneDate") fortuneDate: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<ContentVersionList | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    if (typeof fortuneDate !== "string" || !isFortuneDate(fortuneDate)) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_FORTUNE_DATE",
        "命理日格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.listVersions(fortuneDate);
    if ("kind" in result) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_FORTUNE_DATE",
        "命理日格式无效，请检查后重试。",
        requestId(request),
      );
    }
    return result;
  }

  @Get("daily-content-versions/:contentVersion")
  async getVersion(
    @Param("contentVersion") contentVersion: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminContentVersion | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const version = isOpaqueAdminId(contentVersion)
      ? await this.lifecycleService.getVersion(contentVersion)
      : null;
    if (version === null) {
      reply.status(404);
      return adminErrorEnvelope("RESOURCE_NOT_FOUND", "内容版本不存在。", requestId(request));
    }
    reply.header("ETag", `"lifecycle:${version.lifecycleRevision}"`);
    return version;
  }

  @Post("daily-content-versions/:contentVersion/master-review-evidence")
  @HttpCode(200)
  async addMasterReviewEvidence(
    @Param("contentVersion") contentVersion: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminContentVersion | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const ifMatch = request.headers["if-match"];
    if (ifMatch === undefined) {
      reply.status(428);
      return adminErrorEnvelope(
        "PRECONDITION_REQUIRED",
        "缺少当前生命周期修订号，请刷新后重试。",
        requestId(request),
      );
    }
    const revision = parseStrongRevisionEtag(ifMatch, "lifecycle");
    const idempotencyKey = request.headers["idempotency-key"];
    if (
      revision === null ||
      !isOpaqueAdminId(contentVersion) ||
      !isIdempotencyKey(idempotencyKey) ||
      !isMasterReviewEvidenceRequest(body)
    ) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "大师核对依据格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.addMasterReviewEvidence({
      actorId: request.adminPrincipal.accountId,
      contentVersion,
      evidence: body,
      expectedLifecycleRevision: revision,
      idempotencyKey,
      requestId: requestId(request),
    });
    if (result.kind === "added" || result.kind === "existing") {
      reply.header("ETag", `"lifecycle:${result.version.lifecycleRevision}"`);
      return result.version;
    }
    if (result.kind === "not_found") {
      reply.status(404);
      return adminErrorEnvelope("RESOURCE_NOT_FOUND", "内容版本不存在。", requestId(request));
    }
    if (result.kind === "invalid_state") {
      reply.status(409);
      return adminErrorEnvelope(
        "INVALID_STATE_TRANSITION",
        "当前内容状态不允许登记核对依据。",
        requestId(request),
      );
    }
    if (result.kind === "idempotency_conflict") {
      return idempotencyConflict(request, reply);
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "lifecycle", result.currentRevision);
    }
    reply.status(400);
    return adminErrorEnvelope(
      "INVALID_ARGUMENT",
      "大师核对依据无法登记，请刷新后重试。",
      requestId(request),
    );
  }

  @Post("daily-content-versions/:contentVersion/review-decision")
  @HttpCode(200)
  async decideReview(
    @Param("contentVersion") contentVersion: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<LifecycleActionResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const ifMatch = request.headers["if-match"];
    if (ifMatch === undefined) {
      reply.status(428);
      return adminErrorEnvelope(
        "PRECONDITION_REQUIRED",
        "缺少当前生命周期修订号，请刷新后重试。",
        requestId(request),
      );
    }
    const revision = parseStrongRevisionEtag(ifMatch, "lifecycle");
    const idempotencyKey = request.headers["idempotency-key"];
    if (
      revision === null ||
      !isOpaqueAdminId(contentVersion) ||
      !isIdempotencyKey(idempotencyKey) ||
      !isReviewDecisionRequest(body)
    ) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "核对结论格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.decideReview({
      actorId: request.adminPrincipal.accountId,
      contentVersion,
      decision: body.decision,
      expectedLifecycleRevision: revision,
      idempotencyKey,
      reason: body.reason,
      requestId: requestId(request),
    });
    if (result.kind === "applied" || result.kind === "existing") {
      reply.header("ETag", `"lifecycle:${result.action.lifecycleRevision}"`);
      return result.action;
    }
    if (result.kind === "not_found") {
      reply.status(404);
      return adminErrorEnvelope("RESOURCE_NOT_FOUND", "内容版本不存在。", requestId(request));
    }
    if (result.kind === "invalid_state") {
      reply.status(409);
      return adminErrorEnvelope(
        "INVALID_STATE_TRANSITION",
        "当前内容状态不允许保存核对结论。",
        requestId(request),
      );
    }
    if (result.kind === "idempotency_conflict") {
      return idempotencyConflict(request, reply);
    }
    if (result.kind === "revision_mismatch") {
      return revisionMismatch(request, reply, "lifecycle", result.currentRevision);
    }
    if (result.kind === "master_review_missing" || result.kind === "required_review_missing") {
      reply.status(422);
      const envelope = adminErrorEnvelope(
        result.kind === "master_review_missing"
          ? "MASTER_REVIEW_EVIDENCE_MISSING"
          : "REQUIRED_REVIEW_MISSING",
        result.kind === "master_review_missing"
          ? "缺少完整的大师核对依据。"
          : "仍有必审检查未通过。",
        requestId(request),
      );
      return {
        error: {
          ...envelope.error,
          details: { preflightChecks: result.preflightChecks },
        },
      };
    }
    reply.status(400);
    return adminErrorEnvelope(
      "INVALID_ARGUMENT",
      "核对结论无法保存，请刷新后重试。",
      requestId(request),
    );
  }

  @Get("audit-events")
  async listAuditEvents(
    @Query("fortuneDate") fortuneDate: string | string[] | undefined,
    @Query("contentVersion") contentVersion: string | string[] | undefined,
    @Query("cursor") cursor: string | string[] | undefined,
    @Query("limit") rawLimit: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AuditEventPage | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) {
      return unauthenticated(request, reply);
    }
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (
      Array.isArray(fortuneDate) ||
      Array.isArray(contentVersion) ||
      Array.isArray(cursor) ||
      Array.isArray(rawLimit) ||
      (fortuneDate !== undefined && !isFortuneDate(fortuneDate)) ||
      (contentVersion !== undefined && !isOpaqueAdminId(contentVersion)) ||
      (cursor !== undefined && cursor.length > 256) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "审计查询参数格式无效，请检查后重试。",
        requestId(request),
      );
    }
    const result = await this.lifecycleService.listAuditEvents({
      contentVersion: contentVersion ?? null,
      cursor: cursor ?? null,
      fortuneDate: fortuneDate ?? null,
      limit,
    });
    if (result.kind !== "page") {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        result.kind === "invalid_cursor" ? "审计游标无效，请重新加载。" : "审计查询参数无效。",
        requestId(request),
      );
    }
    return { items: result.items, nextCursor: result.nextCursor };
  }
}
