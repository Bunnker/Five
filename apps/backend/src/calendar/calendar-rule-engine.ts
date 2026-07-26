export const CALENDAR_RULE_VERSION = "fortune-date-23h-v1" as const;
export const CALENDAR_SOURCE = "gbt-33661-2017-anchor-1949-10-01-jiazi" as const;

export type FiveElement = "wood" | "fire" | "earth" | "metal" | "water";
export type TierCode = "da_ji" | "ci_ji" | "ping" | "jiao_cha" | "bu_li";

export interface CalendarTierAnswer {
  element: FiveElement;
  rank: 1 | 2 | 3 | 4 | 5;
  tierCode: TierCode;
}

export interface CalendarDayAnswer {
  calendarRuleVersion: typeof CALENDAR_RULE_VERSION;
  dayBranch: DayBranch;
  dayElement: FiveElement;
  dayStem: DayStem;
  effectiveFrom: string;
  effectiveTo: string;
  fortuneDate: string;
  ganzhiDay: string;
  ganzhiIndex: number;
  source: typeof CALENDAR_SOURCE;
  tiers: CalendarTierAnswer[];
}

const MILLISECONDS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ANCHOR_DATE = "1949-10-01";

const DAY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
type DayStem = (typeof DAY_STEMS)[number];

const DAY_BRANCHES = [
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
type DayBranch = (typeof DAY_BRANCHES)[number];

const BRANCH_ELEMENTS: Readonly<Record<DayBranch, FiveElement>> = {
  丑: "earth",
  亥: "water",
  午: "fire",
  卯: "wood",
  子: "water",
  寅: "wood",
  巳: "fire",
  戌: "earth",
  未: "earth",
  申: "metal",
  辰: "earth",
  酉: "metal",
};

const GENERATES: Readonly<Record<FiveElement, FiveElement>> = {
  earth: "metal",
  fire: "earth",
  metal: "water",
  water: "wood",
  wood: "fire",
};

const GENERATED_BY: Readonly<Record<FiveElement, FiveElement>> = {
  earth: "fire",
  fire: "wood",
  metal: "earth",
  water: "metal",
  wood: "water",
};

const CONTROLS: Readonly<Record<FiveElement, FiveElement>> = {
  earth: "water",
  fire: "metal",
  metal: "wood",
  water: "fire",
  wood: "earth",
};

const CONTROLLED_BY: Readonly<Record<FiveElement, FiveElement>> = {
  earth: "wood",
  fire: "water",
  metal: "fire",
  water: "earth",
  wood: "metal",
};

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function formatEpochDay(epochDay: number): string {
  const date = new Date(epochDay * MILLISECONDS_PER_DAY);
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function parseEpochDay(fortuneDate: string): number {
  const match = DATE_PATTERN.exec(fortuneDate);

  if (match === null) {
    throw new RangeError(`fortuneDate must use YYYY-MM-DD: ${fortuneDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`fortuneDate is not a valid Gregorian date: ${fortuneDate}`);
  }

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`fortuneDate is not a valid Gregorian date: ${fortuneDate}`);
  }

  return Math.floor(date.getTime() / MILLISECONDS_PER_DAY);
}

function requireAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];

  if (value === undefined) {
    throw new Error(`Unable to resolve ${label} at index ${index}`);
  }

  return value;
}

function resolveTiers(dayElement: FiveElement): CalendarTierAnswer[] {
  return [
    { element: GENERATES[dayElement], rank: 1, tierCode: "da_ji" },
    { element: dayElement, rank: 2, tierCode: "ci_ji" },
    { element: CONTROLLED_BY[dayElement], rank: 3, tierCode: "ping" },
    { element: GENERATED_BY[dayElement], rank: 4, tierCode: "jiao_cha" },
    { element: CONTROLS[dayElement], rank: 5, tierCode: "bu_li" },
  ];
}

const ANCHOR_EPOCH_DAY = parseEpochDay(ANCHOR_DATE);

export class CalendarRuleEngine {
  evaluate(fortuneDate: string): CalendarDayAnswer {
    const epochDay = parseEpochDay(fortuneDate);
    const ganzhiIndex = positiveMod(epochDay - ANCHOR_EPOCH_DAY, 60);
    const dayStem = requireAt(DAY_STEMS, ganzhiIndex % DAY_STEMS.length, "day stem");
    const dayBranch = requireAt(DAY_BRANCHES, ganzhiIndex % DAY_BRANCHES.length, "day branch");
    const dayElement = BRANCH_ELEMENTS[dayBranch];

    return {
      calendarRuleVersion: CALENDAR_RULE_VERSION,
      dayBranch,
      dayElement,
      dayStem,
      effectiveFrom: `${formatEpochDay(epochDay - 1)}T23:00:00+08:00`,
      effectiveTo: `${fortuneDate}T23:00:00+08:00`,
      fortuneDate,
      ganzhiDay: `${dayStem}${dayBranch}`,
      ganzhiIndex,
      source: CALENDAR_SOURCE,
      tiers: resolveTiers(dayElement),
    };
  }
}
