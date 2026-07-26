import { describe, expect, it } from "vitest";

import type { TodayPageData } from "./today";
import { resolveTodayEntry } from "./today-entry";

const today = {
  attentionSection: null,
  ciJiCard: null,
  content: {
    calendar: {
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
});
