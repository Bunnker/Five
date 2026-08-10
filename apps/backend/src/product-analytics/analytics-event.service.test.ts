import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../request-context/request-context-resolver";
import { AnalyticsEventService } from "./analytics-event.service";
import type {
  AnalyticsEventRepository,
  StoredAnalyticsOverview,
} from "./analytics-event.repository";
import {
  AnalyticsHmacDigester,
  analyticsHmacDigesterFromEnvironment,
  analyticsHmacKeyFromEnvironment,
} from "./analytics-hmac";

const key = Buffer.alloc(32, 0x4a);
const now = new Date("2026-08-09T12:00:00.000Z");
const clock: Clock = { now: () => now };

const request = {
  anonymousId: "browser-018f3a7d6c214ed4",
  channelId: "organic",
  contentVersion: "fd-20260810-r2",
  eventId: "event-018f3a7d6c214ed4",
  eventName: "share_summary_initiated" as const,
  fortuneDate: "2026-08-10",
  posterInstanceId: null,
  referralId: "referral-018f3a7d6c214ed4",
  sourceContentVersion: null,
};

function storedOverview(overrides: Partial<StoredAnalyticsOverview> = {}): StoredAnalyticsOverview {
  return {
    anonymousBrowsers: 4,
    outfitDetailVisitors: 2,
    outfitHubVisitors: 3,
    pageViews: 7,
    posterSaveFailed: 1,
    posterSaveRequests: 3,
    posterSaveSucceeded: 2,
    referredBrowsers: 1,
    shareInitiations: 3,
    sharingBrowsers: 2,
    ...overrides,
  };
}

function storedDaily() {
  return Array.from({ length: 7 }, (_, index) => ({
    anonymousBrowsers: index === 6 ? 4 : 0,
    fortuneDate: `2026-08-0${index + 3}`,
    outfitDetailVisitors: index === 6 ? 2 : 0,
    outfitHubVisitors: index === 6 ? 3 : 0,
    pageViews: index === 6 ? 7 : 0,
    posterSaveSucceeded: index === 6 ? 2 : 0,
    referredBrowsers: index === 6 ? 1 : 0,
    shareInitiations: index === 6 ? 3 : 0,
    sharingBrowsers: index === 6 ? 2 : 0,
  }));
}

function dependencies(overview: StoredAnalyticsOverview = storedOverview()) {
  const storedReport = {
    channelBreakdown: [
      { anonymousBrowsers: 4, channelId: "organic" as const, pageViews: 7, ratio: 1 },
      { anonymousBrowsers: 0, channelId: "wechat_official" as const, pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "wechat_group" as const, pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "user_share" as const, pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "other" as const, pageViews: 0, ratio: 0 },
    ],
    daily: storedDaily(),
    summary: overview,
  };
  const repository = {
    overview: vi.fn().mockResolvedValue(overview),
    purgeExpired: vi.fn().mockResolvedValue(0),
    record: vi.fn().mockResolvedValue({ kind: "accepted" }),
    report: vi.fn().mockResolvedValue(storedReport),
  } satisfies AnalyticsEventRepository;
  const service = new AnalyticsEventService(repository, new AnalyticsHmacDigester(key), clock);
  return { repository, service };
}

describe("AnalyticsEventService", () => {
  it("accepts only one canonical base64-encoded 32-byte HMAC key", () => {
    const encoded = key.toString("base64");
    expect(analyticsHmacKeyFromEnvironment({ FIVE_ANALYTICS_HMAC_KEY_BASE64: encoded })).toEqual(
      key,
    );
    expect(() => analyticsHmacKeyFromEnvironment({})).toThrow("FIVE_ANALYTICS_HMAC_KEY_BASE64");
    expect(() =>
      analyticsHmacKeyFromEnvironment({ FIVE_ANALYTICS_HMAC_KEY_BASE64: "not-base64" }),
    ).toThrow("FIVE_ANALYTICS_HMAC_KEY_BASE64");
    expect(() =>
      analyticsHmacKeyFromEnvironment({
        FIVE_ANALYTICS_HMAC_KEY_BASE64: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow("FIVE_ANALYTICS_HMAC_KEY_BASE64");
  });

  it("keeps the application bootable while event recording fails closed without a valid key", () => {
    const unavailable = analyticsHmacDigesterFromEnvironment({});

    expect(() => unavailable.digest("anonymous-id", "browser:aaaaaaaaaaaaaaaa")).toThrow(
      "analytics HMAC is unavailable",
    );
    expect(
      analyticsHmacDigesterFromEnvironment({
        FIVE_ANALYTICS_HMAC_KEY_BASE64: key.toString("base64"),
      }).digest("anonymous-id", "browser:aaaaaaaaaaaaaaaa"),
    ).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("persists only domain-separated HMAC identifiers with a canonical request hash and 90-day expiry", async () => {
    const { repository, service } = dependencies();

    await expect(service.record(request)).resolves.toEqual({ kind: "accepted" });

    expect(repository.record).toHaveBeenCalledOnce();
    const stored = vi.mocked(repository.record).mock.calls[0]![0];
    expect(stored).toMatchObject({
      anonymousIdHmac: createHmac("sha256", key)
        .update("five-analytics:anonymous-id\u0000")
        .update(request.anonymousId)
        .digest("hex"),
      channelId: "organic",
      eventId: request.eventId,
      expiresAt: new Date("2026-11-07T12:00:00.000Z"),
      observedAt: now,
      referralIdHmac: createHmac("sha256", key)
        .update("five-analytics:referral-id\u0000")
        .update(request.referralId)
        .digest("hex"),
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(stored).not.toHaveProperty("anonymousId");
    expect(stored).not.toHaveProperty("ip");
    expect(stored).not.toHaveProperty("userAgent");
    expect(JSON.stringify(stored)).not.toContain(request.anonymousId);
    expect(JSON.stringify(stored)).not.toContain(request.referralId);
  });

  it("uses a stable canonical hash and preserves repository idempotency outcomes", async () => {
    const { repository, service } = dependencies();
    vi.mocked(repository.record)
      .mockResolvedValueOnce({ kind: "duplicate" })
      .mockResolvedValueOnce({ kind: "idempotency_conflict" });

    await expect(service.record(request)).resolves.toEqual({ kind: "duplicate" });
    await expect(service.record({ ...request, contentVersion: "fd-20260810-r3" })).resolves.toEqual(
      { kind: "idempotency_conflict" },
    );

    const [first, second] = vi.mocked(repository.record).mock.calls.map(([input]) => input);
    expect(first.requestHash).not.toBe(second.requestHash);
  });

  it("builds explainable rates and returns null instead of dividing by zero", async () => {
    const { service } = dependencies();
    await expect(
      service.overview({
        channelId: null,
        contentVersion: null,
        fromFortuneDate: "2026-08-01",
        toFortuneDate: "2026-08-09",
      }),
    ).resolves.toMatchObject({
      collectionStatus: "active",
      generatedAt: "2026-08-09T12:00:00.000Z",
      outfitDetailRate: { denominator: 4, numerator: 2, ratio: 0.5 },
      shareInitiationRate: { denominator: 4, numerator: 2, ratio: 0.5 },
    });

    const zero = dependencies(storedOverview({ anonymousBrowsers: 0 })).service;
    await expect(
      zero.overview({
        channelId: null,
        contentVersion: null,
        fromFortuneDate: "2026-08-01",
        toFortuneDate: "2026-08-09",
      }),
    ).resolves.toMatchObject({
      collectionStatus: "active",
      outfitDetailRate: { denominator: 0, numerator: 2, ratio: null },
      shareInitiationRate: { denominator: 0, numerator: 2, ratio: null },
    });
  });

  it("builds one report with matching metadata, summary rates, daily points and channel ratios", async () => {
    const { repository, service } = dependencies();

    await expect(
      service.report({
        days: 7,
        fromFortuneDate: "2026-08-03",
        toFortuneDate: "2026-08-09",
      }),
    ).resolves.toEqual({
      channelBreakdown: [
        { anonymousBrowsers: 4, channelId: "organic", pageViews: 7, ratio: 1 },
        { anonymousBrowsers: 0, channelId: "wechat_official", pageViews: 0, ratio: 0 },
        { anonymousBrowsers: 0, channelId: "wechat_group", pageViews: 0, ratio: 0 },
        { anonymousBrowsers: 0, channelId: "user_share", pageViews: 0, ratio: 0 },
        { anonymousBrowsers: 0, channelId: "other", pageViews: 0, ratio: 0 },
      ],
      collectionStatus: "active",
      daily: storedDaily(),
      days: 7,
      fromFortuneDate: "2026-08-03",
      generatedAt: "2026-08-09T12:00:00.000Z",
      summary: {
        ...storedOverview(),
        channelId: null,
        collectionStatus: "active",
        contentVersion: null,
        fromFortuneDate: "2026-08-03",
        generatedAt: "2026-08-09T12:00:00.000Z",
        outfitDetailRate: { denominator: 4, numerator: 2, ratio: 0.5 },
        shareInitiationRate: { denominator: 4, numerator: 2, ratio: 0.5 },
        toFortuneDate: "2026-08-09",
      },
      toFortuneDate: "2026-08-09",
    });
    expect(repository.report).toHaveBeenCalledWith({
      fromFortuneDate: "2026-08-03",
      toFortuneDate: "2026-08-09",
    });
  });

  it("rejects an internally inconsistent report instead of returning a contract-invalid response", async () => {
    const { repository, service } = dependencies();
    vi.mocked(repository.report).mockResolvedValueOnce({
      channelBreakdown: [{ anonymousBrowsers: 4, channelId: "organic", pageViews: 6, ratio: 1 }],
      daily: storedDaily().slice(1),
      summary: storedOverview(),
    });

    await expect(
      service.report({
        days: 7,
        fromFortuneDate: "2026-08-03",
        toFortuneDate: "2026-08-09",
      }),
    ).rejects.toThrow("analytics report is internally inconsistent");
  });

  it("marks summaries incomplete when the write-side HMAC configuration is unavailable", async () => {
    const repository = {
      overview: vi.fn().mockResolvedValue(storedOverview()),
      purgeExpired: vi.fn().mockResolvedValue(0),
      record: vi.fn().mockResolvedValue({ kind: "accepted" }),
      report: vi.fn().mockResolvedValue({
        channelBreakdown: [],
        daily: [],
        summary: storedOverview(),
      }),
    } satisfies AnalyticsEventRepository;
    const service = new AnalyticsEventService(
      repository,
      analyticsHmacDigesterFromEnvironment({}),
      clock,
    );

    await expect(
      service.overview({
        channelId: null,
        contentVersion: null,
        fromFortuneDate: "2026-08-09",
        toFortuneDate: "2026-08-09",
      }),
    ).resolves.toMatchObject({ collectionStatus: "unavailable" });
  });
});
