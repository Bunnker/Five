import { randomUUID } from "node:crypto";

import type { FiveApiPaths } from "./api-contract";

type TodayResponse =
  FiveApiPaths["/api/v1/today"]["get"]["responses"][200]["content"]["application/json"];
type TodayRequestContext = TodayResponse["requestContext"];
type TodayCalendar = TodayResponse["content"]["calendar"];

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
}: LoadTodayOptions = {}): Promise<TodayDateData | null> {
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
    return toTodayDateData(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
