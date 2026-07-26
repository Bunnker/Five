import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadToday,
  type CiJiCardData,
  type DaJiCardData,
  type PingCardData,
  type TodayDateData,
  type TodayPageData,
} from "./today";

const contentVersion = "fd-20260715-r1";

const dateData = {
  content: {
    calendar: {
      dayElement: "wood",
      dayElementLabel: "木",
      ganzhiDay: "庚寅",
      lunarDateText: "六月初二",
      weekdayText: "星期三",
    },
    fortuneDate: "2026-07-15",
  },
  requestContext: {
    civilDate: "2026-07-14",
    crossedDayBoundary: true,
    fortuneDate: "2026-07-15",
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

const ciJiTier = {
  algorithmLabel: "次吉",
  colors: [
    { colorCode: "lake_blue", name: "湖蓝" },
    { colorCode: "green", name: "绿色" },
    { colorCode: "cyan", name: "青色" },
  ],
  displayLabel: "稳妥选择",
  displaySection: "primary",
  element: "wood",
  elementLabel: "木",
  explanation: "与今日五行相同，作为稳妥选择。",
  rank: 2,
  relationText: "木与木同类",
  tierCode: "ci_ji",
};

const pingTier = {
  algorithmLabel: "平",
  colors: [
    { colorCode: "silver", name: "银色" },
    { colorCode: "white", name: "白色" },
    { colorCode: "gold", name: "金色" },
    { colorCode: "ivory", name: "乳白" },
    { colorCode: "light_family", name: "浅色系" },
  ],
  displayLabel: "日常可穿",
  displaySection: "primary",
  element: "metal",
  elementLabel: "金",
  explanation: "适合作为日常穿搭参考。",
  rank: 3,
  relationText: "金克木",
  tierCode: "ping",
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
  ciJiTier,
  pingTier,
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
  tierCode: "da_ji",
} satisfies DaJiCardData;

const ciJiCard = {
  algorithmLabel: "次吉",
  colors: [
    { colorCode: "lake_blue", name: "湖蓝" },
    { colorCode: "green", name: "绿色" },
    { colorCode: "cyan", name: "青色" },
  ],
  contentVersion,
  displayLabel: "稳妥选择",
  element: "wood",
  elementLabel: "木",
  explanation: "与今日五行相同，作为稳妥选择。",
  rank: 2,
  relationText: "木与木同类",
  tierCode: "ci_ji",
} satisfies CiJiCardData;

const pingCard = {
  algorithmLabel: "平",
  colors: [
    { colorCode: "silver", name: "银色" },
    { colorCode: "white", name: "白色" },
    { colorCode: "gold", name: "金色" },
    { colorCode: "ivory", name: "乳白" },
    { colorCode: "light_family", name: "浅色系" },
  ],
  contentVersion,
  displayLabel: "日常可穿",
  element: "metal",
  elementLabel: "金",
  explanation: "适合作为日常穿搭参考。",
  rank: 3,
  relationText: "金克木",
  tierCode: "ping",
} satisfies PingCardData;

const pageData = {
  ...dateData,
  ciJiCard,
  daJiCard,
  pingCard,
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

  it("selects the three positive tiers by tierCode and preserves each published color order", async () => {
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
    expect(pageData.ciJiCard.contentVersion).toBe(pageData.daJiCard.contentVersion);
    expect(pageData.pingCard.contentVersion).toBe(pageData.daJiCard.contentVersion);
    expect(pageData.ciJiCard.colors.map(({ name }) => name)).toEqual(["湖蓝", "绿色", "青色"]);
    expect(pageData.pingCard.colors.map(({ name }) => name)).toEqual([
      "银色",
      "白色",
      "金色",
      "乳白",
      "浅色系",
    ]);
  });

  it.each([
    ["missing da_ji", otherTiers],
    ["non-unique", [otherTiers[0], otherTiers[0], daJiTier, otherTiers[2], otherTiers[3]]],
    [
      "wrong ci_ji rank",
      apiTodayResponse.content.tiers.map((tier) =>
        tier?.tierCode === "ci_ji" ? { ...ciJiTier, rank: 3 } : tier,
      ),
    ],
    [
      "wrong ping rank",
      apiTodayResponse.content.tiers.map((tier) =>
        tier?.tierCode === "ping" ? { ...pingTier, rank: 4 } : tier,
      ),
    ],
  ])("keeps the date but hides the whole card when the tier index is %s", async (_case, tiers) => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: { ...apiTodayResponse.content, tiers },
    });

    expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
  });

  it.each([
    ["empty colors", "colors", []],
    ["wrong algorithm label", "algorithmLabel", "大吉"],
    ["wrong display label", "displayLabel", "今日优先"],
    ["wrong display section", "displaySection", "attention"],
    ["mismatched element label", "elementLabel", "火"],
    ["forbidden promise copy", "explanation", "保证好运，帮助转运。"],
  ])(
    "keeps a valid da_ji but hides the entire ci_ji card when it has %s",
    async (_case, field, value) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          tiers: apiTodayResponse.content.tiers.map((tier) =>
            tier?.tierCode === "ci_ji" ? { ...ciJiTier, [field]: value } : tier,
          ),
        },
      });

      expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard, pingCard: null });
    },
  );

  it.each([
    ["empty colors", "colors", []],
    ["wrong algorithm label", "algorithmLabel", "次吉"],
    ["wrong display label", "displayLabel", "稳妥选择"],
    ["wrong display section", "displaySection", "attention"],
    ["mismatched element label", "elementLabel", "水"],
    ["high-risk exaggerated copy", "explanation", "这些颜色会带来好运。"],
    ["negative copy", "explanation", "这些颜色今天比较勉强，不推荐。"],
    ["internal negative label", "explanation", "这些颜色今天不利。"],
  ])(
    "keeps da_ji and ci_ji but hides the entire ping card when it has %s",
    async (_case, field, value) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          tiers: apiTodayResponse.content.tiers.map((tier) =>
            tier?.tierCode === "ping" ? { ...pingTier, [field]: value } : tier,
          ),
        },
      });

      expect(result).toEqual({ ...dateData, ciJiCard, daJiCard, pingCard: null });
    },
  );

  it("does not discard neutral reviewed ping copy merely because it contains 一般", async () => {
    const explanation = "适合一般通勤场景。";
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "ping" ? { ...pingTier, explanation } : tier,
        ),
      },
    });

    expect(result?.pingCard?.explanation).toBe(explanation);
  });

  it("does not display ping by itself when ci_ji content is invalid", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "ci_ji" ? { ...ciJiTier, colors: [] } : tier,
        ),
      },
    });

    expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard, pingCard: null });
  });

  it("does not display ci_ji by itself when da_ji content is invalid", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        tiers: apiTodayResponse.content.tiers.map((tier) =>
          tier?.tierCode === "da_ji" ? { ...daJiTier, colors: [] } : tier,
        ),
      },
    });

    expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
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

    expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
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

    expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
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

      expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
    },
  );

  it("hides the card when the response header and body content versions differ", async () => {
    await expect(loadFrom(apiTodayResponse, "fd-20260715-r2")).resolves.toEqual({
      ...dateData,
      ciJiCard: null,
      daJiCard: null,
      pingCard: null,
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
      ciJiCard: null,
      daJiCard: null,
      pingCard: null,
    });
  });

  it("hides the card when X-Content-Version is missing", async () => {
    await expect(loadFrom(apiTodayResponse, null)).resolves.toEqual({
      ...dateData,
      ciJiCard: null,
      daJiCard: null,
      pingCard: null,
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

    expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
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

      expect(result).toEqual({ ...dateData, ciJiCard: null, daJiCard: null, pingCard: null });
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
