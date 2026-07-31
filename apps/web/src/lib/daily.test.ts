import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDaily, loadDailyResult } from "./daily";

const fortuneDate = "2026-07-15";
const currentContentVersion = "fd-20260715-r4";
const expectedContentVersion = "fd-20260715-r3";

const versions = {
  algorithmVersion: "algorithm-v1",
  assetManifestVersion: "assets-v1",
  calendarDataVersion: "calendar-data-v1",
  calendarRuleVersion: "calendar-rule-v1",
  contentVersion: currentContentVersion,
  copyVersion: "copy-v1",
  outfitVersion: "outfit-v1",
  posterTemplateVersion: "poster-v1",
};

const content = {
  balanceSuggestion: {
    accessoryExamples: ["丝巾", "包"],
    description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
    preferredTierCode: "da_ji",
    title: "已经穿了注意色",
  },
  basis: {
    disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
    steps: ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
  },
  calendar: {
    branch: "寅",
    dayElement: "wood",
    dayElementLabel: "木",
    ganzhiDay: "庚寅",
    lunarDateText: "六月初二",
    weekdayText: "星期三",
  },
  effectiveFrom: "2026-07-14T23:00:00+08:00",
  effectiveTo: "2026-07-15T23:00:00+08:00",
  fortuneDate,
  looks: [],
  outfitFormulas: [],
  share: {
    copyText: "当日穿搭参考：优先火色，稳妥选择木色。",
    posterJobEndpoint: "/api/v1/poster-jobs",
    posterTemplateVersion: "poster-v1",
    summaryText: "当日木日，优先参考红、橙、紫色系。",
  },
  tiers: [
    {
      algorithmLabel: "大吉",
      colors: [{ colorCode: "red", name: "红色" }],
      displayLabel: "今日优先",
      displaySection: "primary",
      element: "fire",
      elementLabel: "火",
      explanation: "今日木日，木生火，火为大吉。",
      rank: 1,
      relationText: "木生火",
      tierCode: "da_ji",
    },
    {
      algorithmLabel: "次吉",
      colors: [{ colorCode: "green", name: "绿色" }],
      displayLabel: "稳妥选择",
      displaySection: "primary",
      element: "wood",
      elementLabel: "木",
      explanation: "与当日五行相同，作为稳妥选择。",
      rank: 2,
      relationText: "木与木同类",
      tierCode: "ci_ji",
    },
    {
      algorithmLabel: "平",
      colors: [{ colorCode: "white", name: "白色" }],
      displayLabel: "日常可穿",
      displaySection: "primary",
      element: "metal",
      elementLabel: "金",
      explanation: "适合作为日常穿搭参考。",
      rank: 3,
      relationText: "金克木",
      tierCode: "ping",
    },
    {
      algorithmLabel: "较差",
      colors: [{ colorCode: "navy", name: "藏青" }],
      displayLabel: "注意",
      displaySection: "attention",
      element: "water",
      elementLabel: "水",
      explanation: "当日建议降低大面积使用比例。",
      rank: 4,
      relationText: "水生木",
      tierCode: "jiao_cha",
    },
    {
      algorithmLabel: "不利",
      colors: [{ colorCode: "brown", name: "棕色" }],
      displayLabel: "注意",
      displaySection: "attention",
      element: "earth",
      elementLabel: "土",
      explanation: "当日建议减少使用。",
      rank: 5,
      relationText: "木克土",
      tierCode: "bu_li",
    },
  ],
  versions,
};

function dailyResponse(
  overrides: {
    body?: Record<string, unknown>;
    responseContentVersion?: string;
    status?: number;
  } = {},
): Response {
  const body = {
    content,
    requestedFortuneDate: fortuneDate,
    resolution: {
      expectedContentVersion,
      reason: "replaced",
      servedContentVersion: currentContentVersion,
      versionChanged: true,
    },
    ...overrides.body,
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-content-version": overrides.responseContentVersion ?? currentContentVersion,
    },
    status: overrides.status ?? 200,
  });
}

function expiredResponse(
  overrides: {
    body?: Record<string, unknown>;
    contentType?: string;
    responseRequestId?: string;
  } = {},
): Response {
  const requestId = "web-daily-request-123";

  return new Response(
    JSON.stringify(
      overrides.body ?? {
        error: {
          code: "HISTORICAL_CONTENT_EXPIRED",
          details: { fortuneDate },
          message: "该日期内容已不在公开保留期内。",
          requestId,
          retryable: false,
        },
      },
    ),
    {
      headers: {
        "content-type": overrides.contentType ?? "application/json; charset=utf-8",
        "x-request-id": overrides.responseRequestId ?? requestId,
      },
      status: 410,
    },
  );
}

describe("loadDaily", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the current safe version for the specified date and preserves the update notice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(dailyResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadDaily({
      apiOrigin: "http://backend.test:3100",
      expectedContentVersion,
      fortuneDate,
      requestId: "web-daily-request-123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test:3100/api/v1/daily/2026-07-15?expectedContentVersion=fd-20260715-r3",
      {
        cache: "no-store",
        headers: {
          accept: "application/json",
          "x-request-id": "web-daily-request-123",
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(result).toMatchObject({
      content: {
        calendar: {
          dayElementLabel: "木",
          ganzhiDay: "庚寅",
        },
        fortuneDate,
      },
      daJiCard: {
        colors: [{ colorCode: "red", name: "红色" }],
        contentVersion: currentContentVersion,
      },
      versionChanged: true,
    });
  });

  it("omits the version query and accepts the current resolution when no old version was supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      dailyResponse({
        body: {
          resolution: {
            expectedContentVersion: null,
            reason: "current",
            servedContentVersion: currentContentVersion,
            versionChanged: false,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadDaily({
        apiOrigin: "http://backend.test:3100",
        fortuneDate,
      }),
    ).resolves.toMatchObject({ versionChanged: false });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://backend.test:3100/api/v1/daily/2026-07-15");
  });

  it.each([
    {
      label: "requested date",
      response: dailyResponse({ body: { requestedFortuneDate: "2026-07-16" } }),
    },
    {
      label: "served version",
      response: dailyResponse({
        body: {
          resolution: {
            expectedContentVersion,
            reason: "replaced",
            servedContentVersion: "fd-20260715-r5",
            versionChanged: true,
          },
        },
      }),
    },
    {
      label: "response header",
      response: dailyResponse({ responseContentVersion: "fd-20260715-r5" }),
    },
    {
      label: "resolution semantics",
      response: dailyResponse({
        body: {
          resolution: {
            expectedContentVersion,
            reason: "current",
            servedContentVersion: currentContentVersion,
            versionChanged: true,
          },
        },
      }),
    },
  ])("fails closed when the $label disagrees with the public payload", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      loadDaily({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion,
        fortuneDate,
        requestId: "web-daily-request-123",
      }),
    ).resolves.toBeNull();
  });

  it.each([404, 410, 503])("maps HTTP %s to the same safe unavailable state", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    await expect(
      loadDaily({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion,
        fortuneDate,
        requestId: "web-daily-request-123",
      }),
    ).resolves.toBeNull();
  });

  it("distinguishes an expired historical share from a generic unavailable response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(expiredResponse()).mockResolvedValueOnce(expiredResponse()),
    );

    await expect(
      loadDailyResult({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion,
        fortuneDate,
        requestId: "web-daily-request-123",
      }),
    ).resolves.toEqual({ kind: "expired" });

    await expect(
      loadDaily({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion,
        fortuneDate,
        requestId: "web-daily-request-123",
      }),
    ).resolves.toBeNull();
  });

  it.each([
    {
      label: "non-JSON response",
      response: expiredResponse({ contentType: "text/html" }),
    },
    {
      label: "different error code",
      response: expiredResponse({
        body: {
          error: {
            code: "CONTENT_NOT_FOUND",
            details: { fortuneDate },
            message: "该日期内容不存在。",
            requestId: "web-daily-request-123",
            retryable: false,
          },
        },
      }),
    },
    {
      label: "mismatched response request ID",
      response: expiredResponse({ responseRequestId: "different-request-id" }),
    },
    {
      label: "self-consistent request ID that was not sent",
      response: expiredResponse({
        body: {
          error: {
            code: "HISTORICAL_CONTENT_EXPIRED",
            details: { fortuneDate },
            message: "该日期内容已不在公开保留期内。",
            requestId: "foreign-request-id",
            retryable: false,
          },
        },
        responseRequestId: "foreign-request-id",
      }),
    },
    {
      label: "different details date",
      response: expiredResponse({
        body: {
          error: {
            code: "HISTORICAL_CONTENT_EXPIRED",
            details: { fortuneDate: "2026-07-14" },
            message: "该日期内容已不在公开保留期内。",
            requestId: "web-daily-request-123",
            retryable: false,
          },
        },
      }),
    },
  ])("keeps a malformed 410 $label in the generic unavailable state", async ({ response }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      loadDailyResult({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion,
        fortuneDate,
        requestId: "web-daily-request-123",
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("rejects an impossible route date without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadDaily({
        apiOrigin: "http://backend.test:3100",
        fortuneDate: "2026-02-30",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
