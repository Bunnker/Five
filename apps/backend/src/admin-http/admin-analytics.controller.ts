import type { components } from "@five/api-contract";
import { Controller, Get, Query, Req, Res } from "@nestjs/common";

import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { shiftFortuneDate } from "../public-content/public-content-date";
import { AnalyticsEventService } from "../product-analytics/analytics-event.service";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { isFortuneDate, isOpaquePublicValue } from "../today/public-route-params";
import { adminErrorEnvelope, type AdminHttpReply } from "./admin-http";
import type { AdminProtectionRequest } from "./admin-request-protection";

type AdminAnalyticsOverview = components["schemas"]["AdminAnalyticsOverview"];
type AdminAnalyticsReport = components["schemas"]["AdminAnalyticsReport"];
type AnalyticsReportDays = AdminAnalyticsReport["days"];

function requestId(request: AdminProtectionRequest): string {
  return request.adminRequestId ?? "admin-request-unavailable";
}

function failure(
  request: AdminProtectionRequest,
  reply: AdminHttpReply,
  status: 400 | 401,
  code: "INVALID_ARGUMENT" | "UNAUTHENTICATED",
  message: string,
) {
  reply.status(status);
  return adminErrorEnvelope(code, message, requestId(request));
}

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function optionalOpaque(
  value: string | string[] | undefined,
  maximumCodePoints: number,
): string | null | undefined {
  if (value === undefined) return null;
  if (!isOpaquePublicValue(value) || [...value].length > maximumCodePoints) return undefined;
  return value;
}

function inclusiveDays(from: string, to: string): number {
  const fromTime = new Date(`${from}T00:00:00.000Z`).valueOf();
  const toTime = new Date(`${to}T00:00:00.000Z`).valueOf();
  return (toTime - fromTime) / 86_400_000 + 1;
}

@Controller("admin/api/v1/analytics")
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsEventService,
    private readonly requestContextResolver: RequestContextResolver,
    private readonly publicContentContextResolver: PublicContentContextResolver,
  ) {}

  @Get("overview")
  overview(
    @Query("from") rawFrom: string | string[] | undefined,
    @Query("to") rawTo: string | string[] | undefined,
    @Query("channelId") rawChannelId: string | string[] | undefined,
    @Query("contentVersion") rawContentVersion: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminAnalyticsOverview> | ReturnType<typeof failure> {
    if (request.adminPrincipal === undefined) {
      return failure(
        request,
        reply,
        401,
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
      );
    }
    const from = one(rawFrom);
    const to = one(rawTo);
    const channelId = optionalOpaque(rawChannelId, 64);
    const contentVersion = optionalOpaque(rawContentVersion, 128);
    if (
      from === null ||
      to === null ||
      !isFortuneDate(from) ||
      !isFortuneDate(to) ||
      channelId === undefined ||
      contentVersion === undefined
    ) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "统计查询字段或日期格式无效。");
    }
    const days = inclusiveDays(from, to);
    if (!Number.isInteger(days) || days < 1 || days > 31) {
      return failure(
        request,
        reply,
        400,
        "INVALID_ARGUMENT",
        "统计日期范围必须按顺序且最多包含 31 天。",
      );
    }
    return this.analytics.overview({
      channelId,
      contentVersion,
      fromFortuneDate: from,
      toFortuneDate: to,
    });
  }

  @Get("report")
  report(
    @Query("days") rawDays: string | string[] | undefined,
    @Req() request: AdminProtectionRequest,
    @Res({ passthrough: true }) reply: AdminHttpReply,
  ): Promise<AdminAnalyticsReport> | ReturnType<typeof failure> {
    if (request.adminPrincipal === undefined) {
      return failure(
        request,
        reply,
        401,
        "UNAUTHENTICATED",
        "后台会话不存在或已失效，请重新登录。",
      );
    }
    const days: AnalyticsReportDays | null = rawDays === "7" ? 7 : rawDays === "30" ? 30 : null;
    if (days === null) {
      return failure(request, reply, 400, "INVALID_ARGUMENT", "统计周期只支持最近 7 日或 30 日。");
    }
    const requestContext = this.requestContextResolver.resolve();
    const { servedFortuneDate } = this.publicContentContextResolver.resolve(requestContext);
    return this.analytics.report({
      days,
      fromFortuneDate: shiftFortuneDate(servedFortuneDate, -(days - 1)),
      toFortuneDate: servedFortuneDate,
    });
  }
}
