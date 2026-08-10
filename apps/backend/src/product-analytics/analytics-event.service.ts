import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";
import { Inject, Injectable } from "@nestjs/common";

import { shiftFortuneDate } from "../public-content/public-content-date";
import type { Clock } from "../request-context/request-context-resolver";
import {
  ANALYTICS_EVENT_REPOSITORY,
  type AnalyticsEventRepository,
  type AnalyticsOverviewQuery,
  type AnalyticsReportQuery,
  type StoredAnalyticsOverview,
} from "./analytics-event.repository";
import type { AnalyticsHmacDigesterPort } from "./analytics-hmac";

export type CreateAnalyticsEventRequest = components["schemas"]["CreateAnalyticsEventRequest"];

export type RecordAnalyticsEventResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "rate_limited" };

export const ANALYTICS_HMAC_DIGESTER = Symbol("ANALYTICS_HMAC_DIGESTER");
export const ANALYTICS_CLOCK = Symbol("ANALYTICS_CLOCK");
const RETENTION_DAYS = 90;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function requestHash(value: CreateAnalyticsEventRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function rate(numerator: number, denominator: number): components["schemas"]["AnalyticsRate"] {
  return { denominator, numerator, ratio: denominator === 0 ? null : numerator / denominator };
}

function presentOverview(
  query: AnalyticsOverviewQuery,
  stored: StoredAnalyticsOverview,
  collectionStatus: components["schemas"]["AdminAnalyticsOverview"]["collectionStatus"],
  generatedAt: string,
): components["schemas"]["AdminAnalyticsOverview"] {
  return {
    ...query,
    ...stored,
    collectionStatus,
    generatedAt,
    outfitDetailRate: rate(stored.outfitDetailVisitors, stored.anonymousBrowsers),
    shareInitiationRate: rate(stored.sharingBrowsers, stored.anonymousBrowsers),
  };
}

@Injectable()
export class AnalyticsEventService {
  constructor(
    @Inject(ANALYTICS_EVENT_REPOSITORY)
    private readonly repository: AnalyticsEventRepository,
    @Inject(ANALYTICS_HMAC_DIGESTER)
    private readonly hmac: AnalyticsHmacDigesterPort,
    @Inject(ANALYTICS_CLOCK)
    private readonly clock: Clock,
  ) {}

  record(request: CreateAnalyticsEventRequest): Promise<RecordAnalyticsEventResult> {
    const observedAt = this.clock.now();
    const expiresAt = new Date(observedAt);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + RETENTION_DAYS);
    return this.repository.record({
      anonymousIdHmac: this.hmac.digest("anonymous-id", request.anonymousId),
      channelId: request.channelId,
      contentVersion: request.contentVersion,
      eventId: request.eventId,
      eventName: request.eventName,
      expiresAt,
      fortuneDate: request.fortuneDate,
      observedAt,
      posterInstanceIdHmac:
        request.posterInstanceId === null
          ? null
          : this.hmac.digest("poster-instance-id", request.posterInstanceId),
      referralIdHmac:
        request.referralId === null ? null : this.hmac.digest("referral-id", request.referralId),
      requestHash: requestHash(request),
      sourceContentVersion: request.sourceContentVersion,
    });
  }

  async overview(
    query: AnalyticsOverviewQuery,
  ): Promise<components["schemas"]["AdminAnalyticsOverview"]> {
    const stored = await this.repository.overview(query);
    return presentOverview(
      query,
      stored,
      this.hmac.available ? "active" : "unavailable",
      this.clock.now().toISOString(),
    );
  }

  async report(
    query: AnalyticsReportQuery & {
      readonly days: components["schemas"]["AdminAnalyticsReport"]["days"];
    },
  ): Promise<components["schemas"]["AdminAnalyticsReport"]> {
    const stored = await this.repository.report({
      fromFortuneDate: query.fromFortuneDate,
      toFortuneDate: query.toFortuneDate,
    });
    const hasContinuousDates = stored.daily.every(
      (point, index) => point.fortuneDate === shiftFortuneDate(query.fromFortuneDate, index),
    );
    const channelPageViews = stored.channelBreakdown.reduce(
      (total, point) => total + point.pageViews,
      0,
    );
    const dailyPageViews = stored.daily.reduce((total, point) => total + point.pageViews, 0);
    if (
      stored.daily.length !== query.days ||
      !hasContinuousDates ||
      shiftFortuneDate(query.fromFortuneDate, query.days - 1) !== query.toFortuneDate ||
      dailyPageViews !== stored.summary.pageViews ||
      channelPageViews !== stored.summary.pageViews
    ) {
      throw new Error("analytics report is internally inconsistent");
    }
    const generatedAt = this.clock.now().toISOString();
    const collectionStatus = this.hmac.available ? "active" : "unavailable";
    const overviewQuery: AnalyticsOverviewQuery = {
      channelId: null,
      contentVersion: null,
      fromFortuneDate: query.fromFortuneDate,
      toFortuneDate: query.toFortuneDate,
    };
    return {
      channelBreakdown: [...stored.channelBreakdown],
      collectionStatus,
      daily: [...stored.daily],
      days: query.days,
      fromFortuneDate: query.fromFortuneDate,
      generatedAt,
      summary: presentOverview(overviewQuery, stored.summary, collectionStatus, generatedAt),
      toFortuneDate: query.toFortuneDate,
    };
  }

  purgeExpired(): Promise<number> {
    return this.repository.purgeExpired(this.clock.now());
  }
}
