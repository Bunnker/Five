import { describe, expect, it } from "vitest";

import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { TodayCachePolicy } from "./today-cache-policy";

const policy = new TodayCachePolicy();

function requestContextAt(instant: string) {
  return new RequestContextResolver({
    now: () => new Date(instant),
  }).resolve();
}

function publicContentContextAt(instant: string) {
  return new PublicContentContextResolver().resolve(requestContextAt(instant));
}

describe("TodayCachePolicy", () => {
  it("cannot cache a /today response across the 18:00 public switch", () => {
    expect(
      policy.calculate(
        requestContextAt("2026-07-24T17:59:59.001+08:00"),
        "2026-07-24T23:00:00+08:00",
        publicContentContextAt("2026-07-24T17:59:59.001+08:00"),
      ).sharedMaxAgeSeconds,
    ).toBe(0);
    expect(
      policy.calculate(
        requestContextAt("2026-07-24T18:00:00+08:00"),
        "2026-07-25T18:00:00+08:00",
        publicContentContextAt("2026-07-24T18:00:00+08:00"),
      ).sharedMaxAgeSeconds,
    ).toBe(60);
  });

  it("caps shared caching at 60 seconds", () => {
    expect(
      policy.calculate(requestContextAt("2026-07-24T10:00:00+08:00"), "2026-07-24T23:00:00+08:00"),
    ).toEqual({
      cacheControl: "public, max-age=0, s-maxage=60, must-revalidate",
      sharedMaxAgeSeconds: 60,
    });
  });

  it.each([
    {
      effectiveTo: "2026-07-23T23:00:00+08:00",
      instant: "2026-07-23T22:59:42.250+08:00",
      reason: "the 23:00 fortune-date and shichen boundary",
    },
    {
      effectiveTo: "2026-07-24T23:00:00+08:00",
      instant: "2026-07-23T23:59:42.250+08:00",
      reason: "civil midnight",
    },
    {
      effectiveTo: "2026-07-24T23:00:00+08:00",
      instant: "2026-07-24T00:59:42.250+08:00",
      reason: "the next shichen",
    },
  ])("stops before $reason", ({ effectiveTo, instant }) => {
    expect(policy.calculate(requestContextAt(instant), effectiveTo)).toEqual({
      cacheControl: "public, max-age=0, s-maxage=17, must-revalidate",
      sharedMaxAgeSeconds: 17,
    });
  });

  it("stops at content effectiveTo when it is the nearest boundary", () => {
    expect(
      policy.calculate(
        requestContextAt("2026-07-24T10:00:00.500+08:00"),
        "2026-07-24T10:00:12.999+08:00",
      ),
    ).toEqual({
      cacheControl: "public, max-age=0, s-maxage=12, must-revalidate",
      sharedMaxAgeSeconds: 12,
    });
  });

  it("rounds down instead of allowing a cached response to cross a boundary", () => {
    expect(
      policy.calculate(
        requestContextAt("2026-07-24T00:59:59.999+08:00"),
        "2026-07-24T23:00:00+08:00",
      ),
    ).toEqual({
      cacheControl: "public, max-age=0, s-maxage=0, must-revalidate",
      sharedMaxAgeSeconds: 0,
    });
  });

  it.each([
    ["2026-07-23T22:59:00+08:00", "2026-07-23T23:00:00+08:00", 60],
    ["2026-07-23T22:59:00.001+08:00", "2026-07-23T23:00:00+08:00", 59],
    ["2026-07-23T22:59:59+08:00", "2026-07-23T23:00:00+08:00", 1],
    ["2026-07-23T22:59:59.001+08:00", "2026-07-23T23:00:00+08:00", 0],
    ["2026-07-23T23:00:00+08:00", "2026-07-24T23:00:00+08:00", 60],
    ["2026-07-23T23:59:00+08:00", "2026-07-24T23:00:00+08:00", 60],
    ["2026-07-23T23:59:00.001+08:00", "2026-07-24T23:00:00+08:00", 59],
    ["2026-07-23T23:59:59+08:00", "2026-07-24T23:00:00+08:00", 1],
    ["2026-07-23T23:59:59.001+08:00", "2026-07-24T23:00:00+08:00", 0],
    ["2026-07-24T00:00:00+08:00", "2026-07-24T23:00:00+08:00", 60],
    ["2026-07-24T00:59:00+08:00", "2026-07-24T23:00:00+08:00", 60],
    ["2026-07-24T00:59:00.001+08:00", "2026-07-24T23:00:00+08:00", 59],
    ["2026-07-24T00:59:59+08:00", "2026-07-24T23:00:00+08:00", 1],
    ["2026-07-24T00:59:59.001+08:00", "2026-07-24T23:00:00+08:00", 0],
    ["2026-07-24T01:00:00+08:00", "2026-07-24T23:00:00+08:00", 60],
  ])("returns a safe TTL at %s before content end %s", (instant, effectiveTo, expectedSeconds) => {
    expect(policy.calculate(requestContextAt(instant), effectiveTo).sharedMaxAgeSeconds).toBe(
      expectedSeconds,
    );
  });

  it.each([
    ["2026-07-24T10:00:42+08:00", 42],
    ["2026-07-24T10:00:41.999+08:00", 41],
    ["2026-07-24T10:00:01+08:00", 1],
    ["2026-07-24T10:00:00.999+08:00", 0],
  ])("uses the exact remaining seconds before %s", (effectiveTo, expectedSeconds) => {
    expect(
      policy.calculate(requestContextAt("2026-07-24T10:00:00+08:00"), effectiveTo)
        .sharedMaxAgeSeconds,
    ).toBe(expectedSeconds);
  });

  it("does not depend on the process timezone", () => {
    const originalTimezone = process.env.TZ;

    try {
      const results = ["UTC", "America/Los_Angeles", "Asia/Shanghai"].map((timezone) => {
        process.env.TZ = timezone;
        return policy.calculate(
          requestContextAt("2026-07-23T23:59:42.250+08:00"),
          "2026-07-24T23:00:00+08:00",
        );
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

  it("rejects an effectiveTo value without an explicit timezone", () => {
    expect(() =>
      policy.calculate(requestContextAt("2026-07-24T10:00:00+08:00"), "2026-07-24T23:00:00"),
    ).toThrow("content.effectiveTo must be a valid ISO 8601 instant");
  });
});
