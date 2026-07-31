import type { components } from "@five/api-contract";
import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";

import type { AdminAuthService } from "../admin-auth/admin-auth.service";
import {
  adminErrorEnvelope,
  type AdminHttpReply,
  codePointLength,
  hasExactlyKeys,
} from "./admin-http";
import { ADMIN_AUTH_SERVICE } from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

type PasswordChallenge = components["schemas"]["PasswordChallenge"];
type AdminSession = components["schemas"]["AdminSession"];
type RecoveryChallenge = components["schemas"]["RecoveryChallenge"];
type RecoveryCompletion = components["schemas"]["RecoveryCompletion"];

function isUsername(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(value);
}

function isPasswordChallengeRequest(
  value: unknown,
): value is { readonly password: string; readonly username: string } {
  if (!hasExactlyKeys(value, ["password", "username"])) {
    return false;
  }
  return (
    isUsername(value.username) &&
    typeof value.password === "string" &&
    codePointLength(value.password) >= 16 &&
    codePointLength(value.password) <= 128
  );
}

function isRecoveryChallengeRequest(
  value: unknown,
): value is { readonly recoveryCode: string; readonly username: string } {
  if (!hasExactlyKeys(value, ["recoveryCode", "username"])) {
    return false;
  }
  return (
    isUsername(value.username) &&
    typeof value.recoveryCode === "string" &&
    codePointLength(value.recoveryCode) >= 16 &&
    codePointLength(value.recoveryCode) <= 128
  );
}

function isRecoveryCompletionRequest(value: unknown): value is {
  readonly challengeToken: string;
  readonly newPassword: string;
  readonly totpCode: string;
} {
  if (!hasExactlyKeys(value, ["challengeToken", "newPassword", "totpCode"])) {
    return false;
  }
  return (
    typeof value.challengeToken === "string" &&
    codePointLength(value.challengeToken) >= 32 &&
    codePointLength(value.challengeToken) <= 512 &&
    typeof value.newPassword === "string" &&
    codePointLength(value.newPassword) >= 16 &&
    codePointLength(value.newPassword) <= 128 &&
    typeof value.totpCode === "string" &&
    /^\d{6}$/u.test(value.totpCode)
  );
}

function isSessionRequest(
  value: unknown,
): value is { readonly challengeToken: string; readonly totpCode: string } {
  if (!hasExactlyKeys(value, ["challengeToken", "totpCode"])) {
    return false;
  }
  return (
    typeof value.challengeToken === "string" &&
    codePointLength(value.challengeToken) >= 32 &&
    codePointLength(value.challengeToken) <= 512 &&
    typeof value.totpCode === "string" &&
    /^\d{6}$/u.test(value.totpCode)
  );
}

export function adminSessionCookie(input: {
  readonly absoluteExpiresAt: Date;
  readonly issuedAt: Date;
  readonly production: boolean;
  readonly sessionToken: string;
}): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((input.absoluteExpiresAt.getTime() - input.issuedAt.getTime()) / 1_000),
  );
  return [
    `five_admin_session=${input.sessionToken}`,
    "HttpOnly",
    input.production ? "Secure" : null,
    "SameSite=Strict",
    "Path=/admin",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

export function clearedAdminSessionCookie(production: boolean): string {
  return [
    "five_admin_session=",
    "HttpOnly",
    production ? "Secure" : null,
    "SameSite=Strict",
    "Path=/admin",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

function adminSessionResponse(input: {
  readonly absoluteExpiresAt: Date;
  readonly credentialRevision: number;
  readonly csrfToken: string;
  readonly idleExpiresAt: Date;
  readonly issuedAt: Date;
  readonly username: string;
}): AdminSession {
  return {
    absoluteExpiresAt: input.absoluteExpiresAt.toISOString(),
    credentialRevision: input.credentialRevision,
    csrfToken: input.csrfToken,
    idleExpiresAt: input.idleExpiresAt.toISOString(),
    issuedAt: input.issuedAt.toISOString(),
    username: input.username,
  };
}

@Controller("admin/api/v1/auth")
export class AdminAuthController {
  constructor(
    @Inject(ADMIN_AUTH_SERVICE)
    private readonly service: AdminAuthService,
  ) {}

  @Get("session")
  getCurrentSession(
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): AdminSession | components["schemas"]["ErrorEnvelope"] {
    if (request.adminPrincipal === undefined) {
      reply.status(401);
      return adminErrorEnvelope(
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    return adminSessionResponse(request.adminPrincipal);
  }

  @Delete("session")
  @HttpCode(204)
  async deleteCurrentSession(
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<void | components["schemas"]["ErrorEnvelope"]> {
    const sessionToken = request.adminSessionToken;
    const csrfToken = request.headers["x-csrf-token"];
    if (sessionToken === undefined || typeof csrfToken !== "string") {
      reply.status(401);
      return adminErrorEnvelope(
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    const revoked = await this.service.logout({
      context: {
        requestId: request.adminRequestId ?? "admin-request-unavailable",
        source: request.ip ?? "unknown",
        userAgent:
          typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
      },
      csrfToken,
      sessionToken,
    });
    if (!revoked) {
      reply.status(401);
      return adminErrorEnvelope(
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    reply.header("Set-Cookie", clearedAdminSessionCookie(process.env.NODE_ENV === "production"));
  }

  @Post("logout-all")
  @HttpCode(204)
  async deleteAllSessions(
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<void | components["schemas"]["ErrorEnvelope"]> {
    if (request.adminPrincipal === undefined) {
      reply.status(401);
      return adminErrorEnvelope(
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    const revoked = await this.service.logoutAll({
      context: {
        requestId: request.adminRequestId ?? "admin-request-unavailable",
        source: request.ip ?? "unknown",
        userAgent:
          typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
      },
      principal: request.adminPrincipal,
    });
    if (!revoked) {
      reply.status(401);
      return adminErrorEnvelope(
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
        request.adminRequestId ?? "admin-request-unavailable",
      );
    }
    reply.header("Set-Cookie", clearedAdminSessionCookie(process.env.NODE_ENV === "production"));
  }

  @Post("password-challenges")
  @HttpCode(200)
  async passwordChallenge(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<PasswordChallenge | components["schemas"]["ErrorEnvelope"]> {
    const requestId = request.adminRequestId ?? "admin-request-unavailable";
    if (!isPasswordChallengeRequest(body) || request.adminAuthPermit?.action !== "login") {
      reply.status(400);
      return adminErrorEnvelope("INVALID_ARGUMENT", "登录信息格式无效，请检查后重试。", requestId);
    }

    const result = await this.service.beginLogin({
      password: body.password,
      permit: request.adminAuthPermit,
      username: body.username,
    });
    if (result.kind === "rate_limited") {
      reply.header("Retry-After", result.retryAfterSeconds);
      reply.status(429);
      return adminErrorEnvelope("RATE_LIMITED", "尝试次数过多，请稍后再试。", requestId, true);
    }
    if (result.kind === "invalid") {
      reply.status(401);
      return adminErrorEnvelope(
        "AUTHENTICATION_FAILED",
        "账号或凭据无效，请检查后重试。",
        requestId,
      );
    }
    return {
      challengeToken: result.challengeToken,
      expiresAt: result.challengeExpiresAt.toISOString(),
    };
  }

  @Post("sessions")
  async createSession(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminSession | components["schemas"]["ErrorEnvelope"]> {
    const requestId = request.adminRequestId ?? "admin-request-unavailable";
    if (!isSessionRequest(body) || request.adminAuthPermit?.action !== "login_totp") {
      reply.status(400);
      return adminErrorEnvelope("INVALID_ARGUMENT", "登录信息格式无效，请检查后重试。", requestId);
    }
    const result = await this.service.completeLogin({
      challengeToken: body.challengeToken,
      permit: request.adminAuthPermit,
      totpCode: body.totpCode,
    });
    if (result.kind === "rate_limited") {
      reply.header("Retry-After", result.retryAfterSeconds);
      reply.status(429);
      return adminErrorEnvelope("RATE_LIMITED", "尝试次数过多，请稍后再试。", requestId, true);
    }
    if (result.kind === "invalid") {
      reply.status(401);
      return adminErrorEnvelope(
        "AUTHENTICATION_FAILED",
        "账号或凭据无效，请检查后重试。",
        requestId,
      );
    }

    reply.header(
      "Set-Cookie",
      adminSessionCookie({
        ...result,
        production: process.env.NODE_ENV === "production",
      }),
    );
    reply.status(201);
    return adminSessionResponse(result);
  }

  @Post("recovery-challenges")
  @HttpCode(200)
  async createRecoveryChallenge(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<RecoveryChallenge | components["schemas"]["ErrorEnvelope"]> {
    const requestId = request.adminRequestId ?? "admin-request-unavailable";
    if (!isRecoveryChallengeRequest(body) || request.adminAuthPermit?.action !== "recovery") {
      reply.status(400);
      return adminErrorEnvelope("INVALID_ARGUMENT", "恢复信息格式无效，请检查后重试。", requestId);
    }
    const result = await this.service.beginRecovery({
      permit: request.adminAuthPermit,
      recoveryCode: body.recoveryCode,
      username: body.username,
    });
    if (result.kind === "rate_limited") {
      reply.header("Retry-After", result.retryAfterSeconds);
      reply.status(429);
      return adminErrorEnvelope("RATE_LIMITED", "尝试次数过多，请稍后再试。", requestId, true);
    }
    if (result.kind === "invalid") {
      reply.status(401);
      return adminErrorEnvelope(
        "AUTHENTICATION_FAILED",
        "账号或凭据无效，请检查后重试。",
        requestId,
      );
    }
    return {
      challengeToken: result.challengeToken,
      expiresAt: result.challengeExpiresAt.toISOString(),
      totpProvisioning: {
        algorithm: "SHA1",
        digits: 6,
        otpauthUri: result.totpSetup.otpauthUri,
        periodSeconds: 30,
        secret: result.totpSetup.secretBase32,
      },
    };
  }

  @Post("recovery-completions")
  async completeRecovery(
    @Body() body: unknown,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<RecoveryCompletion | components["schemas"]["ErrorEnvelope"]> {
    const requestId = request.adminRequestId ?? "admin-request-unavailable";
    if (
      !isRecoveryCompletionRequest(body) ||
      request.adminAuthPermit?.action !== "recovery_complete"
    ) {
      reply.status(400);
      return adminErrorEnvelope("INVALID_ARGUMENT", "恢复信息格式无效，请检查后重试。", requestId);
    }
    const result = await this.service.completeRecovery({
      challengeToken: body.challengeToken,
      newPassword: body.newPassword,
      permit: request.adminAuthPermit,
      totpCode: body.totpCode,
    });
    if (result.kind === "rate_limited") {
      reply.header("Retry-After", result.retryAfterSeconds);
      reply.status(429);
      return adminErrorEnvelope("RATE_LIMITED", "尝试次数过多，请稍后再试。", requestId, true);
    }
    if (result.kind === "invalid") {
      reply.status(401);
      return adminErrorEnvelope(
        "AUTHENTICATION_FAILED",
        "账号或凭据无效，请检查后重试。",
        requestId,
      );
    }
    reply.header(
      "Set-Cookie",
      adminSessionCookie({
        ...result.session,
        production: process.env.NODE_ENV === "production",
      }),
    );
    reply.status(201);
    return {
      recoveryCodes: [...result.recoveryCodes],
      session: adminSessionResponse(result.session),
    };
  }
}
