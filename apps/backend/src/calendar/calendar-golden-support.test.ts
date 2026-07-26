import { describe, expect, it } from "vitest";

import {
  buildCalendarGoldenData,
  verifyCalendarGoldenData,
} from "../../scripts/calendar-golden-support";

describe("calendar golden data", () => {
  it("builds exactly 366 fixed answers including both range endpoints", () => {
    const data = buildCalendarGoldenData();

    expect(data.range).toEqual({
      count: 366,
      from: "2026-01-01",
      to: "2027-01-01",
    });
    expect(data.entries).toHaveLength(366);
    expect(data.entries.at(0)?.fortuneDate).toBe("2026-01-01");
    expect(data.entries.at(-1)?.fortuneDate).toBe("2027-01-01");
  });

  it("keeps the required time, Zi-hour, month, year and leap-day boundaries", () => {
    const data = buildCalendarGoldenData();

    expect(data.boundaries.map(({ id }) => id)).toEqual([
      "before-23h",
      "at-23h",
      "last-minute-before-midnight",
      "civil-midnight",
      "zi-hour-last-minute",
      "zi-hour-end",
      "month-end",
      "year-end",
      "leap-day-start",
      "leap-day-end",
    ]);

    expect(data.boundaries.find(({ id }) => id === "before-23h")?.requestContext).toMatchObject({
      civilDate: "2026-07-23",
      crossedDayBoundary: false,
      fortuneDate: "2026-07-23",
      shichen: "亥",
    });
    expect(data.boundaries.find(({ id }) => id === "at-23h")?.requestContext).toMatchObject({
      civilDate: "2026-07-23",
      crossedDayBoundary: true,
      fortuneDate: "2026-07-24",
      shichen: "子",
    });
    expect(data.boundaries.find(({ id }) => id === "civil-midnight")?.requestContext).toMatchObject(
      {
        civilDate: "2026-07-24",
        crossedDayBoundary: false,
        fortuneDate: "2026-07-24",
        shichen: "子",
      },
    );
    expect(data.boundaries.find(({ id }) => id === "year-end")?.requestContext).toMatchObject({
      civilDate: "2026-12-31",
      fortuneDate: "2027-01-01",
    });
    expect(data.boundaries.find(({ id }) => id === "leap-day-start")?.requestContext).toMatchObject(
      {
        civilDate: "2024-02-28",
        fortuneDate: "2024-02-29",
      },
    );
  });

  it("stores the national-standard anchor, pre-anchor and 60-day repeat references", () => {
    const data = buildCalendarGoldenData();

    expect(data.referenceCases.map(({ fortuneDate, id }) => ({ fortuneDate, id }))).toEqual([
      { fortuneDate: "1949-10-01", id: "standard-anchor" },
      { fortuneDate: "1949-09-30", id: "pre-anchor" },
      { fortuneDate: "1949-11-30", id: "anchor-plus-60-days" },
    ]);
    expect(data.referenceCases[0]?.calendar.ganzhiDay).toBe("甲子");
    expect(data.referenceCases[1]?.calendar.ganzhiIndex).toBe(59);
    expect(data.referenceCases[2]?.calendar.ganzhiDay).toBe("甲子");
  });

  it("verifies every fixed answer and both stored checksums", () => {
    expect(verifyCalendarGoldenData(buildCalendarGoldenData())).toEqual({
      checkedBoundaries: 10,
      checkedDays: 366,
      checkedReferences: 3,
      lunarCrossChecks: 366,
    });
  });

  it("fails instead of rewriting a changed answer", () => {
    const data = structuredClone(buildCalendarGoldenData());
    const changed = data.entries[100];

    if (changed === undefined) {
      throw new Error("Missing test entry");
    }

    changed.ganzhiDay = "甲子";

    expect(() => verifyCalendarGoldenData(data)).toThrow(/2026-04-11/);
    expect(changed.ganzhiDay).toBe("甲子");
  });
});
