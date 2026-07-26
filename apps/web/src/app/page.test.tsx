import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TodayPageContent } from "../components/today-page-content";
import type { TodayDateData } from "../lib/today";

const todayResponse = {
  content: {
    calendar: {
      dayElement: "water",
      dayElementLabel: "水",
      ganzhiDay: "己亥",
      lunarDateText: "六月十一",
      weekdayText: "星期五",
    },
    fortuneDate: "2026-07-24",
  },
  requestContext: {
    civilDate: "2026-07-23",
    crossedDayBoundary: true,
    fortuneDate: "2026-07-24",
    shichen: "子",
  },
} satisfies TodayDateData;

describe("Today homepage date area", () => {
  it("renders the server-provided date area instead of the visual sample page", () => {
    render(<TodayPageContent today={todayResponse} />);

    expect(screen.getByRole("heading", { name: "今日水日" })).toBeVisible();
    expect(screen.getByText("2026年7月24日")).toBeVisible();
    expect(screen.queryByText("Five P0 视觉基础")).not.toBeInTheDocument();
    expect(
      screen.queryByText("这里展示基础样式，不代表任何一天的实际结果。"),
    ).not.toBeInTheDocument();
  });

  it("does not expose history, yesterday, calendar, profile or birth entry points", () => {
    render(<TodayPageContent today={todayResponse} />);

    const forbidden = /历史|昨日|日历|个人资料|个人五行|出生/u;
    for (const link of screen.queryAllByRole("link")) {
      expect(link).not.toHaveAccessibleName(forbidden);
      expect(link.getAttribute("href") ?? "").not.toMatch(
        /history|yesterday|calendar|profile|birth/iu,
      );
    }
    for (const button of screen.queryAllByRole("button")) {
      expect(button).not.toHaveAccessibleName(forbidden);
    }
  });

  it("shows a safe temporary message instead of inventing content when today is unavailable", () => {
    render(<TodayPageContent today={null} />);

    expect(screen.getByRole("status")).toHaveTextContent("今日内容正在校验中");
    expect(screen.queryByRole("heading", { name: /今日.+日/u })).not.toBeInTheDocument();
  });
});
