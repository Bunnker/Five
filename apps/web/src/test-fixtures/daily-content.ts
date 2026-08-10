import type { components } from "@five/api-contract";

type DailyContent = components["schemas"]["DailyContent"];

const audience = { code: "adult_women", label: "成年女性" };

function previousDate(fortuneDate: string): string {
  return new Date(Date.parse(`${fortuneDate}T00:00:00.000Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function formulaSlot(
  role: "accent" | "primary" | "secondary",
  tierCode: "ci_ji" | "da_ji" | "ping",
  colorCode: "green" | "red" | "white",
  ratioPercent: number | null,
) {
  return {
    colorCodes: [colorCode],
    garmentParts: role === "accent" ? ["配饰"] : role === "primary" ? ["上衣"] : ["下装"],
    ratioPercent,
    role,
    roleLabel: role === "accent" ? "点缀色" : role === "primary" ? "主色" : "辅助色",
    tierCode,
  };
}

function coverImage(assetId: string) {
  return {
    aiDisclosure: "AI 生成穿搭示意图",
    aiGenerated: true,
    altText: "公开穿搭示意图",
    assetId,
    height: 1600,
    mediaType: "image/webp",
    url: `https://cdn.five.test/${assetId}.webp`,
    width: 1200,
  };
}

export function dailyContentFixture(
  fortuneDate = "2026-08-07",
  contentVersion = `content-${fortuneDate}`,
): DailyContent {
  const previous = previousDate(fortuneDate);
  const monoFormula = {
    audience,
    disclaimer: "同色系深浅变化属于穿搭参考。",
    formulaId: "formula-mono",
    kind: "mono",
    lookIds: ["look-primary"],
    scenario: { code: "daily", label: "日常" },
    slots: [formulaSlot("primary", "da_ji", "red", 100)],
    title: "红色日常搭配",
  };
  const dualFormula = {
    audience,
    disclaimer: "双色比例未确认时不编造百分比。",
    formulaId: "formula-dual",
    kind: "dual",
    lookIds: ["look-alternate"],
    scenario: { code: "commute", label: "通勤" },
    slots: [
      formulaSlot("primary", "da_ji", "red", null),
      formulaSlot("secondary", "ci_ji", "green", null),
    ],
    title: "红绿通勤搭配",
  };
  const tripleFormula = {
    audience,
    disclaimer: "60/30/10 为穿搭参考，不是五行推算规则。",
    formulaId: "formula-triple",
    kind: "triple",
    lookIds: [],
    scenario: { code: "meeting", label: "会议" },
    slots: [
      formulaSlot("primary", "da_ji", "red", 60),
      formulaSlot("secondary", "ci_ji", "green", 30),
      formulaSlot("accent", "ping", "white", 10),
    ],
    title: "三色会议搭配",
  };

  return {
    balanceSuggestion: {
      accessoryExamples: ["丝巾"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: {
      disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
      steps: ["当日干支与五行结果由服务端固定规则生成。"],
    },
    calendar: {
      branch: "申",
      dayElement: "metal",
      dayElementLabel: "金",
      ganzhiDay: "庚申",
      lunarDateText: "六月廿五",
      weekdayText: "星期五",
    },
    effectiveFrom: `${previous}T18:00:00+08:00`,
    effectiveTo: `${fortuneDate}T18:00:00+08:00`,
    fortuneDate,
    looks: [
      {
        alternatives: [],
        audience,
        coverImage: coverImage("asset-primary"),
        detailImages: [],
        formulaId: monoFormula.formulaId,
        items: [
          {
            category: "top",
            categoryLabel: "上衣",
            colorCode: "red",
            description: "红色上衣",
          },
        ],
        lookId: "look-primary",
        requiredForPublish: true,
        scenario: monoFormula.scenario,
        sortOrder: 1,
        title: "红色日常主方案",
      },
      {
        alternatives: [],
        audience,
        coverImage: coverImage("asset-alternate"),
        detailImages: [],
        formulaId: dualFormula.formulaId,
        items: [
          {
            category: "top",
            categoryLabel: "上衣",
            colorCode: "red",
            description: "红色上衣",
          },
          {
            category: "bottom",
            categoryLabel: "下装",
            colorCode: "green",
            description: "绿色下装",
          },
        ],
        lookId: "look-alternate",
        requiredForPublish: true,
        scenario: dualFormula.scenario,
        sortOrder: 2,
        title: "红绿通勤备选方案",
      },
    ],
    outfitFormulas: [monoFormula, dualFormula, tripleFormula],
    share: {
      copyText: "今日穿搭参考：优先红色，绿色作为稳妥选择。",
      posterJobEndpoint: "/api/v1/poster-jobs",
      posterTemplateVersion: "poster-v1",
      summaryText: "今日穿搭优先参考红色。",
    },
    tiers: [
      {
        algorithmLabel: "大吉",
        colors: [{ colorCode: "red", name: "红色" }],
        displayLabel: "今日优先",
        displaySection: "primary",
        element: "fire",
        elementLabel: "火",
        explanation: "今日优先参考红色。",
        rank: 1,
        relationText: "金日与火色搭配",
        tierCode: "da_ji",
      },
      {
        algorithmLabel: "次吉",
        colors: [{ colorCode: "green", name: "绿色" }],
        displayLabel: "稳妥选择",
        displaySection: "primary",
        element: "wood",
        elementLabel: "木",
        explanation: "今日可稳妥参考绿色。",
        rank: 2,
        relationText: "金日与木色搭配",
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
        relationText: "日常搭配参考",
        tierCode: "ping",
      },
      {
        algorithmLabel: "较差",
        colors: [{ colorCode: "black", name: "黑色" }],
        displayLabel: "注意",
        displaySection: "attention",
        element: "water",
        elementLabel: "水",
        explanation: "今日建议降低大面积使用比例。",
        rank: 4,
        relationText: "今日需要留意",
        tierCode: "jiao_cha",
      },
      {
        algorithmLabel: "不利",
        colors: [{ colorCode: "yellow", name: "黄色" }],
        displayLabel: "注意",
        displaySection: "attention",
        element: "earth",
        elementLabel: "土",
        explanation: "今日建议减少使用。",
        rank: 5,
        relationText: "今日需要减少",
        tierCode: "bu_li",
      },
    ],
    versions: {
      algorithmVersion: "algorithm-v1",
      assetManifestVersion: "assets-v1",
      calendarDataVersion: "calendar-data-v1",
      calendarRuleVersion: "calendar-rule-v1",
      contentVersion,
      copyVersion: "copy-v1",
      outfitVersion: "outfit-v1",
      posterTemplateVersion: "poster-v1",
    },
  } as unknown as DailyContent;
}
