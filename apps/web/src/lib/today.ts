import { randomUUID } from "node:crypto";

import type { FiveApiPaths } from "./api-contract";
import { isReviewedColorCode, reviewedColorPalette, type ReviewedColorCode } from "./color-palette";

type TodayResponse =
  FiveApiPaths["/api/v1/today"]["get"]["responses"][200]["content"]["application/json"];
type TodayRequestContext = TodayResponse["requestContext"];
type TodayCalendar = TodayResponse["content"]["calendar"];
type TodayTier = TodayResponse["content"]["tiers"][number];
type TodayBalanceSuggestion = TodayResponse["content"]["balanceSuggestion"];
type TodayBalanceAccessory = TodayBalanceSuggestion["accessoryExamples"][number];

interface DecisionCardBaseData {
  colors: Array<{
    colorCode: ReviewedColorCode;
    name: string;
  }>;
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
  element: TodayTier["element"];
  elementLabel: TodayTier["elementLabel"];
  explanation: TodayTier["explanation"];
  relationText: TodayTier["relationText"];
}

export interface DaJiCardData extends DecisionCardBaseData {
  algorithmLabel: "大吉";
  displayLabel: "今日优先";
  rank: 1;
  tierCode: "da_ji";
}

export interface CiJiCardData extends DecisionCardBaseData {
  algorithmLabel: "次吉";
  displayLabel: "稳妥选择";
  rank: 2;
  tierCode: "ci_ji";
}

export interface PingCardData extends DecisionCardBaseData {
  algorithmLabel: "平";
  displayLabel: "日常可穿";
  rank: 3;
  tierCode: "ping";
}

export type DecisionCardData = CiJiCardData | DaJiCardData | PingCardData;

interface AttentionGroupBaseData {
  colors: DecisionCardBaseData["colors"];
  element: TodayTier["element"];
  elementLabel: TodayTier["elementLabel"];
  explanation: TodayTier["explanation"];
  relationText: TodayTier["relationText"];
}

export interface JiaoChaAttentionGroupData extends AttentionGroupBaseData {
  rank: 4;
  tierCode: "jiao_cha";
}

export interface BuLiAttentionGroupData extends AttentionGroupBaseData {
  rank: 5;
  tierCode: "bu_li";
}

export type AttentionGroupData = BuLiAttentionGroupData | JiaoChaAttentionGroupData;

export interface OutfitPreviewColorData {
  colorCode: ReviewedColorCode;
  name: string;
}

export interface OutfitPreviewSlotData {
  colors: OutfitPreviewColorData[];
  ratioPercent: number | null;
  role: "accent" | "primary" | "secondary";
  roleLabel: "主色" | "辅助色" | "点缀色";
  tierCode: "ci_ji" | "da_ji" | "ping";
}

export interface OutfitPreviewCardData {
  formulaId: string;
  href: string;
  kind: "dual" | "mono" | "triple";
  slots: OutfitPreviewSlotData[];
  title: string;
}

export interface OutfitPreviewSectionData {
  cards: [OutfitPreviewCardData, OutfitPreviewCardData, OutfitPreviewCardData];
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
}

export interface AttentionSectionData {
  balanceSuggestion: {
    accessoryExamples: TodayBalanceSuggestion["accessoryExamples"];
    description: TodayBalanceSuggestion["description"];
    preferredTierCode: "da_ji";
    title: "已经穿了注意色";
  };
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
  groups: [JiaoChaAttentionGroupData, BuLiAttentionGroupData];
}

export interface TodayDateData {
  content: {
    calendar: Pick<
      TodayCalendar,
      "dayElement" | "dayElementLabel" | "ganzhiDay" | "lunarDateText" | "weekdayText"
    >;
    fortuneDate: TodayResponse["content"]["fortuneDate"];
  };
  requestContext: Pick<
    TodayRequestContext,
    "civilDate" | "crossedDayBoundary" | "fortuneDate" | "shichen"
  >;
}

export interface TodayPageData extends TodayDateData {
  attentionSection: AttentionSectionData | null;
  ciJiCard: CiJiCardData | null;
  daJiCard: DaJiCardData | null;
  outfitPreviewSection: OutfitPreviewSectionData | null;
  pingCard: PingCardData | null;
}

export interface LoadTodayOptions {
  apiOrigin?: string;
  requestId?: string | null;
  timeoutMs?: number;
}

const DEFAULT_HTTP_PORT = "3100";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const dayElements = ["wood", "fire", "earth", "metal", "water"] as const;
const dayElementLabels = {
  earth: "土",
  fire: "火",
  metal: "金",
  water: "水",
  wood: "木",
} as const;
const dayElementLabelNames = ["木", "火", "土", "金", "水"] as const;
const tierRanks = {
  bu_li: 5,
  ci_ji: 2,
  da_ji: 1,
  jiao_cha: 4,
  ping: 3,
} as const;
const decisionTierSpecs = {
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
  ping: {
    algorithmLabel: "平",
    displayLabel: "日常可穿",
    displaySection: "primary",
    rank: 3,
  },
} as const;
const attentionTierSpecs = {
  bu_li: {
    algorithmLabel: "不利",
    displayLabel: "注意",
    displaySection: "attention",
    rank: 5,
  },
  jiao_cha: {
    algorithmLabel: "较差",
    displayLabel: "注意",
    displaySection: "attention",
    rank: 4,
  },
} as const;
const outfitKinds = ["mono", "dual", "triple"] as const;
const outfitRoleLabels = {
  accent: "点缀色",
  primary: "主色",
  secondary: "辅助色",
} as const;
const outfitRolesByKind = {
  dual: ["primary", "secondary"],
  mono: ["primary"],
  triple: ["primary", "secondary", "accent"],
} as const;
const versionFields = [
  "algorithmVersion",
  "assetManifestVersion",
  "calendarDataVersion",
  "calendarRuleVersion",
  "contentVersion",
  "copyVersion",
  "outfitVersion",
  "posterTemplateVersion",
] as const;
const shichenNames = [
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
] as const;
const fortuneDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const forbiddenPublicCopyPattern = /保证|必然|转运|暴富|破财|大凶|灾|一定有效/u;
const forbiddenPingCopyPattern =
  /好运|贵人|助运|加分|事半功倍|运程|吉凶|运势平平|勉强|较差|不利|不推荐|倒霉|晦气/u;
const forbiddenAttentionCopyPattern =
  /好运|贵人|助运|加分|事半功倍|运程|吉凶|化解|较差|不利|不推荐|倒霉|晦气|厄运|凶险|灾祸|危险|警告|百分百|绝对|肯定|必定|必会|必能|一定会|确保|见效|有效|灵验|应验|受伤|伤害|出事|生病|失败|损失|坏事|祸事|不顺|出问题/u;
const forbiddenOutfitCopyPattern =
  /收藏|购买|商品|吉祥物|登录|账户|账号|出生|八字|个人运势|拍照试搭/u;
const reviewedBalanceAccessories = new Set<TodayBalanceAccessory>([
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
]);
const reviewedBalanceDescription =
  "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    value.trim() === value &&
    !hasAsciiControlCharacter(value)
  );
}

function isReviewedBalanceAccessory(value: string): value is TodayBalanceAccessory {
  return reviewedBalanceAccessories.has(value as TodayBalanceAccessory);
}

function isMember<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isFortuneDate(value: unknown): value is string {
  return typeof value === "string" && fortuneDatePattern.test(value);
}

function hasCompleteTierIndex(tiers: unknown): tiers is Array<Record<string, unknown>> {
  if (!Array.isArray(tiers) || tiers.length !== 5) {
    return false;
  }

  const seenTierCodes = new Set<string>();
  for (const tier of tiers) {
    if (!isRecord(tier) || typeof tier.tierCode !== "string") {
      return false;
    }

    const expectedRank = tierRanks[tier.tierCode as keyof typeof tierRanks];
    if (
      expectedRank === undefined ||
      tier.rank !== expectedRank ||
      seenTierCodes.has(tier.tierCode)
    ) {
      return false;
    }

    seenTierCodes.add(tier.tierCode);
  }

  return seenTierCodes.size === 5;
}

function getContentVersion(
  versions: unknown,
  responseContentVersion: string | null,
): string | null {
  if (
    !isRecord(versions) ||
    responseContentVersion === null ||
    !versionFields.every((field) => isNonEmptyString(versions[field]))
  ) {
    return null;
  }

  const bodyContentVersion = versions.contentVersion;
  return isNonEmptyString(bodyContentVersion) && bodyContentVersion === responseContentVersion
    ? bodyContentVersion
    : null;
}

interface DecisionContent {
  contentVersion: string;
  tiers: Array<Record<string, unknown>>;
}

interface DecisionCardCoreData {
  colors: DecisionCardData["colors"];
  contentVersion: DecisionCardData["contentVersion"];
  element: DecisionCardData["element"];
  elementLabel: DecisionCardData["elementLabel"];
  explanation: DecisionCardData["explanation"];
  relationText: DecisionCardData["relationText"];
}

function toReviewedColors(value: unknown): DecisionCardData["colors"] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const colors: DecisionCardData["colors"] = [];
  const seenColorCodes = new Set<ReviewedColorCode>();
  for (const color of value) {
    const colorCode =
      isRecord(color) && isReviewedColorCode(color.colorCode) ? color.colorCode : null;
    if (
      colorCode === null ||
      !isNonEmptyString(color.name) ||
      color.name !== reviewedColorPalette[colorCode].name ||
      seenColorCodes.has(colorCode)
    ) {
      return null;
    }

    seenColorCodes.add(colorCode);
    colors.push({
      colorCode,
      name: color.name,
    });
  }

  return colors;
}

function toDecisionContent(
  content: Record<string, unknown>,
  responseContentVersion: string | null,
): DecisionContent | null {
  if (!hasCompleteTierIndex(content.tiers)) {
    return null;
  }

  const contentVersion = getContentVersion(content.versions, responseContentVersion);
  if (contentVersion === null) {
    return null;
  }

  return {
    contentVersion,
    tiers: content.tiers,
  };
}

function toDecisionCardCore(
  tier: Record<string, unknown> | undefined,
  contentVersion: string,
  tierCode: keyof typeof decisionTierSpecs,
): DecisionCardCoreData | null {
  const spec = decisionTierSpecs[tierCode];
  if (
    tier === undefined ||
    tier.tierCode !== tierCode ||
    tier.rank !== spec.rank ||
    tier.algorithmLabel !== spec.algorithmLabel ||
    tier.displayLabel !== spec.displayLabel ||
    tier.displaySection !== spec.displaySection ||
    !isMember(dayElements, tier.element) ||
    !isMember(dayElementLabelNames, tier.elementLabel) ||
    tier.elementLabel !== dayElementLabels[tier.element] ||
    !isNonEmptyString(tier.relationText) ||
    !isNonEmptyString(tier.explanation) ||
    forbiddenPublicCopyPattern.test(tier.relationText) ||
    forbiddenPublicCopyPattern.test(tier.explanation) ||
    (tierCode === "ping" &&
      (forbiddenPingCopyPattern.test(tier.relationText) ||
        forbiddenPingCopyPattern.test(tier.explanation)))
  ) {
    return null;
  }

  const colors = toReviewedColors(tier.colors);
  if (colors === null) {
    return null;
  }

  return {
    colors,
    contentVersion,
    element: tier.element,
    elementLabel: tier.elementLabel,
    explanation: tier.explanation,
    relationText: tier.relationText,
  };
}

function isSafeAttentionCopy(value: unknown, maxLength: number): value is string {
  return (
    isNonEmptyString(value) &&
    value.length <= maxLength &&
    !forbiddenPublicCopyPattern.test(value) &&
    !forbiddenAttentionCopyPattern.test(value)
  );
}

function isSafeOutfitCopy(value: unknown, maxLength: number): value is string {
  return isSafeAttentionCopy(value, maxLength) && !forbiddenOutfitCopyPattern.test(value);
}

function toAttentionGroupData(
  decisionContent: DecisionContent,
  tierCode: "jiao_cha",
): JiaoChaAttentionGroupData | null;
function toAttentionGroupData(
  decisionContent: DecisionContent,
  tierCode: "bu_li",
): BuLiAttentionGroupData | null;
function toAttentionGroupData(
  decisionContent: DecisionContent,
  tierCode: keyof typeof attentionTierSpecs,
): AttentionGroupData | null {
  const spec = attentionTierSpecs[tierCode];
  const tier = decisionContent.tiers.find((candidate) => candidate.tierCode === tierCode);
  if (
    tier === undefined ||
    tier.rank !== spec.rank ||
    tier.algorithmLabel !== spec.algorithmLabel ||
    tier.displayLabel !== spec.displayLabel ||
    tier.displaySection !== spec.displaySection ||
    !isMember(dayElements, tier.element) ||
    !isMember(dayElementLabelNames, tier.elementLabel) ||
    tier.elementLabel !== dayElementLabels[tier.element] ||
    !isSafeAttentionCopy(tier.relationText, 64) ||
    !isSafeAttentionCopy(tier.explanation, 300)
  ) {
    return null;
  }

  const colors = toReviewedColors(tier.colors);
  if (colors === null) {
    return null;
  }

  const group = {
    colors,
    element: tier.element,
    elementLabel: tier.elementLabel,
    explanation: tier.explanation,
    rank: spec.rank,
    relationText: tier.relationText,
    tierCode,
  };

  return group as AttentionGroupData;
}

function toBalanceSuggestion(value: unknown): AttentionSectionData["balanceSuggestion"] | null {
  if (
    !isRecord(value) ||
    value.title !== "已经穿了注意色" ||
    value.preferredTierCode !== "da_ji" ||
    value.description !== reviewedBalanceDescription ||
    !Array.isArray(value.accessoryExamples) ||
    value.accessoryExamples.length < 1 ||
    value.accessoryExamples.length > reviewedBalanceAccessories.size
  ) {
    return null;
  }

  const accessoryExamples: TodayBalanceSuggestion["accessoryExamples"] = [];
  const seenExamples = new Set<string>();
  for (const example of value.accessoryExamples) {
    if (
      !isSafeAttentionCopy(example, 32) ||
      !isReviewedBalanceAccessory(example) ||
      seenExamples.has(example)
    ) {
      return null;
    }

    seenExamples.add(example);
    accessoryExamples.push(example);
  }

  return {
    accessoryExamples,
    description: value.description,
    preferredTierCode: "da_ji",
    title: "已经穿了注意色",
  };
}

function toAttentionSectionData(
  content: Record<string, unknown>,
  decisionContent: DecisionContent,
): AttentionSectionData | null {
  const jiaoChaGroup = toAttentionGroupData(decisionContent, "jiao_cha");
  const buLiGroup = toAttentionGroupData(decisionContent, "bu_li");
  const balanceSuggestion = toBalanceSuggestion(content.balanceSuggestion);
  if (jiaoChaGroup === null || buLiGroup === null || balanceSuggestion === null) {
    return null;
  }

  return {
    balanceSuggestion,
    contentVersion: decisionContent.contentVersion,
    groups: [jiaoChaGroup, buLiGroup],
  };
}

interface PositiveDecisionCards {
  ci_ji: CiJiCardData;
  da_ji: DaJiCardData;
  ping: PingCardData;
}

function toOutfitPreviewColors(
  value: unknown,
  tier: DecisionCardData,
): OutfitPreviewColorData[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const colors: OutfitPreviewColorData[] = [];
  const seenColorCodes = new Set<ReviewedColorCode>();
  for (const colorCode of value) {
    if (!isReviewedColorCode(colorCode) || seenColorCodes.has(colorCode)) {
      return null;
    }

    const publishedColor = tier.colors.find((color) => color.colorCode === colorCode);
    if (publishedColor === undefined) {
      return null;
    }

    seenColorCodes.add(colorCode);
    colors.push({
      colorCode,
      name: publishedColor.name,
    });
  }

  return colors;
}

function isRatioPercent(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100);
}

function isAllowedOutfitTierCode(
  kind: (typeof outfitKinds)[number],
  role: keyof typeof outfitRoleLabels,
  value: unknown,
): value is keyof PositiveDecisionCards {
  if (kind === "mono") {
    return role === "primary" && value === "da_ji";
  }

  if (kind === "dual") {
    return (
      (role === "primary" && value === "da_ji") ||
      (role === "secondary" && (value === "ci_ji" || value === "ping"))
    );
  }

  return (
    (role === "primary" && value === "da_ji") ||
    (role === "secondary" && value === "ci_ji") ||
    (role === "accent" && value === "ping")
  );
}

function toOutfitPreviewSlot(
  value: unknown,
  kind: (typeof outfitKinds)[number],
  role: keyof typeof outfitRoleLabels,
  tiers: PositiveDecisionCards,
): OutfitPreviewSlotData | null {
  if (!isRecord(value) || value.role !== role || value.roleLabel !== outfitRoleLabels[role]) {
    return null;
  }

  const tierCode = isAllowedOutfitTierCode(kind, role, value.tierCode) ? value.tierCode : null;
  if (tierCode === null || !isRatioPercent(value.ratioPercent)) {
    return null;
  }

  const colors = toOutfitPreviewColors(value.colorCodes, tiers[tierCode]);
  if (colors === null) {
    return null;
  }

  return {
    colors,
    ratioPercent: value.ratioPercent,
    role,
    roleLabel: outfitRoleLabels[role],
    tierCode,
  };
}

function toOutfitPreviewSlots(
  value: unknown,
  kind: (typeof outfitKinds)[number],
  tiers: PositiveDecisionCards,
): OutfitPreviewSlotData[] | null {
  const expectedRoles = outfitRolesByKind[kind];
  if (!Array.isArray(value) || value.length !== expectedRoles.length) {
    return null;
  }

  const slots: OutfitPreviewSlotData[] = [];
  for (const role of expectedRoles) {
    const matchingSlots = value.filter((slot) => isRecord(slot) && slot.role === role);
    if (matchingSlots.length !== 1) {
      return null;
    }

    const slot = toOutfitPreviewSlot(matchingSlots[0], kind, role, tiers);
    if (slot === null) {
      return null;
    }
    slots.push(slot);
  }

  const ratios = slots.map((slot) => slot.ratioPercent);
  if (kind === "mono") {
    return ratios[0] === null || ratios[0] === 100 ? slots : null;
  }

  if (kind === "dual" && ratios.every((ratio) => ratio === null)) {
    return slots;
  }

  if (ratios.some((ratio) => ratio === null)) {
    return null;
  }

  return ratios.reduce<number>((total, ratio) => total + Number(ratio), 0) === 100 ? slots : null;
}

function buildOutfitPreviewHref(
  fortuneDate: string,
  contentVersion: string,
  formulaId: string,
): string {
  const searchParams = new URLSearchParams({
    fortuneDate,
    expectedContentVersion: contentVersion,
    formulaId,
  });

  return `/outfits?${searchParams.toString()}`;
}

function toOutfitPreviewCard(
  value: unknown,
  kind: (typeof outfitKinds)[number],
  tiers: PositiveDecisionCards,
  fortuneDate: string,
  contentVersion: string,
): OutfitPreviewCardData | null {
  if (
    !isRecord(value) ||
    value.kind !== kind ||
    !isOpaqueId(value.formulaId) ||
    !isSafeOutfitCopy(value.title, 80)
  ) {
    return null;
  }

  const slots = toOutfitPreviewSlots(value.slots, kind, tiers);
  if (slots === null) {
    return null;
  }

  return {
    formulaId: value.formulaId,
    href: buildOutfitPreviewHref(fortuneDate, contentVersion, value.formulaId),
    kind,
    slots,
    title: value.title,
  };
}

function toOutfitPreviewSectionData(
  content: Record<string, unknown>,
  decisionContent: DecisionContent,
  tiers: PositiveDecisionCards,
  fortuneDate: string,
): OutfitPreviewSectionData | null {
  if (!Array.isArray(content.outfitFormulas) || content.outfitFormulas.length < 3) {
    return null;
  }

  const seenFormulaIds = new Set<string>();
  for (const formula of content.outfitFormulas) {
    if (
      !isRecord(formula) ||
      !isOpaqueId(formula.formulaId) ||
      seenFormulaIds.has(formula.formulaId)
    ) {
      return null;
    }
    seenFormulaIds.add(formula.formulaId);
  }

  const cards: OutfitPreviewCardData[] = [];
  for (const kind of outfitKinds) {
    const formula = content.outfitFormulas.find(
      (candidate) => isRecord(candidate) && candidate.kind === kind,
    );
    const card = toOutfitPreviewCard(
      formula,
      kind,
      tiers,
      fortuneDate,
      decisionContent.contentVersion,
    );
    if (card === null) {
      return null;
    }
    cards.push(card);
  }

  return {
    cards: cards as OutfitPreviewSectionData["cards"],
    contentVersion: decisionContent.contentVersion,
  };
}

function findDecisionTier(
  decisionContent: DecisionContent,
  tierCode: keyof typeof decisionTierSpecs,
): Record<string, unknown> | undefined {
  return decisionContent.tiers.find((tier) => tier.tierCode === tierCode);
}

function toDecisionCardData(
  decisionContent: DecisionContent,
  tierCode: "da_ji",
): DaJiCardData | null;
function toDecisionCardData(
  decisionContent: DecisionContent,
  tierCode: "ci_ji",
): CiJiCardData | null;
function toDecisionCardData(
  decisionContent: DecisionContent,
  tierCode: "ping",
): PingCardData | null;
function toDecisionCardData(
  decisionContent: DecisionContent,
  tierCode: keyof typeof decisionTierSpecs,
): DecisionCardData | null {
  const tier = findDecisionTier(decisionContent, tierCode);
  const core = toDecisionCardCore(tier, decisionContent.contentVersion, tierCode);
  if (core === null || tier === undefined) {
    return null;
  }

  if (tierCode === "da_ji") {
    return {
      ...core,
      algorithmLabel: tier.algorithmLabel as DaJiCardData["algorithmLabel"],
      displayLabel: tier.displayLabel as DaJiCardData["displayLabel"],
      rank: tier.rank as DaJiCardData["rank"],
      tierCode: tier.tierCode as DaJiCardData["tierCode"],
    };
  }

  if (tierCode === "ci_ji") {
    return {
      ...core,
      algorithmLabel: tier.algorithmLabel as CiJiCardData["algorithmLabel"],
      displayLabel: tier.displayLabel as CiJiCardData["displayLabel"],
      rank: tier.rank as CiJiCardData["rank"],
      tierCode: tier.tierCode as CiJiCardData["tierCode"],
    };
  }

  return {
    ...core,
    algorithmLabel: tier.algorithmLabel as PingCardData["algorithmLabel"],
    displayLabel: tier.displayLabel as PingCardData["displayLabel"],
    rank: tier.rank as PingCardData["rank"],
    tierCode: tier.tierCode as PingCardData["tierCode"],
  };
}

function toTodayDateData(value: unknown): TodayDateData | null {
  if (!isRecord(value) || !isRecord(value.requestContext) || !isRecord(value.content)) {
    return null;
  }

  const { content, requestContext } = value;
  if (!isRecord(content.calendar)) {
    return null;
  }

  const { calendar } = content;
  const civilDate = requestContext.civilDate;
  const crossedDayBoundary = requestContext.crossedDayBoundary;
  const fortuneDate = requestContext.fortuneDate;
  const contentFortuneDate = content.fortuneDate;
  const shichen = requestContext.shichen;
  const dayElement = calendar.dayElement;
  const dayElementLabel = calendar.dayElementLabel;
  const ganzhiDay = calendar.ganzhiDay;
  const lunarDateText = calendar.lunarDateText;
  const weekdayText = calendar.weekdayText;

  if (
    !isFortuneDate(civilDate) ||
    !isFortuneDate(fortuneDate) ||
    !isFortuneDate(contentFortuneDate) ||
    fortuneDate !== contentFortuneDate ||
    typeof crossedDayBoundary !== "boolean" ||
    !isMember(shichenNames, shichen) ||
    !isMember(dayElements, dayElement) ||
    dayElementLabel !== dayElementLabels[dayElement] ||
    !isNonEmptyString(ganzhiDay) ||
    !isNonEmptyString(lunarDateText) ||
    !isNonEmptyString(weekdayText)
  ) {
    return null;
  }

  return {
    content: {
      calendar: {
        dayElement,
        dayElementLabel: dayElementLabels[dayElement],
        ganzhiDay,
        lunarDateText,
        weekdayText,
      },
      fortuneDate: contentFortuneDate,
    },
    requestContext: {
      civilDate,
      crossedDayBoundary,
      fortuneDate,
      shichen,
    },
  };
}

function getApiOrigin(): string {
  return (
    process.env.FIVE_API_ORIGIN ?? `http://127.0.0.1:${process.env.HTTP_PORT ?? DEFAULT_HTTP_PORT}`
  );
}

function resolveRequestId(requestId: string | null | undefined): string {
  const candidate = requestId?.trim();
  if (
    candidate !== undefined &&
    candidate.length >= 8 &&
    candidate.length <= 128 &&
    !/[\r\n]/u.test(candidate)
  ) {
    return candidate;
  }

  return randomUUID();
}

export async function loadToday({
  apiOrigin = getApiOrigin(),
  requestId,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: LoadTodayOptions = {}): Promise<TodayPageData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL("/api/v1/today", apiOrigin).toString();
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": resolveRequestId(requestId),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    const dateData = toTodayDateData(body);
    if (dateData === null || !isRecord(body) || !isRecord(body.content)) {
      return null;
    }

    const decisionContent = toDecisionContent(
      body.content,
      response.headers.get("x-content-version"),
    );
    const daJiCard = decisionContent === null ? null : toDecisionCardData(decisionContent, "da_ji");
    const ciJiCard =
      decisionContent === null || daJiCard === null
        ? null
        : toDecisionCardData(decisionContent, "ci_ji");
    const pingCard =
      decisionContent === null || daJiCard === null || ciJiCard === null
        ? null
        : toDecisionCardData(decisionContent, "ping");

    return {
      ...dateData,
      attentionSection:
        decisionContent === null || daJiCard === null || ciJiCard === null || pingCard === null
          ? null
          : toAttentionSectionData(body.content, decisionContent),
      ciJiCard,
      daJiCard,
      outfitPreviewSection:
        decisionContent === null || daJiCard === null || ciJiCard === null || pingCard === null
          ? null
          : toOutfitPreviewSectionData(
              body.content,
              decisionContent,
              {
                ci_ji: ciJiCard,
                da_ji: daJiCard,
                ping: pingCard,
              },
              dateData.content.fortuneDate,
            ),
      pingCard,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
