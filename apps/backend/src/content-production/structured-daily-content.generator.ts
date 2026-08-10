import type { components } from "@five/api-contract";
import { Solar } from "lunar-javascript";

import {
  CURRENT_CALENDAR_ALGORITHM_VERSION,
  CURRENT_CALENDAR_DATA_VERSION,
} from "../calendar/calendar-content.values";
import {
  CalendarRuleEngine,
  type FiveElement,
  type TierCode,
} from "../calendar/calendar-rule-engine";
import {
  FIVE_ELEMENT_PRESENTATION,
  TIER_PRESENTATION,
} from "../calendar/five-element-presentation";
import { CONTRACT_POSTER_TEMPLATE_VERSION } from "../poster/poster-template.values";

export type DraftModules = components["schemas"]["DraftModules"];
type CalendarAlgorithmModule = NonNullable<DraftModules["calendar_algorithm"]>;
type CopyAndFormulaModule = NonNullable<DraftModules["copy_and_formula"]>;
type OutfitFormula = CopyAndFormulaModule["outfitFormulas"][number];
type Tier = CalendarAlgorithmModule["tiers"][number];

const COPY_VERSION = "structured-copy-template-v1";
const OUTFIT_VERSION = "structured-outfit-template-v1";
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  weekday: "long",
});
const GENERAL_AUDIENCE = { code: "adult_women", label: "成年女性" } as const;
const DAILY_SCENARIO = { code: "daily", label: "日常" } as const;
const COMMUTE_SCENARIO = { code: "commute", label: "通勤" } as const;

function requireAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing ${label} at index ${index}`);
  }
  return value;
}

function requireTier(tiers: readonly Tier[], tierCode: TierCode): Tier {
  const tier = tiers.find((candidate) => candidate.tierCode === tierCode);
  if (tier === undefined) {
    throw new Error(`Missing ${tierCode} tier`);
  }
  return tier;
}

function parseFortuneDate(fortuneDate: string): readonly [number, number, number] {
  const [year, month, day] = fortuneDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Invalid fortune date: ${fortuneDate}`);
  }
  return [year, month, day];
}

function lunarDateText(fortuneDate: string): string {
  const [year, month, day] = parseFortuneDate(fortuneDate);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
}

function displayDate(fortuneDate: string): Date {
  return new Date(`${fortuneDate}T12:00:00+08:00`);
}

function chineseDateText(fortuneDate: string): string {
  const [year, month, day] = parseFortuneDate(fortuneDate);
  return `${year}年${month}月${day}日`;
}

function relationText(
  tierCode: TierCode,
  dayElement: FiveElement,
  tierElement: FiveElement,
): string {
  const dayLabel = FIVE_ELEMENT_PRESENTATION[dayElement].label;
  const tierLabel = FIVE_ELEMENT_PRESENTATION[tierElement].label;
  const relations: Readonly<Record<TierCode, string>> = {
    bu_li: `${dayLabel}克${tierLabel}`,
    ci_ji: `${dayLabel}与${tierLabel}同类`,
    da_ji: `${dayLabel}生${tierLabel}`,
    jiao_cha: `${tierLabel}生${dayLabel}`,
    ping: `${tierLabel}克${dayLabel}`,
  };
  return relations[tierCode];
}

function explanation(
  tierCode: TierCode,
  dayElement: FiveElement,
  tierElement: FiveElement,
): string {
  const dayLabel = FIVE_ELEMENT_PRESENTATION[dayElement].label;
  const tierLabel = FIVE_ELEMENT_PRESENTATION[tierElement].label;
  const relation = relationText(tierCode, dayElement, tierElement);
  const explanations: Readonly<Record<TierCode, string>> = {
    bu_li: "今日建议减少使用；已经穿了可用大吉色小配饰做平衡。",
    ci_ji: "与今日五行相同，作为稳妥选择。",
    da_ji: `今日${dayLabel}日，${relation}，${tierLabel}为大吉。`,
    jiao_cha: "今日建议降低大面积使用比例；已经穿了可用大吉色小配饰做平衡。",
    ping: "适合作为日常穿搭参考。",
  };
  return explanations[tierCode];
}

function createTiers(
  answer: ReturnType<CalendarRuleEngine["evaluate"]>,
): CalendarAlgorithmModule["tiers"] {
  return answer.tiers.map((tier) => {
    const element = FIVE_ELEMENT_PRESENTATION[tier.element];
    return {
      ...TIER_PRESENTATION[tier.tierCode],
      colors: element.colors.map((color) => ({ ...color })),
      element: tier.element,
      elementLabel: element.label,
      explanation: explanation(tier.tierCode, answer.dayElement, tier.element),
      relationText: relationText(tier.tierCode, answer.dayElement, tier.element),
      tierCode: tier.tierCode,
    };
  });
}

function createOutfitFormulas(tiers: readonly Tier[]): OutfitFormula[] {
  const daJi = requireTier(tiers, "da_ji");
  const ciJi = requireTier(tiers, "ci_ji");
  const ping = requireTier(tiers, "ping");
  const daJiPrimary = requireAt(daJi.colors, 0, "大吉主色");
  const daJiFamily = requireAt(daJi.colors, daJi.colors.length - 1, "大吉同色系");
  const ciJiPrimary = requireAt(ciJi.colors, 0, "次吉主色");
  const pingPrimary = requireAt(ping.colors, 0, "平色");

  return [
    {
      audience: GENERAL_AUDIENCE,
      disclaimer: "同色系深浅变化属于穿搭参考。",
      formulaId: "formula-mono-01",
      kind: "mono",
      lookIds: ["look-alt-01"],
      scenario: DAILY_SCENARIO,
      slots: [
        {
          colorCodes: [daJiPrimary.colorCode, daJiFamily.colorCode],
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
      audience: GENERAL_AUDIENCE,
      disclaimer: "双色比例可按场景灵活调整，不必固定百分比。",
      formulaId: "formula-dual-01",
      kind: "dual",
      lookIds: ["look-alt-02"],
      scenario: DAILY_SCENARIO,
      slots: [
        {
          colorCodes: [daJiPrimary.colorCode],
          garmentParts: ["上衣"],
          ratioPercent: null,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colorCodes: [ciJiPrimary.colorCode],
          garmentParts: ["下装"],
          ratioPercent: null,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
      ],
      title: "大吉 × 次吉",
    },
    {
      audience: GENERAL_AUDIENCE,
      disclaimer: "60/30/10 为穿搭参考，不是五行推算规则。",
      formulaId: "formula-triple-01",
      kind: "triple",
      lookIds: ["look-main-01"],
      scenario: COMMUTE_SCENARIO,
      slots: [
        {
          colorCodes: [daJiPrimary.colorCode],
          garmentParts: ["上衣"],
          ratioPercent: 60,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colorCodes: [ciJiPrimary.colorCode],
          garmentParts: ["下装"],
          ratioPercent: 30,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
        {
          colorCodes: [pingPrimary.colorCode],
          garmentParts: ["鞋包", "配饰"],
          ratioPercent: 10,
          role: "accent",
          roleLabel: "点缀色",
          tierCode: "ping",
        },
      ],
      title: "60/30/10 通勤搭配",
    },
  ];
}

function colorNames(tier: Tier): string {
  return tier.colors.map((color) => color.name).join("、");
}

export class StructuredDailyContentGenerator {
  generate(fortuneDate: string): DraftModules {
    const answer = new CalendarRuleEngine().evaluate(fortuneDate);
    const tiers = createTiers(answer);
    const daJi = requireTier(tiers, "da_ji");
    const ciJi = requireTier(tiers, "ci_ji");
    const dayElementLabel = FIVE_ELEMENT_PRESENTATION[answer.dayElement].label;

    return {
      calendar_algorithm: {
        algorithmVersion: CURRENT_CALENDAR_ALGORITHM_VERSION,
        calendar: {
          branch: answer.dayBranch,
          dayElement: answer.dayElement,
          dayElementLabel,
          ganzhiDay: answer.ganzhiDay,
          lunarDateText: lunarDateText(fortuneDate),
          weekdayText: WEEKDAY_FORMATTER.format(displayDate(fortuneDate)),
        },
        calendarDataVersion: CURRENT_CALENDAR_DATA_VERSION,
        calendarRuleVersion: answer.calendarRuleVersion,
        tiers,
      },
      copy_and_formula: {
        balanceSuggestion: {
          accessoryExamples: ["丝巾", "包", "鞋", "耳饰"],
          description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
          preferredTierCode: "da_ji",
          title: "已经穿了注意色",
        },
        basis: {
          disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
          steps: [
            `今日干支为${answer.ganzhiDay}`,
            `日柱地支取${answer.dayBranch}`,
            `${answer.dayBranch}属${dayElementLabel}，因此今日为${dayElementLabel}日`,
          ],
        },
        copyVersion: COPY_VERSION,
        outfitFormulas: createOutfitFormulas(tiers),
        outfitVersion: OUTFIT_VERSION,
        share: {
          copyText: [
            `${chineseDateText(fortuneDate)} · ${dayElementLabel}日`,
            ...tiers.map((tier) => `${tier.algorithmLabel}：${colorNames(tier)}`),
            "内容基于传统文化规则整理，仅供穿搭参考。",
          ].join("\n"),
          posterJobEndpoint: "/api/v1/poster-jobs",
          posterTemplateVersion: CONTRACT_POSTER_TEMPLATE_VERSION,
          summaryText: `今日${dayElementLabel}日，优先参考${colorNames(daJi)}；${colorNames(ciJi)}可作为稳妥选择。`,
        },
      },
      poster_consistency: null,
      visual_and_rights: null,
    };
  }
}
