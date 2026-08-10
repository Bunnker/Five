import type { components } from "@five/api-contract";

export type AnalyticsEventName = components["schemas"]["AnalyticsEventName"];

export interface StoredAnalyticsEventInput {
  readonly anonymousIdHmac: string;
  readonly channelId: string;
  readonly contentVersion: string;
  readonly eventId: string;
  readonly eventName: AnalyticsEventName;
  readonly expiresAt: Date;
  readonly fortuneDate: string;
  readonly observedAt: Date;
  readonly posterInstanceIdHmac: string | null;
  readonly referralIdHmac: string | null;
  readonly requestHash: string;
  readonly sourceContentVersion: string | null;
}

export type RecordStoredAnalyticsEventResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "rate_limited" };

export interface AnalyticsOverviewQuery {
  readonly channelId: string | null;
  readonly contentVersion: string | null;
  readonly fromFortuneDate: string;
  readonly toFortuneDate: string;
}

export interface StoredAnalyticsOverview {
  readonly anonymousBrowsers: number;
  readonly outfitDetailVisitors: number;
  readonly outfitHubVisitors: number;
  readonly pageViews: number;
  readonly posterSaveFailed: number;
  readonly posterSaveRequests: number;
  readonly posterSaveSucceeded: number;
  readonly referredBrowsers: number;
  readonly shareInitiations: number;
  readonly sharingBrowsers: number;
}

export interface AnalyticsReportQuery {
  readonly fromFortuneDate: string;
  readonly toFortuneDate: string;
}

export interface StoredAnalyticsDailyPoint {
  readonly anonymousBrowsers: number;
  readonly fortuneDate: string;
  readonly outfitDetailVisitors: number;
  readonly outfitHubVisitors: number;
  readonly pageViews: number;
  readonly posterSaveSucceeded: number;
  readonly referredBrowsers: number;
  readonly shareInitiations: number;
  readonly sharingBrowsers: number;
}

export interface StoredAnalyticsChannelPoint {
  readonly anonymousBrowsers: number;
  readonly channelId: components["schemas"]["AnalyticsChannelBucket"];
  readonly pageViews: number;
  readonly ratio: number | null;
}

export interface StoredAnalyticsReport {
  readonly channelBreakdown: readonly StoredAnalyticsChannelPoint[];
  readonly daily: readonly StoredAnalyticsDailyPoint[];
  readonly summary: StoredAnalyticsOverview;
}

export interface AnalyticsEventRepository {
  overview(query: AnalyticsOverviewQuery): Promise<StoredAnalyticsOverview>;
  purgeExpired(expiredAtOrBefore: Date): Promise<number>;
  record(input: StoredAnalyticsEventInput): Promise<RecordStoredAnalyticsEventResult>;
  report(query: AnalyticsReportQuery): Promise<StoredAnalyticsReport>;
}

export const ANALYTICS_EVENT_REPOSITORY = Symbol("ANALYTICS_EVENT_REPOSITORY");
