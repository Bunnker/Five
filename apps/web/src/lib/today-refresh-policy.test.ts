import { describe, expect, it } from "vitest";

import type { CompleteTodayPageData, TodaySnapshot } from "./today";
import { resolveTodayContextBoundary, resolveTodayRefreshSchedule } from "./today-refresh-policy";

function snapshot({
  civilDate,
  effectiveTo,
  responseGeneratedAt,
  servedFortuneDate = "2026-07-24",
}: {
  civilDate: string;
  effectiveTo: string;
  responseGeneratedAt: string;
  servedFortuneDate?: string;
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
      publicContentContext: {
        advancedFromCivilDate: servedFortuneDate !== civilDate,
        servedFortuneDate,
        switchBoundary: "18:00",
      },
    } as CompleteTodayPageData,
    effectiveFrom: "2026-07-23T18:00:00+08:00",
    effectiveTo,
    fortuneDate: servedFortuneDate,
    responseGeneratedAt,
    serverObservedAtMs: Date.parse(responseGeneratedAt),
  };
}

describe("today refresh policy", () => {
  it("treats Beijing 18:00 as the blocking public-content boundary", () => {
    const value = snapshot({
      civilDate: "2026-07-24",
      effectiveTo: "2026-07-24T18:00:00+08:00",
      responseGeneratedAt: "2026-07-24T17:59:59.500+08:00",
    });

    expect(resolveTodayContextBoundary(value)).toEqual({
      atMs: Date.parse("2026-07-24T18:00:00+08:00"),
      reason: "public_content_boundary",
    });
    expect(resolveTodayRefreshSchedule(value, 500)).toEqual({
      blocksStaleContext: true,
      delayMs: 500,
      reason: "public_content_boundary",
    });
  });

  it("still refreshes the 23:00 fortune context after public content switched at 18:00", () => {
    const value = snapshot({
      civilDate: "2026-07-23",
      effectiveTo: "2026-07-24T18:00:00+08:00",
      responseGeneratedAt: "2026-07-23T22:59:59.500+08:00",
    });

    expect(resolveTodayContextBoundary(value)).toEqual({
      atMs: Date.parse("2026-07-23T23:00:00+08:00"),
      reason: "fortune_context_boundary",
    });
  });

  it("refreshes the complete context at civil midnight without moving fortuneDate again", () => {
    const value = snapshot({
      civilDate: "2026-07-23",
      effectiveTo: "2026-07-24T18:00:00+08:00",
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
      effectiveTo: "2026-07-24T18:00:00+08:00",
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
      effectiveTo: "2026-07-24T18:00:00+08:00",
      responseGeneratedAt: "2026-07-24T10:00:00+08:00",
    });

    expect(resolveTodayRefreshSchedule(value, 3_600_000)).toEqual({
      blocksStaleContext: false,
      delayMs: 60_000,
      reason: "poll",
    });
  });
});
