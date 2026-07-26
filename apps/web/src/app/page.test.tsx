import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TodayPageContent } from "../components/today-page-content";
import type { TodayPageData } from "../lib/today";

const todayResponse = {
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
  ciJiCard: null,
  daJiCard: {
    algorithmLabel: "大吉",
    colors: [
      { colorCode: "purple", name: "紫色" },
      { colorCode: "red", name: "红色" },
      { colorCode: "orange", name: "橙色" },
    ],
    contentVersion: "fd-20260715-r1",
    displayLabel: "今日优先",
    element: "fire",
    elementLabel: "火",
    explanation: "今日木日，木生火，火为大吉。",
    rank: 1,
    relationText: "木生火",
    tierCode: "da_ji",
  },
  requestContext: {
    civilDate: "2026-07-14",
    crossedDayBoundary: true,
    fortuneDate: "2026-07-15",
    shichen: "子",
  },
} satisfies TodayPageData;

describe("Today homepage date area", () => {
  it("renders the server-provided date area instead of the visual sample page", () => {
    render(<TodayPageContent today={todayResponse} />);

    expect(screen.getByRole("heading", { name: "今日木日" })).toBeVisible();
    expect(screen.getByText("2026年7月15日")).toBeVisible();
    expect(screen.getByText("大吉")).toBeVisible();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "紫色",
      "红色",
      "橙色",
    ]);
    expect(screen.queryByText("Five P0 视觉基础")).not.toBeInTheDocument();
    expect(
      screen.queryByText("这里展示基础样式，不代表任何一天的实际结果。"),
    ).not.toBeInTheDocument();
  });

  it("keeps the date but renders no partial card when da_ji is unavailable", () => {
    render(<TodayPageContent today={{ ...todayResponse, daJiCard: null }} />);

    expect(screen.getByText("2026年7月15日")).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日木日" })).toBeVisible();
    expect(screen.queryByText("大吉")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "大吉颜色" })).not.toBeInTheDocument();
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
