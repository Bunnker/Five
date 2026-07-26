import { afterEach, describe, expect, it, vi } from "vitest";

import { loadToday, type DaJiCardData, type TodayDateData, type TodayPageData } from "./today";

const contentVersion = "fd-20260724-r1";

const dateData = {
  content: {
    calendar: {
      dayElement: "wood",
      dayElementLabel: "木",
      ganzhiDay: "己亥",
      lunarDateText: "六月十一",
      weekdayText: "星期五",
    },
    fortuneDate: "2026-07-24",
  },
  requestContext: {
    civilDate: "2026-07-23",
    crossedDayBoundary: true,
    fortuneDate: "2026-07-24",
    shichen: "子",
  },
} satisfies TodayDateData;

const daJiTier = {
  algorithmLabel: "大吉",
  colors: [
    { colorCode: "purple", name: "紫色" },
    { colorCode: "red", name: "红色" },
    { colorCode: "orange", name: "橙色" },
  ],
  displayLabel: "今日优先",
  displaySection: "primary",
  element: "fire",
  elementLabel: "火",
  explanation: "今日木日，木生火，火为大吉。",
  rank: 1,
  relationText: "木生火",
  tierCode: "da_ji",
};

const versions = {
  algorithmVersion: "algorithm-v1",
  assetManifestVersion: "assets-v1",
  calendarDataVersion: "calendar-data-v1",
  calendarRuleVersion: "calendar-rule-v1",
  contentVersion,
  copyVersion: "copy-v1",
  outfitVersion: "outfit-v1",
  posterTemplateVersion: "poster-v1",
};

const otherTiers = [
  { rank: 2, tierCode: "ci_ji" },
  { rank: 3, tierCode: "ping" },
  { rank: 4, tierCode: "jiao_cha" },
  { rank: 5, tierCode: "bu_li" },
];

const apiTodayResponse = {
  content: {
    ...dateData.content,
    tiers: [otherTiers[0], otherTiers[2], daJiTier, otherTiers[1], otherTiers[3]],
    versions,
  },
  requestContext: dateData.requestContext,
};

const daJiCard = {
  algorithmLabel: "大吉",
  colors: [
    { colorCode: "purple", name: "紫色" },
    { colorCode: "red", name: "红色" },
    { colorCode: "orange", name: "橙色" },
  ],
  contentVersion,
  displayLabel: "今日优先",
  element: "fire",
  elementLabel: "火",
  explanation: "今日木日，木生火，火为大吉。",
  rank: 1,
  relationText: "木生火",
} satisfies DaJiCardData;

const pageData = {
  ...dateData,
  daJiCard,
} satisfies TodayPageData;

function readyResponse(
  body: unknown,
  responseContentVersion: string | null = contentVersion,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (responseContentVersion !== null) {
    headers.set("x-content-version", responseContentVersion);
  }

  return new Response(JSON.stringify(body), {
    headers,
    status: 200,
  });
}

async function loadFrom(body: unknown, responseContentVersion: string | null = contentVersion) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(readyResponse(body, responseContentVersion)));

  return loadToday({
    apiOrigin: "http://backend.test:3100",
    requestId: "web-request-123",
  });
}

describe("loadToday", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("selects only da_ji and preserves its element and published color order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(readyResponse(apiTodayResponse));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadToday({
        apiOrigin: "http://backend.test:3100",
        requestId: "web-request-123",
      }),
    ).resolves.toEqual(pageData);
    expect(fetchMock).toHaveBeenCalledWith("http://backend.test:3100/api/v1/today", {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": "web-request-123",
      },
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ["missing da_ji", otherTiers],
    ["non-unique", [otherTiers[0], otherTiers[0], daJiTier, otherTiers[2], otherTiers[3]]],
  ])("keeps the date but hides the whole card when the tier index is %s", async (_case, tiers) => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: { ...apiTodayResponse.content, tiers },
    });

    expect(result).toEqual({ ...dateData, daJiCard: null });
  });

  it.each([
    ["empty colors", []],
    ["unknown color", [{ colorCode: "future_color", name: "未来色" }]],
    ["blank name", [{ colorCode: "red", name: " " }]],
    [
      "mismatched name",
      [
        { colorCode: "red", name: "蓝色" },
        { colorCode: "orange", name: "橙色" },
      ],
    ],
    [
      "more than twelve colors",
      [
        { colorCode: "red", name: "红色" },
        { colorCode: "orange", name: "橙色" },
        { colorCode: "purple", name: "紫色" },
        { colorCode: "pink_family", name: "粉色系" },
        { colorCode: "green", name: "绿色" },
        { colorCode: "cyan", name: "青色" },
        { colorCode: "emerald", name: "翠色" },
        { colorCode: "lake_blue", name: "湖蓝" },
        { colorCode: "light_green_family", name: "浅绿系" },
        { colorCode: "yellow", name: "黄色" },
        { colorCode: "coffee", name: "咖色" },
        { colorCode: "brown", name: "棕色" },
        { colorCode: "khaki", name: "卡其" },
      ],
    ],
  ])("does not keep the remaining colors when the group has %s", async (_case, colors) => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "da_ji" ? { ...daJiTier, colors } : tier,
        ),
      },
    });

    expect(result).toEqual({ ...dateData, daJiCard: null });
  });

  it.each([
    ["rank", 2],
    ["algorithmLabel", "次吉"],
    ["displayLabel", "稳妥选择"],
    ["displaySection", "attention"],
    ["element", "future_element"],
    ["elementLabel", "水"],
  ])("hides the card when da_ji field %s is invalid", async (field, value) => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "da_ji" ? { ...daJiTier, [field]: value } : tier,
        ),
      },
    });

    expect(result).toEqual({ ...dateData, daJiCard: null });
  });

  it("shows only the valid colors that the published tier actually contains", async () => {
    const colors = [
      { colorCode: "red", name: "红色" },
      { colorCode: "orange", name: "橙色" },
    ];
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "da_ji" ? { ...daJiTier, colors } : tier,
        ),
      },
    });

    expect(result?.daJiCard?.colors).toEqual(colors);
  });

  it.each(Object.keys(versions))(
    "hides the whole card when version field %s is blank",
    async (versionField) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          versions: { ...versions, [versionField]: " " },
        },
      });

      expect(result).toEqual({ ...dateData, daJiCard: null });
    },
  );

  it("hides the card when the response header and body content versions differ", async () => {
    await expect(loadFrom(apiTodayResponse, "fd-20260724-r2")).resolves.toEqual({
      ...dateData,
      daJiCard: null,
    });
  });

  it("hides the card when a body version field is missing", async () => {
    const incompleteVersions = Object.fromEntries(
      Object.entries(versions).filter(([field]) => field !== "copyVersion"),
    );

    await expect(
      loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          versions: incompleteVersions,
        },
      }),
    ).resolves.toEqual({
      ...dateData,
      daJiCard: null,
    });
  });

  it("hides the card when X-Content-Version is missing", async () => {
    await expect(loadFrom(apiTodayResponse, null)).resolves.toEqual({
      ...dateData,
      daJiCard: null,
    });
  });

  it("hides the card instead of displaying promise language from malformed content", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "da_ji" ? { ...daJiTier, explanation: "保证好运，帮助转运。" } : tier,
        ),
      },
    });

    expect(result).toEqual({ ...dateData, daJiCard: null });
  });

  it.each(["今天穿这个必然暴富。", "不用参考，保证一定有效。", "否则会破财，遇到大凶灾。"])(
    "hides the card when published copy contains a hard forbidden phrase: %s",
    async (explanation) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          tiers: apiTodayResponse.content.tiers.map((tier) =>
            tier?.tierCode === "da_ji" ? { ...daJiTier, explanation } : tier,
          ),
        },
      });

      expect(result).toEqual({ ...dateData, daJiCard: null });
    },
  );

  it("does not invent a date when the backend has no published content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CONTENT_NOT_READY",
            details: {},
            message: "今日内容正在校验中，请稍后重试。",
            requestId: "request-123",
            retryable: true,
          },
        }),
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadToday({ apiOrigin: "http://backend.test:3100" })).resolves.toBeNull();

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>)["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("rejects malformed date data instead of rendering a partial page", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      requestContext: {
        ...apiTodayResponse.requestContext,
        crossedDayBoundary: "false",
      },
    });

    expect(result).toBeNull();
  });

  it("stops waiting for an unresponsive backend", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );

    const result = loadToday({
      apiOrigin: "http://backend.test:3100",
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBeNull();
  });
});
