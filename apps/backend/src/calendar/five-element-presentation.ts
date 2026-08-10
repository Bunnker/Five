import type { components } from "@five/api-contract";

import type { FiveElement, TierCode } from "./calendar-rule-engine";

type Tier = components["schemas"]["Tier"];

export interface FiveElementPresentation {
  readonly colors: Tier["colors"];
  readonly label: Tier["elementLabel"];
}

export const FIVE_ELEMENT_PRESENTATION: Readonly<Record<FiveElement, FiveElementPresentation>> = {
  earth: {
    colors: [
      { colorCode: "yellow", name: "黄色" },
      { colorCode: "coffee", name: "咖色" },
      { colorCode: "brown", name: "棕色" },
      { colorCode: "khaki", name: "卡其" },
      { colorCode: "dark_brown_family", name: "褐色系" },
    ],
    label: "土",
  },
  fire: {
    colors: [
      { colorCode: "red", name: "红色" },
      { colorCode: "orange", name: "橙色" },
      { colorCode: "purple", name: "紫色" },
      { colorCode: "pink_family", name: "粉色系" },
    ],
    label: "火",
  },
  metal: {
    colors: [
      { colorCode: "white", name: "白色" },
      { colorCode: "ivory", name: "乳白" },
      { colorCode: "silver", name: "银色" },
      { colorCode: "gold", name: "金色" },
      { colorCode: "light_family", name: "浅色系" },
    ],
    label: "金",
  },
  water: {
    colors: [
      { colorCode: "black", name: "黑色" },
      { colorCode: "navy", name: "藏青" },
      { colorCode: "royal_blue", name: "宝蓝" },
      { colorCode: "dark_green", name: "墨绿" },
      { colorCode: "dark_gray_family", name: "深灰系" },
    ],
    label: "水",
  },
  wood: {
    colors: [
      { colorCode: "green", name: "绿色" },
      { colorCode: "cyan", name: "青色" },
      { colorCode: "emerald", name: "翠色" },
      { colorCode: "lake_blue", name: "湖蓝" },
      { colorCode: "light_green_family", name: "浅绿系" },
    ],
    label: "木",
  },
};

export const TIER_PRESENTATION: Readonly<
  Record<TierCode, Pick<Tier, "algorithmLabel" | "displayLabel" | "displaySection" | "rank">>
> = {
  bu_li: {
    algorithmLabel: "不利",
    displayLabel: "注意",
    displaySection: "attention",
    rank: 5,
  },
  ci_ji: {
    algorithmLabel: "次吉",
    displayLabel: "稳妥选择",
    displaySection: "primary",
    rank: 2,
  },
  da_ji: {
    algorithmLabel: "大吉",
    displayLabel: "今日优先",
    displaySection: "primary",
    rank: 1,
  },
  jiao_cha: {
    algorithmLabel: "较差",
    displayLabel: "注意",
    displaySection: "attention",
    rank: 4,
  },
  ping: {
    algorithmLabel: "平",
    displayLabel: "日常可穿",
    displaySection: "primary",
    rank: 3,
  },
};

export const TIER_CODES_IN_RANK_ORDER = [
  "da_ji",
  "ci_ji",
  "ping",
  "jiao_cha",
  "bu_li",
] as const satisfies readonly TierCode[];
