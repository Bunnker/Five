import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayDateData } from "../lib/today";
import { TodayDateRegion } from "./today-date-region";

const todayResponse = {
  content: {
    calendar: {
      branch: "亥",
      dayElement: "water",
      dayElementLabel: "水",
      ganzhiDay: "己亥",
      lunarDateText: "六月十一",
      weekdayText: "星期五",
    },
    fortuneDate: "2026-07-24",
  },
  publicContentContext: {
    advancedFromCivilDate: true,
    servedFortuneDate: "2026-07-24",
    switchBoundary: "18:00",
  },
  requestContext: {
    civilDate: "2026-07-23",
    crossedDayBoundary: true,
    fortuneDate: "2026-07-24",
    shichen: "子",
  },
} satisfies TodayDateData;

describe("TodayDateRegion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2041-12-31T04:20:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the complete date summary supplied by the today response", () => {
    render(<TodayDateRegion today={todayResponse} />);

    expect(screen.getByText("2026年7月24日")).toBeVisible();
    expect(screen.getByText("星期五")).toBeVisible();
    expect(screen.getByText("六月十一")).toBeVisible();
    expect(screen.getByText("己亥日")).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日水日" })).toBeVisible();
    expect(screen.getByText("水", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("子时")).toBeVisible();
  });

  it("uses the server-served public content date instead of the civil or browser date", () => {
    render(<TodayDateRegion today={todayResponse} />);

    expect(screen.getByText("2026年7月24日")).toBeVisible();
    expect(screen.queryByText("2026年7月23日")).not.toBeInTheDocument();
    expect(screen.queryByText(/2041年|12月31日/u)).not.toBeInTheDocument();
    expect(screen.getByText("明日建议已更新")).toBeVisible();
    expect(screen.getByText("已进入次日子时")).toBeVisible();
  });

  it("shows the next public date at 18:00 while keeping the 23:00 fortune context unchanged", () => {
    const atPublicSwitch = {
      ...todayResponse,
      requestContext: {
        ...todayResponse.requestContext,
        crossedDayBoundary: false,
        fortuneDate: "2026-07-23",
        shichen: "酉" as const,
      },
    };

    render(<TodayDateRegion today={atPublicSwitch} />);

    expect(screen.getByText("2026年7月24日")).toBeVisible();
    expect(screen.getByText("明日建议已更新")).toBeVisible();
    expect(screen.getByText("酉时")).toBeVisible();
    expect(screen.queryByText("已进入次日子时")).not.toBeInTheDocument();
  });

  it("does not infer the crossed-day notice from the 子时 label alone", () => {
    const afterMidnight = {
      ...todayResponse,
      requestContext: {
        ...todayResponse.requestContext,
        civilDate: "2026-07-24",
        crossedDayBoundary: false,
        responseGeneratedAt: "2026-07-24T00:30:00+08:00",
      },
      publicContentContext: {
        advancedFromCivilDate: false,
        servedFortuneDate: "2026-07-24",
        switchBoundary: "18:00" as const,
      },
    };

    render(<TodayDateRegion today={afterMidnight} />);

    expect(screen.getByText("子时")).toBeVisible();
    expect(screen.queryByText("明日建议已更新")).not.toBeInTheDocument();
    expect(screen.queryByText("已进入次日子时")).not.toBeInTheDocument();
  });
});
