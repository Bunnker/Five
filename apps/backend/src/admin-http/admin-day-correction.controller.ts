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
  Req,
  Res,
} from "@nestjs/common";

import type {
  ApplyDayCorrectionResult,
  DayCorrectionWorkflow,
  OpenDayCorrectionResult,
  PatchDayCorrectionResult,
} from "../day-correction/day-correction.workflow";
import {
  formatDayCorrectionEtag,
  isApplyDayCorrectionRequest,
  isIdempotencyKey,
  isOpaqueAdminId,
  isOpenDayCorrectionRequest,
  parseDayCorrectionEtag,
} from "./admin-content.validation";
import { adminErrorEnvelope, type AdminHttpReply } from "./admin-http";
import { DAY_CORRECTION_WORKFLOW } from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

type DayCorrectionApplyResult = components["schemas"]["DayCorrectionApplyResult"];
type DayCorrectionPatchResult = components["schemas"]["DayCorrectionPatchResult"];
type DayCorrectionWorkingCopy = components["schemas"]["DayCorrectionWorkingCopy"];
type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

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

function dayCorrectionPrecondition(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
):
  | {
      readonly kind: "valid";
      readonly revision: { readonly correctionRevision: number; readonly draftRevision: number };
    }
  | { readonly error: ErrorEnvelope; readonly kind: "invalid" } {
  const value = request.headers["if-match"];
  if (value === undefined) {
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
  const revision = parseDayCorrectionEtag(value);
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

function dayCorrectionRevisionMismatch(
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
    "这一天的内容已被其他操作更新，请刷新后重试。",
  );
}

export function mapDayCorrectionWorkingCopy(
  result: Extract<OpenDayCorrectionResult, { readonly kind: "ready" }>,
): DayCorrectionWorkingCopy {
  return {
    applyMode: result.correction.applyMode,
    baselineActiveContentVersion: result.correction.baselineActiveContentVersion,
    correctionId: result.correction.correctionId,
    correctionRevision: result.correction.correctionRevision,
    createdAt: result.correction.createdAt,
    draftId: result.draft.draftId,
    draftRevision: result.draft.draftRevision,
    fortuneDate: result.correction.fortuneDate,
    modules: result.draft.modules,
    sourceContentVersion: result.correction.sourceContentVersion,
    status: result.correction.status,
    submittedContentVersion: result.correction.submittedContentVersion,
    updatedAt: result.draft.updatedAt,
  };
}

function openResponse(
  result: OpenDayCorrectionResult,
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
): DayCorrectionWorkingCopy | ErrorEnvelope {
  if (result.kind === "ready") {
    reply.header(
      "ETag",
      formatDayCorrectionEtag({
        correctionRevision: result.correction.correctionRevision,
        draftRevision: result.draft.draftRevision,
      }),
    );
    return mapDayCorrectionWorkingCopy(result);
  }
  if (result.kind === "invalid_argument") {
    return failure(request, reply, 400, "INVALID_ARGUMENT", "命理日或订正请求格式无效。");
  }
  return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正工作副本不存在或已不可编辑。");
}

function patchResponse(
  result: PatchDayCorrectionResult,
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
): DayCorrectionPatchResult | ErrorEnvelope {
  if (result.kind === "updated") {
    reply.header(
      "ETag",
      formatDayCorrectionEtag({
        correctionRevision: result.correctionRevision,
        draftRevision: result.draftRevision,
      }),
    );
    return result;
  }
  if (result.kind === "revision_mismatch") {
    return dayCorrectionRevisionMismatch(request, reply, result.currentRevision);
  }
  if (result.kind === "algorithm_field_read_only") {
    return failure(
      request,
      reply,
      400,
      "ALGORITHM_FIELD_READ_ONLY",
      "算法计算字段不能在单日普通订正中修改。",
      { field: result.field },
    );
  }
  if (result.kind === "not_found" || result.kind === "target_not_found") {
    return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正对象不存在。");
  }
  if (result.kind === "invalid_state") {
    return failure(
      request,
      reply,
      409,
      "INVALID_STATE_TRANSITION",
      "当前订正已经开始应用或完成，不能继续编辑。",
    );
  }
  if (result.kind === "invalid_asset_reference") {
    return failure(request, reply, 422, "IMAGE_SET_INVALID", "选择的图片不属于当前工作副本。");
  }
  return failure(request, reply, 400, "INVALID_ARGUMENT", "订正命令格式或内容无效。");
}

function applyResponse(
  result: ApplyDayCorrectionResult,
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
): DayCorrectionApplyResult | ErrorEnvelope {
  if (result.kind === "applied" || result.kind === "existing") {
    reply.header(
      "ETag",
      formatDayCorrectionEtag({
        correctionRevision: result.correctionRevision,
        draftRevision: result.draftRevision,
      }),
    );
    return {
      action: result.action,
      correctionId: result.correctionId,
      correctionRevision: result.correctionRevision,
      draftRevision: result.draftRevision,
      mode: result.mode,
    };
  }
  if (result.kind === "revision_mismatch") {
    return dayCorrectionRevisionMismatch(request, reply, result.currentRevision);
  }
  if (result.kind === "not_found") {
    return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正工作副本不存在。");
  }
  if (result.kind === "past_date") {
    return failure(
      request,
      reply,
      409,
      "DAY_CORRECTION_PAST_DATE",
      "过去的命理日不能通过普通订正流程重新发布。",
    );
  }
  if (result.kind === "idempotency_conflict") {
    return failure(
      request,
      reply,
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "幂等键已用于另一项订正，请生成新幂等键。",
    );
  }
  if (result.kind === "invalid_state" || result.kind === "persistence_conflict") {
    return failure(
      request,
      reply,
      409,
      "INVALID_STATE_TRANSITION",
      "订正状态已经变化，请刷新后重试。",
    );
  }
  if (result.kind === "release_unavailable") {
    reply.header("Retry-After", 30);
    return failure(
      request,
      reply,
      503,
      "DAY_CORRECTION_RELEASE_UNAVAILABLE",
      "内容已经安全保存，但发布步骤暂时不可用，请使用同一幂等键重试。",
    );
  }
  if (result.kind === "submit_failed") {
    if (result.result.kind === "not_found") {
      return failure(request, reply, 404, "RESOURCE_NOT_FOUND", "订正工作副本不存在。");
    }
    if (
      result.result.kind === "image_withdrawn" ||
      result.result.kind === "invalid_asset_reference"
    ) {
      return failure(request, reply, 422, "IMAGE_SET_INVALID", "当前图片集合不能安全发布。");
    }
    if (result.result.kind === "idempotency_conflict") {
      return failure(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "订正提交幂等键发生冲突。");
    }
    return failure(request, reply, 409, "INVALID_STATE_TRANSITION", "当前草稿不能应用订正。");
  }
  if (result.kind === "release_failed") {
    reply.header(
      "ETag",
      formatDayCorrectionEtag({
        correctionRevision: result.correctionRevision,
        draftRevision: result.draftRevision,
      }),
    );
    if (result.result.kind === "revision_mismatch") {
      return failure(
        request,
        reply,
        412,
        "REVISION_MISMATCH",
        "内容生命周期已经变化；本次订正已安全终止，请刷新后重新订正。",
      );
    }
    if (result.result.kind === "idempotency_conflict") {
      return failure(request, reply, 409, "IDEMPOTENCY_KEY_REUSED", "订正发布幂等键发生冲突。");
    }
    if (result.result.kind === "preflight_failed") {
      return failure(request, reply, 422, "PUBLISH_PRECHECK_FAILED", "发布前检查未通过。", {
        preflightChecks: result.result.preflightChecks,
      });
    }
    return failure(request, reply, 409, "INVALID_STATE_TRANSITION", "当前内容状态不能完成发布。");
  }
  return failure(request, reply, 400, "INVALID_ARGUMENT", "应用订正的参数无效。");
}

@Controller("admin/api/v1/day-corrections")
export class AdminDayCorrectionController {
  constructor(
    @Inject(DAY_CORRECTION_WORKFLOW)
    private readonly workflow: DayCorrectionWorkflow,
  ) {}

  @Post()
  @HttpCode(200)
  async open(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionWorkingCopy | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    if (!isOpenDayCorrectionRequest(body)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "命理日格式无效。");
    }
    return openResponse(
      await this.workflow.openWorkingCopy({
        actorId: request.adminPrincipal.accountId,
        fortuneDate: body.fortuneDate,
        requestId: requestId(request),
      }),
      request,
      reply,
    );
  }

  @Get(":correctionId")
  async get(
    @Param("correctionId") correctionId: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionWorkingCopy | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    if (!isOpaqueAdminId(correctionId)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "订正编号格式无效。");
    }
    return openResponse(await this.workflow.getWorkingCopy(correctionId), request, reply);
  }

  @Patch(":correctionId")
  async patch(
    @Param("correctionId") correctionId: string,
    @Body() command: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionPatchResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    if (!isOpaqueAdminId(correctionId)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "订正编号格式无效。");
    }
    const precondition = dayCorrectionPrecondition(request, reply);
    if (precondition.kind === "invalid") return precondition.error;
    return patchResponse(
      await this.workflow.patch({
        actorId: request.adminPrincipal.accountId,
        command,
        correctionId,
        expectedRevision: precondition.revision,
        requestId: requestId(request),
      }),
      request,
      reply,
    );
  }

  @Post(":correctionId/apply")
  @HttpCode(200)
  async apply(
    @Param("correctionId") correctionId: string,
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<DayCorrectionApplyResult | ErrorEnvelope> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    if (!isOpaqueAdminId(correctionId) || !isApplyDayCorrectionRequest(body)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "订正编号或生效原因格式无效。");
    }
    const precondition = dayCorrectionPrecondition(request, reply);
    if (precondition.kind === "invalid") return precondition.error;
    const idempotencyKey = request.headers["idempotency-key"];
    if (!isIdempotencyKey(idempotencyKey)) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "幂等键格式无效。");
    }
    return applyResponse(
      await this.workflow.apply({
        actorId: request.adminPrincipal.accountId,
        correctionId,
        expectedRevision: precondition.revision,
        idempotencyKey,
        reason: body.reason,
        requestId: requestId(request),
      }),
      request,
      reply,
    );
  }
}
