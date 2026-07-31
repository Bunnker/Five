import type { components } from "@five/api-contract";

import type {
  AdminAuthService,
  AdminSourceRateLimitPermit,
  SessionPrincipal,
} from "../admin-auth/admin-auth.service";
import { resolveHttpRequestId } from "../http/request-id";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export interface AdminProtectionRequest {
  adminAuthPermit?: AdminSourceRateLimitPermit;
  adminPrincipal?: SessionPrincipal;
  adminRequestId?: string;
  adminSessionToken?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  url?: string;
}

interface AdminProtectionReply {
  header(name: string, value: string | number): AdminProtectionReply;
  send(body: ErrorEnvelope): unknown;
  status(code: number): AdminProtectionReply;
}

interface AdminFastifyError {
  readonly code?: unknown;
}

export interface AdminProtectionFastifyInstance {
  addHook(
    name: "onError",
    hook: (
      request: AdminProtectionRequest,
      reply: AdminProtectionReply,
      error: unknown,
      done: (error?: Error) => void,
    ) => void,
  ): void;
  addHook(
    name: "onRequest",
    hook: (
      request: AdminProtectionRequest,
      reply: AdminProtectionReply,
      done: (error?: Error) => void,
    ) => void,
  ): void;
  addHook(
    name: "onSend",
    hook: (
      request: AdminProtectionRequest,
      reply: AdminProtectionReply,
      payload: unknown,
      done: (error: Error | null, payload?: unknown) => void,
    ) => void,
  ): void;
}

type ProtectionService = Pick<
  AdminAuthService,
  "authenticateSession" | "preflight" | "recordCsrfRejected"
>;

const PUBLIC_AUTH_POST_PATHS = new Set([
  "/admin/api/v1/auth/password-challenges",
  "/admin/api/v1/auth/recovery-challenges",
  "/admin/api/v1/auth/recovery-completions",
  "/admin/api/v1/auth/sessions",
]);
const ADMIN_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ADMIN_BODY_ERROR_CODES = new Set([
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
]);

function authActionForPath(path: string): AdminSourceRateLimitPermit["action"] | null {
  switch (path) {
    case "/admin/api/v1/auth/password-challenges":
      return "login";
    case "/admin/api/v1/auth/sessions":
      return "login_totp";
    case "/admin/api/v1/auth/recovery-challenges":
      return "recovery";
    case "/admin/api/v1/auth/recovery-completions":
      return "recovery_complete";
    default:
      return null;
  }
}

function singleHeader(request: AdminProtectionRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function requestPath(request: AdminProtectionRequest): string | null {
  return typeof request.url === "string" ? (request.url.split("?", 1)[0] ?? null) : null;
}

function sessionTokenFromCookie(request: AdminProtectionRequest): string | null {
  const cookieHeader = singleHeader(request, "cookie");
  if (cookieHeader === undefined) {
    return null;
  }
  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("five_admin_session="))
    .map((part) => part.slice("five_admin_session=".length));
  if (matches.length !== 1) {
    return null;
  }
  const token = matches[0] ?? "";
  return /^[A-Za-z0-9_-]{32,512}$/u.test(token) ? token : null;
}

function requestContext(request: AdminProtectionRequest, requestId: string) {
  return {
    requestId,
    source: request.ip ?? "unknown",
    userAgent: singleHeader(request, "user-agent") ?? null,
  };
}

function errorEnvelope(
  code: components["schemas"]["ErrorCode"],
  message: string,
  requestId: string,
  retryable: boolean,
): ErrorEnvelope {
  return { error: { code, details: {}, message, requestId, retryable } };
}

function failAdminServiceUnavailable(reply: AdminProtectionReply, requestId: string): void {
  reply.header("Retry-After", 30);
  reply
    .status(503)
    .send(
      errorEnvelope(
        "ADMIN_SERVICE_UNAVAILABLE",
        "后台服务暂时不可用，请稍后再试。",
        requestId,
        true,
      ),
    );
}

/**
 * Runs before Fastify parses an admin request body. Public-auth writes must pass the trusted-origin
 * and persistent source gates; protected writes reject an untrusted Origin before touching a
 * session, so rejected traffic cannot extend the session idle deadline.
 */
export function installAdminRequestProtection(
  instance: AdminProtectionFastifyInstance,
  service: ProtectionService,
  trustedOrigins: ReadonlySet<string>,
): void {
  const errorResponses = new WeakMap<
    AdminProtectionRequest,
    {
      readonly body: ErrorEnvelope;
      readonly requestId: string;
      readonly retryAfter: number | null;
      readonly status: number;
    }
  >();

  function rejectCsrf(
    request: AdminProtectionRequest,
    reply: AdminProtectionReply,
    requestId: string,
    accountId: string | null,
    reasonCategory: "csrf_mismatch" | "csrf_missing" | "origin_missing" | "origin_untrusted",
  ): void {
    void service
      .recordCsrfRejected({
        accountId,
        context: requestContext(request, requestId),
        reasonCategory,
      })
      .catch(() => undefined)
      .finally(() => {
        reply
          .status(403)
          .send(
            errorEnvelope(
              "CSRF_VALIDATION_FAILED",
              "请求来源验证失败，请刷新后台页面后重试。",
              requestId,
              false,
            ),
          );
      });
  }

  instance.addHook("onRequest", (request, reply, done) => {
    const path = requestPath(request);
    if (path?.startsWith("/admin/api/v1") !== true) {
      done();
      return;
    }

    const requestId = resolveHttpRequestId(singleHeader(request, "x-request-id"));
    request.adminRequestId = requestId;
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Request-Id", requestId);

    const isPublicAuthPost =
      request.method === "POST" && path !== null && PUBLIC_AUTH_POST_PATHS.has(path);
    if (!isPublicAuthPost) {
      const isWrite = !ADMIN_READ_METHODS.has(request.method ?? "");
      if (isWrite) {
        const origin = singleHeader(request, "origin");
        if (origin === undefined || !trustedOrigins.has(origin)) {
          rejectCsrf(
            request,
            reply,
            requestId,
            null,
            origin === undefined ? "origin_missing" : "origin_untrusted",
          );
          return;
        }
      }
      const sessionToken = sessionTokenFromCookie(request);
      if (sessionToken === null) {
        reply
          .status(401)
          .send(
            errorEnvelope(
              "UNAUTHENTICATED",
              "后台会话不存在或已失效，请重新登录。",
              requestId,
              false,
            ),
          );
        return;
      }
      void service
        .authenticateSession({ requireCsrf: false, sessionToken })
        .then((principal) => {
          if (principal === null) {
            reply
              .status(401)
              .send(
                errorEnvelope(
                  "UNAUTHENTICATED",
                  "后台会话不存在或已失效，请重新登录。",
                  requestId,
                  false,
                ),
              );
            return;
          }
          request.adminPrincipal = principal;
          request.adminSessionToken = sessionToken;
          if (isWrite) {
            const csrfToken = singleHeader(request, "x-csrf-token");
            if (csrfToken === undefined) {
              rejectCsrf(request, reply, requestId, principal.accountId, "csrf_missing");
              return;
            }
            void service
              .authenticateSession({
                csrfToken,
                requireCsrf: true,
                sessionToken,
              })
              .then((csrfPrincipal) => {
                if (csrfPrincipal === null) {
                  rejectCsrf(request, reply, requestId, principal.accountId, "csrf_mismatch");
                  return;
                }
                request.adminPrincipal = csrfPrincipal;
                done();
              })
              .catch(() => failAdminServiceUnavailable(reply, requestId));
            return;
          }
          done();
        })
        .catch(() => failAdminServiceUnavailable(reply, requestId));
      return;
    }

    const origin = singleHeader(request, "origin");
    if (origin !== undefined && trustedOrigins.has(origin)) {
      const action = authActionForPath(path);
      if (action === null) {
        done();
        return;
      }
      void service
        .preflight(action, requestContext(request, requestId))
        .then((permit) => {
          request.adminAuthPermit = permit;
          if (permit.result.allowed) {
            done();
            return;
          }
          reply.header("Retry-After", permit.result.retryAfterSeconds);
          reply
            .status(429)
            .send(errorEnvelope("RATE_LIMITED", "尝试次数过多，请稍后再试。", requestId, true));
        })
        .catch(() => failAdminServiceUnavailable(reply, requestId));
      return;
    }

    rejectCsrf(
      request,
      reply,
      requestId,
      null,
      origin === undefined ? "origin_missing" : "origin_untrusted",
    );
  });

  instance.addHook("onError", (request, reply, error, done) => {
    if (requestPath(request)?.startsWith("/admin/api/v1") !== true) {
      done();
      return;
    }
    const requestId =
      request.adminRequestId ?? resolveHttpRequestId(singleHeader(request, "x-request-id"));
    const errorCode =
      typeof error === "object" && error !== null ? (error as AdminFastifyError).code : undefined;
    const isBodyError = typeof errorCode === "string" && ADMIN_BODY_ERROR_CODES.has(errorCode);
    errorResponses.set(request, {
      body: isBodyError
        ? errorEnvelope("INVALID_ARGUMENT", "请求正文格式无效，请检查后重试。", requestId, false)
        : errorEnvelope(
            "ADMIN_SERVICE_UNAVAILABLE",
            "后台服务暂时不可用，请稍后再试。",
            requestId,
            true,
          ),
      requestId,
      retryAfter: isBodyError ? null : 30,
      status: isBodyError ? 400 : 503,
    });
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Request-Id", requestId);
    done();
  });

  instance.addHook("onSend", (request, reply, payload, done) => {
    const replacement = errorResponses.get(request);
    if (replacement === undefined) {
      done(null, payload);
      return;
    }
    errorResponses.delete(request);
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Referrer-Policy", "no-referrer");
    if (replacement.retryAfter !== null) {
      reply.header("Retry-After", replacement.retryAfter);
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Request-Id", replacement.requestId);
    reply.status(replacement.status);
    done(null, JSON.stringify(replacement.body));
  });
}

export function adminTrustedOriginsFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ReadonlySet<string> {
  const configured = environment.FIVE_ADMIN_TRUSTED_ORIGINS;
  const values =
    configured === undefined && environment.NODE_ENV === "test"
      ? ["http://127.0.0.1:3000", "http://localhost:3000"]
      : (configured ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
  if (values.length === 0) {
    throw new Error("FIVE_ADMIN_TRUSTED_ORIGINS must contain at least one trusted web Origin");
  }
  const origins = new Set<string>();
  for (const value of values) {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.origin !== value
    ) {
      throw new Error("FIVE_ADMIN_TRUSTED_ORIGINS contains an invalid Origin");
    }
    origins.add(parsed.origin);
  }
  return origins;
}
