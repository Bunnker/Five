import { randomUUID } from "node:crypto";

import type { FiveApiPaths } from "./api-contract";
import { isReviewedColorCode, reviewedColorPalette, type ReviewedColorCode } from "./color-palette";

type TodayResponse =
  FiveApiPaths["/api/v1/today"]["get"]["responses"][200]["content"]["application/json"];
type TodayRequestContext = TodayResponse["requestContext"];
type TodayCalendar = TodayResponse["content"]["calendar"];
type TodayTier = TodayResponse["content"]["tiers"][number];

export interface DaJiCardData {
  algorithmLabel: "大吉";
  colors: Array<{
    colorCode: ReviewedColorCode;
    name: string;
  }>;
  contentVersion: TodayResponse["content"]["versions"]["contentVersion"];
  displayLabel: "今日优先";
  element: TodayTier["element"];
  elementLabel: TodayTier["elementLabel"];
  explanation: TodayTier["explanation"];
  rank: 1;
  relationText: TodayTier["relationText"];
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
  daJiCard: DaJiCardData | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function toDaJiCardData(
  content: Record<string, unknown>,
  responseContentVersion: string | null,
): DaJiCardData | null {
  if (!hasCompleteTierIndex(content.tiers)) {
    return null;
  }

  const contentVersion = getContentVersion(content.versions, responseContentVersion);
  const daJiTiers = content.tiers.filter((tier) => tier.tierCode === "da_ji");
  if (contentVersion === null || daJiTiers.length !== 1) {
    return null;
  }

  const [tier] = daJiTiers;
  if (
    tier === undefined ||
    tier.rank !== 1 ||
    tier.algorithmLabel !== "大吉" ||
    tier.displayLabel !== "今日优先" ||
    tier.displaySection !== "primary" ||
    !isMember(dayElements, tier.element) ||
    !isMember(dayElementLabelNames, tier.elementLabel) ||
    tier.elementLabel !== dayElementLabels[tier.element] ||
    !isNonEmptyString(tier.relationText) ||
    !isNonEmptyString(tier.explanation) ||
    forbiddenPublicCopyPattern.test(tier.relationText) ||
    forbiddenPublicCopyPattern.test(tier.explanation) ||
    !Array.isArray(tier.colors) ||
    tier.colors.length < 1 ||
    tier.colors.length > 12
  ) {
    return null;
  }

  const colors: DaJiCardData["colors"] = [];
  const seenColorCodes = new Set<ReviewedColorCode>();
  for (const color of tier.colors) {
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

  return {
    algorithmLabel: tier.algorithmLabel,
    colors,
    contentVersion,
    displayLabel: tier.displayLabel,
    element: tier.element,
    elementLabel: tier.elementLabel,
    explanation: tier.explanation,
    rank: tier.rank,
    relationText: tier.relationText,
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

    return {
      ...dateData,
      daJiCard: toDaJiCardData(body.content, response.headers.get("x-content-version")),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
