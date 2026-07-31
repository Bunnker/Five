import type { ArgumentsHost } from "@nestjs/common";
import { Catch, HttpException, Injectable } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { BaseExceptionFilter } from "@nestjs/core";

import { resolveHttpRequestId } from "../http/request-id";
import { adminErrorEnvelope } from "./admin-http";
import type { AdminProtectionRequest } from "./admin-request-protection";

interface ExceptionReply {
  header(name: string, value: string | number): ExceptionReply;
  send(body: unknown): unknown;
  status(code: number): ExceptionReply;
}

function incomingRequestId(request: AdminProtectionRequest): string | undefined {
  const value = request.headers["x-request-id"];
  return typeof value === "string" ? value : undefined;
}

@Catch()
@Injectable()
export class AdminHttpExceptionFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AdminProtectionRequest>();
    const path = typeof request.url === "string" ? request.url.split("?", 1)[0] : null;
    if (path?.startsWith("/admin/api/v1") !== true) {
      super.catch(exception, host);
      return;
    }

    const reply = http.getResponse<ExceptionReply>();
    const requestId = request.adminRequestId ?? resolveHttpRequestId(incomingRequestId(request));
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Request-Id", requestId);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 400 || status === 413 || status === 422) {
        reply
          .status(400)
          .send(
            adminErrorEnvelope("INVALID_ARGUMENT", "请求字段或格式无效，请检查后重试。", requestId),
          );
        return;
      }
      if (status === 401) {
        reply
          .status(401)
          .send(
            adminErrorEnvelope(
              "UNAUTHENTICATED",
              "后台会话不存在或已失效，请重新登录。",
              requestId,
            ),
          );
        return;
      }
      if (status === 403) {
        reply.status(403).send(adminErrorEnvelope("FORBIDDEN", "当前操作不被允许。", requestId));
        return;
      }
      if (status === 404 || status === 405) {
        reply
          .status(404)
          .send(adminErrorEnvelope("RESOURCE_NOT_FOUND", "后台资源不存在。", requestId));
        return;
      }
    }

    reply.header("Retry-After", 30);
    reply
      .status(503)
      .send(
        adminErrorEnvelope(
          "ADMIN_SERVICE_UNAVAILABLE",
          "后台服务暂时不可用，请稍后再试。",
          requestId,
          true,
        ),
      );
  }
}
