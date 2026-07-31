import "reflect-metadata";

import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthService } from "../admin-auth/admin-auth.service";
import { AdminAuthController, adminSessionCookie } from "./admin-auth.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { ADMIN_AUTH_SERVICE } from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";

const authService = {
  authenticateSession: vi.fn(),
  beginLogin: vi.fn(),
  beginRecovery: vi.fn(),
  completeLogin: vi.fn(),
  completeRecovery: vi.fn(),
  getSession: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  preflight: vi.fn(),
  recordCsrfRejected: vi.fn(),
} as unknown as AdminAuthService;

@Module({
  controllers: [AdminAuthController],
  providers: [
    { provide: ADMIN_AUTH_SERVICE, useValue: authService },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
class AdminAuthHttpTestModule {}

function allowedPermit(action: "login" | "login_totp" | "recovery" | "recovery_complete") {
  return {
    action,
    evidence: {
      requestId: "admin-auth-test",
      sourceFingerprint: Buffer.alloc(32, 1),
      userAgentSummary: "vitest",
    },
    result: { allowed: true as const },
  };
}

describe("admin authentication HTTP", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AdminAuthHttpTestModule,
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
    vi.mocked(authService.preflight).mockImplementation(async (action) => allowedPermit(action));
    vi.mocked(authService.recordCsrfRejected).mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps the production cookie through the 12-hour absolute limit while the server enforces idle expiry", () => {
    const cookie = adminSessionCookie({
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      production: true,
      sessionToken: "s".repeat(43),
    });

    expect(cookie).toContain("Max-Age=43200");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });

  it("creates a one-use password challenge without returning credential material", async () => {
    vi.mocked(authService.beginLogin).mockResolvedValue({
      challengeExpiresAt: new Date("2026-07-31T20:05:00.000Z"),
      challengeToken: "challenge-token-".padEnd(43, "x"),
      kind: "challenge",
    });

    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-password-challenge",
      },
      method: "POST",
      payload: { password: "correct horse battery staple", username: "Operator" },
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "x-request-id": "admin-password-challenge",
    });
    expect(response.json()).toEqual({
      challengeToken: "challenge-token-".padEnd(43, "x"),
      expiresAt: "2026-07-31T20:05:00.000Z",
    });
    expect(response.body).not.toMatch(/password|operator/iu);
    expect(authService.beginLogin).toHaveBeenCalledWith({
      password: "correct horse battery staple",
      permit: expect.objectContaining({ action: "login" }),
      username: "Operator",
    });
  });

  it("rejects a username whose first character is not alphanumeric before calling auth", async () => {
    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-invalid-username",
      },
      method: "POST",
      payload: { password: "correct horse battery staple", username: ".admin" },
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "admin-invalid-username" },
    });
    expect(authService.beginLogin).not.toHaveBeenCalled();
  });

  it("maps malformed authentication JSON to the stable no-store error envelope", async () => {
    const response = await app.inject({
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-malformed-json",
      },
      method: "POST",
      payload: "{",
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_ARGUMENT",
        details: {},
        message: "请求正文格式无效，请检查后重试。",
        requestId: "admin-malformed-json",
        retryable: false,
      },
    });
    expect(response.body).not.toMatch(/Body is not valid|Unexpected token|at position/iu);
  });

  it("maps an oversized authentication body to the same stable client error", async () => {
    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-oversized-body",
      },
      method: "POST",
      payload: { password: "x".repeat(1_100_000), username: "Operator" },
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "admin-oversized-body" },
    });
    expect(response.body).not.toMatch(/body limit|too large|1100000/iu);
  });

  it.each([
    [
      "empty JSON",
      {
        headers: { "content-type": "application/json" },
      },
    ],
    [
      "unsupported media",
      {
        headers: { "content-type": "application/xml" },
        payload: "<login />",
      },
    ],
    [
      "invalid content length",
      {
        headers: { "content-length": "20" },
        payload: { password: "correct horse battery staple", username: "Operator" },
      },
    ],
  ])("maps %s parser failures to stable 400", async (_caseName, input) => {
    const response = await app.inject({
      ...input,
      headers: {
        ...input.headers,
        origin: "http://127.0.0.1:3000",
        "x-request-id": `admin-parser-${_caseName.replaceAll(" ", "-")}`,
      },
      method: "POST",
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(response.body).not.toMatch(
      /FST_ERR|Request body size|Unsupported Media Type|Body cannot be empty/iu,
    );
  });

  it("maps an unexpected admin store failure to a stable retryable 503", async () => {
    vi.mocked(authService.beginLogin).mockRejectedValue(
      new Error("postgresql://admin-password@secret-host/five"),
    );

    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-controller-unavailable",
      },
      method: "POST",
      payload: { password: "correct horse battery staple", username: "Operator" },
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.json()).toEqual({
      error: {
        code: "ADMIN_SERVICE_UNAVAILABLE",
        details: {},
        message: "后台服务暂时不可用，请稍后再试。",
        requestId: "admin-controller-unavailable",
        retryable: true,
      },
    });
    expect(response.body).not.toContain("postgresql://admin-password@secret-host/five");
  });

  it("establishes the admin session in an HttpOnly strict same-site cookie", async () => {
    vi.mocked(authService.completeLogin).mockResolvedValue({
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      accountId: "admin-1",
      credentialRevision: 4,
      csrfToken: "csrf-token".padEnd(43, "c"),
      idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      kind: "authenticated",
      sessionToken: "session-token".padEnd(43, "s"),
      username: "operator",
    });

    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-session-create",
      },
      method: "POST",
      payload: {
        challengeToken: "challenge-token".padEnd(43, "x"),
        totpCode: "123456",
      },
      url: "/admin/api/v1/auth/sessions",
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toContain(
      `five_admin_session=${"session-token".padEnd(43, "s")}`,
    );
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.headers["set-cookie"]).toContain("Path=/admin");
    expect(response.headers["set-cookie"]).toContain("Max-Age=43200");
    expect(response.headers["set-cookie"]).not.toContain("Domain=");
    expect(response.json()).toEqual({
      absoluteExpiresAt: "2026-08-01T08:00:00.000Z",
      credentialRevision: 4,
      csrfToken: "csrf-token".padEnd(43, "c"),
      idleExpiresAt: "2026-07-31T20:30:00.000Z",
      issuedAt: "2026-07-31T20:00:00.000Z",
      username: "operator",
    });
    expect(response.body).not.toContain("session-token");
  });

  it("returns the current session and its in-memory CSRF token", async () => {
    const principal = {
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      accountId: "admin-1",
      credentialRevision: 4,
      csrfToken: "csrf-current".padEnd(43, "c"),
      idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      sessionTokenDigest: Buffer.alloc(32, 2),
      username: "operator",
    };
    vi.mocked(authService.authenticateSession).mockResolvedValue(principal);

    const response = await app.inject({
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/auth/session",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      credentialRevision: 4,
      csrfToken: "csrf-current".padEnd(43, "c"),
      username: "operator",
    });
    expect(authService.getSession).not.toHaveBeenCalled();
  });

  it("revokes the current session and clears the cookie", async () => {
    const principal = {
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      accountId: "admin-1",
      credentialRevision: 4,
      csrfToken: "c".repeat(43),
      idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      sessionTokenDigest: Buffer.alloc(32, 2),
      username: "operator",
    };
    vi.mocked(authService.authenticateSession).mockResolvedValue(principal);
    vi.mocked(authService.logout).mockResolvedValue(true);

    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "c".repeat(43),
        "x-request-id": "admin-logout-current",
      },
      method: "DELETE",
      url: "/admin/api/v1/auth/session",
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["set-cookie"]).toContain("five_admin_session=");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.headers["set-cookie"]).toContain("Path=/admin");
    expect(authService.logout).toHaveBeenCalledWith({
      context: expect.objectContaining({ requestId: "admin-logout-current" }),
      csrfToken: "c".repeat(43),
      sessionToken: "s".repeat(43),
    });
  });

  it("revokes every session without changing the credential revision", async () => {
    const principal = {
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      accountId: "admin-1",
      credentialRevision: 4,
      csrfToken: "c".repeat(43),
      idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      sessionTokenDigest: Buffer.alloc(32, 2),
      username: "operator",
    };
    vi.mocked(authService.authenticateSession).mockResolvedValue(principal);
    vi.mocked(authService.logoutAll).mockResolvedValue(true);

    const response = await app.inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "c".repeat(43),
        "x-request-id": "admin-logout-all",
      },
      method: "POST",
      url: "/admin/api/v1/auth/logout-all",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(authService.logoutAll).toHaveBeenCalledWith({
      context: expect.objectContaining({ requestId: "admin-logout-all" }),
      principal,
    });
  });

  it("consumes one recovery code and returns only the pending TOTP provisioning", async () => {
    vi.mocked(authService.beginRecovery).mockResolvedValue({
      challengeExpiresAt: new Date("2026-07-31T20:10:00.000Z"),
      challengeToken: "recovery-challenge".padEnd(43, "r"),
      kind: "challenge",
      totpSetup: {
        otpauthUri:
          "otpauth://totp/Five%3Aoperator?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Five&algorithm=SHA1&digits=6&period=30",
        secretBase32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
      },
    });

    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-recovery-begin",
      },
      method: "POST",
      payload: { recoveryCode: "RC-1234567890123456", username: "Operator" },
      url: "/admin/api/v1/auth/recovery-challenges",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      challengeToken: "recovery-challenge".padEnd(43, "r"),
      expiresAt: "2026-07-31T20:10:00.000Z",
      totpProvisioning: {
        algorithm: "SHA1",
        digits: 6,
        otpauthUri:
          "otpauth://totp/Five%3Aoperator?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Five&algorithm=SHA1&digits=6&period=30",
        periodSeconds: 30,
        secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
      },
    });
    expect(response.body).not.toContain("RC-1234567890123456");
  });

  it("completes recovery, creates a session, and displays exactly ten new codes once", async () => {
    const sessionToken = "recovered-session".padEnd(43, "s");
    const recoveryCodes = Array.from(
      { length: 10 },
      (_, index) => `RC-${String(index + 1).padStart(2, "0")}-${"x".repeat(24)}`,
    );
    vi.mocked(authService.completeRecovery).mockResolvedValue({
      kind: "completed",
      recoveryCodes,
      session: {
        absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
        accountId: "admin-1",
        credentialRevision: 5,
        csrfToken: "recovered-csrf".padEnd(43, "c"),
        idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
        issuedAt: new Date("2026-07-31T20:00:00.000Z"),
        sessionToken,
        username: "operator",
      },
    });

    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-recovery-complete",
      },
      method: "POST",
      payload: {
        challengeToken: "recovery-challenge".padEnd(43, "r"),
        newPassword: "new correct horse battery staple",
        totpCode: "654321",
      },
      url: "/admin/api/v1/auth/recovery-completions",
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toContain(`five_admin_session=${sessionToken}`);
    expect(response.json()).toEqual({
      recoveryCodes,
      session: {
        absoluteExpiresAt: "2026-08-01T08:00:00.000Z",
        credentialRevision: 5,
        csrfToken: "recovered-csrf".padEnd(43, "c"),
        idleExpiresAt: "2026-07-31T20:30:00.000Z",
        issuedAt: "2026-07-31T20:00:00.000Z",
        username: "operator",
      },
    });
    expect(response.body).not.toContain(sessionToken);
    expect(authService.getSession).not.toHaveBeenCalled();
  });
});
