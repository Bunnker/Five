import { describe, expect, it } from "vitest";

import {
  CALENDAR_RULE_VERSION,
  CalendarRuleEngine,
  type CalendarDayAnswer,
} from "./calendar-rule-engine";

const engine = new CalendarRuleEngine();

function addDays(fortuneDate: string, days: number): string {
  const [year, month, day] = fortuneDate.split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid test date: ${fortuneDate}`);
  }

  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    result.getUTCFullYear().toString().padStart(4, "0"),
    (result.getUTCMonth() + 1).toString().padStart(2, "0"),
    result.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function expectDay(
  fortuneDate: string,
  expected: Pick<CalendarDayAnswer, "dayBranch" | "dayElement" | "ganzhiDay" | "ganzhiIndex">,
): void {
  expect(engine.evaluate(fortuneDate)).toMatchObject(expected);
}

describe("CalendarRuleEngine", () => {
  it("uses the national-standard anchor and the PRD examples", () => {
    expectDay("1949-10-01", {
      dayBranch: "子",
      dayElement: "water",
      ganzhiDay: "甲子",
      ganzhiIndex: 0,
    });
    expectDay("2026-07-15", {
      dayBranch: "寅",
      dayElement: "wood",
      ganzhiDay: "庚寅",
      ganzhiIndex: 26,
    });
    expectDay("2026-07-23", {
      dayBranch: "戌",
      dayElement: "earth",
      ganzhiDay: "戊戌",
      ganzhiIndex: 34,
    });
    expectDay("2026-07-24", {
      dayBranch: "亥",
      dayElement: "water",
      ganzhiDay: "己亥",
      ganzhiIndex: 35,
    });
  });

  it("keeps pre-anchor dates inside the positive 60-day cycle", () => {
    expectDay("1949-09-30", {
      dayBranch: "亥",
      dayElement: "water",
      ganzhiDay: "癸亥",
      ganzhiIndex: 59,
    });
  });

  it("derives the complete five-tier order from the day element", () => {
    expect(engine.evaluate("2026-07-15").tiers).toEqual([
      { element: "fire", rank: 1, tierCode: "da_ji" },
      { element: "wood", rank: 2, tierCode: "ci_ji" },
      { element: "metal", rank: 3, tierCode: "ping" },
      { element: "water", rank: 4, tierCode: "jiao_cha" },
      { element: "earth", rank: 5, tierCode: "bu_li" },
    ]);
  });

  it.each([
    {
      fortuneDate: "1949-10-01",
      tiers: ["wood", "water", "earth", "metal", "fire"],
    },
    {
      fortuneDate: "1949-10-02",
      tiers: ["metal", "earth", "wood", "fire", "water"],
    },
    {
      fortuneDate: "1949-10-03",
      tiers: ["fire", "wood", "metal", "water", "earth"],
    },
    {
      fortuneDate: "1949-10-06",
      tiers: ["earth", "fire", "water", "wood", "metal"],
    },
    {
      fortuneDate: "1949-10-09",
      tiers: ["water", "metal", "fire", "earth", "wood"],
    },
  ] as const)(
    "checks all five day-element tier directions for $fortuneDate",
    ({ fortuneDate, tiers }) => {
      expect(engine.evaluate(fortuneDate).tiers.map(({ element }) => element)).toEqual(tiers);
    },
  );

  it("records the one-day content-effective interval at the Beijing 23:00 boundary", () => {
    expect(engine.evaluate("2026-07-24")).toMatchObject({
      calendarRuleVersion: CALENDAR_RULE_VERSION,
      effectiveFrom: "2026-07-23T23:00:00+08:00",
      effectiveTo: "2026-07-24T23:00:00+08:00",
      fortuneDate: "2026-07-24",
    });
  });

  it("advances one step per civil date and repeats after 60 days", () => {
    for (const date of ["2024-02-28", "2024-02-29", "2026-12-31"]) {
      const current = engine.evaluate(date);
      const next = engine.evaluate(addDays(date, 1));

      expect(next.ganzhiIndex).toBe((current.ganzhiIndex + 1) % 60);
    }

    const start = engine.evaluate("2026-01-01");
    const afterSixtyDays = engine.evaluate(addDays("2026-01-01", 60));
    expect(afterSixtyDays.ganzhiDay).toBe(start.ganzhiDay);
    expect(afterSixtyDays.ganzhiIndex).toBe(start.ganzhiIndex);
  });

  it.each(["2026-02-29", "2026-13-01", "not-a-date", "2026-7-01"])(
    "rejects an invalid or non-canonical date: %s",
    (fortuneDate) => {
      expect(() => engine.evaluate(fortuneDate)).toThrow(RangeError);
    },
  );
});
