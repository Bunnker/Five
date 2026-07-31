import { describe, expect, it, vi } from "vitest";

import type { AdminAuthService } from "../admin-auth/admin-auth.service";
import {
  installAdminRequestProtection,
  type AdminProtectionFastifyInstance,
  type AdminProtectionRequest,
} from "./admin-request-protection";

function createHarness(
  service: Pick<AdminAuthService, "authenticateSession" | "preflight" | "recordCsrfRejected">,
) {
  let onRequest:
    | ((
        request: AdminProtectionRequest,
        reply: {
          header(name: string, value: string | number): unknown;
          send(body: unknown): unknown;
          status(code: number): unknown;
        },
        done: (error?: Error) => void,
      ) => void)
    | undefined;
  const instance = {
    addHook: vi.fn((name: string, hook: typeof onRequest) => {
      if (name === "onRequest") {
        onRequest = hook;
      }
    }),
  } as unknown as AdminProtectionFastifyInstance;

  installAdminRequestProtection(instance, service, new Set(["http://127.0.0.1:3000"]));

  async function inject(request: AdminProtectionRequest) {
    if (onRequest === undefined) {
      throw new Error("onRequest hook was not installed");
    }
    const headers: Record<string, string | number> = {};
    let body: unknown;
    let statusCode = 200;
    let continued = false;

    await new Promise<void>((resolve, reject) => {
      const reply = {
        header(name: string, value: string | number) {
          headers[name.toLowerCase()] = value;
          return this;
        },
        send(value: unknown) {
          body = value;
          resolve();
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      };
      onRequest?.(request, reply, (error) => {
        if (error === undefined) {
          continued = true;
          resolve();
        } else {
          reject(error);
        }
      });
    });

    return { body, continued, headers, statusCode };
  }

  return { inject };
}

describe("admin request protection", () => {
  it("rejects an untrusted Origin before an unauthenticated login body can be parsed", async () => {
    const service = {
      authenticateSession: vi.fn(),
      preflight: vi.fn(),
      recordCsrfRejected: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);

    const response = await inject({
      headers: {
        origin: "https://attacker.example",
        "x-request-id": "admin-origin-rejected",
      },
      ip: "203.0.113.8",
      method: "POST",
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response).toEqual({
      body: {
        error: {
          code: "CSRF_VALIDATION_FAILED",
          details: {},
          message: "请求来源验证失败，请刷新后台页面后重试。",
          requestId: "admin-origin-rejected",
          retryable: false,
        },
      },
      continued: false,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-request-id": "admin-origin-rejected",
      },
      statusCode: 403,
    });
    expect(service.preflight).not.toHaveBeenCalled();
    expect(service.recordCsrfRejected).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: null, reasonCategory: "origin_untrusted" }),
    );
  });

  it("consumes the persistent source permit before continuing to a public auth parser", async () => {
    const permit = {
      action: "login" as const,
      evidence: {
        requestId: "admin-login-preflight",
        sourceFingerprint: Buffer.alloc(32, 7),
        userAgentSummary: "test-browser",
      },
      result: { allowed: true as const },
    };
    const service = {
      authenticateSession: vi.fn(),
      preflight: vi.fn().mockResolvedValue(permit),
      recordCsrfRejected: vi.fn(),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);
    const request: AdminProtectionRequest = {
      headers: {
        origin: "http://127.0.0.1:3000",
        "user-agent": "test-browser",
        "x-request-id": "admin-login-preflight",
      },
      ip: "203.0.113.9",
      method: "POST",
      url: "/admin/api/v1/auth/password-challenges",
    };

    const response = await inject(request);

    expect(response.continued).toBe(true);
    expect(service.preflight).toHaveBeenCalledWith("login", {
      requestId: "admin-login-preflight",
      source: "203.0.113.9",
      userAgent: "test-browser",
    });
    expect(request.adminAuthPermit).toBe(permit);
  });

  it("returns the stable rate-limit envelope without continuing to body parsing", async () => {
    const service = {
      authenticateSession: vi.fn(),
      preflight: vi.fn().mockResolvedValue({
        action: "recovery",
        evidence: {
          requestId: "admin-source-limited",
          sourceFingerprint: Buffer.alloc(32, 4),
          userAgentSummary: "unknown",
        },
        result: { allowed: false, retryAfterSeconds: 41 },
      }),
      recordCsrfRejected: vi.fn(),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);

    const response = await inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-source-limited",
      },
      ip: "203.0.113.10",
      method: "POST",
      url: "/admin/api/v1/auth/recovery-challenges",
    });

    expect(response.continued).toBe(false);
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe(41);
    expect(response.body).toEqual({
      error: {
        code: "RATE_LIMITED",
        details: {},
        message: "尝试次数过多，请稍后再试。",
        requestId: "admin-source-limited",
        retryable: true,
      },
    });
  });

  it("fails closed with a stable response when the persistent preflight store is unavailable", async () => {
    const service = {
      authenticateSession: vi.fn(),
      preflight: vi.fn().mockRejectedValue(new Error("postgres://secret-host/five")),
      recordCsrfRejected: vi.fn(),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);

    const response = await inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "admin-store-unavailable",
      },
      method: "POST",
      url: "/admin/api/v1/auth/password-challenges",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe(30);
    expect(response.body).toMatchObject({
      error: {
        code: "ADMIN_SERVICE_UNAVAILABLE",
        requestId: "admin-store-unavailable",
        retryable: true,
      },
    });
    expect(JSON.stringify(response)).not.toContain("postgres://secret-host/five");
  });

  it("protects every other admin API path by default, including routes not registered yet", async () => {
    const service = {
      authenticateSession: vi.fn(),
      preflight: vi.fn(),
      recordCsrfRejected: vi.fn(),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);

    const response = await inject({
      headers: { "x-request-id": "admin-default-deny" },
      method: "GET",
      url: "/admin/api/v1/future-sensitive-route",
    });

    expect(response.continued).toBe(false);
    expect(response.statusCode).toBe(401);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": "admin-default-deny",
    });
    expect(response.body).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        details: {},
        message: "后台会话不存在或已失效，请重新登录。",
        requestId: "admin-default-deny",
        retryable: false,
      },
    });
  });

  it("attaches an authenticated principal to a read request", async () => {
    const principal = {
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      accountId: "admin-1",
      credentialRevision: 3,
      idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      sessionTokenDigest: Buffer.alloc(32, 3),
      username: "operator",
    };
    const service = {
      authenticateSession: vi.fn().mockResolvedValue(principal),
      preflight: vi.fn(),
      recordCsrfRejected: vi.fn(),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);
    const request: AdminProtectionRequest = {
      headers: { cookie: `five_admin_session=${"s".repeat(43)}` },
      method: "GET",
      url: "/admin/api/v1/security-events",
    };

    const response = await inject(request);

    expect(response.continued).toBe(true);
    expect(service.authenticateSession).toHaveBeenCalledWith({
      requireCsrf: false,
      sessionToken: "s".repeat(43),
    });
    expect(request.adminPrincipal).toBe(principal);
    expect(request.adminSessionToken).toBe("s".repeat(43));
  });

  it("rejects a protected write from an untrusted Origin before touching the session", async () => {
    const service = {
      authenticateSession: vi.fn(),
      preflight: vi.fn(),
      recordCsrfRejected: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);

    const response = await inject({
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        origin: "https://attacker.example",
        "x-csrf-token": "c".repeat(43),
        "x-request-id": "admin-write-origin",
      },
      method: "POST",
      url: "/admin/api/v1/auth/logout-all",
    });

    expect(response.continued).toBe(false);
    expect(response.statusCode).toBe(403);
    expect(service.recordCsrfRejected).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: null, reasonCategory: "origin_untrusted" }),
    );
    expect(service.authenticateSession).not.toHaveBeenCalled();
  });

  it("requires the session-bound CSRF token after the write Origin is trusted", async () => {
    const principal = {
      absoluteExpiresAt: new Date("2026-08-01T08:00:00.000Z"),
      accountId: "admin-1",
      credentialRevision: 3,
      idleExpiresAt: new Date("2026-07-31T20:30:00.000Z"),
      issuedAt: new Date("2026-07-31T20:00:00.000Z"),
      sessionTokenDigest: Buffer.alloc(32, 3),
      username: "operator",
    };
    const service = {
      authenticateSession: vi.fn().mockResolvedValue(principal),
      preflight: vi.fn(),
      recordCsrfRejected: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pick<
      AdminAuthService,
      "authenticateSession" | "preflight" | "recordCsrfRejected"
    >;
    const { inject } = createHarness(service);
    const request: AdminProtectionRequest = {
      headers: {
        cookie: `five_admin_session=${"s".repeat(43)}`,
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": "c".repeat(43),
      },
      method: "POST",
      url: "/admin/api/v1/auth/logout-all",
    };

    const response = await inject(request);

    expect(response.continued).toBe(true);
    expect(service.authenticateSession).toHaveBeenNthCalledWith(1, {
      requireCsrf: false,
      sessionToken: "s".repeat(43),
    });
    expect(service.authenticateSession).toHaveBeenNthCalledWith(2, {
      csrfToken: "c".repeat(43),
      requireCsrf: true,
      sessionToken: "s".repeat(43),
    });
    expect(request.adminPrincipal).toBe(principal);
  });
});
