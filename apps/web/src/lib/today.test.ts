import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadToday,
  type AttentionSectionData,
  type CiJiCardData,
  type DaJiCardData,
  type OutfitPreviewSectionData,
  type PingCardData,
  type TodayImagePreviewSectionData,
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

const jiaoChaTier = {
  algorithmLabel: "较差",
  colors: [
    { colorCode: "black", name: "黑色" },
    { colorCode: "navy", name: "藏青" },
    { colorCode: "royal_blue", name: "宝蓝" },
    { colorCode: "dark_green", name: "墨绿" },
    { colorCode: "dark_gray_family", name: "深灰系" },
  ] satisfies AttentionSectionData["groups"][0]["colors"],
  displayLabel: "注意",
  displaySection: "attention",
  element: "water",
  elementLabel: "水",
  explanation: "今日建议降低大面积使用比例。",
  rank: 4,
  relationText: "水生木",
  tierCode: "jiao_cha",
};

const buLiTier = {
  algorithmLabel: "不利",
  colors: [
    { colorCode: "yellow", name: "黄色" },
    { colorCode: "coffee", name: "咖色" },
    { colorCode: "brown", name: "棕色" },
    { colorCode: "khaki", name: "卡其" },
    { colorCode: "dark_brown_family", name: "褐色系" },
  ] satisfies AttentionSectionData["groups"][1]["colors"],
  displayLabel: "注意",
  displaySection: "attention",
  element: "earth",
  elementLabel: "土",
  explanation: "今日建议减少使用。",
  rank: 5,
  relationText: "木克土",
  tierCode: "bu_li",
};

const balanceSuggestion = {
  accessoryExamples: ["丝巾", "包", "鞋", "耳饰"],
  description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
  preferredTierCode: "da_ji",
  title: "已经穿了注意色",
} satisfies AttentionSectionData["balanceSuggestion"];

const formulaAudience = { code: "adult_women", label: "成年女性" };
const formulaScenario = { code: "daily", label: "日常" };
const monoFormula = {
  audience: formulaAudience,
  disclaimer: "同色系深浅变化属于穿搭参考。",
  formulaId: "formula-mono-01",
  kind: "mono",
  lookIds: ["look-mono-01"],
  scenario: formulaScenario,
  slots: [
    {
      colorCodes: ["red", "orange"],
      garmentParts: ["上衣", "下装"],
      ratioPercent: 100,
      role: "primary",
      roleLabel: "主色",
      tierCode: "da_ji",
    },
  ],
  title: "红橙同色系",
};
const dualFormula = {
  audience: formulaAudience,
  disclaimer: "双色比例未确认时不编造百分比。",
  formulaId: "formula-dual-01",
  kind: "dual",
  lookIds: ["look-dual-01"],
  scenario: formulaScenario,
  slots: [
    {
      colorCodes: ["orange"],
      garmentParts: ["上衣"],
      ratioPercent: null,
      role: "primary",
      roleLabel: "主色",
      tierCode: "da_ji",
    },
    {
      colorCodes: ["lake_blue"],
      garmentParts: ["下装"],
      ratioPercent: null,
      role: "secondary",
      roleLabel: "辅助色",
      tierCode: "ci_ji",
    },
  ],
  title: "橙色与湖蓝",
};
const tripleFormula = {
  audience: formulaAudience,
  disclaimer: "60/30/10 为穿搭参考，不是五行推算规则。",
  formulaId: "formula-triple-01",
  kind: "triple",
  lookIds: ["look-triple-01"],
  scenario: { code: "commute", label: "通勤" },
  slots: [
    {
      colorCodes: ["red"],
      garmentParts: ["上衣"],
      ratioPercent: 60,
      role: "primary",
      roleLabel: "主色",
      tierCode: "da_ji",
    },
    {
      colorCodes: ["green"],
      garmentParts: ["下装"],
      ratioPercent: 30,
      role: "secondary",
      roleLabel: "辅助色",
      tierCode: "ci_ji",
    },
    {
      colorCodes: ["white"],
      garmentParts: ["鞋包", "配饰"],
      ratioPercent: 10,
      role: "accent",
      roleLabel: "点缀色",
      tierCode: "ping",
    },
  ],
  title: "通勤三色搭配",
};
const outfitFormulas = [tripleFormula, monoFormula, dualFormula];

const mainLook = {
  alternatives: [],
  audience: formulaAudience,
  coverImage: {
    aiDisclosure: "AI 生成穿搭示意图",
    aiGenerated: true,
    altText: "红色上衣、绿色下装和白色配饰的通勤穿搭",
    assetId: "asset-look-main-cover",
    height: 1600,
    mediaType: "image/webp",
    url: "https://cdn.five.test/assets/fd-20260715-r1/main-a1b2c3.webp",
    width: 1200,
  },
  detailImages: [],
  formulaId: "formula-triple-01",
  items: [
    {
      category: "top",
      categoryLabel: "上衣",
      colorCode: "red",
      description: "红色简洁上衣",
    },
    {
      category: "bottom",
      categoryLabel: "下装",
      colorCode: "green",
      description: "低饱和绿色下装",
    },
    {
      category: "accessory",
      categoryLabel: "鞋包/配饰",
      colorCode: "white",
      description: "白色小面积点缀",
    },
  ],
  lookId: "look-triple-01",
  requiredForPublish: true,
  scenario: tripleFormula.scenario,
  sortOrder: 1,
  title: "木日通勤主方案",
};

const alternateLook = {
  alternatives: [],
  audience: formulaAudience,
  coverImage: {
    aiDisclosure: "AI 生成穿搭示意图",
    aiGenerated: true,
    altText: "橙色上衣和湖蓝下装的日常穿搭",
    assetId: "asset-look-alternate-cover",
    height: 1600,
    mediaType: "image/webp",
    url: "https://cdn.five.test/assets/fd-20260715-r1/alternate-d4e5f6.webp",
    width: 1200,
  },
  detailImages: [],
  formulaId: "formula-dual-01",
  items: [
    {
      category: "top",
      categoryLabel: "上衣",
      colorCode: "orange",
      description: "橙色上衣",
    },
    {
      category: "bottom",
      categoryLabel: "下装",
      colorCode: "lake_blue",
      description: "湖蓝下装",
    },
  ],
  lookId: "look-dual-01",
  requiredForPublish: true,
  scenario: dualFormula.scenario,
  sortOrder: 2,
  title: "橙色与湖蓝日常方案",
};

const supplementalLook = {
  alternatives: [],
  audience: formulaAudience,
  coverImage: {
    aiDisclosure: null,
    aiGenerated: false,
    altText: "红橙同色系日常穿搭",
    assetId: "asset-look-supplemental-cover",
    height: 1600,
    mediaType: "image/webp",
    url: "https://cdn.five.test/assets/fd-20260715-r1/supplemental-g7h8i9.webp",
    width: 1200,
  },
  detailImages: [],
  formulaId: "formula-mono-01",
  items: [
    {
      category: "top",
      categoryLabel: "上衣",
      colorCode: "orange",
      description: "橙色上衣",
    },
    {
      category: "bottom",
      categoryLabel: "下装",
      colorCode: "red",
      description: "红色下装",
    },
  ],
  lookId: "look-mono-01",
  requiredForPublish: false,
  scenario: monoFormula.scenario,
  sortOrder: 3,
  title: "红橙同色系日常方案",
};

const looks = [supplementalLook, alternateLook, mainLook];

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

const otherTiers = [ciJiTier, pingTier, jiaoChaTier, buLiTier];

const apiTodayResponse = {
  content: {
    ...dateData.content,
    balanceSuggestion,
    looks,
    outfitFormulas,
    tiers: [otherTiers[0], otherTiers[3], daJiTier, otherTiers[1], otherTiers[2]],
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

const attentionSection = {
  balanceSuggestion,
  contentVersion,
  groups: [
    {
      colors: jiaoChaTier.colors,
      element: "water",
      elementLabel: "水",
      explanation: "今日建议降低大面积使用比例。",
      rank: 4,
      relationText: "水生木",
      tierCode: "jiao_cha",
    },
    {
      colors: buLiTier.colors,
      element: "earth",
      elementLabel: "土",
      explanation: "今日建议减少使用。",
      rank: 5,
      relationText: "木克土",
      tierCode: "bu_li",
    },
  ],
} satisfies AttentionSectionData;

const outfitPreviewSection = {
  cards: [
    {
      formulaId: "formula-mono-01",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono-01",
      kind: "mono",
      slots: [
        {
          colors: [
            { colorCode: "red", name: "红色" },
            { colorCode: "orange", name: "橙色" },
          ],
          ratioPercent: 100,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
      ],
      title: "红橙同色系",
    },
    {
      formulaId: "formula-dual-01",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-dual-01",
      kind: "dual",
      slots: [
        {
          colors: [{ colorCode: "orange", name: "橙色" }],
          ratioPercent: null,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colors: [{ colorCode: "lake_blue", name: "湖蓝" }],
          ratioPercent: null,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
      ],
      title: "橙色与湖蓝",
    },
    {
      formulaId: "formula-triple-01",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
      kind: "triple",
      slots: [
        {
          colors: [{ colorCode: "red", name: "红色" }],
          ratioPercent: 60,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colors: [{ colorCode: "green", name: "绿色" }],
          ratioPercent: 30,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
        {
          colors: [{ colorCode: "white", name: "白色" }],
          ratioPercent: 10,
          role: "accent",
          roleLabel: "点缀色",
          tierCode: "ping",
        },
      ],
      title: "通勤三色搭配",
    },
  ],
  contentVersion,
} satisfies OutfitPreviewSectionData;

const imagePreviewSection = {
  cards: [
    {
      aiDisclosure: "AI 生成穿搭示意图",
      altText: "红色上衣、绿色下装和白色配饰的通勤穿搭",
      assetId: "asset-look-main-cover",
      displayLabel: "主方案",
      formulaId: "formula-triple-01",
      height: 1600,
      items: [
        { categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } },
        { categoryLabel: "下装", color: { colorCode: "green", name: "绿色" } },
        { categoryLabel: "鞋包/配饰", color: { colorCode: "white", name: "白色" } },
      ],
      lookId: "look-triple-01",
      mediaType: "image/webp",
      placement: "primary",
      scenarioLabel: "通勤",
      sortOrder: 1,
      title: "木日通勤主方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/main-a1b2c3.webp",
      width: 1200,
    },
    {
      aiDisclosure: "AI 生成穿搭示意图",
      altText: "橙色上衣和湖蓝下装的日常穿搭",
      assetId: "asset-look-alternate-cover",
      displayLabel: "替代方案",
      formulaId: "formula-dual-01",
      height: 1600,
      items: [
        { categoryLabel: "上衣", color: { colorCode: "orange", name: "橙色" } },
        { categoryLabel: "下装", color: { colorCode: "lake_blue", name: "湖蓝" } },
      ],
      lookId: "look-dual-01",
      mediaType: "image/webp",
      placement: "alternate",
      scenarioLabel: "日常",
      sortOrder: 2,
      title: "橙色与湖蓝日常方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/alternate-d4e5f6.webp",
      width: 1200,
    },
    {
      aiDisclosure: null,
      altText: "红橙同色系日常穿搭",
      assetId: "asset-look-supplemental-cover",
      displayLabel: "更多场景",
      formulaId: "formula-mono-01",
      height: 1600,
      items: [
        { categoryLabel: "上衣", color: { colorCode: "orange", name: "橙色" } },
        { categoryLabel: "下装", color: { colorCode: "red", name: "红色" } },
      ],
      lookId: "look-mono-01",
      mediaType: "image/webp",
      placement: "supplemental",
      scenarioLabel: "日常",
      sortOrder: 3,
      title: "红橙同色系日常方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/supplemental-g7h8i9.webp",
      width: 1200,
    },
  ],
  contentVersion,
} satisfies TodayImagePreviewSectionData;

const pageData = {
  ...dateData,
  attentionSection,
  ciJiCard,
  daJiCard,
  imagePreviewSection,
  outfitPreviewSection,
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

  it("selects every tier by tierCode and preserves the published group and color order", async () => {
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
    expect(pageData.attentionSection.contentVersion).toBe(pageData.daJiCard.contentVersion);
    expect(
      pageData.attentionSection.groups.map(({ rank, tierCode }) => ({ rank, tierCode })),
    ).toEqual([
      { rank: 4, tierCode: "jiao_cha" },
      { rank: 5, tierCode: "bu_li" },
    ]);
    expect(pageData.attentionSection.groups[0].colors.map(({ name }) => name)).toEqual([
      "黑色",
      "藏青",
      "宝蓝",
      "墨绿",
      "深灰系",
    ]);
    expect(pageData.attentionSection.groups[1].colors.map(({ name }) => name)).toEqual([
      "黄色",
      "咖色",
      "棕色",
      "卡其",
      "褐色系",
    ]);
    expect(pageData.outfitPreviewSection.cards.map(({ kind }) => kind)).toEqual([
      "mono",
      "dual",
      "triple",
    ]);
  });

  it("uses the first published formula of each kind and resolves every Chinese color name from its tier", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        outfitFormulas: [
          { ...monoFormula, formulaId: "formula-mono-first", title: "第一套单色" },
          { ...monoFormula, formulaId: "formula-mono-second", title: "第二套单色" },
          tripleFormula,
          dualFormula,
        ],
      },
    });

    expect(result?.outfitPreviewSection).toEqual({
      ...outfitPreviewSection,
      cards: [
        {
          ...outfitPreviewSection.cards[0],
          formulaId: "formula-mono-first",
          href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono-first",
          title: "第一套单色",
        },
        outfitPreviewSection.cards[1],
        outfitPreviewSection.cards[2],
      ],
    });
  });

  it.each([
    ["missing dual formula", outfitFormulas.filter(({ kind }) => kind !== "dual")],
    [
      "duplicate formula ids",
      outfitFormulas.map((formula) =>
        formula.kind === "dual" ? { ...formula, formulaId: monoFormula.formulaId } : formula,
      ),
    ],
    [
      "control character in formula id",
      outfitFormulas.map((formula) =>
        formula.kind === "mono" ? { ...formula, formulaId: "formula\nmono" } : formula,
      ),
    ],
    [
      "unsafe title",
      outfitFormulas.map((formula) =>
        formula.kind === "mono" ? { ...formula, title: "保证转运的单色穿法" } : formula,
      ),
    ],
    [
      "out-of-scope product title",
      outfitFormulas.map((formula) =>
        formula.kind === "mono" ? { ...formula, title: "吉祥物购买方案" } : formula,
      ),
    ],
    [
      "mono with two slots",
      outfitFormulas.map((formula) =>
        formula.kind === "mono"
          ? { ...formula, slots: [formula.slots[0], dualFormula.slots[1]] }
          : formula,
      ),
    ],
    [
      "attention tier in a public outfit",
      outfitFormulas.map((formula) =>
        formula.kind === "dual"
          ? {
              ...formula,
              slots: [
                formula.slots[0],
                { ...formula.slots[1], colorCodes: ["black"], tierCode: "jiao_cha" },
              ],
            }
          : formula,
      ),
    ],
    [
      "color outside its declared tier",
      outfitFormulas.map((formula) =>
        formula.kind === "mono"
          ? { ...formula, slots: [{ ...formula.slots[0], colorCodes: ["white"] }] }
          : formula,
      ),
    ],
    [
      "mismatched role label",
      outfitFormulas.map((formula) =>
        formula.kind === "triple"
          ? {
              ...formula,
              slots: [
                { ...formula.slots[0], roleLabel: "辅助色" },
                formula.slots[1],
                formula.slots[2],
              ],
            }
          : formula,
      ),
    ],
    [
      "partially specified dual ratios",
      outfitFormulas.map((formula) =>
        formula.kind === "dual"
          ? {
              ...formula,
              slots: [{ ...formula.slots[0], ratioPercent: 60 }, formula.slots[1]],
            }
          : formula,
      ),
    ],
    [
      "triple ratios that do not total 100",
      outfitFormulas.map((formula) =>
        formula.kind === "triple"
          ? {
              ...formula,
              slots: [formula.slots[0], formula.slots[1], { ...formula.slots[2], ratioPercent: 5 }],
            }
          : formula,
      ),
    ],
    [
      "triple ratios omitted",
      outfitFormulas.map((formula) =>
        formula.kind === "triple"
          ? {
              ...formula,
              slots: formula.slots.map((slot) => ({ ...slot, ratioPercent: null })),
            }
          : formula,
      ),
    ],
  ])(
    "hides the whole outfit preview but preserves daily decisions when it has %s",
    async (_case, formulas) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: { ...apiTodayResponse.content, outfitFormulas: formulas },
      });

      expect(result?.outfitPreviewSection).toBeNull();
      expect(result?.daJiCard).toEqual(daJiCard);
      expect(result?.ciJiCard).toEqual(ciJiCard);
      expect(result?.pingCard).toEqual(pingCard);
      expect(result?.attentionSection).toEqual(attentionSection);
    },
  );

  it("URL-encodes opaque versions and formula ids without parsing them", async () => {
    const opaqueContentVersion = "version /?&= alpha";
    const opaqueFormulaId = "单色 /?&= one";
    const result = await loadFrom(
      {
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          outfitFormulas: outfitFormulas.map((formula) =>
            formula.kind === "mono" ? { ...formula, formulaId: opaqueFormulaId } : formula,
          ),
          versions: { ...versions, contentVersion: opaqueContentVersion },
        },
      },
      opaqueContentVersion,
    );

    const href = result?.outfitPreviewSection?.cards[0].href;
    expect(href).toBeDefined();
    const target = new URL(href ?? "", "https://five.test");
    expect(target.pathname).toBe("/outfits");
    expect(target.searchParams.get("fortuneDate")).toBe("2026-07-15");
    expect(target.searchParams.get("expectedContentVersion")).toBe(opaqueContentVersion);
    expect(target.searchParams.get("formulaId")).toBe(opaqueFormulaId);
  });

  it("keeps the two required image previews when no supplemental image is published", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        looks: [alternateLook, mainLook],
        outfitFormulas: outfitFormulas.map((formula) =>
          formula.kind === "mono" ? { ...formula, lookIds: [] } : formula,
        ),
      },
    });

    expect(result?.imagePreviewSection).toEqual({
      ...imagePreviewSection,
      cards: imagePreviewSection.cards.slice(0, 2),
    });
  });

  it("omits an invalid supplemental image without leaving a blank third card", async () => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        looks: [
          mainLook,
          alternateLook,
          {
            ...supplementalLook,
            coverImage: {
              ...supplementalLook.coverImage,
              aiDisclosure: null,
              aiGenerated: true,
            },
          },
        ],
      },
    });

    expect(result?.imagePreviewSection).toEqual({
      ...imagePreviewSection,
      cards: imagePreviewSection.cards.slice(0, 2),
    });
    expect(result?.outfitPreviewSection).toEqual(outfitPreviewSection);
  });

  it.each([
    ["reuses a required sort order", { ...supplementalLook, sortOrder: 1 }],
    [
      "reuses a required image URL",
      {
        ...supplementalLook,
        coverImage: {
          ...supplementalLook.coverImage,
          url: mainLook.coverImage.url,
        },
      },
    ],
  ])("omits a supplemental image that %s", async (_case, invalidSupplementalLook) => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        looks: [mainLook, alternateLook, invalidSupplementalLook],
      },
    });

    expect(result?.imagePreviewSection).toEqual({
      ...imagePreviewSection,
      cards: imagePreviewSection.cards.slice(0, 2),
    });
  });

  it.each([
    [
      "only one required image",
      {
        looks: [mainLook, { ...alternateLook, requiredForPublish: false }],
        outfitFormulas,
      },
    ],
    [
      "duplicate required look ids",
      {
        looks: [mainLook, { ...alternateLook, lookId: mainLook.lookId }],
        outfitFormulas,
      },
    ],
    [
      "duplicate required sort order",
      {
        looks: [mainLook, { ...alternateLook, sortOrder: 1 }],
        outfitFormulas,
      },
    ],
    [
      "duplicate required assets",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            coverImage: {
              ...alternateLook.coverImage,
              assetId: mainLook.coverImage.assetId,
            },
          },
        ],
        outfitFormulas,
      },
    ],
    [
      "duplicate required image URLs",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            coverImage: {
              ...alternateLook.coverImage,
              url: mainLook.coverImage.url,
            },
          },
        ],
        outfitFormulas,
      },
    ],
    [
      "missing formula reference",
      {
        looks: [mainLook, { ...alternateLook, formulaId: "formula-missing-01" }],
        outfitFormulas,
      },
    ],
    [
      "missing formula backlink",
      {
        looks: [mainLook, alternateLook],
        outfitFormulas: outfitFormulas.map((formula) =>
          formula.kind === "dual" ? { ...formula, lookIds: [] } : formula,
        ),
      },
    ],
    [
      "formula reference to a look that is not published today",
      {
        looks: [mainLook, alternateLook],
        outfitFormulas,
      },
    ],
    [
      "backup without a ci_ji color",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            formulaId: monoFormula.formulaId,
            items: [alternateLook.items[0], { ...alternateLook.items[1], colorCode: "red" }],
          },
        ],
        outfitFormulas: outfitFormulas.map((formula) =>
          formula.kind === "mono"
            ? { ...formula, lookIds: [...formula.lookIds, alternateLook.lookId] }
            : formula,
        ),
      },
    ],
    [
      "unsafe image URL",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            coverImage: { ...alternateLook.coverImage, url: "javascript:alert(1)" },
          },
        ],
        outfitFormulas,
      },
    ],
    [
      "AI image without a visible disclosure",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            coverImage: { ...alternateLook.coverImage, aiDisclosure: null },
          },
        ],
        outfitFormulas,
      },
    ],
    [
      "AI image with a negated disclosure",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            coverImage: {
              ...alternateLook.coverImage,
              aiDisclosure: "这不是 AI 生成图片",
            },
          },
        ],
        outfitFormulas,
      },
    ],
    [
      "audience that differs from its formula",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            audience: { code: "adult_men", label: "成年男性" },
          },
        ],
        outfitFormulas,
      },
    ],
    [
      "look id claimed by more than one formula",
      {
        looks: [mainLook, alternateLook],
        outfitFormulas: outfitFormulas.map((formula) =>
          formula.kind === "mono"
            ? { ...formula, lookIds: [...formula.lookIds, mainLook.lookId] }
            : formula,
        ),
      },
    ],
    [
      "garment color outside the formula",
      {
        looks: [
          mainLook,
          {
            ...alternateLook,
            items: [{ ...alternateLook.items[0], colorCode: "white" }],
          },
        ],
        outfitFormulas,
      },
    ],
  ])(
    "hides only the image preview and preserves daily text when required images have %s",
    async (_case, patch) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          looks: patch.looks,
          outfitFormulas: patch.outfitFormulas,
        },
      });

      expect(result?.imagePreviewSection).toBeNull();
      expect(result?.outfitPreviewSection).not.toBeNull();
      expect(result?.daJiCard).toEqual(daJiCard);
      expect(result?.ciJiCard).toEqual(ciJiCard);
      expect(result?.pingCard).toEqual(pingCard);
    },
  );

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
    [
      "wrong jiao_cha rank",
      apiTodayResponse.content.tiers.map((tier) =>
        tier?.tierCode === "jiao_cha" ? { ...jiaoChaTier, rank: 5 } : tier,
      ),
    ],
    [
      "wrong bu_li rank",
      apiTodayResponse.content.tiers.map((tier) =>
        tier?.tierCode === "bu_li" ? { ...buLiTier, rank: 4 } : tier,
      ),
    ],
  ])("keeps the date but hides the whole card when the tier index is %s", async (_case, tiers) => {
    const result = await loadFrom({
      ...apiTodayResponse,
      content: { ...apiTodayResponse.content, tiers },
    });

    expect(result).toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
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

      expect(result).toEqual({
        ...dateData,
        attentionSection: null,
        ciJiCard: null,
        daJiCard,
        imagePreviewSection: null,
        outfitPreviewSection: null,
        pingCard: null,
      });
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

      expect(result).toEqual({
        ...dateData,
        attentionSection: null,
        ciJiCard,
        daJiCard,
        imagePreviewSection: null,
        outfitPreviewSection: null,
        pingCard: null,
      });
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

  it.each([
    ["jiao_cha", "wrong algorithm label", "algorithmLabel", "不利"],
    ["jiao_cha", "wrong display label", "displayLabel", "日常可穿"],
    ["jiao_cha", "wrong display section", "displaySection", "primary"],
    ["jiao_cha", "mismatched element label", "elementLabel", "土"],
    ["jiao_cha", "empty colors", "colors", []],
    [
      "jiao_cha",
      "duplicate color",
      "colors",
      [
        { colorCode: "black", name: "黑色" },
        { colorCode: "black", name: "黑色" },
      ],
    ],
    ["jiao_cha", "unknown color", "colors", [{ colorCode: "future_color", name: "未来色" }]],
    ["jiao_cha", "blank explanation", "explanation", " "],
    ["jiao_cha", "high-risk relation", "relationText", "保证好运。"],
    ["jiao_cha", "absolute promise synonym", "explanation", "这些做法百分百有效。"],
    ["jiao_cha", "internal negative label in public copy", "explanation", "这些颜色今天较差。"],
    ["bu_li", "wrong algorithm label", "algorithmLabel", "较差"],
    ["bu_li", "wrong display section", "displaySection", "primary"],
    ["bu_li", "fear copy", "explanation", "否则会破财，遇到大凶灾。"],
    ["bu_li", "fear synonym", "relationText", "今天大面积使用容易受伤。"],
    ["bu_li", "promise copy", "explanation", "保证转运，一定有效。"],
  ])(
    "keeps the three positive cards but hides the whole attention section when %s has %s",
    async (tierCode, _case, field, value) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          tiers: apiTodayResponse.content.tiers.map((tier) =>
            tier?.tierCode === tierCode ? { ...tier, [field]: value } : tier,
          ),
        },
      });

      expect(result).toEqual({
        ...dateData,
        attentionSection: null,
        ciJiCard,
        daJiCard,
        imagePreviewSection,
        outfitPreviewSection,
        pingCard,
      });
    },
  );

  it.each([
    ["wrong title", { title: "注意颜色" }],
    ["wrong preferred tier", { preferredTierCode: "ping" }],
    ["empty examples", { accessoryExamples: [] }],
    ["blank example", { accessoryExamples: ["包", " "] }],
    ["duplicate examples", { accessoryExamples: ["包", "包"] }],
    ["blank description", { description: " " }],
    ["promise copy", { description: "保证转运，一定有效。" }],
    ["absolute promise synonym", { description: "使用以后百分百有效。" }],
    ["fear copy", { description: "否则会破财，遇到大凶灾。" }],
    ["fear synonym", { description: "不使用就容易受伤。" }],
    ["resolution language", { description: "可以用当日大吉色普通配饰做小面积补充，不用于化解。" }],
    ["high-risk example", { accessoryExamples: ["助运手链"] }],
    ["unreviewed full-outfit example", { accessoryExamples: ["整套换装"] }],
    ["missing da_ji meaning", { description: "可以用普通配饰做小面积补充。" }],
    ["wrong-day da_ji meaning", { description: "可以用明天的大吉色普通配饰做小面积补充。" }],
    [
      "contradictory day meaning",
      { description: "不建议用当日大吉色，可以用明天的大吉色普通配饰做小面积补充。" },
    ],
    ["negated current suggestion", { description: "不可以用今日大吉色做少量点缀。" }],
    [
      "negated small-area suggestion",
      { description: "可以用今日大吉色的普通配饰，不过不是小面积点缀，而要整套换衣。" },
    ],
    ["unapproved mascot in description", { description: "可以用当日大吉色吉祥物做小面积补充。" }],
    [
      "guaranteed outcome synonym",
      { description: "可以用今日大吉色普通配饰做少量点缀，必能改善结果。" },
    ],
    [
      "spaced resolution language",
      { description: "可以用当日大吉色普通配饰做小面积补充，不用于化 解。" },
    ],
    ["missing small-area meaning", { description: "可以用当日大吉色更换整套衣服。" }],
  ])(
    "keeps the three positive cards but hides attention when balance suggestion has %s",
    async (_case, override) => {
      const result = await loadFrom({
        ...apiTodayResponse,
        content: {
          ...apiTodayResponse.content,
          balanceSuggestion: { ...balanceSuggestion, ...override },
        },
      });

      expect(result).toEqual({
        ...dateData,
        attentionSection: null,
        ciJiCard,
        daJiCard,
        imagePreviewSection,
        outfitPreviewSection,
        pingCard,
      });
    },
  );

  it("accepts the reviewed ordinary accessory examples and preserves their published order", async () => {
    const accessoryExamples = [
      "丝巾",
      "围巾",
      "包",
      "鞋",
      "领带",
      "耳饰",
      "手机壳",
      "帽子",
      "腰带",
      "首饰",
    ];
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        balanceSuggestion: { ...balanceSuggestion, accessoryExamples },
      },
    });

    expect(result?.attentionSection?.balanceSuggestion.accessoryExamples).toEqual(
      accessoryExamples,
    );
  });

  it("accepts the PRD-approved balance suggestion without changing any published tier result", async () => {
    const description = "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。";
    const result = await loadFrom({
      ...apiTodayResponse,
      content: {
        ...apiTodayResponse.content,
        balanceSuggestion: { ...balanceSuggestion, description },
      },
    });

    expect(result?.attentionSection?.balanceSuggestion.description).toBe(description);
    expect(result?.attentionSection?.groups).toEqual(attentionSection.groups);
    expect(result?.daJiCard).toEqual(daJiCard);
    expect(result?.ciJiCard).toEqual(ciJiCard);
    expect(result?.pingCard).toEqual(pingCard);
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

    expect(result).toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
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

    expect(result).toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
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

    expect(result).toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
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

    expect(result).toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
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

      expect(result).toEqual({
        ...dateData,
        attentionSection: null,
        ciJiCard: null,
        daJiCard: null,
        imagePreviewSection: null,
        outfitPreviewSection: null,
        pingCard: null,
      });
    },
  );

  it("hides the card when the response header and body content versions differ", async () => {
    await expect(loadFrom(apiTodayResponse, "fd-20260715-r2")).resolves.toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
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
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
  });

  it("hides the card when X-Content-Version is missing", async () => {
    await expect(loadFrom(apiTodayResponse, null)).resolves.toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
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

    expect(result).toEqual({
      ...dateData,
      attentionSection: null,
      ciJiCard: null,
      daJiCard: null,
      imagePreviewSection: null,
      outfitPreviewSection: null,
      pingCard: null,
    });
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

      expect(result).toEqual({
        ...dateData,
        attentionSection: null,
        ciJiCard: null,
        daJiCard: null,
        imagePreviewSection: null,
        outfitPreviewSection: null,
        pingCard: null,
      });
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
