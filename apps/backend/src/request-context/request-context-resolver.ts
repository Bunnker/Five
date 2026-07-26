import type { components } from "@five/api-contract";

export type RequestContext = components["schemas"]["RequestContext"];
type Shichen = RequestContext["shichen"];

export interface Clock {
  now(): Date;
}

interface ShanghaiDateTimeParts {
  day: number;
  fractionalSecond: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

const TIMEZONE = "Asia/Shanghai" as const;
const DAY_BOUNDARY_HOUR = 23 as const;
const DAY_BOUNDARY = `${DAY_BOUNDARY_HOUR}:00` as const;
const HOURS_PER_SHICHEN = 2;
const SHICHEN_BOUNDARY_OFFSET_HOURS = 1;
const MILLISECONDS_PER_MINUTE = 60_000;
const SHICHEN_SEQUENCE = [
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
] as const satisfies readonly Shichen[];

const shanghaiFormatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
  calendar: "gregory",
  day: "2-digit",
  fractionalSecondDigits: 3,
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: TIMEZONE,
  year: "numeric",
});

function requirePart(parts: ReadonlyMap<string, string>, name: string): string {
  const value = parts.get(name);

  if (value === undefined) {
    throw new Error(`Intl did not return the ${name} part`);
  }

  return value;
}

function readShanghaiParts(instant: Date): ShanghaiDateTimeParts {
  const parts = new Map(
    shanghaiFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    day: Number(requirePart(parts, "day")),
    fractionalSecond: Number(requirePart(parts, "fractionalSecond")),
    hour: Number(requirePart(parts, "hour")),
    minute: Number(requirePart(parts, "minute")),
    month: Number(requirePart(parts, "month")),
    second: Number(requirePart(parts, "second")),
    year: Number(requirePart(parts, "year")),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function formatDate({ day, month, year }: ShanghaiDateTimeParts): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function addOneCalendarDay({ day, month, year }: ShanghaiDateTimeParts): string {
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return `${pad(nextDay.getUTCFullYear(), 4)}-${pad(nextDay.getUTCMonth() + 1)}-${pad(
    nextDay.getUTCDate(),
  )}`;
}

function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(totalMinutes);
  return `${sign}${pad(Math.floor(absoluteMinutes / 60))}:${pad(absoluteMinutes % 60)}`;
}

function formatResponseGeneratedAt(instant: Date, parts: ShanghaiDateTimeParts): string {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.fractionalSecond,
  );
  const offsetMinutes = Math.round((localAsUtc - instant.getTime()) / MILLISECONDS_PER_MINUTE);
  const fraction = parts.fractionalSecond === 0 ? "" : `.${pad(parts.fractionalSecond, 3)}`;

  return `${formatDate(parts)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(
    parts.second,
  )}${fraction}${formatOffset(offsetMinutes)}`;
}

function resolveShichen(hour: number): Shichen {
  // 十二时辰在北京时间的奇数整点切换，子时从 23:00 跨民用午夜到 01:00。
  const index =
    Math.floor((hour + SHICHEN_BOUNDARY_OFFSET_HOURS) / HOURS_PER_SHICHEN) %
    SHICHEN_SEQUENCE.length;
  const shichen = SHICHEN_SEQUENCE[index];

  if (shichen === undefined) {
    throw new Error(`Unable to resolve shichen for hour ${hour}`);
  }

  return shichen;
}

export class RequestContextResolver {
  constructor(private readonly clock: Clock) {}

  resolve(): RequestContext {
    const instant = this.clock.now();

    if (Number.isNaN(instant.getTime())) {
      throw new RangeError("Clock returned an invalid instant");
    }

    const local = readShanghaiParts(instant);
    const civilDate = formatDate(local);
    const crossedDayBoundary = local.hour >= DAY_BOUNDARY_HOUR;

    return {
      civilDate,
      crossedDayBoundary,
      dayBoundary: DAY_BOUNDARY,
      fortuneDate: crossedDayBoundary ? addOneCalendarDay(local) : civilDate,
      responseGeneratedAt: formatResponseGeneratedAt(instant, local),
      shichen: resolveShichen(local.hour),
      timezone: TIMEZONE,
    };
  }
}
