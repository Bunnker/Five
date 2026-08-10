import { describe, expect, it } from "vitest";

import type { TodayPageData } from "./today";
import { resolveTodayEntry } from "./today-entry";

const today = {
  attentionSection: null,
  ciJiCard: null,
  content: {
    calendar: {
      branch: "寅",
      dayElement: "wood",
      dayElementLabel: "木",
      ganzhiDay: "庚寅",
      lunarDateText: "六月初二",
      weekdayText: "星期三",
    },
    fortuneDate: "2026-07-15",
  },
  daJiCard: null,
  imagePreviewSection: null,
  outfitPreviewSection: null,
  pingCard: null,
  publicContentContext: {
    advancedFromCivilDate: false,
    servedFortuneDate: "2026-07-15",
    switchBoundary: "18:00",
  },
  requestContext: {
    civilDate: "2026-07-15",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-15",
    shichen: "午",
  },
} satisfies TodayPageData;

describe("resolveTodayEntry", () => {
  it("opens content only when the date and opaque content version both match", () => {
    expect(
      resolveTodayEntry(
        today,
        {
          expectedContentVersion: " version%2Fwith-reserved-characters ",
          fortuneDate: "2026-07-15",
        },
        {
          contentVersion: " version%2Fwith-reserved-characters ",
        },
      ),
    ).toEqual({
      channelId: null,
      contentVersion: " version%2Fwith-reserved-characters ",
      fortuneDate: "2026-07-15",
      status: "ready",
      today,
    });
  });

  it.each([
    {
      advancedFromCivilDate: false,
      civilDate: "2026-07-15",
      contentVersion: "fd-20260715-r1",
      crossedDayBoundary: false,
      label: "17:59 still serves the civil date",
      requestFortuneDate: "2026-07-15",
      servedFortuneDate: "2026-07-15",
      shichen: "酉" as const,
    },
    {
      advancedFromCivilDate: true,
      civilDate: "2026-07-15",
      contentVersion: "fd-20260716-r1",
      crossedDayBoundary: false,
      label: "18:00 serves the next date before the fortune day advances",
      requestFortuneDate: "2026-07-15",
      servedFortuneDate: "2026-07-16",
      shichen: "酉" as const,
    },
    {
      advancedFromCivilDate: true,
      civilDate: "2026-07-15",
      contentVersion: "fd-20260716-r1",
      crossedDayBoundary: false,
      label: "22:59 keeps serving that next date",
      requestFortuneDate: "2026-07-15",
      servedFortuneDate: "2026-07-16",
      shichen: "亥" as const,
    },
    {
      advancedFromCivilDate: true,
      civilDate: "2026-07-15",
      contentVersion: "fd-20260716-r1",
      crossedDayBoundary: true,
      label: "23:00 advances only the fortune context",
      requestFortuneDate: "2026-07-16",
      servedFortuneDate: "2026-07-16",
      shichen: "子" as const,
    },
  ])("opens the authoritative public content at $label", (example) => {
    const boundaryToday = {
      ...today,
      content: { ...today.content, fortuneDate: example.servedFortuneDate },
      publicContentContext: {
        advancedFromCivilDate: example.advancedFromCivilDate,
        servedFortuneDate: example.servedFortuneDate,
        switchBoundary: "18:00" as const,
      },
      requestContext: {
        civilDate: example.civilDate,
        crossedDayBoundary: example.crossedDayBoundary,
        fortuneDate: example.requestFortuneDate,
        shichen: example.shichen,
      },
    } satisfies TodayPageData;

    expect(
      resolveTodayEntry(
        boundaryToday,
        {
          expectedContentVersion: example.contentVersion,
          fortuneDate: example.servedFortuneDate,
        },
        { contentVersion: example.contentVersion },
      ),
    ).toEqual({
      channelId: null,
      contentVersion: example.contentVersion,
      fortuneDate: example.servedFortuneDate,
      status: "ready",
      today: boundaryToday,
    });
  });

  it("rejects content when its served date disagrees with the content date", () => {
    expect(
      resolveTodayEntry(
        {
          ...today,
          publicContentContext: {
            ...today.publicContentContext,
            servedFortuneDate: "2026-07-16",
          },
        },
        {
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        },
        { contentVersion: "fd-20260715-r1" },
      ),
    ).toEqual({ status: "stale" });
  });

  it.each([
    ["a missing date", { expectedContentVersion: "fd-20260715-r1" }],
    [
      "more than one date",
      {
        expectedContentVersion: "fd-20260715-r1",
        fortuneDate: ["2026-07-15", "2026-07-16"],
      },
    ],
    [
      "a calendar date that does not exist",
      {
        expectedContentVersion: "fd-20260715-r1",
        fortuneDate: "2026-02-30",
      },
    ],
  ])("rejects %s instead of guessing", (_reason, params) => {
    expect(
      resolveTodayEntry(today, params, {
        contentVersion: "fd-20260715-r1",
      }),
    ).toEqual({ status: "invalid" });
  });

  it.each([
    ["the requested date changed", "2026-07-14", "fd-20260715-r1"],
    ["the requested version changed", "2026-07-15", "fd-20260714-r9"],
  ])("reports stale content when %s", (_reason, fortuneDate, expectedContentVersion) => {
    expect(
      resolveTodayEntry(
        today,
        {
          expectedContentVersion,
          fortuneDate,
        },
        {
          contentVersion: "fd-20260715-r1",
        },
      ),
    ).toEqual({ status: "stale" });
  });

  it("reports unavailable content separately from a stale link", () => {
    expect(
      resolveTodayEntry(
        null,
        {
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        },
        {
          contentVersion: null,
        },
      ),
    ).toEqual({ status: "unavailable" });
  });

  it("requires one safe channel id for a share entry", () => {
    expect(
      resolveTodayEntry(
        today,
        {
          channelId: "wechat_group",
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        },
        {
          contentVersion: "fd-20260715-r1",
          requireChannelId: true,
        },
      ),
    ).toEqual({
      channelId: "wechat_group",
      contentVersion: "fd-20260715-r1",
      fortuneDate: "2026-07-15",
      status: "ready",
      today,
    });

    expect(
      resolveTodayEntry(
        today,
        {
          channelId: ["wechat_group", "organic"],
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        },
        {
          contentVersion: "fd-20260715-r1",
          requireChannelId: true,
        },
      ),
    ).toEqual({ status: "invalid" });
  });

  it("preserves one optional safe channel and rejects an optional unsafe channel", () => {
    expect(
      resolveTodayEntry(
        today,
        {
          channelId: "wechat_official",
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        },
        { contentVersion: "fd-20260715-r1" },
      ),
    ).toMatchObject({ channelId: "wechat_official", status: "ready" });

    expect(
      resolveTodayEntry(
        today,
        {
          channelId: "wechat\nheader",
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        },
        { contentVersion: "fd-20260715-r1" },
      ),
    ).toEqual({ status: "invalid" });
  });
});
