import type { FiveApiPaths } from "./api-contract";
import { isReviewedColorCode, reviewedColorPalette, type ReviewedColorCode } from "./color-palette";
import {
  DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
  getPublicApiOrigin,
  resolvePublicRequestId,
} from "./public-api-client";
import {
  hasAsciiControlCharacter,
  hasForbiddenPublicCopy,
  isSafeAttentionCopy,
  isSafeImageCopy,
  isSafeOutfitCopy,
} from "./public-content-safety";
import {
  isMember,
  isOpaquePublicValue as isOpaqueId,
  isRecord,
  parsePublicImage,
  publicGarmentCategories as garmentCategories,
  publicImageResourceIdentity as imageResourceIdentity,
} from "./public-response-validation";

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
  displayLabel: "注意";
  element: TodayTier["element"];
  elementLabel: TodayTier["elementLabel"];
  explanation: TodayTier["explanation"];
  relationText: TodayTier["relationText"];
}

export interface JiaoChaAttentionGroupData extends AttentionGroupBaseData {
  algorithmLabel: "较差";
  rank: 4;
  tierCode: "jiao_cha";
}

export interface BuLiAttentionGroupData extends AttentionGroupBaseData {
  algorithmLabel: "不利";
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
  garmentParts: string[];
  ratioPercent: number | null;
  role: "accent" | "primary" | "secondary";
  roleLabel: "主色" | "辅助色" | "点缀色";
  tierCode: "ci_ji" | "da_ji" | "ping";
}

export interface OutfitPreviewCardData {
  description: string;
  formulaId: string;
  href: string;
  kind: "dual" | "mono" | "triple";
  scenarioLabel: string;
  slots: OutfitPreviewSlotData[];
  title: string;
}

export interface OutfitPreviewSectionData {
  cards: [
    OutfitPreviewCardData,
    OutfitPreviewCardData,
    OutfitPreviewCardData,
    ...OutfitPreviewCardData[],
  ];
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
}

export interface TodayImagePreviewItemData {
  categoryLabel: string;
  color: OutfitPreviewColorData;
}

export interface TodayImagePreviewCardData {
  aiDisclosure: string | null;
  altText: string;
  assetId: string;
  displayLabel: "主方案" | "替代方案" | "更多场景";
  formulaId: string;
  height: number;
  items: TodayImagePreviewItemData[];
  lookId: string;
  mediaType: "image/avif" | "image/jpeg" | "image/png" | "image/webp";
  placement: "alternate" | "primary" | "supplemental";
  scenarioLabel: string;
  sortOrder: 1 | 2 | 3;
  title: string;
  url: string;
  width: number;
}

export interface TodayImagePreviewSectionData {
  cards: TodayImagePreviewCardData[];
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
}

export function resolveOutfitPreviewImages(
  outfitSection: OutfitPreviewSectionData,
  imageSection: TodayImagePreviewSectionData | null,
): ReadonlyMap<string, TodayImagePreviewCardData> {
  const imagesByFormula = new Map<string, TodayImagePreviewCardData>();
  if (imageSection === null || imageSection.contentVersion !== outfitSection.contentVersion) {
    return imagesByFormula;
  }

  const formulaIds = new Set(outfitSection.cards.map((card) => card.formulaId));
  const imagesByPriority = [...imageSection.cards].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  for (const image of imagesByPriority) {
    if (formulaIds.has(image.formulaId) && !imagesByFormula.has(image.formulaId)) {
      imagesByFormula.set(image.formulaId, image);
    }
  }

  return imagesByFormula;
}

export interface TodayBasisData {
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
  disclaimer: string;
  steps: string[];
}

export interface TodayShareData {
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
  copyText: string;
  posterJobEndpoint: TodayResponse["content"]["share"]["posterJobEndpoint"];
  posterTemplateVersion: TodayResponse["content"]["share"]["posterTemplateVersion"];
  summaryText: string;
}

export interface TodayNextStepsData {
  basisHref: string;
  colorsHref: string;
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
  outfitsHref: string;
  shareHref: string;
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

export interface DailyDateData {
  content: {
    calendar: Pick<
      TodayCalendar,
      "branch" | "dayElement" | "dayElementLabel" | "ganzhiDay" | "lunarDateText" | "weekdayText"
    >;
    fortuneDate: TodayResponse["content"]["fortuneDate"];
  };
}

export interface TodayDateData extends DailyDateData {
  requestContext: Pick<
    TodayRequestContext,
    "civilDate" | "crossedDayBoundary" | "fortuneDate" | "shichen"
  >;
}

export interface PublicDailyContentData extends DailyDateData {
  attentionSection: AttentionSectionData | null;
  basis?: TodayBasisData | null;
  ciJiCard: CiJiCardData | null;
  daJiCard: DaJiCardData | null;
  imagePreviewSection: TodayImagePreviewSectionData | null;
  nextSteps?: TodayNextStepsData | null;
  outfitPreviewSection: OutfitPreviewSectionData | null;
  pingCard: PingCardData | null;
  share?: TodayShareData | null;
}

export interface TodayPageData extends TodayDateData, PublicDailyContentData {
  nextSteps?: TodayNextStepsData | null;
}

export interface CompleteTodayPageData extends TodayPageData {
  attentionSection: AttentionSectionData;
  basis: TodayBasisData;
  ciJiCard: CiJiCardData;
  daJiCard: DaJiCardData;
  imagePreviewSection: TodayImagePreviewSectionData;
  nextSteps: TodayNextStepsData;
  outfitPreviewSection: OutfitPreviewSectionData;
  pingCard: PingCardData;
  share: TodayShareData;
}

export interface TodaySnapshot {
  contentVersion: string;
  data: CompleteTodayPageData;
  effectiveFrom: string;
  effectiveTo: string;
  fortuneDate: string;
  responseGeneratedAt: string;
  serverObservedAtMs: number | null;
}

export type LoadTodayResult =
  | { kind: "content_not_ready"; retryAfterSeconds: number | null }
  | {
      kind: "refresh_failed";
      reason: "http" | "invalid_response" | "network" | "rate_limited" | "timeout";
    }
  | { kind: "ready"; snapshot: TodaySnapshot };

export interface LoadTodayOptions {
  apiOrigin?: string;
  requestId?: string | null;
  timeoutMs?: number;
}

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
const reviewedReferenceDisclaimer = "内容基于传统文化规则整理，仅供穿搭参考。";
const homepageShareChannelId = "organic";
const publicPosterJobEndpoint = "/api/v1/poster-jobs";
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
const earthlyBranchNames = [
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
const forbiddenPingCopyPattern =
  /好运|贵人|助运|加分|事半功倍|运程|吉凶|运势平平|勉强|较差|不利|不推荐|倒霉|晦气/u;
const forbiddenBasisCopyPattern =
  /黄历|今日(?:的)?运程|运程|好运|贵人|助运|加分|事半功倍|吉凶|化解|不推荐|倒霉|晦气|厄运|凶险|灾祸|危险|警告|百分百|绝对|肯定|必定|必会|必能|一定会|确保|见效|有效|灵验|应验|受伤|伤害|出事|生病|失败|损失|坏事|祸事|不顺|出问题|收藏|购买|商品|吉祥物|登录|账户|账号|出生|八字|个人运势|拍照试搭/u;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReviewedBalanceAccessory(value: string): value is TodayBalanceAccessory {
  return reviewedBalanceAccessories.has(value as TodayBalanceAccessory);
}

export function isPublicFortuneDate(value: unknown): value is string {
  if (typeof value !== "string" || !fortuneDatePattern.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
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
    hasForbiddenPublicCopy(tier.relationText) ||
    hasForbiddenPublicCopy(tier.explanation) ||
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

function isSafeBasisCopy(value: unknown, maxLength: number): value is string {
  return (
    isNonEmptyString(value) &&
    value.length <= maxLength &&
    value.trim() === value &&
    !hasAsciiControlCharacter(value) &&
    !hasForbiddenPublicCopy(value) &&
    !forbiddenBasisCopyPattern.test(value)
  );
}

function toTodayBasisData(value: unknown, contentVersion: string): TodayBasisData | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > 12 ||
    value.disclaimer !== reviewedReferenceDisclaimer
  ) {
    return null;
  }

  const steps: string[] = [];
  for (const step of value.steps) {
    if (!isSafeBasisCopy(step, 300) || steps.includes(step)) {
      return null;
    }
    steps.push(step);
  }

  return {
    contentVersion,
    disclaimer: reviewedReferenceDisclaimer,
    steps,
  };
}

function toTodayShareData(
  value: unknown,
  versions: unknown,
  contentVersion: string,
): TodayShareData | null {
  if (
    !isRecord(value) ||
    !isRecord(versions) ||
    !isSafeImageCopy(value.summaryText, 200) ||
    !isSafeImageCopy(value.copyText, 500) ||
    forbiddenBasisCopyPattern.test(value.summaryText) ||
    forbiddenBasisCopyPattern.test(value.copyText) ||
    !isOpaqueId(value.posterTemplateVersion) ||
    value.posterTemplateVersion !== versions.posterTemplateVersion ||
    value.posterJobEndpoint !== publicPosterJobEndpoint
  ) {
    return null;
  }

  return {
    contentVersion,
    copyText: value.copyText,
    posterJobEndpoint: value.posterJobEndpoint,
    posterTemplateVersion: value.posterTemplateVersion,
    summaryText: value.summaryText,
  };
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
    algorithmLabel: tier.algorithmLabel,
    colors,
    displayLabel: tier.displayLabel,
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

function toGarmentParts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const garmentParts: string[] = [];
  for (const garmentPart of value) {
    if (!isSafeImageCopy(garmentPart, 32)) {
      return null;
    }
    garmentParts.push(garmentPart);
  }
  return garmentParts;
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
  const garmentParts = toGarmentParts(value.garmentParts);
  if (colors === null || garmentParts === null) {
    return null;
  }

  return {
    colors,
    garmentParts,
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

function buildTodayEntryHref(
  pathname: "/basis" | "/colors" | "/share",
  fortuneDate: string,
  contentVersion: string,
  additionalParams: Record<string, string> = {},
): string {
  const searchParams = new URLSearchParams({
    fortuneDate,
    expectedContentVersion: contentVersion,
    ...additionalParams,
  });

  return `${pathname}?${searchParams.toString()}`;
}

function toTodayNextStepsData(
  basis: TodayBasisData,
  share: TodayShareData,
  outfitPreviewSection: OutfitPreviewSectionData,
  fortuneDate: string,
  contentVersion: string,
): TodayNextStepsData | null {
  if (
    basis.contentVersion !== contentVersion ||
    share.contentVersion !== contentVersion ||
    outfitPreviewSection.contentVersion !== contentVersion
  ) {
    return null;
  }

  const defaultOutfit = outfitPreviewSection.cards.find((card) => card.kind === "mono");
  if (defaultOutfit === undefined) {
    return null;
  }

  return {
    basisHref: buildTodayEntryHref("/basis", fortuneDate, contentVersion),
    colorsHref: buildTodayEntryHref("/colors", fortuneDate, contentVersion),
    contentVersion,
    outfitsHref: defaultOutfit.href,
    shareHref: buildTodayEntryHref("/share", fortuneDate, contentVersion, {
      channelId: homepageShareChannelId,
    }),
  };
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
    !isSafeOutfitCopy(value.title, 80) ||
    !isSafeOutfitCopy(value.disclaimer, 300) ||
    !isRecord(value.scenario) ||
    !isSafeOutfitCopy(value.scenario.label, 32)
  ) {
    return null;
  }

  const slots = toOutfitPreviewSlots(value.slots, kind, tiers);
  if (slots === null) {
    return null;
  }

  return {
    description: value.disclaimer,
    formulaId: value.formulaId,
    href: buildOutfitPreviewHref(fortuneDate, contentVersion, value.formulaId),
    kind,
    scenarioLabel: value.scenario.label,
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
    const formulas = content.outfitFormulas.filter(
      (candidate) => isRecord(candidate) && candidate.kind === kind,
    );
    if (formulas.length === 0) {
      return null;
    }

    for (const formula of formulas) {
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
  }

  return {
    cards: cards as OutfitPreviewSectionData["cards"],
    contentVersion: decisionContent.contentVersion,
  };
}

interface ImageFormulaData {
  audienceCode: string;
  audienceLabel: string;
  formulaId: string;
  lookIds: string[];
  scenarioCode: string;
  scenarioLabel: string;
  slots: OutfitPreviewSlotData[];
}

interface ImageAssetData {
  aiDisclosure: string | null;
  altText: string;
  assetId: string;
  height: number;
  mediaType: TodayImagePreviewCardData["mediaType"];
  url: string;
  width: number;
}

interface ImageItemData {
  items: TodayImagePreviewItemData[];
  tierCodes: Set<OutfitPreviewSlotData["tierCode"]>;
}

function toImageAudience(value: unknown): { code: string; label: string } | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.code) ||
    value.code.length > 64 ||
    !isSafeImageCopy(value.label, 32)
  ) {
    return null;
  }

  return { code: value.code, label: value.label };
}

function toImageAsset(value: unknown): ImageAssetData | null {
  const image = parsePublicImage(value);
  if (image === null) {
    return null;
  }

  return {
    aiDisclosure: image.aiDisclosure,
    altText: image.altText,
    assetId: image.assetId,
    height: image.height,
    mediaType: image.mediaType,
    url: image.url,
    width: image.width,
  };
}

function toImageFormulaMap(
  value: unknown,
  tiers: PositiveDecisionCards,
): Map<string, ImageFormulaData> | null {
  if (!Array.isArray(value) || value.length < 3) {
    return null;
  }

  const formulas = new Map<string, ImageFormulaData>();
  const formulaOwnerByLookId = new Map<string, string>();
  for (const formula of value) {
    if (
      !isRecord(formula) ||
      !isOpaqueId(formula.formulaId) ||
      !isMember(outfitKinds, formula.kind) ||
      !Array.isArray(formula.lookIds) ||
      formula.lookIds.length > 3 ||
      !isRecord(formula.scenario) ||
      !isNonEmptyString(formula.scenario.code) ||
      formula.scenario.code.length > 64 ||
      !isSafeImageCopy(formula.scenario.label, 32) ||
      formulas.has(formula.formulaId)
    ) {
      return null;
    }

    const audience = toImageAudience(formula.audience);
    if (audience === null) {
      return null;
    }

    const lookIds: string[] = [];
    for (const lookId of formula.lookIds) {
      if (!isOpaqueId(lookId) || lookIds.includes(lookId) || formulaOwnerByLookId.has(lookId)) {
        return null;
      }
      lookIds.push(lookId);
      formulaOwnerByLookId.set(lookId, formula.formulaId);
    }

    const slots = toOutfitPreviewSlots(formula.slots, formula.kind, tiers);
    if (slots === null) {
      return null;
    }

    formulas.set(formula.formulaId, {
      audienceCode: audience.code,
      audienceLabel: audience.label,
      formulaId: formula.formulaId,
      lookIds,
      scenarioCode: formula.scenario.code,
      scenarioLabel: formula.scenario.label,
      slots,
    });
  }

  return formulas;
}

function toImageItems(value: unknown, formula: ImageFormulaData): ImageItemData | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const formulaColors = new Map<
    ReviewedColorCode,
    {
      color: OutfitPreviewColorData;
      tierCode: OutfitPreviewSlotData["tierCode"];
    }
  >();
  for (const slot of formula.slots) {
    for (const color of slot.colors) {
      if (formulaColors.has(color.colorCode)) {
        return null;
      }
      formulaColors.set(color.colorCode, { color, tierCode: slot.tierCode });
    }
  }

  const items: TodayImagePreviewItemData[] = [];
  const tierCodes = new Set<OutfitPreviewSlotData["tierCode"]>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isMember(garmentCategories, item.category) ||
      !isSafeImageCopy(item.categoryLabel, 32) ||
      !isSafeImageCopy(item.description, 120) ||
      !isReviewedColorCode(item.colorCode)
    ) {
      return null;
    }

    const formulaColor = formulaColors.get(item.colorCode);
    if (formulaColor === undefined) {
      return null;
    }

    items.push({
      categoryLabel: item.categoryLabel,
      color: formulaColor.color,
    });
    tierCodes.add(formulaColor.tierCode);
  }

  return { items, tierCodes };
}

function toTodayImagePreviewCard(
  value: unknown,
  placement: TodayImagePreviewCardData["placement"],
  formulas: Map<string, ImageFormulaData>,
  primaryScenarioCode: string | null,
): TodayImagePreviewCardData | null {
  const presentation = {
    alternate: { displayLabel: "替代方案", sortOrder: 2 },
    primary: { displayLabel: "主方案", sortOrder: 1 },
    supplemental: { displayLabel: "更多场景", sortOrder: 3 },
  } as const;
  const expected = presentation[placement];

  if (
    !isRecord(value) ||
    !isOpaqueId(value.lookId) ||
    !isOpaqueId(value.formulaId) ||
    value.sortOrder !== expected.sortOrder ||
    value.requiredForPublish !== (placement !== "supplemental") ||
    !isSafeImageCopy(value.title, 80) ||
    !isRecord(value.scenario) ||
    !isNonEmptyString(value.scenario.code) ||
    value.scenario.code.length > 64 ||
    !isSafeImageCopy(value.scenario.label, 32)
  ) {
    return null;
  }

  const formula = formulas.get(value.formulaId);
  const audience = toImageAudience(value.audience);
  if (
    formula === undefined ||
    audience === null ||
    formula.audienceCode !== audience.code ||
    formula.audienceLabel !== audience.label ||
    !formula.lookIds.includes(value.lookId) ||
    formula.scenarioCode !== value.scenario.code ||
    formula.scenarioLabel !== value.scenario.label
  ) {
    return null;
  }

  const asset = toImageAsset(value.coverImage);
  const imageItems = toImageItems(value.items, formula);
  if (
    asset === null ||
    imageItems === null ||
    !imageItems.tierCodes.has("da_ji") ||
    formula.slots.some((slot) => !imageItems.tierCodes.has(slot.tierCode))
  ) {
    return null;
  }

  if (placement === "alternate" && !imageItems.tierCodes.has("ci_ji")) {
    return null;
  }
  if (
    placement === "supplemental" &&
    !imageItems.tierCodes.has("ping") &&
    value.scenario.code === primaryScenarioCode
  ) {
    return null;
  }

  return {
    ...asset,
    displayLabel: expected.displayLabel,
    formulaId: formula.formulaId,
    items: imageItems.items,
    lookId: value.lookId,
    placement,
    scenarioLabel: value.scenario.label,
    sortOrder: expected.sortOrder,
    title: value.title,
  };
}

function toTodayImagePreviewSectionData(
  content: Record<string, unknown>,
  decisionContent: DecisionContent,
  tiers: PositiveDecisionCards,
): TodayImagePreviewSectionData | null {
  if (!Array.isArray(content.looks) || content.looks.length < 2 || content.looks.length > 3) {
    return null;
  }

  const requiredCount = content.looks.filter(
    (look) => isRecord(look) && look.requiredForPublish === true,
  ).length;
  if (requiredCount !== 2) {
    return null;
  }

  const formulas = toImageFormulaMap(content.outfitFormulas, tiers);
  if (formulas === null) {
    return null;
  }

  const publishedLookIds = new Set(
    content.looks
      .filter((look) => isRecord(look) && isOpaqueId(look.lookId))
      .map((look) => (isRecord(look) ? String(look.lookId) : "")),
  );
  if (
    [...formulas.values()].some((formula) =>
      formula.lookIds.some((lookId) => !publishedLookIds.has(lookId)),
    )
  ) {
    return null;
  }

  const primaryCandidates = content.looks.filter(
    (look) => isRecord(look) && look.requiredForPublish === true && look.sortOrder === 1,
  );
  const alternateCandidates = content.looks.filter(
    (look) => isRecord(look) && look.requiredForPublish === true && look.sortOrder === 2,
  );
  if (primaryCandidates.length !== 1 || alternateCandidates.length !== 1) {
    return null;
  }

  const primary = toTodayImagePreviewCard(primaryCandidates[0], "primary", formulas, null);
  const alternate = toTodayImagePreviewCard(alternateCandidates[0], "alternate", formulas, null);
  if (
    primary === null ||
    alternate === null ||
    primary.lookId === alternate.lookId ||
    primary.assetId === alternate.assetId ||
    imageResourceIdentity(primary.url) === imageResourceIdentity(alternate.url)
  ) {
    return null;
  }

  const cards = [primary, alternate];
  if (content.looks.length === 3) {
    const supplementalCandidates = content.looks.filter(
      (look) => isRecord(look) && look.requiredForPublish === false && look.sortOrder === 3,
    );
    if (supplementalCandidates.length === 1) {
      const supplemental = toTodayImagePreviewCard(
        supplementalCandidates[0],
        "supplemental",
        formulas,
        primaryCandidates[0] && isRecord(primaryCandidates[0].scenario)
          ? String(primaryCandidates[0].scenario.code)
          : null,
      );
      if (
        supplemental !== null &&
        !cards.some(
          (card) =>
            card.lookId === supplemental.lookId ||
            card.assetId === supplemental.assetId ||
            imageResourceIdentity(card.url) === imageResourceIdentity(supplemental.url),
        )
      ) {
        cards.push(supplemental);
      }
    }
  }

  return {
    cards,
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

function toDailyDateData(value: unknown): DailyDateData | null {
  if (!isRecord(value) || !isRecord(value.calendar)) {
    return null;
  }

  const { calendar } = value;
  const branch = calendar.branch;
  const fortuneDate = value.fortuneDate;
  const dayElement = calendar.dayElement;
  const dayElementLabel = calendar.dayElementLabel;
  const ganzhiDay = calendar.ganzhiDay;
  const lunarDateText = calendar.lunarDateText;
  const weekdayText = calendar.weekdayText;

  if (
    !isPublicFortuneDate(fortuneDate) ||
    !isMember(earthlyBranchNames, branch) ||
    !isMember(dayElements, dayElement) ||
    dayElementLabel !== dayElementLabels[dayElement] ||
    !isNonEmptyString(ganzhiDay) ||
    !ganzhiDay.endsWith(branch) ||
    !isNonEmptyString(lunarDateText) ||
    !isNonEmptyString(weekdayText)
  ) {
    return null;
  }

  return {
    content: {
      calendar: {
        branch,
        dayElement,
        dayElementLabel: dayElementLabels[dayElement],
        ganzhiDay,
        lunarDateText,
        weekdayText,
      },
      fortuneDate,
    },
  };
}

function toTodayDateData(value: unknown): TodayDateData | null {
  if (!isRecord(value) || !isRecord(value.requestContext)) {
    return null;
  }

  const dateData = toDailyDateData(value.content);
  if (dateData === null) {
    return null;
  }

  const { requestContext } = value;
  const civilDate = requestContext.civilDate;
  const crossedDayBoundary = requestContext.crossedDayBoundary;
  const fortuneDate = requestContext.fortuneDate;
  const shichen = requestContext.shichen;

  if (
    !isPublicFortuneDate(civilDate) ||
    !isPublicFortuneDate(fortuneDate) ||
    fortuneDate !== dateData.content.fortuneDate ||
    typeof crossedDayBoundary !== "boolean" ||
    !isMember(earthlyBranchNames, shichen)
  ) {
    return null;
  }

  return {
    ...dateData,
    requestContext: {
      civilDate,
      crossedDayBoundary,
      fortuneDate,
      shichen,
    },
  };
}

export function parsePublicDailyContent(
  value: unknown,
  responseContentVersion: string | null,
): PublicDailyContentData | null {
  if (!isRecord(value)) {
    return null;
  }

  const dateData = toDailyDateData(value);
  if (dateData === null) {
    return null;
  }

  const decisionContent = toDecisionContent(value, responseContentVersion);
  const daJiCard = decisionContent === null ? null : toDecisionCardData(decisionContent, "da_ji");
  const ciJiCard =
    decisionContent === null || daJiCard === null
      ? null
      : toDecisionCardData(decisionContent, "ci_ji");
  const pingCard =
    decisionContent === null || daJiCard === null || ciJiCard === null
      ? null
      : toDecisionCardData(decisionContent, "ping");
  const positiveTiers =
    daJiCard === null || ciJiCard === null || pingCard === null
      ? null
      : {
          ci_ji: ciJiCard,
          da_ji: daJiCard,
          ping: pingCard,
        };
  const outfitPreviewSection =
    decisionContent === null || positiveTiers === null
      ? null
      : toOutfitPreviewSectionData(
          value,
          decisionContent,
          positiveTiers,
          dateData.content.fortuneDate,
        );
  const attentionSection =
    decisionContent === null || positiveTiers === null
      ? null
      : toAttentionSectionData(value, decisionContent);
  const imagePreviewSection =
    decisionContent === null || positiveTiers === null || outfitPreviewSection === null
      ? null
      : toTodayImagePreviewSectionData(value, decisionContent, positiveTiers);
  const basis =
    decisionContent === null ? null : toTodayBasisData(value.basis, decisionContent.contentVersion);
  if (decisionContent !== null && basis === null) {
    return null;
  }

  const completeContentVersion =
    decisionContent !== null &&
    positiveTiers !== null &&
    attentionSection !== null &&
    outfitPreviewSection !== null &&
    imagePreviewSection !== null
      ? decisionContent.contentVersion
      : null;
  const share =
    completeContentVersion === null
      ? null
      : toTodayShareData(value.share, value.versions, completeContentVersion);
  if (completeContentVersion !== null && share === null) {
    return null;
  }

  return {
    ...dateData,
    attentionSection,
    ...(basis === null ? {} : { basis }),
    ...(share === null ? {} : { share }),
    ciJiCard,
    daJiCard,
    imagePreviewSection,
    outfitPreviewSection,
    pingCard,
  };
}

function parseTodayPageData(
  body: unknown,
  responseContentVersion: string | null,
): TodayPageData | null {
  const dateData = toTodayDateData(body);
  if (dateData === null || !isRecord(body)) {
    return null;
  }

  const dailyContent = parsePublicDailyContent(body.content, responseContentVersion);
  if (dailyContent === null || dailyContent.content.fortuneDate !== dateData.content.fortuneDate) {
    return null;
  }

  const completeHomepageContentVersion =
    dailyContent.daJiCard !== null &&
    dailyContent.ciJiCard !== null &&
    dailyContent.pingCard !== null &&
    dailyContent.attentionSection !== null &&
    dailyContent.outfitPreviewSection !== null &&
    dailyContent.imagePreviewSection !== null
      ? dailyContent.daJiCard.contentVersion
      : null;
  const nextSteps =
    completeHomepageContentVersion === null ||
    dailyContent.basis === null ||
    dailyContent.basis === undefined ||
    dailyContent.share === null ||
    dailyContent.share === undefined ||
    dailyContent.outfitPreviewSection === null
      ? null
      : toTodayNextStepsData(
          dailyContent.basis,
          dailyContent.share,
          dailyContent.outfitPreviewSection,
          dateData.content.fortuneDate,
          completeHomepageContentVersion,
        );
  if (completeHomepageContentVersion !== null && nextSteps === null) {
    return null;
  }

  return {
    ...dailyContent,
    ...dateData,
    ...(nextSteps === null ? {} : { nextSteps }),
  };
}

function toCompleteTodayPageData(data: TodayPageData): CompleteTodayPageData | null {
  const contentVersion = data.daJiCard?.contentVersion;
  if (
    contentVersion === undefined ||
    data.ciJiCard === null ||
    data.pingCard === null ||
    data.attentionSection === null ||
    data.outfitPreviewSection === null ||
    data.imagePreviewSection === null ||
    data.basis === null ||
    data.basis === undefined ||
    data.share === null ||
    data.share === undefined ||
    data.nextSteps === null ||
    data.nextSteps === undefined ||
    data.content.fortuneDate !== data.requestContext.fortuneDate ||
    data.imagePreviewSection.cards.length < 2 ||
    [
      data.ciJiCard.contentVersion,
      data.pingCard.contentVersion,
      data.attentionSection.contentVersion,
      data.outfitPreviewSection.contentVersion,
      data.imagePreviewSection.contentVersion,
      data.basis.contentVersion,
      data.share.contentVersion,
      data.nextSteps.contentVersion,
    ].some((candidate) => candidate !== contentVersion)
  ) {
    return null;
  }
  return data as CompleteTodayPageData;
}

function isZonedDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseServerObservedAt(headers: Headers): number | null {
  const dateHeader = headers.get("date");
  const dateMilliseconds = dateHeader === null ? Number.NaN : Date.parse(dateHeader);
  const ageHeader = headers.get("age");
  const ageSeconds = ageHeader === null ? 0 : Number(ageHeader);
  if (
    !Number.isFinite(dateMilliseconds) ||
    !Number.isInteger(ageSeconds) ||
    ageSeconds < 0 ||
    ageSeconds > 86_400
  ) {
    return null;
  }
  return dateMilliseconds + ageSeconds * 1_000;
}

function toTodaySnapshot(
  body: unknown,
  responseContentVersion: string | null,
  headers: Headers,
): TodaySnapshot | null {
  const data = parseTodayPageData(body, responseContentVersion);
  const completeData = data === null ? null : toCompleteTodayPageData(data);
  if (completeData === null || !isRecord(body) || !isRecord(body.content)) {
    return null;
  }
  const effectiveFrom = body.content.effectiveFrom;
  const effectiveTo = body.content.effectiveTo;
  const responseGeneratedAt = isRecord(body.requestContext)
    ? body.requestContext.responseGeneratedAt
    : null;
  const serverObservedAtMs = parseServerObservedAt(headers);
  if (
    !isZonedDateTime(effectiveFrom) ||
    !isZonedDateTime(effectiveTo) ||
    !isZonedDateTime(responseGeneratedAt) ||
    serverObservedAtMs === null
  ) {
    return null;
  }
  const effectiveFromMs = Date.parse(effectiveFrom);
  const effectiveToMs = Date.parse(effectiveTo);
  const responseGeneratedAtMs = Date.parse(responseGeneratedAt);
  if (
    effectiveFromMs >= effectiveToMs ||
    serverObservedAtMs < effectiveFromMs ||
    serverObservedAtMs >= effectiveToMs ||
    responseGeneratedAtMs < effectiveFromMs ||
    responseGeneratedAtMs >= effectiveToMs
  ) {
    return null;
  }

  return {
    contentVersion: completeData.daJiCard.contentVersion,
    data: completeData,
    effectiveFrom,
    effectiveTo,
    fortuneDate: completeData.content.fortuneDate,
    responseGeneratedAt,
    serverObservedAtMs,
  };
}

const invalidJson = Symbol("invalid-json");

type TodayHttpResult =
  | { kind: "network" | "timeout" }
  | { body: unknown | typeof invalidJson; kind: "response"; response: Response };

async function requestToday({
  apiOrigin = getPublicApiOrigin(),
  requestId,
  timeoutMs = DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
}: LoadTodayOptions): Promise<TodayHttpResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL("/api/v1/today", apiOrigin).toString();
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": resolvePublicRequestId(requestId),
      },
      signal: controller.signal,
    });

    let body: unknown | typeof invalidJson = invalidJson;
    try {
      body = (await response.json()) as unknown;
    } catch {
      // Keep the HTTP status available to the caller while marking the payload invalid.
    }
    return { body, kind: "response", response };
  } catch {
    return { kind: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryAfter(value: string | null): number | null {
  const seconds = value === null ? Number.NaN : Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86_400 ? seconds : null;
}

function isJsonResponse(headers: Headers): boolean {
  return headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isContentNotReadyEnvelope(value: unknown, responseRequestId: string | null): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.error)) {
    return false;
  }
  const error = value.error;
  return (
    Object.keys(error).length === 5 &&
    error.code === "CONTENT_NOT_READY" &&
    isNonEmptyString(error.message) &&
    error.message.length <= 500 &&
    error.retryable === true &&
    isNonEmptyString(error.requestId) &&
    error.requestId.length >= 8 &&
    error.requestId.length <= 128 &&
    !/[\r\n]/u.test(error.requestId) &&
    error.requestId === responseRequestId &&
    isRecord(error.details)
  );
}

export async function loadTodayResult(options: LoadTodayOptions = {}): Promise<LoadTodayResult> {
  const result = await requestToday(options);
  if (result.kind !== "response") {
    return { kind: "refresh_failed", reason: result.kind };
  }
  if (!result.response.ok) {
    if (result.response.status === 503) {
      return result.body !== invalidJson &&
        isJsonResponse(result.response.headers) &&
        isContentNotReadyEnvelope(result.body, result.response.headers.get("x-request-id"))
        ? {
            kind: "content_not_ready",
            retryAfterSeconds: parseRetryAfter(result.response.headers.get("retry-after")),
          }
        : { kind: "refresh_failed", reason: "invalid_response" };
    }
    return {
      kind: "refresh_failed",
      reason: result.response.status === 429 ? "rate_limited" : "http",
    };
  }
  if (result.body === invalidJson) {
    return { kind: "refresh_failed", reason: "invalid_response" };
  }
  if (!isJsonResponse(result.response.headers)) {
    return { kind: "refresh_failed", reason: "invalid_response" };
  }
  const snapshot = toTodaySnapshot(
    result.body,
    result.response.headers.get("x-content-version"),
    result.response.headers,
  );
  return snapshot === null
    ? { kind: "refresh_failed", reason: "invalid_response" }
    : { kind: "ready", snapshot };
}

export async function loadToday(options: LoadTodayOptions = {}): Promise<TodayPageData | null> {
  const result = await requestToday(options);
  if (result.kind !== "response" || !result.response.ok || result.body === invalidJson) {
    return null;
  }
  return parseTodayPageData(result.body, result.response.headers.get("x-content-version"));
}
