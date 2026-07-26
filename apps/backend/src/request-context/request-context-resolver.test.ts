import { describe, expect, it } from "vitest";

import {
  RequestContextResolver,
  type Clock,
  type RequestContext,
} from "./request-context-resolver";

function fixedClock(isoInstant: string): Clock {
  return {
    now: () => new Date(isoInstant),
  };
}

function resolveAt(isoInstant: string): RequestContext {
  return new RequestContextResolver(fixedClock(isoInstant)).resolve();
}

describe("RequestContextResolver", () => {
  it.each([
    {
      crossedDayBoundary: false,
      civilDate: "2026-07-23",
      fortuneDate: "2026-07-23",
      instant: "2026-07-23T22:59:00+08:00",
      shichen: "亥",
    },
    {
      crossedDayBoundary: true,
      civilDate: "2026-07-23",
      fortuneDate: "2026-07-24",
      instant: "2026-07-23T23:00:00+08:00",
      shichen: "子",
    },
    {
      crossedDayBoundary: true,
      civilDate: "2026-07-23",
      fortuneDate: "2026-07-24",
      instant: "2026-07-23T23:59:00+08:00",
      shichen: "子",
    },
    {
      crossedDayBoundary: false,
      civilDate: "2026-07-24",
      fortuneDate: "2026-07-24",
      instant: "2026-07-24T00:00:00+08:00",
      shichen: "子",
    },
    {
      crossedDayBoundary: false,
      civilDate: "2026-07-24",
      fortuneDate: "2026-07-24",
      instant: "2026-07-24T00:59:00+08:00",
      shichen: "子",
    },
    {
      crossedDayBoundary: false,
      civilDate: "2026-07-24",
      fortuneDate: "2026-07-24",
      instant: "2026-07-24T01:00:00+08:00",
      shichen: "丑",
    },
  ])(
    "resolves $instant without moving fortuneDate twice",
    ({ crossedDayBoundary, civilDate, fortuneDate, instant, shichen }) => {
      expect(resolveAt(instant)).toMatchObject({
        crossedDayBoundary,
        civilDate,
        dayBoundary: "23:00",
        fortuneDate,
        shichen,
        timezone: "Asia/Shanghai",
      });
    },
  );

  it.each([
    ["2026-07-24T00:59:59.999+08:00", "子"],
    ["2026-07-24T01:00:00+08:00", "丑"],
    ["2026-07-24T02:59:59.999+08:00", "丑"],
    ["2026-07-24T03:00:00+08:00", "寅"],
    ["2026-07-24T04:59:59.999+08:00", "寅"],
    ["2026-07-24T05:00:00+08:00", "卯"],
    ["2026-07-24T06:59:59.999+08:00", "卯"],
    ["2026-07-24T07:00:00+08:00", "辰"],
    ["2026-07-24T08:59:59.999+08:00", "辰"],
    ["2026-07-24T09:00:00+08:00", "巳"],
    ["2026-07-24T10:59:59.999+08:00", "巳"],
    ["2026-07-24T11:00:00+08:00", "午"],
    ["2026-07-24T12:59:59.999+08:00", "午"],
    ["2026-07-24T13:00:00+08:00", "未"],
    ["2026-07-24T14:59:59.999+08:00", "未"],
    ["2026-07-24T15:00:00+08:00", "申"],
    ["2026-07-24T16:59:59.999+08:00", "申"],
    ["2026-07-24T17:00:00+08:00", "酉"],
    ["2026-07-24T18:59:59.999+08:00", "酉"],
    ["2026-07-24T19:00:00+08:00", "戌"],
    ["2026-07-24T20:59:59.999+08:00", "戌"],
    ["2026-07-24T21:00:00+08:00", "亥"],
    ["2026-07-24T22:59:59.999+08:00", "亥"],
    ["2026-07-24T23:00:00+08:00", "子"],
  ])("maps %s to %s using left-closed, right-open shichen ranges", (instant, shichen) => {
    expect(resolveAt(instant).shichen).toBe(shichen);
  });

  it.each([
    ["2026-01-31T23:00:00+08:00", "2026-02-01"],
    ["2026-12-31T23:00:00+08:00", "2027-01-01"],
    ["2028-02-28T23:00:00+08:00", "2028-02-29"],
    ["2028-02-29T23:00:00+08:00", "2028-03-01"],
  ])("adds one civil calendar day at 23:00 for %s", (instant, fortuneDate) => {
    expect(resolveAt(instant).fortuneDate).toBe(fortuneDate);
  });

  it("always formats the response instant in Asia/Shanghai", () => {
    expect(resolveAt("2026-07-23T15:30:12.123Z").responseGeneratedAt).toBe(
      "2026-07-23T23:30:12.123+08:00",
    );
  });

  it("does not depend on the process timezone", () => {
    const originalTimezone = process.env.TZ;

    try {
      const results = ["UTC", "America/Los_Angeles", "Asia/Shanghai"].map((timezone) => {
        process.env.TZ = timezone;
        return resolveAt("2026-07-23T15:30:00Z");
      });

      expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it("reads the clock exactly once for one request context", () => {
    let calls = 0;
    const clock: Clock = {
      now: () => {
        calls += 1;
        return new Date("2026-07-23T15:30:00Z");
      },
    };

    new RequestContextResolver(clock).resolve();

    expect(calls).toBe(1);
  });

  it("rejects an invalid clock value", () => {
    const resolver = new RequestContextResolver({
      now: () => new Date(Number.NaN),
    });

    expect(() => resolver.resolve()).toThrow("Clock returned an invalid instant");
  });
});
