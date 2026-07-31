import { createHmac, randomBytes } from "node:crypto";

import { resolveHttpRequestId } from "../http/request-id";
import {
  FEEDBACK_REPORT_PATH,
  feedbackErrorEnvelope,
  type FeedbackErrorEnvelope,
} from "./feedback-http";

const SOURCE_WINDOW_MILLISECONDS = 60_000;
const SOURCE_WINDOW_CAPACITY = 12;
const MAX_SOURCE_BUCKETS = 4_096;
const BODY_ERROR_CODES = new Set(["FST_ERR_CTP_BODY_TOO_LARGE", "FST_ERR_CTP_INVALID_JSON_BODY"]);

interface FeedbackFastifyRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  url?: string;
}

interface FeedbackFastifyReply {
  header(name: string, value: string | number): FeedbackFastifyReply;
  send(body: FeedbackErrorEnvelope): unknown;
  status(code: number): FeedbackFastifyReply;
}

interface FeedbackFastifyError {
  code?: unknown;
}

interface FeedbackFastifyInstance {
  addHook(name: "onClose", hook: (instance: unknown, done: (error?: Error) => void) => void): void;
  addHook(
    name: "onError",
    hook: (
      request: FeedbackFastifyRequest,
      reply: FeedbackFastifyReply,
      error: unknown,
      done: (error?: Error) => void,
    ) => void,
  ): void;
  addHook(
    name: "onRequest",
    hook: (
      request: FeedbackFastifyRequest,
      reply: FeedbackFastifyReply,
      done: (error?: Error) => void,
    ) => void,
  ): void;
  addHook(
    name: "onSend",
    hook: (
      request: FeedbackFastifyRequest,
      reply: FeedbackFastifyReply,
      payload: unknown,
      done: (error: Error | null, payload?: unknown) => void,
    ) => void,
  ): void;
}

interface SourceBucket {
  count: number;
  resetAt: number;
}

interface ParserErrorResponse {
  body: FeedbackErrorEnvelope;
  requestId: string;
}

function isFeedbackRequest(request: FeedbackFastifyRequest): boolean {
  return (
    request.method === "POST" &&
    typeof request.url === "string" &&
    request.url.split("?", 1)[0] === FEEDBACK_REPORT_PATH
  );
}

function incomingRequestId(request: FeedbackFastifyRequest): string | undefined {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : undefined;
}

function isFeedbackBodyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code } = error as FeedbackFastifyError;
  return typeof code === "string" && BODY_ERROR_CODES.has(code);
}

/**
 * Installs protection before Fastify registers its routes and body parsers.
 *
 * The source token is an HMAC made with a process-random key. Raw IP addresses are never retained,
 * and every token expires with its one-minute bucket. PostgreSQL still applies the cross-process
 * accepted-report limit; this early gate protects body parsing and prevents one source consuming it.
 */
export function installFeedbackRequestProtection(instance: FeedbackFastifyInstance): void {
  const sourceSecret = randomBytes(32);
  const sourceBuckets = new Map<string, SourceBucket>();
  const parserErrorResponses = new WeakMap<FeedbackFastifyRequest, ParserErrorResponse>();

  function sourceToken(source: string): string {
    return createHmac("sha256", sourceSecret).update(source).digest("base64url");
  }

  function pruneExpiredBuckets(now: number): void {
    for (const [token, bucket] of sourceBuckets) {
      if (bucket.resetAt <= now) {
        sourceBuckets.delete(token);
      }
    }
  }

  const bucketSweepTimer = setInterval(
    () => pruneExpiredBuckets(Date.now()),
    SOURCE_WINDOW_MILLISECONDS,
  );
  bucketSweepTimer.unref();

  instance.addHook("onClose", (_fastify, done) => {
    clearInterval(bucketSweepTimer);
    sourceBuckets.clear();
    done();
  });

  instance.addHook("onRequest", (request, reply, done) => {
    if (!isFeedbackRequest(request)) {
      done();
      return;
    }

    const now = Date.now();
    if (sourceBuckets.size >= MAX_SOURCE_BUCKETS) {
      pruneExpiredBuckets(now);
      while (sourceBuckets.size >= MAX_SOURCE_BUCKETS) {
        const oldest = sourceBuckets.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        sourceBuckets.delete(oldest);
      }
    }
    const token = sourceToken(request.ip ?? "unknown");
    let bucket = sourceBuckets.get(token);
    if (bucket === undefined || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + SOURCE_WINDOW_MILLISECONDS };
      sourceBuckets.set(token, bucket);
    }

    if (bucket.count >= SOURCE_WINDOW_CAPACITY) {
      const requestId = resolveHttpRequestId(incomingRequestId(request));
      reply.header("Cache-Control", "no-store");
      reply.header("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)));
      reply.header("X-Request-Id", requestId);
      reply
        .status(429)
        .send(feedbackErrorEnvelope("RATE_LIMITED", "提交过于频繁，请稍后再试。", requestId, true));
      return;
    }

    bucket.count += 1;
    done();
  });

  instance.addHook("onError", (request, reply, error, done) => {
    if (!isFeedbackRequest(request) || !isFeedbackBodyError(error)) {
      done();
      return;
    }

    const requestId = resolveHttpRequestId(incomingRequestId(request));
    parserErrorResponses.set(request, {
      body: feedbackErrorEnvelope(
        "INVALID_ARGUMENT",
        "反馈信息格式无效，请检查后重试。",
        requestId,
        false,
      ),
      requestId,
    });
    reply.header("Cache-Control", "no-store");
    reply.header("X-Request-Id", requestId);
    done();
  });

  instance.addHook("onSend", (request, reply, payload, done) => {
    const parserError = parserErrorResponses.get(request);
    if (parserError === undefined) {
      done(null, payload);
      return;
    }

    parserErrorResponses.delete(request);
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("X-Request-Id", parserError.requestId);
    reply.status(400);
    done(null, JSON.stringify(parserError.body));
  });
}
