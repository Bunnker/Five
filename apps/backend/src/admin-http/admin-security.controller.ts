import type { components } from "@five/api-contract";
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from "@nestjs/common";

import type { AdminAuthService, EmergencyControlService } from "../admin-auth/admin-auth.service";
import type { SecurityEventRecord } from "../admin-auth/admin-auth.store";
import {
  adminErrorEnvelope,
  type AdminHttpReply,
  codePointLength,
  hasExactlyKeys,
} from "./admin-http";
import { ADMIN_AUTH_SERVICE, EMERGENCY_CONTROL_SERVICE } from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
type SecurityEvent = components["schemas"]["SecurityEvent"];
type SecurityEventAction = components["schemas"]["SecurityEventAction"];
type SecurityEventPage = components["schemas"]["SecurityEventPage"];
type EmergencyControlStatus = components["schemas"]["EmergencyControlStatus"];

function securityAction(eventType: string): SecurityEventAction {
  if (eventType.includes("rate_limited")) {
    return "rate_limited";
  }
  if (eventType.startsWith("login_password_")) {
    return "login_password";
  }
  if (eventType.startsWith("login_totp_")) {
    return "login_totp";
  }
  if (eventType === "session_logged_out") {
    return "logout_current";
  }
  if (eventType === "all_sessions_logged_out") {
    return "logout_all";
  }
  if (eventType.startsWith("recovery_code_")) {
    return "recovery_code";
  }
  if (eventType.startsWith("recovery_completion_") || eventType === "recovery_completed") {
    return "recovery_completed";
  }
  if (eventType === "account_offline_reset") {
    return "offline_reset";
  }
  if (eventType === "csrf_rejected") {
    return "csrf_rejected";
  }
  if (eventType.startsWith("public_access_resume")) {
    return "emergency_resume";
  }
  if (eventType.startsWith("public_access_stop")) {
    return "emergency_stop";
  }
  if (eventType === "account_bootstrapped") {
    return "bootstrap_completed";
  }
  throw new Error("Unsupported admin security event type");
}

function securityEvent(record: SecurityEventRecord): SecurityEvent {
  return {
    action: securityAction(record.eventType),
    clientSummary: record.userAgentSummary.slice(0, 160),
    eventId: record.eventId,
    occurredAt: record.occurredAt.toISOString(),
    outcome: record.outcome === "success" ? "succeeded" : "rejected",
    reason: record.reason,
    requestId: record.requestId,
    sourceFingerprint: record.sourceFingerprint,
  };
}

function emergencyStatus(
  state: Awaited<ReturnType<EmergencyControlService["getState"]>>,
): EmergencyControlStatus {
  return {
    auditEventId: state.auditEventId,
    changedAt: state.changedAt.toISOString(),
    publicAccessEnabled: state.publiclyEnabled,
    reason: state.reason,
    revision: state.revision,
  };
}

function parseEmergencyRevision(value: string | string[] | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^"emergency-control:([1-9]\d*)"$/u.exec(value);
  if (match === null) {
    return null;
  }
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

function isEmergencyRequest(
  value: unknown,
  action: "resume" | "stop",
): value is {
  readonly confirmationPhrase: string;
  readonly reason: string;
  readonly totpCode: string;
} {
  if (!hasExactlyKeys(value, ["confirmationPhrase", "reason", "totpCode"])) {
    return false;
  }
  const expectedPhrase = action === "stop" ? "停止全部公开内容" : "恢复全部公开内容";
  return (
    value.confirmationPhrase === expectedPhrase &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    codePointLength(value.reason) <= 2_000 &&
    typeof value.totpCode === "string" &&
    /^\d{6}$/u.test(value.totpCode)
  );
}

@Controller("admin/api/v1")
export class AdminSecurityController {
  constructor(
    @Inject(ADMIN_AUTH_SERVICE)
    private readonly authService: AdminAuthService,
    @Inject(EMERGENCY_CONTROL_SERVICE)
    private readonly emergencyService: EmergencyControlService,
  ) {}

  @Get("emergency-control")
  async getEmergencyControl(
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<EmergencyControlStatus> {
    const state = await this.emergencyService.getState();
    reply.header("ETag", `"emergency-control:${state.revision}"`);
    return emergencyStatus(state);
  }

  @Post("emergency-control/stop")
  @HttpCode(200)
  stopPublicAccess(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<EmergencyControlStatus | ErrorEnvelope> {
    return this.applyEmergencyControl("stop", body, request, reply);
  }

  @Post("emergency-control/resume")
  @HttpCode(200)
  resumePublicAccess(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<EmergencyControlStatus | ErrorEnvelope> {
    return this.applyEmergencyControl("resume", body, request, reply);
  }

  @Get("security-events")
  async listSecurityEvents(
    @Query("limit") rawLimit: string | string[] | undefined,
    @Query("cursor") cursor: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<SecurityEventPage | ErrorEnvelope> {
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (
      request.adminPrincipal === undefined ||
      Array.isArray(rawLimit) ||
      Array.isArray(cursor) ||
      (cursor !== undefined && cursor.length > 256) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      reply.status(request.adminPrincipal === undefined ? 401 : 400);
      return adminErrorEnvelope(
        request.adminPrincipal === undefined ? "UNAUTHENTICATED" : "INVALID_ARGUMENT",
        request.adminPrincipal === undefined
          ? "后台会话不存在或已失效，请重新登录。"
          : "查询参数格式无效，请检查后重试。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    const result = await this.authService.listSecurityEvents(request.adminPrincipal.accountId, {
      cursor: cursor ?? null,
      limit,
    });
    if (result.kind === "invalid_cursor") {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "安全记录游标无效，请重新加载。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    return { items: result.items.map(securityEvent), nextCursor: result.nextCursor };
  }

  private async applyEmergencyControl(
    action: "resume" | "stop",
    body: unknown,
    request: AdminProtectionRequest,
    reply: AdminHttpReply,
  ): Promise<EmergencyControlStatus | ErrorEnvelope> {
    const requestId = request.adminRequestId ?? "admin-request-unavailable";
    const expectedRevision = parseEmergencyRevision(request.headers["if-match"]);
    if (request.headers["if-match"] === undefined) {
      reply.status(428);
      return adminErrorEnvelope(
        "PRECONDITION_REQUIRED",
        "缺少当前紧急控制修订号，请刷新后重试。",
        requestId,
      );
    }
    const idempotencyKey = request.headers["idempotency-key"];
    if (
      request.adminPrincipal === undefined ||
      expectedRevision === null ||
      typeof idempotencyKey !== "string" ||
      !/^[-A-Za-z0-9_:.]{16,128}$/u.test(idempotencyKey) ||
      !isEmergencyRequest(body, action)
    ) {
      reply.status(400);
      return adminErrorEnvelope(
        "INVALID_ARGUMENT",
        "紧急控制确认信息格式无效，请检查后重试。",
        requestId,
      );
    }

    const result = await this.emergencyService.apply({
      action,
      confirmationPhrase: body.confirmationPhrase,
      context: {
        requestId,
        source: request.ip ?? "unknown",
        userAgent:
          typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
      },
      expectedRevision,
      idempotencyKey,
      principal: request.adminPrincipal,
      reason: body.reason,
      totpCode: body.totpCode,
    });
    if (result.kind === "applied" || result.kind === "existing") {
      reply.header("ETag", `"emergency-control:${result.state.revision}"`);
      return emergencyStatus(result.state);
    }
    if (result.kind === "revision_conflict") {
      reply.header("ETag", `"emergency-control:${result.current.revision}"`);
      reply.status(412);
      return adminErrorEnvelope(
        "REVISION_MISMATCH",
        "紧急控制状态已变化，请刷新后重试。",
        requestId,
      );
    }
    if (result.kind === "totp_replayed") {
      reply.status(409);
      return adminErrorEnvelope(
        "TOTP_REPLAYED",
        "动态码已经使用，请等待新动态码后重试。",
        requestId,
      );
    }
    if (result.kind === "idempotency_conflict") {
      reply.status(409);
      return adminErrorEnvelope(
        "IDEMPOTENCY_KEY_REUSED",
        "幂等键已用于另一项操作，请生成新幂等键。",
        requestId,
      );
    }
    if (result.kind === "invalid_state") {
      reply.status(409);
      return adminErrorEnvelope(
        "EMERGENCY_CONTROL_CONFLICT",
        "公开内容已经处于目标状态，请刷新后确认。",
        requestId,
      );
    }
    if (result.kind === "invalid_totp") {
      reply.status(401);
      return adminErrorEnvelope(
        "AUTHENTICATION_FAILED",
        "账号或凭据无效，请检查后重试。",
        requestId,
      );
    }
    reply.status(400);
    return adminErrorEnvelope(
      "INVALID_ARGUMENT",
      "紧急控制确认信息格式无效，请检查后重试。",
      requestId,
    );
  }
}
