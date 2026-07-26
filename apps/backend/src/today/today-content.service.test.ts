import type { components } from "@five/api-contract";
import { describe, expect, it } from "vitest";

import { RequestContextResolver, type Clock } from "../request-context/request-context-resolver";
import { type PublishedContentReader, TodayContentService } from "./today-content.service";
import { TodayCachePolicy } from "./today-cache-policy";

type DailyContent = components["schemas"]["DailyContent"];

function publishedContent(overrides: Partial<DailyContent> = {}): DailyContent {
  const scenario = { code: "daily", label: "日常" };
  const audience = { code: "all", label: "通用" };
  const image = {
    aiDisclosure: null,
    aiGenerated: false,
    altText: "蓝色通勤穿搭",
    assetId: "asset-1",
    height: 1_200,
    mediaType: "image/webp" as const,
    url: "https://cdn.example.com/look.webp",
    width: 900,
  };
  const tiers: DailyContent["tiers"] = [
    {
      algorithmLabel: "大吉",
      colors: [{ colorCode: "green", name: "绿色" }],
      displayLabel: "今日优先",
      displaySection: "primary",
      element: "wood",
      elementLabel: "木",
      explanation: "今日优先选择绿色。",
      rank: 1,
      relationText: "水生木",
      tierCode: "da_ji",
    },
    {
      algorithmLabel: "次吉",
      colors: [{ colorCode: "blue", name: "蓝色" }],
      displayLabel: "稳妥选择",
      displaySection: "primary",
      element: "water",
      elementLabel: "水",
      explanation: "蓝色是稳妥选择。",
      rank: 2,
      relationText: "同我为水",
      tierCode: "ci_ji",
    },
    {
      algorithmLabel: "平",
      colors: [{ colorCode: "beige", name: "米色" }],
      displayLabel: "日常可穿",
      displaySection: "primary",
      element: "earth",
      elementLabel: "土",
      explanation: "米色日常可穿。",
      rank: 3,
      relationText: "土克水",
      tierCode: "ping",
    },
    {
      algorithmLabel: "较差",
      colors: [{ colorCode: "white", name: "白色" }],
      displayLabel: "注意",
      displaySection: "attention",
      element: "metal",
      elementLabel: "金",
      explanation: "今天减少大面积使用。",
      rank: 4,
      relationText: "金生水",
      tierCode: "jiao_cha",
    },
    {
      algorithmLabel: "不利",
      colors: [{ colorCode: "red", name: "红色" }],
      displayLabel: "注意",
      displaySection: "attention",
      element: "fire",
      elementLabel: "火",
      explanation: "今天减少大面积使用。",
      rank: 5,
      relationText: "水克火",
      tierCode: "bu_li",
    },
  ];
  const formulas: DailyContent["outfitFormulas"] = [
    {
      audience,
      disclaimer: "穿搭参考",
      formulaId: "formula-mono",
      kind: "mono",
      lookIds: ["look-1"],
      scenario,
      slots: [
        {
          colorCodes: ["green"],
          garmentParts: ["上衣", "下装"],
          ratioPercent: 100,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
      ],
      title: "大吉色同色系",
    },
    {
      audience,
      disclaimer: "穿搭参考",
      formulaId: "formula-dual",
      kind: "dual",
      lookIds: ["look-2"],
      scenario,
      slots: [
        {
          colorCodes: ["green"],
          garmentParts: ["上衣"],
          ratioPercent: 60,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colorCodes: ["blue"],
          garmentParts: ["下装"],
          ratioPercent: 40,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
      ],
      title: "大吉与次吉",
    },
    {
      audience,
      disclaimer: "穿搭参考",
      formulaId: "formula-triple",
      kind: "triple",
      lookIds: [],
      scenario,
      slots: [
        {
          colorCodes: ["green"],
          garmentParts: ["上衣"],
          ratioPercent: 60,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colorCodes: ["blue"],
          garmentParts: ["下装"],
          ratioPercent: 30,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
        {
          colorCodes: ["beige"],
          garmentParts: ["配饰"],
          ratioPercent: 10,
          role: "accent",
          roleLabel: "点缀色",
          tierCode: "ping",
        },
      ],
      title: "三色搭配",
    },
  ];
  const looks: DailyContent["looks"] = ["look-1", "look-2"].map((lookId, index) => ({
    alternatives: [],
    audience,
    coverImage: { ...image, assetId: `asset-${index + 1}` },
    detailImages: [],
    formulaId: index === 0 ? "formula-mono" : "formula-dual",
    items: [
      {
        category: "top",
        categoryLabel: "上衣",
        colorCode: index === 0 ? "green" : "blue",
        description: "适合日常通勤",
      },
    ],
    lookId,
    requiredForPublish: true,
    scenario,
    sortOrder: index + 1,
    title: index === 0 ? "绿色通勤" : "蓝绿搭配",
  }));

  return {
    balanceSuggestion: {
      accessoryExamples: ["包", "鞋"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: {
      disclaimer: "传统文化配色仅供穿搭参考。",
      steps: ["先确定北京时间命理日", "再按日五行排列五档"],
    },
    calendar: {
      branch: "亥",
      dayElement: "water",
      dayElementLabel: "水",
      ganzhiDay: "己亥",
      lunarDateText: "六月十一",
      weekdayText: "星期五",
    },
    effectiveFrom: "2026-07-23T23:00:00+08:00",
    effectiveTo: "2026-07-24T23:00:00+08:00",
    fortuneDate: "2026-07-24",
    looks,
    outfitFormulas: formulas,
    share: {
      copyText: "今日穿搭参考",
      posterJobEndpoint: "/api/v1/poster-jobs",
      posterTemplateVersion: "poster-v1",
      summaryText: "今日优先绿色",
    },
    tiers,
    versions: {
      algorithmVersion: "wx-public-1.0.0",
      assetManifestVersion: "asset-v1",
      calendarDataVersion: "calendar-v1",
      calendarRuleVersion: "fortune-date-23h-v1",
      contentVersion: "fd-20260724-r1",
      copyVersion: "copy-v1",
      outfitVersion: "outfit-v1",
      posterTemplateVersion: "poster-v1",
    },
    ...overrides,
  };
}

function serviceAt(
  instant: string,
  content: DailyContent | null,
  onRead?: (fortuneDate: string) => void,
): { clockCalls: () => number; service: TodayContentService } {
  let calls = 0;
  const clock: Clock = {
    now: () => {
      calls += 1;
      return new Date(instant);
    },
  };
  const reader: PublishedContentReader = {
    findActiveByFortuneDate: (fortuneDate) => {
      onRead?.(fortuneDate);
      return Promise.resolve(content);
    },
  };

  return {
    clockCalls: () => calls,
    service: new TodayContentService(
      new RequestContextResolver(clock),
      reader,
      new TodayCachePolicy(),
    ),
  };
}

describe("TodayContentService", () => {
  it("returns one request context and the matching immutable content version", async () => {
    const lookedUpDates: string[] = [];
    const fixture = publishedContent();
    const { clockCalls, service } = serviceAt("2026-07-24T10:00:00+08:00", fixture, (date) =>
      lookedUpDates.push(date),
    );

    const result = await service.read();

    expect(result).toMatchObject({
      body: {
        content: {
          versions: {
            contentVersion: "fd-20260724-r1",
          },
        },
        requestContext: {
          civilDate: "2026-07-24",
          fortuneDate: "2026-07-24",
          responseGeneratedAt: "2026-07-24T10:00:00+08:00",
          shichen: "巳",
        },
      },
      cacheControl: "public, max-age=0, s-maxage=60, must-revalidate",
      contentVersion: "fd-20260724-r1",
      kind: "ready",
      representationDate: "Fri, 24 Jul 2026 02:00:00 GMT",
      sharedMaxAgeSeconds: 60,
    });
    expect(result.kind === "ready" ? result.body.content : null).toBe(fixture);
    expect(result.kind === "ready" ? result.etag : "").toMatch(/^"sha256-[A-Za-z0-9_-]+"$/);
    expect(lookedUpDates).toEqual(["2026-07-24"]);
    expect(clockCalls()).toBe(1);
  });

  it.each([
    {
      content: null,
      name: "there is no published content",
    },
    {
      content: publishedContent({ fortuneDate: "2026-07-25" }),
      name: "the reader returns another fortune date",
    },
    {
      content: publishedContent({ effectiveTo: "2026-07-24T10:00:00+08:00" }),
      name: "the content has just expired",
    },
    {
      content: publishedContent({ effectiveFrom: "2026-07-24T10:00:00.001+08:00" }),
      name: "the content is not effective yet",
    },
  ])("fails closed when $name", async ({ content }) => {
    const { service } = serviceAt("2026-07-24T10:00:00+08:00", content);

    await expect(service.read()).resolves.toMatchObject({
      kind: "not_ready",
      retryAfterSeconds: 30,
    });
  });

  it("changes the complete-response ETag across civil midnight even for one content version", async () => {
    const fixture = publishedContent();
    const beforeMidnight = await serviceAt("2026-07-23T23:59:59+08:00", fixture).service.read();
    const atMidnight = await serviceAt("2026-07-24T00:00:00+08:00", fixture).service.read();

    expect(beforeMidnight).toMatchObject({
      body: {
        content: {
          versions: { contentVersion: "fd-20260724-r1" },
        },
        requestContext: {
          civilDate: "2026-07-23",
          crossedDayBoundary: true,
        },
      },
      kind: "ready",
    });
    expect(atMidnight).toMatchObject({
      body: {
        content: {
          versions: { contentVersion: "fd-20260724-r1" },
        },
        requestContext: {
          civilDate: "2026-07-24",
          crossedDayBoundary: false,
        },
      },
      kind: "ready",
    });
    expect(beforeMidnight.kind === "ready" ? beforeMidnight.etag : null).not.toBe(
      atMidnight.kind === "ready" ? atMidnight.etag : null,
    );
  });

  it("fails closed for content times without an explicit timezone in every process timezone", async () => {
    const originalTimezone = process.env.TZ;

    try {
      const results = [];

      for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
        process.env.TZ = timezone;
        results.push(
          await serviceAt(
            "2026-07-24T10:00:00+08:00",
            publishedContent({ effectiveTo: "2026-07-24T23:00:00" }),
          ).service.read(),
        );
      }

      expect(results.every((result) => result.kind === "not_ready")).toBe(true);
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
