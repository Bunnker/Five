import { Controller, Get, Inject, Param, Query, Req, Res } from "@nestjs/common";

import type {
  AdminActionableIssueList,
  AdminCalendarMonth,
  AdminDayDetail,
  AdminOperationsOverview,
  AdminOperationsService,
} from "../admin-operations/admin-operations.service";
import { isFortuneDate } from "../today/public-route-params";
import { adminErrorEnvelope, type AdminHttpReply } from "./admin-http";
import { ADMIN_OPERATIONS_SERVICE } from "./admin-http.providers";
import type { AdminProtectionRequest } from "./admin-request-protection";

function requestId(request: AdminProtectionRequest): string {
  return request.adminRequestId ?? "admin-request-unavailable";
}

function unauthenticated(request: AdminProtectionRequest, reply: AdminHttpReply) {
  reply.status(401);
  return adminErrorEnvelope(
    "UNAUTHENTICATED",
    "后台会话不存在或已失效，请重新登录。",
    requestId(request),
  );
}

function invalidArgument(request: AdminProtectionRequest, reply: AdminHttpReply, message: string) {
  reply.status(400);
  return adminErrorEnvelope("INVALID_ARGUMENT", message, requestId(request));
}

@Controller("admin/api/v1/operations")
export class AdminOperationsController {
  constructor(
    @Inject(ADMIN_OPERATIONS_SERVICE)
    private readonly operationsService: AdminOperationsService,
  ) {}

  @Get("overview")
  overview(
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminOperationsOverview> | ReturnType<typeof unauthenticated> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    return this.operationsService.overview();
  }

  @Get("calendar")
  calendar(
    @Query("month") month: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ):
    | Promise<AdminCalendarMonth>
    | ReturnType<typeof invalidArgument>
    | ReturnType<typeof unauthenticated> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    if (Array.isArray(month) || month === undefined || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) {
      return invalidArgument(request, reply, "月份格式无效，请使用 YYYY-MM。");
    }
    return this.operationsService.calendar(month);
  }

  @Get("issues")
  issues(
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminActionableIssueList> | ReturnType<typeof unauthenticated> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    return this.operationsService.issues();
  }

  @Get("days/:fortuneDate")
  dayDetail(
    @Param("fortuneDate") fortuneDate: string,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ):
    | Promise<AdminDayDetail>
    | ReturnType<typeof invalidArgument>
    | ReturnType<typeof unauthenticated> {
    if (request.adminPrincipal === undefined) return unauthenticated(request, reply);
    if (!isFortuneDate(fortuneDate)) {
      return invalidArgument(request, reply, "命理日格式无效，请使用 YYYY-MM-DD。");
    }
    return this.operationsService.dayDetail(fortuneDate);
  }
}
