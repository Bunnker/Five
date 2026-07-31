import type { components } from "@five/api-contract";

import { resolveHttpRequestId } from "./request-id";

type ErrorCode = components["schemas"]["ErrorCode"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

const STOPPED_RETRY_AFTER_SECONDS = 60;
const STORE_FAILURE_RETRY_AFTER_SECONDS = 30;

export interface PublicAccessGateRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method?: string;
  readonly url?: string;
}

interface PublicAccessGateReply {
  header(name: string, value: string | number): PublicAccessGateReply;
  send(body: ErrorEnvelope): unknown;
  status(code: number): PublicAccessGateReply;
}

export interface PublicAccessGateFastifyInstance {
  addHook(
    name: "onRequest",
    hook: (
      request: PublicAccessGateRequest,
      reply: PublicAccessGateReply,
      done: (error?: Error) => void,
    ) => void,
  ): void;
}

export interface PublicAccessStateReader {
  getPublicAccessControl(): Promise<{ readonly publiclyEnabled: boolean }>;
}

function requestPath(request: PublicAccessGateRequest): string | null {
  return typeof request.url === "string" ? (request.url.split("?", 1)[0] ?? null) : null;
}

function isGatedPublicPath(path: string | null): boolean {
  return (
    path === "/api/v1/today" ||
    path?.startsWith("/api/v1/daily/") === true ||
    path === "/api/v1/poster-jobs" ||
    path?.startsWith("/api/v1/poster-jobs/") === true ||
    path?.startsWith("/api/v1/poster-assets/") === true
  );
}

function incomingRequestId(request: PublicAccessGateRequest): string | undefined {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : undefined;
}

function errorEnvelope(code: ErrorCode, message: string, requestId: string): ErrorEnvelope {
  return {
    error: {
      code,
      details: {},
      message,
      requestId,
      retryable: true,
    },
  };
}

function failClosed(
  request: PublicAccessGateRequest,
  reply: PublicAccessGateReply,
  code: ErrorCode,
  message: string,
  retryAfterSeconds: number,
): void {
  const requestId = resolveHttpRequestId(incomingRequestId(request));
  reply.header("Cache-Control", "no-store");
  reply.header("Retry-After", retryAfterSeconds);
  reply.header("X-Request-Id", requestId);
  reply.status(503).send(errorEnvelope(code, message, requestId));
}

/**
 * Checks the persistent emergency switch before parsing a public request body or invoking Nest.
 * Feedback and health routes deliberately remain reachable while published content is stopped.
 */
export function installPublicAccessGate(
  instance: PublicAccessGateFastifyInstance,
  reader: PublicAccessStateReader,
): void {
  instance.addHook("onRequest", (request, reply, done) => {
    const path = requestPath(request);
    if (!isGatedPublicPath(path)) {
      done();
      return;
    }

    void reader
      .getPublicAccessControl()
      .then((state) => {
        if (state.publiclyEnabled) {
          done();
          return;
        }
        failClosed(
          request,
          reply,
          "PUBLIC_ACCESS_STOPPED",
          "公开内容已暂停，请稍后再试。",
          STOPPED_RETRY_AFTER_SECONDS,
        );
      })
      .catch(() => {
        const posterRequest = path?.startsWith("/api/v1/poster-") === true;
        failClosed(
          request,
          reply,
          posterRequest ? "POSTER_GENERATION_UNAVAILABLE" : "CONTENT_NOT_READY",
          posterRequest
            ? "海报暂时不可用，今日内容和分享链接不受影响。"
            : "今日内容正在校验中，请稍后重试。",
          STORE_FAILURE_RETRY_AFTER_SECONDS,
        );
      });
  });
}
