import { describe, expect, it } from "vitest";

import type { CompleteTodayPageData, TodaySnapshot } from "./today";
import { resolveTodayContextBoundary, resolveTodayRefreshSchedule } from "./today-refresh-policy";

function snapshot({
  civilDate,
  effectiveTo,
  responseGeneratedAt,
}: {
  civilDate: string;
  effectiveTo: string;
  responseGeneratedAt: string;
}): TodaySnapshot {
  return {
    contentVersion: "fd-boundary-r1",
    data: {
      requestContext: {
        civilDate,
        crossedDayBoundary: responseGeneratedAt.slice(11, 13) === "23",
        fortuneDate: "2026-07-24",
        shichen: "子",
      },
    } as CompleteTodayPageData,
    effectiveFrom: "2026-07-23T23:00:00+08:00",
    effectiveTo,
    fortuneDate: "2026-07-24",
    responseGeneratedAt,
    serverObservedAtMs: Date.parse(responseGeneratedAt),
  };
}

describe("today refresh policy", () => {
  it("treats effectiveTo at 23:00 as a blocking fortune-day boundary", () => {
    const value = snapshot({
      civilDate: "2026-07-23",
      effectiveTo: "2026-07-23T23:00:00+08:00",
      responseGeneratedAt: "2026-07-23T22:59:59.500+08:00",
    });

    expect(resolveTodayContextBoundary(value)).toEqual({
      atMs: Date.parse("2026-07-23T23:00:00+08:00"),
      reason: "fortune_boundary",
    });
    expect(resolveTodayRefreshSchedule(value, 500)).toEqual({
      blocksStaleContext: true,
      delayMs: 500,
      reason: "fortune_boundary",
    });
  });

  it("refreshes the complete context at civil midnight without moving fortuneDate again", () => {
    const value = snapshot({
      civilDate: "2026-07-23",
      effectiveTo: "2026-07-24T23:00:00+08:00",
      responseGeneratedAt: "2026-07-23T23:59:59+08:00",
    });

    expect(resolveTodayContextBoundary(value)).toEqual({
      atMs: Date.parse("2026-07-24T00:00:00+08:00"),
      reason: "civil_midnight",
    });
    expect(resolveTodayRefreshSchedule(value, 1_000)).toEqual({
      blocksStaleContext: true,
      delayMs: 1_000,
      reason: "civil_midnight",
    });
  });

  it("does not let a returned shichen cross its next odd-hour boundary", () => {
    const value = snapshot({
      civilDate: "2026-07-24",
      effectiveTo: "2026-07-24T23:00:00+08:00",
      responseGeneratedAt: "2026-07-24T00:59:59+08:00",
    });

    expect(resolveTodayContextBoundary(value)).toEqual({
      atMs: Date.parse("2026-07-24T01:00:00+08:00"),
      reason: "shichen_boundary",
    });
  });

  it("polls at most every 60 seconds when every hard context boundary is farther away", () => {
    const value = snapshot({
      civilDate: "2026-07-24",
      effectiveTo: "2026-07-24T23:00:00+08:00",
      responseGeneratedAt: "2026-07-24T10:00:00+08:00",
    });

    expect(resolveTodayRefreshSchedule(value, 3_600_000)).toEqual({
      blocksStaleContext: false,
      delayMs: 60_000,
      reason: "poll",
    });
  });
});
