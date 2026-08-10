import type { TodayPageData } from "./today";
import { parsePublicChannelId } from "./channel-links";

export type TodayEntrySearchParamValue = string | string[] | undefined;
export type TodayEntrySearchParams = Record<string, TodayEntrySearchParamValue>;

export interface ResolveTodayEntryOptions {
  contentVersion: string | null | undefined;
  requireChannelId?: boolean;
}

export type TodayEntryResolution =
  | {
      channelId: string | null;
      contentVersion: string;
      fortuneDate: string;
      status: "ready";
      today: TodayPageData;
    }
  | {
      status: "invalid" | "stale" | "unavailable";
    };

const fortuneDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isBoundedValue(value: string, maxLength: number): boolean {
  return value.length >= 1 && value.length <= maxLength;
}

function isFortuneDate(value: string): boolean {
  const match = fortuneDatePattern.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function getSingleParam(
  value: TodayEntrySearchParamValue,
  isValid: (candidate: string) => boolean,
): string | null {
  return typeof value === "string" && isValid(value) ? value : null;
}

export function resolveTodayEntry(
  today: TodayPageData | null,
  params: TodayEntrySearchParams,
  { contentVersion, requireChannelId = false }: ResolveTodayEntryOptions,
): TodayEntryResolution {
  const fortuneDate = getSingleParam(params.fortuneDate, isFortuneDate);
  const expectedContentVersion = getSingleParam(params.expectedContentVersion, (value) =>
    isBoundedValue(value, 128),
  );
  const carriesChannelId = params.channelId !== undefined;
  const channelId = carriesChannelId ? parsePublicChannelId(params.channelId) : null;

  if (
    fortuneDate === null ||
    expectedContentVersion === null ||
    ((requireChannelId || carriesChannelId) && channelId === null)
  ) {
    return { status: "invalid" };
  }

  if (
    today === null ||
    typeof contentVersion !== "string" ||
    !isBoundedValue(contentVersion, 128)
  ) {
    return { status: "unavailable" };
  }

  if (
    today.content.fortuneDate !== fortuneDate ||
    today.publicContentContext.servedFortuneDate !== fortuneDate ||
    contentVersion !== expectedContentVersion
  ) {
    return { status: "stale" };
  }

  return {
    channelId,
    contentVersion,
    fortuneDate,
    status: "ready",
    today,
  };
}
